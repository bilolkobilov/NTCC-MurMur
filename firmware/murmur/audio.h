// Recording from the ICS-43434 into a 16-bit mono WAV in memory (PSRAM).
#pragma once

#include <Arduino.h>
#include <ESP_I2S.h>

#include "config.h"

static I2SClass mic;

/** Start the I2S clock. Standard (Philips) frames, 32-bit slots: 64 clocks per frame, as the mic requires. */
inline bool micBegin() {
  mic.setPins(MIC_PIN_BCLK, MIC_PIN_WS, -1, MIC_PIN_DATA);
  return mic.begin(I2S_MODE_STD, MIC_SAMPLE_RATE, I2S_DATA_BIT_WIDTH_32BIT, I2S_SLOT_MODE_MONO, I2S_STD_SLOT_LEFT);
}

inline size_t wavSize(uint32_t seconds) { return 44 + (size_t)WAV_SAMPLE_RATE * seconds * 2; }

static void putLE(uint8_t* p, uint32_t value, int bytes) {
  for (int i = 0; i < bytes; i++) p[i] = (value >> (8 * i)) & 0xFF;
}

/** The 44-byte header of a PCM WAV: mono, 16-bit, WAV_SAMPLE_RATE. */
inline void writeWavHeader(uint8_t* out, uint32_t dataBytes) {
  memcpy(out, "RIFF", 4);
  putLE(out + 4, 36 + dataBytes, 4);
  memcpy(out + 8, "WAVEfmt ", 8);
  putLE(out + 16, 16, 4);                    // fmt chunk size
  putLE(out + 20, 1, 2);                     // PCM
  putLE(out + 22, 1, 2);                     // mono
  putLE(out + 24, WAV_SAMPLE_RATE, 4);
  putLE(out + 28, WAV_SAMPLE_RATE * 2, 4);   // byte rate
  putLE(out + 32, 2, 2);                     // block align
  putLE(out + 34, 16, 2);                    // bits per sample
  memcpy(out + 36, "data", 4);
  putLE(out + 40, dataBytes, 4);
}

/** 24-bit sample (left-aligned in 32 bits) -> 16-bit with the configured gain, clipped instead of wrapped. */
static inline int16_t toPcm16(int32_t sample) {
  int32_t value = sample >> MIC_GAIN_SHIFT;
  if (value > 32767) return 32767;
  if (value < -32768) return -32768;
  return (int16_t)value;
}

/**
 * Microphone noise floor in dB re 1 LSB of the 16-bit WAV (20*log10 of the RMS over ~0.5 s of silence, after the
 * gain). It is NOT calibrated to sound pressure; the admin page compares it with a fixed limit (35 dB) to spot a
 * dead or noisy microphone. Returns -1 when the microphone gives no data.
 */
inline int micNoiseDb() {
  int32_t chunk[512];
  const uint32_t settleEnd = millis() + MIC_SETTLE_MS;
  while ((int32_t)(millis() - settleEnd) < 0) mic.readBytes((char*)chunk, sizeof(chunk));
  const uint32_t end = millis() + 500;
  double sumSquares = 0;
  uint32_t count = 0;
  while ((int32_t)(millis() - end) < 0) {
    const size_t got = mic.readBytes((char*)chunk, sizeof(chunk)) / sizeof(int32_t);
    for (size_t i = 0; i < got; i++) {
      const double v = toPcm16(chunk[i]);
      sumSquares += v * v;
      count++;
    }
  }
  if (count == 0) return -1;
  const double rms = sqrt(sumSquares / count);
  return (int)(20.0 * log10(rms < 1.0 ? 1.0 : rms) + 0.5);
}

/**
 * Record `seconds` into `out` (wavSize(seconds) bytes): WAV header + samples. Every DECIMATE input samples are
 * averaged into one output sample (a simple low-pass before dropping to WAV_SAMPLE_RATE).
 * Returns the number of bytes written, or 0 when the microphone stopped delivering data.
 */
inline size_t recordWav(uint8_t* out, uint32_t seconds) {
  const uint32_t wanted = WAV_SAMPLE_RATE * seconds;
  int32_t chunk[512];

  // Let the mic settle, then throw that audio away.
  const uint32_t settleEnd = millis() + MIC_SETTLE_MS;
  while ((int32_t)(millis() - settleEnd) < 0) mic.readBytes((char*)chunk, sizeof(chunk));

  int16_t* pcm = (int16_t*)(out + 44);
  uint32_t written = 0;
  int64_t sum = 0;
  int inSum = 0;
  uint32_t lastData = millis();
  while (written < wanted) {
    size_t got = mic.readBytes((char*)chunk, sizeof(chunk)) / sizeof(int32_t);
    if (got == 0) {
      if (millis() - lastData > 1000) return 0;  // no clock or no mic: fail instead of hanging
      continue;
    }
    lastData = millis();
    for (size_t i = 0; i < got && written < wanted; i++) {
      sum += chunk[i];
      if (++inSum == DECIMATE) {
        pcm[written++] = toPcm16((int32_t)(sum / DECIMATE));
        sum = 0;
        inSum = 0;
      }
    }
  }
  writeWavHeader(out, written * 2);
  return 44 + written * 2;
}
