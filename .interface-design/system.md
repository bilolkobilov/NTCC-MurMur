# MurMur interface system

Source of truth for every screen. Tokens live in `frontend/src/index.css` (`@theme`); the `rd-` component styles in
`frontend/src/redesign/redesign.css` read the same values through `redesign/tokens.css`. If a screen needs a value
that is not here, add it here first.

**2026-11-17 (owner):** one design system for the whole app — the redesign's petrol-blue palette on cool neutrals
(used by most pages since the 2026-11-14…16 redesign), made phone-first; the older "ink + chart paper" pages were moved
onto it. The chart paper stays as the signature of the heart-sound and ECG strips.

## Direction

- **World:** the printed ECG/phonocardiogram strip on a clinic desk — millimetre paper, one red trace, the doctor's
  conclusion — inside a calm, exact clinical tool. Never playful.
- **Who:** a doctor in front of a patient with the device strapped on the chest (laptop **or phone**, hands busy), a
  patient at home on a phone, an admin preparing the session. NTCC commission watches on a projector.
- **Signature:** the millimetre grid + red trace, on the heart-sound strip, the ECG strip under it and the live
  recording sweep. Red (`signal`) appears nowhere else.

## Rejected defaults

| Default | Instead | Why |
| --- | --- | --- |
| Colour alone for status | Chip = icon + word + colour | Colour-blind safe |
| Zebra tables | Hairline-separated rows; **stacked label/value rows on a phone** | Lines, not stripes; no sideways scrolling |
| Sidebar that never collapses | Sidebar ≥ 900 px, **bottom tab bar** below | The doctor uses a phone as much as a laptop |
| Links to pages that do not exist (privacy, terms) | No link until the page exists | Never fake working UI |
| "Normal / Abnormal" for an AI answer nobody reviewed | "Murmur suspected (AI)" / "No murmur (AI)" | Only a doctor says normal |
| Invented reference ranges for vitals | Plain numbers until a doctor sets ranges (owner, 2026-11-17) | No medical rules without a doctor |
| Confirm dialogs for everything | Confirm only irreversible (delete) | Fewer interruptions |

## Tokens

**Colour** (`--color-*` in `index.css`; `--c-*` in `redesign/tokens.css` point at them):

| Token | Value | Use |
| --- | --- | --- |
| `ink-900` / `700` / `500` | #0e1a22 / #41525e / #5a6b77 | text: primary / body / captions (never lighter) |
| `ink-300`, `line-strong` | #7d8c97 | control borders (3.46:1), icons — not text |
| `line` | #dfe5e9 | dividers, card outlines |
| `canvas` / `surface` / `subtle` | #f6f8f9 / #fff / #edf1f3 | page / cards and inputs / hover rows |
| `primary` (+`-hover`, `-tint`, `-ink`) | #0b6e8a | the only accent: actions, links, active navigation |
| `clear` (+`-bg`) | #15663d | no murmur / done |
| `finding` (+`-bg`) | #a33f00 | AI finding / needs review / ECG "cannot judge" |
| `danger` (+`-bg`, `-dot`) | #b0231a | failed, destructive |
| `ai` (+`-bg`) | #5238b8 | AI-generated content only |
| `grid-minor`, `grid-major`, `signal` | #f8dde1, #efb3bc, #c1121f | chart paper and the trace only |

**Type** — IBM Plex Sans (+ Noto for `ʻ`), IBM Plex Mono for codes. `rd-h1` 28/36 (22/30 on a phone), `rd-h2` 22/30,
`rd-h3` 16/24, `rd-body` 14/20, `rd-sm` 12/16, `rd-cap` 11/14 caps. Tailwind `text-*` tokens (caption 12 … display 30)
stay for the older pages. Numbers that change: `tabular-nums`.

**Spacing**: 4 px grid (`--s-1` … `--s-7`). Page gutter **16 px below 900 px**, 24–32 px above. Dense zones (lists,
tables) 8–12 px rows; decision zones (review form, dialogs) 24 px.

**Radius**: 4 small · 8 buttons/inputs · 12 cards · 16 large cards and dialogs. Nested: outer = inner + padding.

**Depth — borders only.** Hairlines separate; the only shadow is on floating layers (menus, dialogs).

## Layout

- **Frames:** doctor and admin share `components/layout/AppFrame.tsx` (sidebar + header + footer; below 900 px:
  header with logo, bottom tab bar, no sidebar). The patient has `PatientShell` (sidebar ≥ 720 px, tab bar below).
- **Breakpoints:** 640 px (phone rules in `redesign.css`: stacked tables, wrapping buttons, one-column forms),
  900 px (frame switch).
- **Tables:** `rd-table rd-table--stack` + `data-label` on every cell except the first and the action; wide history
  tables also `rd-table--wide` (820 px min, scroll inside the card on tablets). Scroll wrappers are
  `position: relative` so hidden screen-reader text cannot widen the page.
- **Check:** every route at 375 / 768 / 1440 px has no element wider than the viewport (v2 measured all 3 roles).

## Behaviour rules

- One `Button` (`components/ui/Button` = redesign `rd-btn`), one `Alert` (= `DAlert`), 44 px controls.
- Submit buttons stay enabled until the request starts; then `busy` (spinner + text, no double submit).
  Invalid on submit → inline error under the field + focus the first invalid field.
- Every list: loading (skeleton rows, no layout shift), empty (what + why + one action), error (what + retry).
- Search/filter/paging state lives in the URL, so reload/back keeps it.
- Unsaved form → warn before leaving (router blocker + `beforeunload`).
- One-time secrets (temporary password, device key): dialog, mono, Copy, closes only with "I saved it".
- Destructive + irreversible → dialog naming the thing and the consequence; type the patient's name to enable.
- Brand, codes (AV/PV/TV/MV), usernames, serials, model names: `translate="no"`.
- Numbers through `Intl.NumberFormat`; plurals through i18next plural keys (ru needs one/few/many/other).
- A background refetch error never hides data already on screen.
- Language menu: flag + the language's own name.
- Motion: popovers 150–200 ms ease-out; the only orchestrated motion is the 20 s recording sweep. All movement off
  under `prefers-reduced-motion`.
- `rem` stays 16 px.
- Copy: sentence case; verbs on buttons; errors = what happened + what to do. Medical words follow `docs/glossary.md`.
- ECG card: under the sound strip; numbers only when the ECG is good, otherwise "cannot judge" + the reason; rhythm
  answer always says "screening aid, not a diagnosis" and AF asks for a 12-lead confirmation. Doctors only.
