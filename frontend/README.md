# MurMur frontend

React web app for MurMur, with three role-based areas: **admin** (doctors, devices, audit log), **doctor** (patients,
exams, AI result review) and **patient** (own reviewed results, phone-friendly). Available in Uzbek, Russian and English.

## Stack

React 19, Vite, TypeScript ~5.9, Tailwind 4, TanStack Query, React Router, react-i18next, Radix UI, wavesurfer.js,
Vitest + Testing Library, ESLint. Spec: `docs/specs/2026-11-08-web-frontend.md`; design system:
`.interface-design/system.md`.

## Run

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173, proxies /api to the backend on :8000
```

Start the backend first (see `../backend/README.md`). For the one-origin demo, `npm run build` and the backend serves
`dist/` at `/`, so no CORS is involved.

## Checks (run all before calling a change done)

```bash
npx tsc -b && npm run lint && npm test && npm run build && npm run check:offline
npx vitest run src/path/to/file.test.tsx     # a single test file
```

`check:offline` fails if the build would load anything from the internet. The demo laptop is offline, so fonts and
icons are bundled.

## Layout

```
src/
  main.tsx, app/        entry, router (role pages lazy-loaded), session (token in sessionStorage), route guards
  api/                  client.ts is the only door to the server; auth.ts, doctor.ts, admin.ts, patient.ts
  features/
    admin/              counts, doctors, devices (fleet list, register, detail), audit
    doctor/             review queue, patients, exam flow (new exam, live status, result + review)
    patient/            reviewed results, profile, printable records; AI label only, never the score
  pages/, components/   login, change password, status pages; ui / brand / layout / exam / device components
  i18n/                 uz / ru / en JSON files
  lib/                  formatting (dates in Asia/Tashkent), synthetic heart trace
```

`docs/map.md` lists the files in detail.

## Rules worth knowing

- **All server access goes through `src/api/client.ts`:** Bearer token from sessionStorage; `401` ends the session
  ("session expired"); `403` forces a password change.
- **Every string needs `uz`, `ru` and `en` keys.** A test checks the key sets match. Uzbek text uses the okina `ʻ`.
  Medical terms: `docs/glossary.md`.
- **The AI answer vocabulary is mirrored** in `src/features/doctor/exam/aiOutcome.ts` and the backend
  `analyzer.py` (`ANSWER_LABELS`, `gave_answer()`). Change both together.
- **Patients never see the AI score, model or agreement (only the yes / no label of reviewed exams),** and the admin never sees medical data. The backend enforces it; do not add UI that
  depends on the opposite.
- UI follows `.interface-design/system.md`; no new dependencies without asking.
