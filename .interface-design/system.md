# MurMur interface system

Source of truth for every screen. Spec: `docs/specs/2026-11-08-web-frontend.md` §12. Tokens live in
`frontend/src/index.css` (`@theme`). If a screen needs a value that is not here, add it here first.

## Direction

- **World:** the printed ECG/phonocardiogram strip on a clinic desk — millimetre paper, ink, one red trace,
  the doctor's handwritten conclusion. Calm, exact, clinical; never playful, never "dashboard-y".
- **Who:** a doctor in front of a patient with a device on the chest (laptop or phone, hands busy), a patient at home
  on a phone, an admin preparing the session. NTCC commission watches on a projector.
- **Signature:** the millimetre grid + trace (1 big square = 0.2 s). Appears on: login, live recording sweep,
  exam result waveform, status marks in lists (mini trace), empty states. Nowhere else red.

## Rejected defaults

| Default | Instead | Why |
| --- | --- | --- |
| Row of 4 KPI cards on every home page | One focal sentence + the queue it describes ("3 exams wait for your review") | The doctor came to do one thing: review |
| Avatar circles with initials for patients | Mono record number `№ 012` + name | A patient is a clinical record, not a social profile |
| Coloured status pills only | Mini trace mark + word (colour never alone) | Signature reuse; colour-blind safe |
| Zebra tables | Hairline-separated dense rows | Chart paper is lines, not stripes |
| Confirm dialogs for everything | Confirm only irreversible (delete); undo-free otherwise | Fewer interruptions |

## Tokens

**Colour** (`--color-*`): `ink-900/700/500/300` text tiers (primary / secondary / meta / disabled-placeholder) ·
`line`, `line-strong` hairlines · `canvas` page · `surface` cards · `field` inputs (inset, darker than surface) ·
`grid-minor`, `grid-major` chart paper · `signal` trace + logo only · `finding`(+`-bg`) AI finding / needs review ·
`clear`(+`-bg`) reviewed / no murmur · `danger` failed / destructive. One accent for actions: `ink-900`.

**Type** — IBM Plex Sans (+ Noto for `ʻ`), IBM Plex Mono for data. Ratio ≈ 1.25:

| Token | Size / line | Use |
| --- | --- | --- |
| `text-caption` | 12 / 16 | meta, timestamps, axis labels (mono) |
| `text-label` | 13 / 18 | form labels, table headers, chips |
| `text-body` | 15 / 23 | default text |
| `text-title` | 19 / 26 | card and section titles (600) |
| `text-headline` | 24 / 30 | page titles (600, −1 % tracking) |
| `text-display` | 30 / 36 | one focal number/sentence per screen (600, −2 %) |

Hierarchy comes from weight + ink tier first, size second. Numbers that change: `tabular-nums`.

**Spacing**: 4 px base. Dense zones (lists, tables): 8–12 px row padding. Decision zones (review form, dialogs):
24 px. Between page sections: 32 px. Page gutter 16 px phone / 24 px laptop; content max 1152 px.

**Radius**: 6 controls inside groups · 8 buttons/inputs · 12 cards · 16 dialogs. Nested: outer = inner + padding.

**Depth — borders only.** Hairlines (`line`) separate; no card shadows. The only shadow is on floating layers
(menus, dialogs): `0 8px 24px rgba(20,33,61,.12)`. Chart paper is made of lines; so is the UI.

## Behaviour rules

- Submit buttons stay enabled until the request starts; then `busy` (spinner + "…ing…" text, no double submit).
  Invalid on submit → inline error under the field + focus the first invalid field.
- Every list: loading (skeleton rows, no layout shift), empty (what + why + one action), error (what + retry).
- Search/filter/paging state lives in the URL (`?q=`), so reload/back keeps it.
- Unsaved form → warn before leaving (router blocker + `beforeunload`).
- One-time secrets (temporary password, device key): dialog, mono, Copy, cannot be dismissed by Esc/overlay,
  closes only with "I saved it". Never in URL, logs or toasts.
- Destructive + irreversible → dialog naming the thing and the consequence; type the patient's name to enable.
- Brand, codes (AV/PV/TV/MV), usernames, serials: `translate="no"`.
- Motion: press `scale(.97)`; popovers 150–200 ms ease-out `cubic-bezier(.23,1,.32,1)`; the only orchestrated motion
  is the 20 s recording sweep. All movement off under `prefers-reduced-motion`.
- Hit areas ≥ 44 px on touch; focus ring 2 px `ink-900`, offset 2; skip link to main content.
- Copy: sentence case; verbs on buttons ("Add patient", not "Submit"); errors = what happened + what to do; no
  "please", no "successfully". Medical words follow `docs/glossary.md`.
