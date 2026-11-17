---
paths:
  - "firmware/**"
  - "scripts/fake_device.py"
---

# Firmware rules

- Never drive the on-board RGB LED (`rgbLedWrite`, `neopixelWrite`, `LED_BUILTIN`): GPIO48 is also the ADS1292R PWDN
  pin and one LED write stops the ECG chip. Status goes to the serial log only.
- Pins come from the owner's wiring diagram (`firmware/README.md`, table "Wiring"); change `config.h` and that table
  together. Mic: BCLK 4, WS 6, SD 5. ADS1292R: CS 10, MOSI 11, SCK 12, MISO 13, DRDY 14, START 47, PWDN 48.
- The ADS1292R wakes up streaming: send SDATAC before any register read or write, SPI mode 1, never a mode scan.
- The upload body is audio, then ecg, then meta (meta last: lead-off is known only after recording). Keep
  `backend/tests/test_ecg.py::test_the_firmware_body_layout_is_accepted` byte-identical to `net.h`.
- `scripts/fake_device.py` speaks exactly the firmware's protocol (stdlib only); change both together.
- A change that cannot run on the board says so in the report and adds a step to `firmware/README.md`
  "First test … on the hardware".
- Never read or print `firmware/murmur/secrets.h`; write it only from the template with values the owner gave.
