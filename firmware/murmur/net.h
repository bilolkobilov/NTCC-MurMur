// Wi-Fi and the device API (backend/app/api/device.py), the same protocol as scripts/fake_device.py.
#pragma once

#include <HTTPClient.h>
#include <WiFi.h>

#include "config.h"
#include "secrets.h"

struct Command {
  bool record = false;
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

/** POST /api/device/heartbeat with firmware version and Wi-Fi strength. Returns the HTTP status (or <0). */
inline int sendHeartbeat() {
  HTTPClient http;
  beginRequest(http, "/api/device/heartbeat");
  http.addHeader("Content-Type", "application/json");
  String body = String("{\"firmware_version\":\"") + FIRMWARE_VERSION + "\",\"wifi_rssi\":" + WiFi.RSSI() + "}";
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

/** GET /api/device/command: 204 = nothing to do, 200 = {"command":"record","exam_id":N,"duration_s":S}. */
inline int pollCommand(Command& command) {
  HTTPClient http;
  beginRequest(http, "/api/device/command");
  int status = http.GET();
  command = Command();
  if (status == 200) {
    String body = http.getString();
    command.record = body.indexOf("\"record\"") >= 0;
    command.examId = jsonInt(body, "exam_id");
    command.seconds = jsonInt(body, "duration_s");
  }
  http.end();
  return status;
}

/**
 * Multipart upload in one buffer, so the WAV is never copied: the caller records straight into
 * buffer + uploadPrefixLength(), then calls uploadRecording(). The server needs Content-Length (it rejects a
 * body without one), which HTTPClient sends for a buffer.
 */
static const char* BOUNDARY = "murmur7f3a9c1e5b";

static String uploadPrefix(bool motion) {
  String meta = String("{\"motion_detected\":") + (motion ? "true" : "false") +
                ",\"sample_rate\":" + WAV_SAMPLE_RATE + ",\"firmware_version\":\"" + FIRMWARE_VERSION + "\"}";
  return String("--") + BOUNDARY + "\r\nContent-Disposition: form-data; name=\"meta\"\r\n\r\n" + meta + "\r\n--" +
         BOUNDARY + "\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"recording.wav\"\r\n" +
         "Content-Type: audio/wav\r\n\r\n";
}
static String uploadSuffix() { return String("\r\n--") + BOUNDARY + "--\r\n"; }

inline size_t uploadPrefixLength(bool motion) { return uploadPrefix(motion).length(); }
inline size_t uploadExtraLength(bool motion) { return uploadPrefixLength(motion) + uploadSuffix().length(); }

/** POST /api/device/upload/{exam}. 202 = accepted, 409 = this exam already has its recording (treat as done). */
inline int uploadRecording(long examId, uint8_t* buffer, size_t wavBytes, bool motion) {
  const String prefix = uploadPrefix(motion), suffix = uploadSuffix();
  memcpy(buffer, prefix.c_str(), prefix.length());
  memcpy(buffer + prefix.length() + wavBytes, suffix.c_str(), suffix.length());
  const size_t total = prefix.length() + wavBytes + suffix.length();

  HTTPClient http;
  beginRequest(http, String("/api/device/upload/") + examId);
  http.addHeader("Content-Type", String("multipart/form-data; boundary=") + BOUNDARY);
  int status = http.POST(buffer, total);
  http.end();
  return status;
}
