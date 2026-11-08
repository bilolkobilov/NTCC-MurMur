// MurMur device firmware (ESP32-S3 + ICS-43434), stage 1: microphone + Wi-Fi + the device API.
// Does exactly what scripts/fake_device.py does: heartbeat every 10 s -> poll for a command every 1.5 s ->
// on "record": record N seconds -> upload the WAV (+ meta) -> back to polling.
// Not yet: MPU6050 motion flag (sent as false), ECG. Build/flash: docs/runbook.md "Device firmware".
//
// Board: ESP32S3 Dev Module, PSRAM "OPI PSRAM", Flash 16 MB (the 20 s recording lives in PSRAM).

#include "audio.h"
#include "config.h"
#include "net.h"

// Status LED: the board's RGB LED if it has one. Blue = connecting, dim green = ready, red = recording.
static void led(uint8_t r, uint8_t g, uint8_t b) {
#ifdef RGB_BUILTIN
  rgbLedWrite(RGB_BUILTIN, r, g, b);
#endif
}

static uint32_t lastHeartbeat = 0;
static uint32_t lastPoll = 0;
static uint8_t* buffer = nullptr;  // multipart body: prefix + WAV + suffix, allocated once in PSRAM
static size_t bufferSize = 0;

static bool ensureBuffer(uint32_t seconds) {
  const size_t needed = uploadExtraLength(false) + wavSize(seconds);
  if (buffer && bufferSize >= needed) return true;
  free(buffer);
  buffer = (uint8_t*)ps_malloc(needed);
  bufferSize = buffer ? needed : 0;
  return buffer != nullptr;
}

/** Record for one exam and upload it, retrying network failures. Returns true when the server has it. */
static bool recordAndUpload(const Command& command) {
  const uint32_t seconds = constrain(command.seconds, 1, MAX_RECORD_SECONDS);
  if (!ensureBuffer(seconds)) {
    Serial.println("not enough PSRAM for the recording (check: Tools > PSRAM > OPI PSRAM)");
    return false;
  }
  const bool motion = false;  // MPU6050 comes in the next firmware step
  led(40, 0, 0);
  Serial.printf("recording %lu s for exam %ld\n", (unsigned long)seconds, command.examId);
  const size_t wavBytes = recordWav(buffer + uploadPrefixLength(motion), seconds);
  led(0, 8, 0);
  if (wavBytes == 0) {
    Serial.println("microphone gave no data: check the I2S wiring (BCLK/WS/SD) and that L/R is on GND");
    return false;  // the exam stays "recording"; the doctor sees "overdue" and can cancel
  }
  for (int attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt++) {
    if (!wifiEnsure()) continue;
    const int status = uploadRecording(command.examId, buffer, wavBytes, motion);
    Serial.printf("upload attempt %d: HTTP %d\n", attempt, status);
    if (status == 202 || status == 409) return true;  // 409: already uploaded (a retry after a lost answer)
    if (status >= 400 && status < 500) return false;  // our request is wrong; retrying will not help
    delay(1000 * attempt);
  }
  return false;
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.printf("MurMur firmware %s\n", FIRMWARE_VERSION);
  led(0, 0, 40);
  if (!psramFound()) Serial.println("WARNING: no PSRAM found - recording will fail");
  if (!micBegin()) Serial.println("WARNING: I2S microphone did not start");
  while (!wifiEnsure()) Serial.println("Wi-Fi: not connected yet, retrying");
  Serial.printf("Wi-Fi: %s, RSSI %d dBm\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
  Serial.printf("heartbeat: HTTP %d\n", sendHeartbeat());
  lastHeartbeat = millis();
  led(0, 8, 0);
}

void loop() {
  if (!wifiEnsure(5000)) {
    led(0, 0, 40);
    return;
  }
  const uint32_t now = millis();
  if (now - lastHeartbeat >= HEARTBEAT_EVERY_MS) {
    const int status = sendHeartbeat();
    if (status == 401) Serial.println("heartbeat 401: the DEVICE_KEY in secrets.h is wrong or was rotated");
    lastHeartbeat = now;
  }
  if (now - lastPoll >= POLL_EVERY_MS) {
    lastPoll = now;
    Command command;
    const int status = pollCommand(command);
    if (status == 200 && command.record && command.examId > 0) {
      Serial.printf("upload %s\n", recordAndUpload(command) ? "done" : "FAILED");
    }
  }
  delay(20);
}
