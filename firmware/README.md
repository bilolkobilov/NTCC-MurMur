# MurMur device firmware (ESP32-S3)

## Qisqacha (o'zbekcha)

- **Nima qiladi:** qurilma Wi-Fi orqali serverga ulanadi. Shifokor saytda tekshiruvni boshlaydi, qurilma **20 soniya yurak
  tovushi va EKG'ni bir vaqtda** yozadi va serverga yuboradi. Server tovushni AI bilan, EKG'ni zarba/min va ritm bo'yicha
  tahlil qiladi.
- **Chiroq (GPIO48) nega ishlatilmaydi:** platadagi rangli chiroq va EKG chipining "yoqish/o'chirish" (PWDN) simi
  **bitta oyoqchada — GPIO48**. Chiroqqa rang yuborilsa, shu oyoqcha "0" bo'lib qoladi va EKG chipi o'chadi. Platada
  o'lchandi: chiroqdan oldin EKG sekundiga 247 ta o'lchov berdi, chiroqdan keyin 0. Shuning uchun dastur chiroqqa
  umuman tegmaydi. Chiroq kerak bo'lsa: PWDN simini boshqa bo'sh oyoqchaga ko'chiring va `config.h`dagi
  `ECG_PIN_PWDN`ni o'zgartiring.
- **EKG elektrodlari:** 3 ta gelli elektrod, qurilmadagi AUX teshik orqali, **alohida** ulanadi (qurilma ichiga
  qo'yilmaydi — elektrodlar bir-biriga yaqin bo'lsa signal 8 marta kuchsiz chiqdi). Joylari: RA — o'ng o'mrov ostida,
  LA — chap yon, qovurg'alar pastida, RL — qorin o'ng pastda. Noutbuk **batareyada** bo'lsin (xavfsizlik va 50 Hz shovqin).
- **Plataga yuklash:** platani **to'g'ridan-to'g'ri USB porti** orqali ulang (COM4 edi, driver kerak emas),
  `secrets.h`ga Wi-Fi (faqat 2.4 GHz), server manzili va qurilma kalitini yozing, keyin pastdagi buyruqlar.
- **Holat:** 0.3.0 versiyasi (tovush + EKG birga) hali **haqiqiy platada sinalmagan** — qurilma qaytganda pastdagi
  "10 daqiqalik tekshiruv"ni bajaring. Tovush qismi (0.2.1) 2026-11-17 da haqiqiy platada ishladi.

## What it does

`murmur.ino` runs the same protocol as `scripts/fake_device.py`:

1. Heartbeat every 10 s (`POST /api/device/heartbeat`: firmware, Wi-Fi, network, microphone noise floor).
2. Poll for a command every 1.5 s (`GET /api/device/command`).
3. On `record`: record N seconds of **sound and ECG at the same time**, upload both
   (`POST /api/device/upload/{exam}`), retry network failures up to 3 times; `409` means "already uploaded".
4. On `self_test`: measure the microphone noise floor and report it.

Without the ECG chip (ID check fails at boot) it records sound only, exactly like 0.2.x. The motion sensor (MPU6050)
is not used yet: the motion flag is always `false`.

| File | What |
|---|---|
| `murmur.ino` | setup, the poll loop, record + upload |
| `config.h` | pins, sample rates, gain, timings (nothing secret) |
| `audio.h` | ICS-43434 over I2S → 16 kHz 16-bit WAV in PSRAM |
| `ecg.h` | ADS1292R over SPI: DRDY interrupt → core-0 task → both channels in PSRAM |
| `net.h` | Wi-Fi, heartbeat, poll, the multipart upload |
| `secrets.example.h` | copy to `secrets.h` (gitignored) and fill in |

## Wiring (the owner's diagram, checked on the board 2026-11-17)

| Part | Signal | ESP32-S3 GPIO |
|---|---|---|
| ICS-43434 microphone | BCLK | 4 |
| | LRCL (= WS) | 6 |
| | DOUT (= SD) | 5 |
| | L/R (SEL) | GND (left slot) |
| ADS1292R ECG | CS | 10 |
| | MOSI | 11 |
| | SCK | 12 |
| | MISO | 13 |
| | DRDY | 14 |
| | START | 47 |
| | PWDN / RESET | **48** (see below) |
| MPU6050 (later) | INT | 7 (not connected yet) |

Board: ESP32-S3 N16R8 (16 MB flash, 8 MB octal PSRAM). Only one microphone is fitted (left slot); the diagram's second
one is not connected, and the firmware reads the left slot only.

### Why the on-board RGB LED is never used (GPIO48)

On this board the RGB LED's data line and the ADS1292R's PWDN pin are the **same pin, GPIO48**. PWDN must stay HIGH for
the ECG chip to run. Any LED write (`rgbLedWrite`, `neopixelWrite`, `digitalWrite(LED_BUILTIN, …)`) sends a pulse train
and leaves the line LOW, which powers the chip down.

Measured on the board: before an LED write the ADS1292R gave 247 valid frames per second; right after it GPIO48 read 0
and the chip gave **0** frames. So the firmware has no status LED; everything goes to the USB serial log.

If you want an LED back: move the PWDN wire to a free GPIO, change `ECG_PIN_PWDN` in `config.h`, and only then use the
RGB LED (or wire a separate LED to another free pin).

## ECG electrodes (AUX jack)

Three disposable **gel** electrodes (Ag/AgCl) on a cable that plugs into the device's AUX jack. They are separate from
the device on purpose: on the bench, electrodes close together and horizontal (both under the collarbones) gave a QRS of
only ~0.1 mV; spread along the heart's axis they gave ~0.8 mV, clean (owner's decision, 2026-11-17).

| Lead | Where | IEC colour | AHA colour |
|---|---|---|---|
| RA | under the right collarbone | red | white |
| LA | left side, on the lower ribs, below the chest | yellow | black |
| RL | lower right abdomen (reference; **needed** against mains hum) | black | green |

Before recording: clean the skin (alcohol), let it dry, use fresh gel electrodes, tape the cables so they do not pull,
the person lies or sits still and does not talk. **Run the laptop on battery** while electrodes are on a person: the
person is connected to the laptop through the device's USB cable, and this is a research prototype, not a certified
medical device. It also removes most of the 50 Hz hum.

Which ADS channel carries the ECG depends on the cable and placement (CH2 in the owner's first log, CH1 on 2026-11-17),
so the firmware sends both and the server uses the cleaner one.

## Build and flash

1. Tools (once): arduino-cli 1.5.1 in `%LOCALAPPDATA%\Programs\arduino-cli`, then
   `arduino-cli config init --additional-urls https://espressif.github.io/arduino-esp32/package_esp32_index.json`,
   `arduino-cli core update-index`, `arduino-cli core install esp32:esp32` (3.3.12). Arduino IDE works too
   (Board "ESP32S3 Dev Module", PSRAM "OPI PSRAM", Flash 16 MB, USB CDC On Boot "Enabled").
2. `copy firmware\murmur\secrets.example.h firmware\murmur\secrets.h` and fill in:
   - `WIFI_SSID` / `WIFI_PASSWORD`: the network the laptop is on. **2.4 GHz only** (a phone hotspot works).
   - `SERVER_URL`: `http://<laptop IP on that network>:8000` (`ipconfig` shows it). The server must listen on all
     interfaces: `uvicorn app.main:app --host 0.0.0.0 --port 8000`.
   - `DEVICE_KEY`: from Admin → Devices (shown once; "Rotate key" gives a new one).
3. Plug the board into its **native USB port** (VID 303A, shows as a COM port without any driver). The other port
   (UART, CH340 chip) needs a driver and is not needed.
4. Compile and flash (replace `COM4`):

   ```
   arduino-cli compile --upload -p COM4 --fqbn "esp32:esp32:esp32s3:PSRAM=opi,FlashSize=16M,PartitionScheme=app3M_fat9M_16MB,CDCOnBoot=cdc" firmware/murmur
   ```

5. Serial log at 115200 baud. If `arduino-cli monitor` shows nothing, open the port with DTR on (PowerShell
   `System.IO.Ports.SerialPort` with `DtrEnable = $true`).

### What a healthy boot prints

```
MurMur firmware 0.3.0
microphone noise floor: 85 dB
ECG: ADS1292R ID 0x73 (expect 0x73)
Wi-Fi: 192.168.x.x, RSSI -40 dBm
heartbeat: HTTP 200
...
recording 20 s for exam 12
ECG: 5000 frames (20.0 s)
upload attempt 1: HTTP 202
upload done
```

## Troubleshooting

| Log says | Likely cause | Fix |
|---|---|---|
| `no PSRAM found` | wrong board settings | PSRAM "OPI PSRAM" (FQBN `PSRAM=opi`) |
| `microphone gave no data` | I2S wiring | BCLK 4, WS 6, SD 5; L/R to GND; 3V3 and GND |
| server says "too loud / clipped" | gain too high | `MIC_GAIN_SHIFT` bigger (16 = no gain) |
| server says "almost silent" | mic not on the skin, or gain too low | press the mic on the chest; `MIC_GAIN_SHIFT` 15 |
| `ECG: ADS1292R ID 0x00` | chip held in reset, or SPI | PWDN (GPIO48) must be HIGH — no LED writes; check CS/MOSI/SCK/MISO; 3V3/GND to the module |
| `ECG: ADS1292R ID 0xFF` | MISO open or module unpowered | check MISO wire and module power |
| `ECG: register write failed` | MOSI/SCK | check MOSI 11 / SCK 12 |
| `an electrode was OFF` | lead-off detector | re-stick the electrodes, check the AUX plug |
| ECG "cannot judge" on the doctor's page | weak or moving signal | electrodes per the table above, RL connected, person still, laptop on battery |
| `Wi-Fi: not connected yet` forever | 5 GHz network, wrong password | use 2.4 GHz |
| `heartbeat 401` | key wrong or rotated | new key from Admin → Devices into `secrets.h` |
| `heartbeat 403` | admin disconnected the device | admin presses "Reconnect" (lost/security: also rotate the key) |

## Bench facts (2026-11-17, owner's board)

- ADS1292R answers ID 0x73; with the owner's settings it streams 247–250 valid frames per second.
- An RGB LED write on GPIO48 stops it (0 frames) — see above.
- Gel electrodes, RL connected, laptop on battery: clean ECG, 68–70 /min, QRS ~0.8 mV, noise ~26 µV.
- Electrodes close together under the collarbones: ~0.1 mV, unusable.
- Mic pins WS 6 / SD 5 (the earlier `config.h` had them swapped); the owner's chest recordings already peak near full
  scale without gain.

## First test of 0.3.0 on the hardware (10 minutes)

0.3.0 (sound + ECG together) compiles and its upload format is covered by a server test
(`backend/tests/test_ecg.py::test_the_firmware_body_layout_is_accepted`), but it has **not run on the board yet**.
When the device is back:

1. Flash, open the serial log: `ECG: ADS1292R ID 0x73`, `heartbeat: HTTP 200`.
2. Electrodes on (table above), mic on the chest, laptop on battery.
3. Start an exam on the website; the log shows `ECG: ~5000 frames (20.0 s)` and `HTTP 202`.
4. The exam page shows the ECG strip under the sound, the heart rate, and the sound and ECG beats line up.
5. Pull one electrode off and record again: the log says `an electrode was OFF`, the page says "cannot judge".

## Upload format (for developers)

`POST /api/device/upload/{exam_id}`, `multipart/form-data`, `Content-Length` required:

| Part | Content |
|---|---|
| `audio` | WAV, mono, 16-bit, 16 kHz |
| `ecg` (optional) | int32 little-endian, CH1 and CH2 interleaved, raw ADS1292R codes (24-bit sign-extended) |
| `meta` | JSON: `motion_detected`, `sample_rate`, `firmware_version`, and with an ECG `ecg_sample_rate` (250), `ecg_channels` (2), `ecg_gain` (6), `ecg_vref_mv` (2420), `ecg_lead_off` |

The firmware sends `meta` last because `ecg_lead_off` is known only after recording. Millivolts at the electrodes =
code × `ecg_vref_mv` / (`ecg_gain` × 8 388 607).
