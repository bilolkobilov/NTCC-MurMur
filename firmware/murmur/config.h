// MurMur device settings that are NOT secret. Secrets (Wi-Fi, device key, server address) live in secrets.h.
// Pins follow the owner's wiring diagram of the real board (checked on the device, 2026-11-17).
#pragma once

#define FIRMWARE_VERSION "0.3.0"

// ICS-43434 I2S microphone (L/R pin to GND = left slot). Diagram names: BCLK, LRCL (= WS), DOUT (= SD).
#define MIC_PIN_BCLK 4
#define MIC_PIN_WS 6
#define MIC_PIN_DATA 5

// TI ADS1292R single-lead ECG (wiring diagram, 2026-11-17). Electrodes plug into the AUX jack: see README.md.
// ECG_PIN_PWDN is GPIO48, which is ALSO the board's RGB LED: never drive the LED (it powers the ECG chip down).
#define ECG_PIN_CS 10
#define ECG_PIN_MOSI 11
#define ECG_PIN_SCK 12
#define ECG_PIN_MISO 13
#define ECG_PIN_DRDY 14
#define ECG_PIN_START 47
#define ECG_PIN_PWDN 48
#define ECG_SAMPLE_RATE 250  // CONFIG1 0x01; the server and the rhythm model expect 250
#define ECG_CONFIG1 0x01
#define ECG_GAIN 6           // CHnSET 0x00 = PGA gain 6, normal electrode input
#define ECG_CHSET 0x00
#define ECG_VREF_MV 2420     // internal reference (CONFIG2 bit 4 = 0)

// The microphone's high-performance mode runs at 23-51.6 kHz (TDK DS-000069 v1.2), so we sample at 32 kHz and
// keep every pair averaged: 16 kHz WAV, 640 KB for 20 s. The server resamples to 4 kHz for the AI anyway.
#define MIC_SAMPLE_RATE 32000
#define WAV_SAMPLE_RATE 16000
#define DECIMATE (MIC_SAMPLE_RATE / WAV_SAMPLE_RATE)

// The mic gives 24-bit samples left-aligned in 32 bits. >> 16 = the top 16 bits (no gain); >> 14 = x4 gain.
// No gain: the owner's real chest recordings (2026-11-15) already peak near full scale at >> 16, and x4 would clip
// 1-46 % of every one of them (the server rejects more than 1 %). Lower it only if the server says "almost silent".
#define MIC_GAIN_SHIFT 16

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
