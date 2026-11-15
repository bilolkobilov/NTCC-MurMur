// TEMPORARY — REDESIGN STAGING AREA. REMOVE `src/redesign/` once all mockups are applied.
// Fake demo data and English strings for `RedesignPreview` only. Names and numbers are invented (copied in spirit
// from the mockup's "Fake demo data only"). Real screens must take text from the uz / ru / en locale files.
import type { NavEntry, Status } from "./components";

export const PALETTE: { group: string; tokens: { name: string; value: string; use: string }[] }[] = [
  {
    group: "Neutrals",
    tokens: [
      { name: "--c-canvas", value: "#F6F8F9", use: "Page background" },
      { name: "--c-surface", value: "#FFFFFF", use: "Cards, inputs, tables" },
      { name: "--c-subtle", value: "#EDF1F3", use: "Hover rows, filled controls" },
      { name: "--c-border", value: "#DFE5E9", use: "Dividers, card outlines" },
      { name: "--c-input-border", value: "#7D8C97", use: "Control borders" },
      { name: "--c-ink", value: "#0E1A22", use: "Headings, primary text" },
      { name: "--c-ink-2", value: "#41525E", use: "Body text" },
      { name: "--c-ink-3", value: "#5A6B77", use: "Captions, units" },
    ],
  },
  {
    group: "Brand",
    tokens: [
      { name: "--c-primary", value: "#0B6E8A", use: "Actions, links, active nav" },
      { name: "--c-primary-hover", value: "#095A72", use: "Hover, pressed" },
      { name: "--c-primary-tint", value: "#E4F2F6", use: "Selected row, active nav" },
      { name: "--c-primary-ink", value: "#0A5C74", use: "Text on tint" },
    ],
  },
  {
    group: "Clinical status (dot)",
    tokens: [
      { name: "--c-normal-dot", value: "#1E9556", use: "Normal" },
      { name: "--c-borderline-dot", value: "#B87500", use: "Borderline" },
      { name: "--c-abnormal-dot", value: "#E2601A", use: "Abnormal" },
      { name: "--c-critical-dot", value: "#D92D20", use: "Critical" },
      { name: "--c-pending-dot", value: "#8493A3", use: "Pending" },
      { name: "--c-ai-fg", value: "#5238B8", use: "AI results only" },
    ],
  },
  {
    group: "Waveform (containers only)",
    tokens: [
      { name: "--c-wave-bg", value: "#0A141A", use: "Canvas" },
      { name: "--c-wave-line", value: "#4CC9E0", use: "PCG trace" },
      { name: "--c-wave-caliper", value: "#F5B83D", use: "S1 / S2 markers" },
      { name: "--c-wave-heat", value: "#A99BF5", use: "Murmur energy" },
    ],
  },
];

export const SAMPLE_STATUSES: { status: Status; label: string }[] = [
  { status: "normal", label: "Normal" },
  { status: "borderline", label: "Borderline" },
  { status: "abnormal", label: "Abnormal" },
  { status: "critical", label: "Critical" },
  { status: "pending", label: "Pending" },
  { status: "ai", label: "AI-assisted" },
];

export const SAMPLE_NAV: NavEntry[] = [
  { id: "patients", label: "Patients", icon: "users", badge: 10 },
  { id: "record", label: "New recording", icon: "activity" },
  { id: "results", label: "Analysis results", icon: "sparkles" },
  { id: "alerts", label: "Alerts", icon: "bell", badge: 4, critical: true },
];

export const SAMPLE_TABS = [
  { value: "overview", label: "Overview" },
  { value: "recordings", label: "Recordings", count: 6 },
  { value: "history", label: "History" },
];

export const SAMPLE_PORTALS = [
  { value: "doctor", label: "Doctor" },
  { value: "admin", label: "Admin" },
];
