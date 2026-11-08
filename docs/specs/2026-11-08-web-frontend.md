# Spec: MurMur web frontend (admin, doctor, patient)

Status: **draft — waiting for owner approval** · 2026-11-08 · Context: `docs/context.md` · Backend: Stage 1 done.

## 1. Problem and outcome

| | |
| --- | --- |
| Who | Doctor (owner in the demo; later a GP), patient (team member / volunteer), admin (team), NTCC commission watching |
| When | Doctor: patient sits in front of them, device on the chest → record → hear/see → conclude → next patient. Patient: at home, later, on a phone. Admin: before the session (devices online?) and when asked "who saw my data?" |
| Outcome | Doctor: a recorded, replayable, visualized heart sound + AI second opinion + written conclusion in **under 2 minutes**. Patient: "what did my doctor conclude" in plain words. Commission: understands the whole chain and the data protection in one 5-minute demo |
| Today | Analogue stethoscope, decision alone, paper notes; nothing recorded or replayable |
| Signal it worked | Rehearsal of the demo script (§8) from "Start exam" to "patient sees the note" runs end to end with **0 errors and < 2 min**, on laptop (1440 px) and phone (375 px), in all 3 languages |

Owner choices (2026-11-08): demo first; uz + ru + en; laptop and phone equally; real AI model ready before the demo;
show live exam, waveform + listening, patient phone view, admin/security; no brand yet; time is not a constraint.

## 2. Research (what real products do)

| Product | What it gets right | What users complain about | Source |
| --- | --- | --- | --- |
| Eko (app + web dashboard, SENSORA) | AI result is one of 3 outcomes: *no murmur / murmur detected / poor quality*; poor recordings are not analyzed; "a physician should always review"; guided multi-point exam flow; admin dashboard | Playback glitches, recordings lost when offline (you learn only after recording), sharing is hard, features moved behind a paywall | [IFU](https://cdn.shopify.com/s/files/1/0715/6111/files/LBL046_EAS_IFU_ENG_Rev2.0.pdf), [SENSORA](https://www.ekohealth.com/sensora), [reviews](https://justuseapp.com/en/app/1026457544/eko-digital-stethoscope-ecg/reviews), [Physicians Practice](https://www.physicianspractice.com/app-review-eko-stethoscope) |
| Littmann CORE + Eko software | Real-time waveform while listening "added clinical confidence"; fixed recording lengths; annotate recordings | Waveform alone is "nice to have" for some doctors — sound quality matters more | [Eko CORE page](https://www.ekohealth.com/products/3m-littmann-core-digital-stethoscope), [review](https://jefferyshome.com/littmann-core-digital-stethoscope/) |
| Stethophone (Sparrow, FDA-cleared app) | Two views: **oscillogram (waveform) and spectrogram**; murmur detection, S1/S2 timing, heart rate | — (no UI reviews found) | [FDA K240901](https://fda.innolitics.com/device/K240901), [Fierce Biotech](https://www.fiercebiotech.com/medtech/fda-clears-first-ai-powered-mobile-app-to-catch-heart-murmurs) |
| Patient portals (MyChart et al.) | Fast access is wanted (96 % prefer it) | Results seen before the doctor → anxiety, more messages; some US states force a 72 h delay | [KFF Health News](https://kffhealthnews.org/news/without-context-or-cushion-do-online-medical-results-make-sense/), [AHCJ 2025](https://healthjournalism.org/blog/2025/06/immediate-online-access-to-medical-test-results-can-feed-scanxiety-study-says/) |
| Clinical dashboards (RPM vendors) | A **"needs my action" list first**, not a flat chronological list; red only for critical; colour always paired with icon/text | Over-flagging → doctors ignore the screen | [Mindbowser RPM](https://www.mindbowser.com/?p=111792) |
| wavesurfer.js v7 | Waveform, Regions, Timeline, **Spectrogram** plugins; React: create once, destroy on unmount (StrictMode double-mount) | — | [repo](https://github.com/katspaugh/wavesurfer.js), [plugins](https://wavesurfer.xyz/docs/plugins/) |

**Conventions we follow:** 3-outcome AI result incl. "poor quality"; physician review is final; waveform + spectrogram;
patient sees results only after review (we already enforce this); "needs review" list as the doctor's home.
**Where we deviate, deliberately:** recording length fixed at 20 s (device firmware), no paywall/sharing.
**What none of them do (our opening):** a chest diagram to pick the auscultation point, and a live device→server→AI
chain visible on one screen — exactly what a demo needs.

**Non-obvious mechanics we must build** (miss them and it "works" but nobody can use it):
live status without page reload (polling with backoff, stops at a final state); a client-side 20 s countdown started
when the exam turns `recording`; "device not responding" after ~15 s in `waiting` with a Cancel button; audio fetched
with the auth header and fed to wavesurfer as a blob; one-time secrets (device key, temporary password) shown in a
modal with Copy and "I saved it" — never retrievable again; forced password change screen; session expiry → back to
login and then to the same page; double-click protection on every action button; empty states with one clear action;
fully offline assets (fonts bundled); fonts covering `oʻ gʻ` and Cyrillic.

## 3. Core flows (shortest path)

**Doctor — live exam (the demo centrepiece)**
1. Log in → **Home**: "Needs review" list, my devices with online dots, recent patients.
2. Open patient (or create: name, birth year, sex, height, weight, ☐ consent) → patient page with exam history.
3. **New exam**: pick device (online first, offline disabled with reason) → tap the point on a **chest diagram**
   (AV/PV/TV/MV) → **Start recording**.
4. Live panel: `waiting` "sending command to device…" → `recording` 20 s countdown ring + "keep the patient still" →
   `uploaded` "checking quality and analysing…" → `analyzed` result appears (no reload).
   `failed`: plain reason (e.g. "Re-record: too short") + **Record again** (same patient/device/point).
5. **Result**: waveform (play/pause, seek, spectrogram toggle), AI card (label, confidence, quality, model + version,
   "screening aid, not a diagnosis"), review form (agree / disagree + note) → **Confirm** → status `reviewed`.

**Patient (phone)**: log in → forced password change on first login → "My results" (reviewed only) → result:
date, point on the chest diagram, doctor's note. No AI words.

**Admin**: Home with counts + devices online + current AI model → Doctors (create, block/unblock, reset password) →
Devices (register → one-time key modal, assign doctor, rotate key, live online/RSSI/firmware) → Audit log (paged).

## 4. Data model

No new tables. The frontend is a client of the existing API (`README.md`). Source of truth stays the backend.
Client state: access token + role (sessionStorage, see §5 D4), UI language (localStorage), nothing else persisted.
Patient names are shown only on doctor screens; the admin UI never requests patient data (the API forbids it anyway).

## 5. Decisions (approach options)

**D1 — UI building blocks**
```
Option A — Tailwind CSS + Radix primitives (shadcn/ui style, components copied into our repo).
  Fits: needs a distinctive demo look; accessible dialogs/menus/selects; Claude can edit every component.
  Costs: more styling work up front.
Option B — Component library (Mantine / MUI).
  Fits: fastest to a working admin table.  Costs: looks like every other admin template; theme fights.
Option C — Plain CSS, hand-made components.
  Fits: zero dependencies.  Costs: accessibility (focus traps, keyboard) must be rebuilt by hand.
Recommendation: A, because the demo is the first use and must look designed, while dialogs/menus must stay accessible.
```
**D2 — Server data and live status**
```
Option A — TanStack Query: caching, retries, refetchInterval for the live exam, stop at final state.
Option B — Hand-written fetch + useEffect polling.
Recommendation: A, because the live exam page is the riskiest screen (polling, retries, stale data) and A solves it
in configuration rather than custom code.
```
**D3 — How the site is served**
```
Option A — Dev: Vite dev server with /api proxy. Demo/prod: `npm run build`, FastAPI serves frontend/dist at "/"
  (SPA fallback), API stays at /api. One process, one origin, no CORS, works on the offline laptop.
Option B — Separate static server (nginx) next to FastAPI.
Recommendation: A, because version 1 is one laptop without internet — one process to start is one less demo risk.
```
**D4 — Session**
```
Token in sessionStorage (dies with the tab), sent as Bearer header. On 401: go to login, then back to the same page.
Open question Q2: JWT lifetime (now 60 min) — a demo rehearsal or a clinic morning is longer.
```
**D5 — Languages**: react-i18next, one JSON per language (`uz`, `ru`, `en`), language switch in the header,
remembered per browser. Dates/numbers via `Intl` in Asia/Tashkent. A test fails if any key is missing in any language.

**Dependencies (all free, MIT/Apache):** react, react-dom, react-router, @tanstack/react-query, react-i18next + i18next,
wavesurfer.js, tailwindcss, @radix-ui/* (dialog, select, dropdown, toast), clsx; dev: vite, typescript, vitest,
@testing-library/react, eslint. Fonts bundled locally (e.g. Inter / Manrope — Latin Ext + Cyrillic, OFL licence).
Alternative to all of them: hand-written equivalents — far more work, worse accessibility.

## 6. Blast radius (backend changes this needs)

| Change | Why | Files |
| --- | --- | --- |
| `GET /api/exams?status=&limit=&offset=` (doctor's own, newest first) | Home "Needs review" and "today" lists — no such endpoint yet | `api/doctor.py`, `services/exams.py`, tests |
| Pagination (`limit`/`offset`) on doctor patient list | Lists must not grow unbounded | `api/doctor.py`, `services/patients.py` |
| Serve `frontend/dist` + SPA fallback (only if the folder exists) | D3 | `app/main.py`, test |
| `JWT_EXPIRE_MINUTES` default (Q2) | Session length | `config.py`, `.env.example` |
| New top-level `frontend/` folder; map, runbook, README, AGENTS updated | Structure | docs |

Nothing else in the backend changes; all 183 tests must stay green. If D3 is wrong, only `main.py` mounting changes.

## 7. Edge cases (must be handled and tested)

1. **Empty**: no patients / no exams / no devices / doctor has no device → empty state with one action ("Add your first patient", "Ask the admin to assign a device").
2. **Device offline** when starting → option disabled with "offline since 14:02"; device goes offline *during* `waiting` → after 15 s "device not responding" + Cancel.
3. **Slow network / hotspot drop** → live panel shows "reconnecting…", keeps polling with backoff, never shows a wrong final state.
4. **Session expired mid-exam** → login, then back to the same exam (exam continues server-side).
5. **Double click** on Start / Confirm review / Reset password / Delete → button disabled while the request runs (backend already serializes; see decisions).
6. **409 conflicts** (exam already reviewed / cancelled in another tab) → refresh the exam and explain, never a raw error.
7. **Failed quality** → reason in the user's language (map backend reason codes, e.g. "too short", to i18n keys; show seconds).
8. **AI model missing** (`not_analyzed`) or poor quality → honest card "AI unavailable / recording quality too low", review still possible.
9. **Long names / Cyrillic / `oʻ` / RTL-free** → truncation with title, fonts with full glyph coverage, sorting with `Intl.Collator` per language.
10. **Huge lists** (500 patients, 10 000 audit rows) → server paging + client search; audit table pages of 50.
11. **One-time secrets** (device key, temp password) → shown once in a modal with Copy; closing asks "Did you save it?"; never logged, never in the URL.
12. **Delete patient** → typed confirmation (patient's name), explains it cannot be undone.
13. **Role mismatch** (patient opens a doctor URL) → "not available for your account", not a blank page.
14. **Phone 375 px** → every screen single-column; waveform scrolls horizontally with pinch-free zoom buttons; tap targets ≥ 44 px.
15. **Audio**: browser autoplay rules (play only on tap), large files streamed as blob, playback position survives a re-render.
16. **Clock/time zone**: all times shown in Asia/Tashkent; "today" matches the backend's definition.
17. **Offline assets**: build contains every font/icon; a test fails if `dist/` references `http(s)://` outside `/api`.

## 8. Verification plan

Defined before any code:
1. **Unit** (`cd frontend && npm test`, Vitest): i18n completeness (every key in uz/ru/en), API client (401 → login
   redirect, error mapping), exam status → UI state mapping, countdown, quality-reason mapping.
2. **Build** (`npm run build`): no type errors, no external URLs in `dist/` (script check).
3. **Backend** (`cd backend && uv run python -m pytest`): new list/paging/static tests + all existing tests green.
4. **End-to-end demo script**, run by Claude in the built-in browser against the real server + `scripts/fake_device.py`
   with the CirCor samples, screenshots saved to `docs/specs/screens/`:
   admin creates doctor + device (key modal) → doctor creates patient + login → starts exam → live states →
   result with waveform/playback → review → patient (375 px) sees the note → admin sees audit rows.
   Repeated at 1440 px and 375 px, in uz / ru / en. Pass = no console errors, no failed requests other than expected
   4xx, every screen matches the approved mockup style.
5. **Owner check**: you walk through the same script yourself once before the demo.

## 9. Out of scope (now)

ECG graph (stage 2 hardware), PDF report (PLAN: optional), real-time audio streaming while recording, S1/S2 labels on
the waveform (only if the chosen AI model returns them), dark mode as a separate theme, push notifications,
sharing results outside the system, offline-first/PWA install, multi-point guided exam (one point per exam for now).

## 10. Open questions (with my recommendation)

- **Q1 Visual style** — I will show 3 directions as mockups; you pick one. *Recommendation: decide from the mockups.*
- **Q2 Session length** — JWT now lasts 60 min, then re-login. *Recommendation: 8 hours (one working day); blocked
  users and password changes still cut sessions at once.*
- **Q3 Default language** on the login page. *Recommendation: Uzbek; English one tap away for the commission.*
- **Q4 Translation check** — who reviews the Russian/Uzbek medical words? *Recommendation: one doctor or a medical
  student, one 30-minute pass before the demo.*
- **Q5 Chest diagram** for picking AV/PV/TV/MV — *Recommendation: yes; it explains the CirCor points to the commission at a glance.*

## 11. Self-critique

- *Would a generic assistant produce this?* It would produce the screens; it would likely miss the offline-laptop
  constraint (no CDN/fonts), the live-state machine with "device not responding", one-time secret handling, quality
  reason mapping, and the 3-outcome AI card from Eko's IFU. Those are in.
- *Weakest assumption:* that Vite's native binaries (esbuild, rollup) run on this PC. **Smart App Control already
  blocked unsigned `.exe`/DLLs for Python.** If it blocks esbuild/rollup, the build fails. Mitigation: task 0 is a
  10-minute spike; fallbacks are the WASM builds (`esbuild-wasm`, `@rollup/wasm-node`) via npm overrides.
- *Second weakest:* 3 languages with medically correct wording (Q4).
- *What makes a user try once and leave:* a live exam that hangs on "waiting" with no explanation; playback that
  stutters (Eko's top complaint). Both have explicit handling + tests.
- *80/20 version:* doctor flow + patient result page in one language would be ~40 % of the work. Not proposed as the
  final scope because the owner asked for all four demo parts and three languages; instead the **build order** is
  80/20: (1) doctor live exam + result, (2) patient phone view, (3) admin, (4) languages polish + full e2e run.
