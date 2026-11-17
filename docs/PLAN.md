> **Historical document (2026-11-08 plan).** Kept for the record; the current truth is `AGENTS.md`,
> `docs/map.md`, `docs/runbook.md`, `firmware/README.md` and `docs/decisions/`. Where this file disagrees
> (pins, PWDN pin, field names, Recharts, "ECG later"), those win.

# MurMur — MVP plan and system architecture

Nov 8, 2026 · @Bilol Kobilov

## Summary

The MVP is simple: the device records 20 seconds of heart sound, our own AI model on the server analyzes it, and the doctor sees the result on a website. Nothing is invented from scratch: only ready-made libraries and open models are used.

| Part | What we use | Notes |
| --- | --- | --- |
| Device | ESP32-S3 + ICS-43434 microphone + MPU6050 | ADS1292R (ECG) in phase 2, for the graph only |
| Device code | Arduino IDE (C++) | A ready-made library exists for everything |
| Backend | Python, FastAPI | The device, the website and the AI meet here |
| Database | PostgreSQL (from day one, in Docker) | WAV files on disk, only the path in the database |
| Frontend | React (Vite), wavesurfer.js, Recharts | wavesurfer: sound waveform and playback; Recharts: ECG graph |
| AI | Local, on our own server | Quality check + murmur model (section 5) |
| Communication | Wi-Fi + plain HTTP | The device asks the server "is there a command?" by itself |
| Deployment | Version 1: laptop + hotspot. Version 2: server + domain + HTTPS | Same code, only the address changes |

Key decisions:

- No mobile app, web site only. The site can also be opened from a phone.
- The AI sends nothing to outside companies (ChatGPT etc.).
- The result is not a diagnosis, it is "screening": at the level of "suspicious, see a doctor".
- The complex parts of the PPT (fusion, baseline, self-calibration) move to "future work".

## How the system works

The system has three parts: the device, the server and the website. The device talks only to the server; the doctor and the admin work only with the website.

[embedded content: MurMur system · 3 parts]

The device sends the recording to the server and gets commands from the server. The AI runs inside the server, and the website gets the result through the API. ECG (dashed) is added in phase 2.

- **Version 1 (local):** the laptop turns on a hotspot and the device connects to it. The server and the website run on the laptop, no internet is needed.
- **Version 2 (server):** the server is on the internet (domain + HTTPS). The device connects to any Wi-Fi with internet; the Wi-Fi name and password are entered through WiFiManager. Only the server address changes in the code.

## Roles: Admin, Doctor and Patient

There are three roles. There is no open registration on the site: the admin creates the doctor account, the doctor creates the patient account.

### Admin

- **Devices:** add (name, serial number), assign to a doctor, status (online/offline, last signal time), Wi-Fi signal strength, software version.
- **Doctors:** create an account, block, reset the password.
- **System status:** number of exams today, errors (unusable recordings, files that failed to upload), running AI model version.
- **Audit log:** who opened which patient's data, and when.

The admin does not see patients' medical results, only counts. This is a plus for data security.

### Doctor

- **Patients:** add (name, birth year, sex, height, weight) and a "consent obtained" mark. A login is created for the patient: the temporary password is shown to the doctor once, and the patient changes it on first login. Height, weight and age are also needed by the CardioPHON model.
- **New exam:** the process below.
- **Result page:** sound waveform, play button, AI result and percentage, warnings.
- **Patient history:** list of previous exams.
- **Report (optional):** download the result as a PDF.

The doctor sees only their own patients.

### Patient

- Sees their own profile and the list of their exams.
- Sees a result only after the doctor has reviewed it and marked it "confirmed", together with the doctor's note.
- Cannot see other patients' data.

The raw AI result is not shown directly to the patient: the word "abnormal" without explanation would scare the patient for no reason.

### Exam process

1. The doctor selects a patient and presses "New exam".
2. They select the device and the point on the chest: AV, PV, TV or MV (the 4 points in CirCor).
3. They press "Start recording". The server stores a command for that device.
4. The device asks the server "is there a command?" every 1–2 seconds, gets the command and records for 20 seconds. A light on the device stays on.
5. The device sends the WAV file and the motion data (MPU6050) to the server.
6. The server checks quality first. If it is bad, the doctor sees "record again". If it is good, it is passed to the AI model.
7. The result appears on the doctor's screen.
8. The doctor writes their own conclusion: "I agree / disagree with the AI" and a note. The final decision is always made by a human.

## Database and API

Eight tables are enough. The device logs in with its own key (API key), and website users log in with a login (JWT token).

### Tables

| Table | Main fields |
| --- | --- |
| users | id, name, email, password hash, role (admin/doctor/patient), active |
| devices | id, name, serial, API key hash, assigned doctor, last signal time, Wi-Fi strength, software version |
| patients | id, doctor, patient login (users), name, birth year, sex, height, weight, time consent was obtained |
| exams | id, patient, doctor, device, point (AV/PV/TV/MV), status, doctor's note, doctor's agreement |
| recordings | id, exam, file path, sample rate, duration, whether there was motion |
| ai\_results | id, exam, model name, model version, quality (good/bad), result, percentage |
| device\_commands | id, device, exam, command (record), seconds, status (waiting/received/done) |
| audit\_logs | id, user, action, which object, time |

Exam statuses change in sequence: waiting → recording → uploaded → analyzed → doctor confirmed (or error).

### API

| For | Address | What it does |
| --- | --- | --- |
| Device | POST /api/device/heartbeat | "I'm alive" every 10 seconds + Wi-Fi strength, version |
| Device | GET /api/device/command | Asks whether there is an unfulfilled command |
| Device | POST /api/device/upload/{exam\_id} | Sends the WAV file + JSON (motion, later ECG) |
| Website | POST /api/auth/login | Log in, get a JWT token |
| Doctor | GET, POST /api/patients | List of patients and a new patient |
| Doctor | POST /api/exams | New exam and a command to the device |
| Doctor | GET /api/exams/{id} | Status and result (the website polls every 2 seconds) |
| Doctor | GET /api/exams/{id}/audio | WAV for listening to the recording |
| Doctor | PATCH /api/exams/{id} | Doctor's note and conclusion |
| Admin | /api/admin/devices, /users, /stats, /audit | Devices, doctors, statistics, audit log |

For the patient: GET /api/me and GET /api/me/exams — only their own data and confirmed results.

After the file is uploaded, the AI analysis runs in the backend as a background task (FastAPI BackgroundTasks). This is why the device does not wait for the response.

## AI: which model and where

The AI runs locally: on the laptop in version 1, on our own server in version 2. No data goes to AI services on the internet. The analysis has two stages: first the recording quality is checked, then the result is produced.

### 1. Quality check

- **Plain rules:** the recording is rejected if the sound is too quiet or too loud (clipped), or if the MPU6050 sensed motion during recording.
- **CardioPHON quality model:** rates the recording as "usable / unusable"; the paper reports about 93% accuracy. It works with 1 kHz audio.

If the recording is unusable, the AI gives no result and the doctor sees "record again".

### 2. Result model (one is chosen after testing)

| Model | What it says | Input | Plus | Minus |
| --- | --- | --- | --- | --- |
| [AST heart murmur classifier](https://huggingface.co/rajnish612/ast-heart-murmur-classifier) | Murmur / Absent / Unknown | Sound, 16 kHz | Works with 5 lines of code | Accuracy not published, little used |
| [CardioPHON](https://git.lih.lu/vdespotovic/cardiophon) | Normal / Abnormal | Sound 4 kHz + age, sex, height, weight | Proven in a paper, source \[1\] in the PPT | Accuracy about 62%; calls more than half of healthy people "abnormal"; the last layer may need to be trained |

How we choose: 100 recordings are taken from CirCor (only one per patient, a mix of murmur and no murmur). Both models are run on these recordings, and accuracy, sensitivity and specificity are calculated. Whichever does better is used. This comparison will be a ready result for the ISR part.

The model name and version are stored with every result. If the model is replaced later, old results still show which model they came from.

### Limitations (stated openly to the committee)

- CirCor is recordings of children in Brazil. Accuracy may drop for adults.
- The models were trained on clinical stethoscope recordings. Accuracy is expected to drop with a cheap microphone (source \[6\] in the PPT shows exactly this).
- This is not a diagnosis, only screening and help for the doctor.

The server does not need a GPU: an ordinary CPU analyzes a single 20-second recording in a few seconds.

## Data security: NTCC questions and answers

Main answer: all data stays on our own server, the AI runs there too, and nothing goes to third parties. Below are the questions the committee is likely to ask, with prepared answers.

| Question | Answer |
| --- | --- |
| Where is the data stored? | On the laptop in version 1, on our own server in version 2. It is not sent to cloud AI services. |
| Does the AI send data outside? | No. The model file sits on the server and runs there. |
| Who sees patient data? | The doctor who added the patient, and the patient (confirmed results only). The admin sees only statistics. Every access is written to the audit log. |
| How is the data protected? | HTTPS (Let's Encrypt) in version 2. Passwords are hashed with bcrypt. The website uses a JWT token and the device uses its own API key. Each role opens only the pages it is allowed. |
| Does the recording file contain the patient's name? | No. The file name is a random ID. The name and other personal data are in a separate table (pseudonymization). |
| Is the patient's consent obtained? | Yes, written consent. Without the "consent obtained" mark in the system, an exam cannot start. For now only team members and voluntary volunteers are tested; ethics approval will be obtained before real patients. |
| Can the data be deleted? | Yes. If the patient asks, all their recordings and results are deleted. |
| Is there a backup? | In version 2, a daily backup of the database and files is made. |
| Is it legal? | The Uzbekistan law "On Personal Data" (ZRU-547) applies. After the March 2026 amendment, the requirement to keep servers only in Uzbekistan remains mainly for biometric and genetic data ([kun.uz](https://kun.uz/en/news/2026/08/04/uzbekistan-approves-49-countries-for-simplified-personal-data-transfers)). Still, the safest way is to host the version 2 server with a hosting provider in Uzbekistan. |
| Is this a medical device? | No, it is a research prototype. A real medical device gets official approval (for example, source \[11\] in the PPT: Eko's FDA clearance). |
| What about electrical safety? | When ECG electrodes are connected to a person, the device runs only from a power bank or battery and is not connected by USB to a laptop that is plugged into the wall. |

Check the legal answer once more before the presentation: I am not a lawyer, and the law changed in 2026.

## Errors in the team's plan and what to add

The main problem with the PPT: the plan is too big, and some parts are technically wrong. The most important missing thing is how to attach the microphone to the chest.

### To fix

| In the PPT | Problem | Correct |
| --- | --- | --- |
| "Wi-Fi 5" | The ESP32-S3 supports only 2.4 GHz Wi-Fi 4 (802.11 b/g/n) and BLE 5 | "Wi-Fi (2.4 GHz)" |
| Slide 14: "CardioEcho AI" | Wrong project name | MurMur |
| AI on the phone, "sensor to phone" | No mobile app, unnecessary complexity | AI on the server, result on the website |
| "MEMS sensor" | The microphone is for air; there is no plan for how it touches the chest | Stethoscope head + tube with the microphone inside (section 8) |
| Reference mic + adaptive noise cancellation | A second microphone was not ordered, and the signal processing is complex | Simple filter (25–400 Hz); ANC — future work |
| Self-calibration | No clear plan | Future work |
| PPG | The sensor was not ordered | Remove from the PPT |
| MPU6050 | Purchased, but not in the PPT | Add to Layer 1: motion check |
| Fusion (H2), Baseline (H3), Fingerprint, Uncertainty, "Models 5 → 6" | Too big for the MVP | ISR or future work |
| "Time sync PCG + ECG" | Not a separate problem: one ESP32 collects both signals | ECG in phase 2, with a single clock |
| Slide 10: "Delivery to Uzbekistan" | Outdated | Write the new status |
| No limitations | CirCor is children's data, clinical stethoscopes | Add the limitations from section 5 |
| No power | A battery is not in the plan | Power bank (section 8) |

### To add (missing from the PPT entirely)

- Roles (admin and doctor), login and database.
- Device management: status (online/offline) and a "start recording" command from the website.
- Data security section (section 6).
- Doctor's conclusion: the final decision is made by a human, the AI only helps.
- Phantom test: play CirCor recordings to the device through a small speaker and measure accuracy without people. This makes it possible to test the whole system without waiting for ethics approval.
- Comparison of two models (section 5) — a result for the ISR.

## Additional shopping list

Besides the 4 ordered modules, the following are needed. The most important is a cheap stethoscope: the microphone is placed inside its tube, so the heart sound is captured properly.

| Item | Why | When |
| --- | --- | --- |
| Cheap stethoscope (head + tube) | To place the microphone inside the tube | Right now, required |
| Power bank (USB-C) | Power and electrical safety | Right now, required |
| USB-C data cable | To upload code to the ESP32 | Right now, required |
| Breadboard, female-female wires | To connect the modules | Right now, required |
| Soldering iron and solder | To solder the module pins | Right now, required |
| Small speaker or old earphones | Phantom test | Right now, required |
| Disposable ECG electrodes (snap) | For the ADS1292R | At the ECG stage |
| Second ICS-43434 | Only if noise cancellation (ANC) is done | Optional |
| 3D-printed case | Device worn on the chest | After the MVP |

Cables may have come with the ADS1292R (visible in the picture); check when the device arrives.

## Weekly work plan and task assignment

The plan is for 5 weeks, starting on November 9. Software is prepared until the device arrives, so nobody sits waiting. When the NTCC date is known, the weeks will be compressed accordingly.

### Week 1 (Nov 9–15): without the device

- [ ] Backend skeleton: FastAPI, login, roles, tables
- [ ] React: login, admin and doctor page skeletons
- [ ] Download CirCor, test the 2 models on 100 files
- [ ] Buy the stethoscope, power bank, wires, soldering iron

### Week 2 (Nov 16–22): the device arrives

- [ ] Solder and connect the modules
- [ ] Get a WAV from the microphone and send it to the laptop
- [ ] Heartbeat, online/offline on the admin page

### Week 3 (Nov 23–29): the full chain

- [ ] From the website "Start" → the device records → AI → result
- [ ] Result page: sound waveform, percentage, doctor's note
- [ ] Quality check and the MPU6050 motion flag

### Week 4 (Nov 30 – Dec 6): testing

- [ ] Phantom test, record the results in a table
- [ ] Audit log, PDF report (optional)

### Week 5 (Dec 7–13): version 2 and presentation

- [ ] Move to the server, domain, HTTPS, WiFiManager
- [ ] ECG graph (if time remains)
- [ ] Update the PPT, prepare the live demo

### Who does what

There is clear work even for members who cannot code.

| Task | Who | Coding needed |
| --- | --- | --- |
| Backend, frontend, device code (with Claude) | You | Yes |
| Assemble the device, solder, place the microphone in the stethoscope | 1 person | No |
| AI testing: run the ready script, write results into Excel | 1 person | A little |
| Phantom test and device tests | 1 person | No |
| PPT, literature, consent form, ethics documents | 1 person | No |

## Next step: device code

The device code is written in Arduino IDE with ready-made libraries. Once the modules arrive, I will write it in this order: first the microphone, then Wi-Fi and sending, then the MPU6050, and ECG last.

| Module | Library |
| --- | --- |
| ICS-43434 microphone (I2S) | ESP\_I2S (included in Arduino-ESP32 3.x) |
| MPU6050 | Adafruit MPU6050 |
| ADS1292R (ECG) | ProtoCentral ADS1292R |
| Wi-Fi setup | WiFiManager |
| Sending to the server | HTTPClient (included) |

Arduino IDE settings: board — "ESP32S3 Dev Module", PSRAM — "OPI PSRAM", Flash — 16MB. This is needed to hold the recording temporarily in memory.

Approximate wiring (to be confirmed against the pinout once the board arrives):

- Microphone (I2S): BCLK → GPIO 4, WS → GPIO 5, SD → GPIO 6, L/R → GND.
- MPU6050 (I2C): SDA → GPIO 8, SCL → GPIO 9.
- ADS1292R (SPI): MOSI → 11, SCK → 12, MISO → 13, CS → 10, DRDY → 14, START → 15, PWDN → 16.
- GPIO 35, 36, 37 are not used: on the N16R8 board they are reserved for the internal memory (PSRAM).

On the day the devices arrive, send a photo of the board and the modules, and I will write the first code (microphone → WAV → laptop) based on it.
