// MurMur device settings that are NOT secret. Secrets (Wi-Fi, device key, server address) live in secrets.h.
// Pins follow docs/PLAN.md "Keyingi qadam: qurilma kodi" — confirm them against the real board before the first flash.
#pragma once

#define FIRMWARE_VERSION "0.2.0"

// ICS-43434 I2S microphone (L/R pin to GND = left slot).
#define MIC_PIN_BCLK 4
#define MIC_PIN_WS 5
#define MIC_PIN_DATA 6

// The microphone's high-performance mode runs at 23-51.6 kHz (TDK DS-000069 v1.2), so we sample at 32 kHz and
// keep every pair averaged: 16 kHz WAV, 640 KB for 20 s. The server resamples to 4 kHz for the AI anyway.
#define MIC_SAMPLE_RATE 32000
#define WAV_SAMPLE_RATE 16000
#define DECIMATE (MIC_SAMPLE_RATE / WAV_SAMPLE_RATE)

// The mic gives 24-bit samples left-aligned in 32 bits. >> 16 = the top 16 bits (no gain); >> 14 = x4 gain.
// Heart sounds through a stethoscope tube are quiet: tune this with the first real recordings (server quality
// checks say "almost silent" or "clipped").
#define MIC_GAIN_SHIFT 14

// The first part of every recording is thrown away: the mic needs time to settle after the clock starts.
#define MIC_SETTLE_MS 300

// Battery level in the heartbeat: define the ADC pin of a voltage divider on the battery to turn it on. Without
// it the heartbeat has no battery value and the web app shows "no data" (the dev board has no fuel gauge).
// #define BATTERY_ADC_PIN 1
#define BATTERY_EMPTY_MV 3300  // battery voltage (after the divider is scaled back) that counts as 0 %
#define BATTERY_FULL_MV 4150   // ... and as 100 %

#define MAX_RECORD_SECONDS 30        // safety limit, whatever the server asks for
#define HEARTBEAT_EVERY_MS 10000     // server: "online" = seen in the last 30 s
#define POLL_EVERY_MS 1500           // server: the device polls every 1-2 s
#define HTTP_TIMEOUT_MS 8000
#define UPLOAD_ATTEMPTS 3
