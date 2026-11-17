// Wi-Fi and the device API (backend/app/api/device.py), the same protocol as scripts/fake_device.py.
#pragma once

#include <HTTPClient.h>
#include <WiFi.h>

#include "config.h"
#include "secrets.h"

struct Command {
  bool record = false;
  bool selfTest = false;
  long examId = 0;
  long seconds = 0;
};

/** Connect (or reconnect) to the hotspot. Returns true when connected. */
inline bool wifiEnsure(uint32_t waitMs = 15000) {
  if (WiFi.status() == WL_CONNECTED) return true;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  const uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < waitMs) delay(200);
  return WiFi.status() == WL_CONNECTED;
}

static void beginRequest(HTTPClient& http, const String& path) {
  http.begin(String(SERVER_URL) + path);
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("X-Device-Key", DEVICE_KEY);
}

/** Microphone noise floor from the last measurement (boot or self-test); -1 = not measured yet. */
static int lastMicNoiseDb = -1;

#ifdef BATTERY_ADC_PIN
/** Battery percent from a voltage divider on BATTERY_ADC_PIN (1:2 divider assumed: the pin sees half the voltage). */
static int batteryPercent() {
  const int mv = analogReadMilliVolts(BATTERY_ADC_PIN) * 2;
  return constrain(map(mv, BATTERY_EMPTY_MV, BATTERY_FULL_MV, 0, 100), 0, 100);
}
#endif

/** POST /api/device/heartbeat: firmware, Wi-Fi, network details, and battery / microphone when known. */
inline int sendHeartbeat() {
  HTTPClient http;
  beginRequest(http, "/api/device/heartbeat");
  http.addHeader("Content-Type", "application/json");
  String body = String("{\"firmware_version\":\"") + FIRMWARE_VERSION + "\",\"wifi_rssi\":" + WiFi.RSSI() +
                ",\"wifi_ssid\":\"" + WiFi.SSID() + "\",\"ip\":\"" + WiFi.localIP().toString() +
                "\",\"mac\":\"" + WiFi.macAddress() + "\",\"gateway\":\"" + WiFi.gatewayIP().toString() + "\"";
  if (lastMicNoiseDb >= 0) body += String(",\"mic_noise_db\":") + lastMicNoiseDb;
#ifdef BATTERY_ADC_PIN
  body += String(",\"battery_pct\":") + batteryPercent();
#endif
  body += "}";
  int status = http.POST(body);
  http.end();
  return status;
}

/** POST /api/device/self-test: the answer to a "self_test" command. */
inline int sendSelfTest(bool ok, int micNoiseDb) {
  HTTPClient http;
  beginRequest(http, "/api/device/self-test");
  http.addHeader("Content-Type", "application/json");
  String body = String("{\"ok\":") + (ok ? "true" : "false");
  if (micNoiseDb >= 0) body += String(",\"mic_noise_db\":") + micNoiseDb;
  body += "}";
  int status = http.POST(body);
  http.end();
  return status;
}

/** The integer after "key": in a small flat JSON object (enough for the command; no JSON library needed). */
static long jsonInt(const String& json, const char* key) {
  int at = json.indexOf(String("\"") + key + "\"");
  if (at < 0) return -1;
  at = json.indexOf(':', at);
  return at < 0 ? -1 : json.substring(at + 1).toInt();
}

/** GET /api/device/command: 204 = nothing, 200 = {"command":"record","exam_id":N,"duration_s":S} or "self_test". */
inline int pollCommand(Command& command) {
  HTTPClient http;
  beginRequest(http, "/api/device/command");
  int status = http.GET();
  command = Command();
  if (status == 200) {
    String body = http.getString();
    command.record = body.indexOf("\"record\"") >= 0;
    command.selfTest = body.indexOf("\"self_test\"") >= 0;
    command.examId = jsonInt(body, "exam_id");
    command.seconds = jsonInt(body, "duration_s");
  }
  http.end();
  return status;
}

/**
 * Multipart upload in one PSRAM buffer, so the WAV is never copied: the caller records straight into
 * buffer + audioHeaderLength(), then buildUpload() appends the ECG part and the meta part (meta goes last because
 * the lead-off result is known only after recording). The server needs Content-Length (it rejects a body without
 * one), which HTTPClient sends for a buffer.
 */
static const char* BOUNDARY = "murmur7f3a9c1e5b";
static const size_t META_PART_MAX = 512;  // room for the meta part and the closing boundary

static String audioHeader() {
  return String("--") + BOUNDARY + "\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"recording.wav\"\r\n" +
         "Content-Type: audio/wav\r\n\r\n";
}
static String ecgHeader() {
  return String("\r\n--") + BOUNDARY + "\r\nContent-Disposition: form-data; name=\"ecg\"; filename=\"ecg.bin\"\r\n" +
         "Content-Type: application/octet-stream\r\n\r\n";
}
static String metaPartAndEnd(bool motion, bool withEcg, bool leadOff) {
  String meta = String("{\"motion_detected\":") + (motion ? "true" : "false") + ",\"sample_rate\":" +
                WAV_SAMPLE_RATE + ",\"firmware_version\":\"" + FIRMWARE_VERSION + "\"";
  if (withEcg) {
    meta += String(",\"ecg_sample_rate\":") + ECG_SAMPLE_RATE + ",\"ecg_channels\":2,\"ecg_gain\":" + ECG_GAIN +
            ",\"ecg_vref_mv\":" + ECG_VREF_MV + ",\"ecg_lead_off\":" + (leadOff ? "true" : "false");
  }
  meta += "}";
  return String("\r\n--") + BOUNDARY + "\r\nContent-Disposition: form-data; name=\"meta\"\r\n\r\n" + meta +
         "\r\n--" + BOUNDARY + "--\r\n";
}

inline size_t audioHeaderLength() { return audioHeader().length(); }
/** Bytes the upload needs besides the WAV itself, with room for `ecgBytes` of ECG. */
inline size_t uploadExtraLength(size_t ecgBytes) {
  return audioHeaderLength() + ecgHeader().length() + ecgBytes + META_PART_MAX;
}

/** Complete the body around a WAV already at buffer + audioHeaderLength(). Returns the total length. */
inline size_t buildUpload(uint8_t* buffer, size_t wavBytes, const int32_t* ecgData, size_t ecgBytes, bool motion,
                          bool leadOff) {
  const String head = audioHeader();
  memcpy(buffer, head.c_str(), head.length());
  size_t at = head.length() + wavBytes;
  if (ecgBytes > 0) {
    const String part = ecgHeader();
    memcpy(buffer + at, part.c_str(), part.length());
    at += part.length();
    memcpy(buffer + at, ecgData, ecgBytes);
    at += ecgBytes;
  }
  const String tail = metaPartAndEnd(motion, ecgBytes > 0, leadOff);
  memcpy(buffer + at, tail.c_str(), tail.length());
  return at + tail.length();
}

/** POST /api/device/upload/{exam}. 202 = accepted, 409 = this exam already has its recording (treat as done). */
inline int uploadRecording(long examId, uint8_t* buffer, size_t total) {
  HTTPClient http;
  beginRequest(http, String("/api/device/upload/") + examId);
  http.addHeader("Content-Type", String("multipart/form-data; boundary=") + BOUNDARY);
  int status = http.POST(buffer, total);
  http.end();
  return status;
}
