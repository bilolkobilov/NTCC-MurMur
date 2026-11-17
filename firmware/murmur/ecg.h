// Single-lead ECG from the TI ADS1292R, recorded at the same time as the microphone.
//
// How it runs: the chip raises DRDY 250 times a second; the interrupt only wakes a small FreeRTOS task on core 0,
// which reads the 9-byte frame over SPI and stores both channels in PSRAM. The microphone keeps core 1 (the Arduino
// loop), so neither waits for the other. Which channel carries the ECG depends on the cable and the electrode
// placement (bench, 2026-11-17), so both are sent and the server picks the cleaner one.
//
// Register values and timing are the owner's working bench code (Testing/ECG, 2026-11-15) plus the lead-off
// detector, which ran on the bench without changing the signal. GPIO48 is PWDN: it must stay HIGH, and the on-board
// RGB LED (also GPIO48) must never be written — one LED write stopped the chip (DRDY 247/s -> 0). See README.md.
#pragma once

#include <Arduino.h>
#include <SPI.h>

#include "config.h"

namespace ecg {

constexpr uint8_t CMD_RESET = 0x06, CMD_START_CONV = 0x08, CMD_RDATAC = 0x10, CMD_SDATAC = 0x11, CMD_RREG = 0x20,
                  CMD_WREG = 0x40;
constexpr uint8_t REG_ID = 0x00, REG_CONFIG1 = 0x01, REG_CONFIG2 = 0x02, REG_LOFF = 0x03, REG_CH1SET = 0x04,
                  REG_CH2SET = 0x05, REG_RLD_SENS = 0x06, REG_LOFF_SENS = 0x07, REG_RESP1 = 0x09, REG_RESP2 = 0x0A,
                  REG_GPIO = 0x0B;

static SPIClass spi(FSPI);
static const SPISettings SPI_CFG(1000000, MSBFIRST, SPI_MODE1);  // the ADS1292R uses SPI mode 1

static bool present = false;         // the chip answered with its ID at boot
static int32_t* samples = nullptr;   // CH1, CH2, CH1, CH2, ... (PSRAM)
static uint32_t capacity = 0;        // frames that fit
static volatile uint32_t frames = 0;
static volatile uint32_t leadOffFrames = 0;
static volatile bool running = false;
static TaskHandle_t reader = nullptr;

static void command(uint8_t c) {
  spi.beginTransaction(SPI_CFG);
  digitalWrite(ECG_PIN_CS, LOW);
  delayMicroseconds(10);
  spi.transfer(c);
  delayMicroseconds(10);
  digitalWrite(ECG_PIN_CS, HIGH);
  spi.endTransaction();
  delayMicroseconds(20);
}

static void writeReg(uint8_t reg, uint8_t value) {
  spi.beginTransaction(SPI_CFG);
  digitalWrite(ECG_PIN_CS, LOW);
  delayMicroseconds(10);
  spi.transfer(CMD_WREG | reg);
  delayMicroseconds(10);
  spi.transfer(0x00);  // one register
  delayMicroseconds(10);
  spi.transfer(value);
  delayMicroseconds(10);
  digitalWrite(ECG_PIN_CS, HIGH);
  spi.endTransaction();
  delayMicroseconds(20);
}

static uint8_t readReg(uint8_t reg) {
  spi.beginTransaction(SPI_CFG);
  digitalWrite(ECG_PIN_CS, LOW);
  delayMicroseconds(10);
  spi.transfer(CMD_RREG | reg);
  delayMicroseconds(10);
  spi.transfer(0x00);
  delayMicroseconds(10);
  const uint8_t value = spi.transfer(0x00);
  delayMicroseconds(10);
  digitalWrite(ECG_PIN_CS, HIGH);
  spi.endTransaction();
  delayMicroseconds(20);
  return value;
}

static inline int32_t signExtend24(uint32_t v) { return (v & 0x800000) ? (int32_t)(v | 0xFF000000) : (int32_t)v; }

static void IRAM_ATTR onDrdy() {
  BaseType_t woken = pdFALSE;
  vTaskNotifyGiveFromISR(reader, &woken);
  portYIELD_FROM_ISR(woken);
}

/** Core 0: one 9-byte frame per DRDY (status 24 bits + CH1 24 bits + CH2 24 bits). */
static void readerLoop(void*) {
  for (;;) {
    ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
    if (!running) continue;
    uint8_t b[9];
    spi.beginTransaction(SPI_CFG);
    digitalWrite(ECG_PIN_CS, LOW);
    delayMicroseconds(5);
    for (int i = 0; i < 9; i++) b[i] = spi.transfer(0x00);
    digitalWrite(ECG_PIN_CS, HIGH);
    spi.endTransaction();
    const uint32_t status = ((uint32_t)b[0] << 16) | ((uint32_t)b[1] << 8) | b[2];
    if ((status & 0xF00000) != 0xC00000) continue;  // not a data frame (sync lost for one sample)
    if (status & (0x0FUL << 15)) leadOffFrames = leadOffFrames + 1;  // IN1P/IN1N/IN2P/IN2N lead-off flags
    const uint32_t n = frames;
    if (n >= capacity) continue;
    samples[2 * n] = signExtend24(((uint32_t)b[3] << 16) | ((uint32_t)b[4] << 8) | b[5]);
    samples[2 * n + 1] = signExtend24(((uint32_t)b[6] << 16) | ((uint32_t)b[7] << 8) | b[8]);
    frames = n + 1;
  }
}

/** Power the chip up, check its ID and configure it. Returns false (and the device records sound only) without it. */
inline bool begin() {
  pinMode(ECG_PIN_CS, OUTPUT);
  digitalWrite(ECG_PIN_CS, HIGH);
  pinMode(ECG_PIN_START, OUTPUT);
  digitalWrite(ECG_PIN_START, LOW);
  pinMode(ECG_PIN_PWDN, OUTPUT);
  pinMode(ECG_PIN_DRDY, INPUT_PULLUP);
  spi.begin(ECG_PIN_SCK, ECG_PIN_MISO, ECG_PIN_MOSI, -1);

  // Power-on reset: PWDN high, settle, a short low pulse resets the chip, settle again (datasheet 10.1.2).
  digitalWrite(ECG_PIN_PWDN, HIGH);
  delay(200);
  digitalWrite(ECG_PIN_PWDN, LOW);
  delay(1);
  digitalWrite(ECG_PIN_PWDN, HIGH);
  delay(200);
  command(CMD_RESET);
  delay(10);
  command(CMD_SDATAC);  // the chip wakes up streaming; registers only answer after SDATAC
  delay(2);

  const uint8_t id = readReg(REG_ID);
  Serial.printf("ECG: ADS1292R ID 0x%02X (expect 0x73)\n", id);
  if (id != 0x73 && id != 0x53) return false;

  writeReg(REG_CONFIG1, ECG_CONFIG1);  // continuous conversion, 250 SPS
  writeReg(REG_CONFIG2, 0xE0);         // internal 2.42 V reference, lead-off comparators on
  writeReg(REG_LOFF, 0x10);            // 95 % threshold, 6 nA DC lead-off current
  writeReg(REG_CH1SET, ECG_CHSET);     // normal electrode input, PGA gain 6
  writeReg(REG_CH2SET, ECG_CHSET);
  writeReg(REG_RLD_SENS, 0x3C);        // right-leg drive from CH2, RLD lead-off sense
  writeReg(REG_LOFF_SENS, 0x0F);       // lead-off detection on IN1P/N and IN2P/N
  writeReg(REG_RESP1, 0x02);           // respiration off
  writeReg(REG_RESP2, 0x03);           // RLD reference internal
  writeReg(REG_GPIO, 0x00);
  delay(10);
  const uint8_t config1 = readReg(REG_CONFIG1);
  if (config1 != ECG_CONFIG1) {
    Serial.printf("ECG: register write failed (CONFIG1 0x%02X)\n", config1);
    return false;
  }

  capacity = (uint32_t)ECG_SAMPLE_RATE * (MAX_RECORD_SECONDS + 1);
  samples = (int32_t*)ps_malloc((size_t)capacity * 2 * sizeof(int32_t));
  if (samples == nullptr) return false;
  xTaskCreatePinnedToCore(readerLoop, "ecg", 4096, nullptr, configMAX_PRIORITIES - 2, &reader, 0);
  attachInterrupt(digitalPinToInterrupt(ECG_PIN_DRDY), onDrdy, FALLING);
  present = true;
  return true;
}

/** Start filling the buffer from sample 0 (call when the microphone starts keeping audio). */
inline void start() {
  if (!present) return;
  frames = 0;
  leadOffFrames = 0;
  command(CMD_RDATAC);
  running = true;
  digitalWrite(ECG_PIN_START, HIGH);
}

/** Stop converting. Returns the frames recorded (each frame = CH1 + CH2). */
inline uint32_t stop() {
  if (!present) return 0;
  digitalWrite(ECG_PIN_START, LOW);
  delay(10);  // let the reader finish the last frame
  running = false;
  command(CMD_SDATAC);
  return frames;
}

/** An electrode was off for more than 5 % of the recording (the chip's DC lead-off detector). */
inline bool leadOff(uint32_t recorded) { return recorded > 0 && leadOffFrames * 20 > recorded; }

/** Bytes of a recording of `recorded` frames, as sent: int32 little-endian (the ESP32 is little-endian). */
inline size_t bytesFor(uint32_t recorded) { return (size_t)recorded * 2 * sizeof(int32_t); }

}  // namespace ecg
