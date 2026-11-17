# Product context

Who MurMur is for and where it runs. Read before any design or UX decision. Details: `docs/PLAN.md`.

## Where and when

- University project (NTCC, B.Tech CSE) in **Tashkent, Uzbekistan**. Time zone Asia/Tashkent (UTC+5).
- **First real use is a live demo** in front of the NTCC commission (owner confirmed 2026-11-08). The owner plays the
  doctor; a teammate is the patient; the commission watches a projector and may hold a phone.
- Version 1 runs on **one laptop with its own Wi-Fi hotspot and no internet**: backend, database and website on the
  laptop, the device on the hotspot. So the website must work fully offline — no CDN scripts, no Google Fonts,
  no external images.
- Version 2 (later): a server in Uzbekistan with a domain and HTTPS.

## People

| Role | Who in practice | Device | What they want |
| --- | --- | --- | --- |
| Doctor | Owner during the demo; later a GP/cardiologist screening patients | Laptop **and** phone, equally (owner) | Start a 20 s recording, hear/see it, get a second opinion from AI, write a conclusion fast |
| Patient | Team members and volunteers now; real patients only after ethics approval | Phone | See "my result and what my doctor says", without scary raw AI words |
| Admin | Owner/team | Laptop | Know devices are online, manage doctors, prove data protection (audit log) |
| Commission | Professors | Projector + maybe a phone | Understand in seconds what is happening and that patient data is safe |

## Today, without MurMur

A doctor listens with an analogue stethoscope, decides alone, writes on paper. Nothing is recorded, nothing can be
replayed or shown to a colleague, and a murmur is easy to miss. MurMur must beat that: recorded, replayable,
visualized, a second opinion, a written conclusion the patient can read later.

## Languages

Uzbek (Latin script), Russian, English — all three (owner, 2026-11-08). Uzbek uses `oʻ`/`gʻ` (U+02BB), Russian uses
Cyrillic: fonts must cover Latin Extended + Cyrillic. Medical wording in uz/ru must be checked by a native speaker
(ideally a doctor) before the demo.

## Constraints

- Screening aid and research prototype, NOT a medical device: every AI result says so.
- Patients never see raw AI output; they see results only after the doctor's review.
- No brand yet: MurMur wordmark + heart-wave mark, colours proposed by Claude (owner, 2026-11-08).
- The real AI model is connected (cardiophon-murmur), plus ECG measurement since v2 (owner, 2026-11-08); the UI must also handle "no model".
