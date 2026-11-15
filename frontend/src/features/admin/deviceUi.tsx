import { clsx } from "clsx";
import type { ReactNode } from "react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import {
  CHECKS,
  type CheckResult,
  type Device,
  type DeviceHealth,
  type DeviceState,
  type Doctor,
} from "../../api/admin";
import { formatRelative } from "../../lib/format";
import { Icon, type IconName } from "../../redesign/Icon";

/** Wi-Fi strength in words (RSSI in dBm): what the admin needs to decide "move the device closer". */
export function signalWord(rssi: number): "strong" | "ok" | "weak" {
  return rssi >= -60 ? "strong" : rssi >= -72 ? "ok" : "weak";
}

/** Serial numbers are shown as the end only ("••••5503"); the full number is on the detail page. */
export const maskSerial = (serial: string) => (serial.length > 4 ? `••••${serial.slice(-4)}` : serial);
/** Network identifiers are shown partly hidden (the mockup does the same): 10.30.••.41, ••:••:••:4E:2A:91. */
export const maskIp = (ip: string) => ip.split(".").map((part, i) => (i === 2 ? "••" : part)).join(".");
export const maskMac = (mac: string) => mac.split(":").map((part, i) => (i < 3 ? "••" : part)).join(":");

type Tone = "normal" | "borderline" | "abnormal" | "critical" | "pending";

/** Chip look per health value: colour + icon + word, as in the mockup legend. */
export const HEALTH_LOOK: Record<DeviceHealth, { tone: Tone; icon: IconName }> = {
  healthy: { tone: "normal", icon: "checkCircle" },
  attention: { tone: "borderline", icon: "alertCircle" },
  degraded: { tone: "abnormal", icon: "alertTriangle" },
  fault: { tone: "critical", icon: "alertOctagon" },
  pending: { tone: "pending", icon: "clock" },
};
export const STATE_LOOK: Record<DeviceState, { tone: Tone; icon: IconName }> = {
  online: { tone: "normal", icon: "wifi" },
  offline: { tone: "critical", icon: "wifiOff" },
  pending: { tone: "pending", icon: "clock" },
  disconnected: { tone: "critical", icon: "wifiOff" },
};
const CHECK_LOOK: Record<CheckResult, { tone: Tone; icon: IconName }> = {
  pass: { tone: "normal", icon: "checkCircle" },
  warn: { tone: "borderline", icon: "alertCircle" },
  fail: { tone: "critical", icon: "alertOctagon" },
  nodata: { tone: "pending", icon: "clock" },
};

export function Chip({ look, label }: { look: { tone: Tone; icon: IconName }; label: string }) {
  return (
    <span className={clsx("rd-chip", `rd-chip--${look.tone}`)}>
      <Icon name={look.icon} />
      {label}
    </span>
  );
}

export const needsAttention = (d: Device) => d.health === "fault" || d.health === "degraded" || d.health === "attention";

export type DeviceTab = "all" | "healthy" | "attention" | "fault" | "pending";
export type DeviceSort = "attention" | "id" | "sync";

export function matchesTab(d: Device, tab: DeviceTab): boolean {
  if (tab === "all") return true;
  if (tab === "attention") return d.health === "attention" || d.health === "degraded";
  return d.health === tab;
}

export function matchesQuery(d: Device, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [d.code, d.name, d.serial, d.model, d.location ?? "", d.clinic ?? ""].some((v) => v.toLowerCase().includes(needle));
}

const HEALTH_RANK: Record<DeviceHealth, number> = { fault: 4, degraded: 3, attention: 2, pending: 1, healthy: 0 };

export function sortDevices(list: Device[], sort: DeviceSort): Device[] {
  const seen = (d: Device) => (d.last_seen_at ? new Date(d.last_seen_at).getTime() : 0);
  return [...list].sort((a, b) => {
    if (sort === "id") return a.code.localeCompare(b.code);
    if (sort === "sync") return seen(b) - seen(a) || a.code.localeCompare(b.code);
    return HEALTH_RANK[b.health] - HEALTH_RANK[a.health] || a.code.localeCompare(b.code);
  });
}

export const batteryTone = (pct: number) => (pct < 15 ? "critical" : pct < 30 ? "borderline" : "normal");

/** Battery bar: fill colour by level (the same thresholds as the health rules). */
export function Meter({ pct }: { pct: number }) {
  return (
    <span className="rd-meter" aria-hidden="true">
      <span className={clsx("rd-meter__fill", `rd-bg-${batteryTone(pct)}`)} style={{ width: `${pct}%` }} />
    </span>
  );
}

/** The coloured box with a line icon inside it ("devicon" in the mockup). */
export function DevIcon({ large }: { large?: boolean }) {
  return (
    <span className={clsx("rd-devicon", large && "rd-devicon--lg")} aria-hidden="true">
      <Icon name="stethoscope" size={large ? "lg" : undefined} />
    </span>
  );
}

export function DAlert({ tone, icon, children, role }: { tone: "info" | "warn" | "crit" | "ok"; icon: IconName; children: ReactNode; role?: "alert" | "status" }) {
  return (
    <div className={clsx("rd-dalert", `rd-dalert--${tone}`)} role={role ?? (tone === "crit" ? "alert" : "status")}>
      <Icon name={icon} />
      <span>{children}</span>
    </div>
  );
}

export function DCard({ title, icon, meta, children, id }: { title: string; icon?: IconName; meta?: ReactNode; children: ReactNode; id: string }) {
  return (
    <section className="rd-dcard" aria-labelledby={id}>
      <div className="rd-dcard__head">
        <div className="flex items-center gap-3">
          {icon && (
            <span style={{ color: "var(--c-primary)" }} className="inline-flex">
              <Icon name={icon} />
            </span>
          )}
          <h2 className="rd-h3" id={id}>
            {title}
          </h2>
        </div>
        {meta}
      </div>
      {children}
    </section>
  );
}

export function KvRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rd-kvrow">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** A form field as drawn in the mockup: 14 px label (red * when required), 44 px field, 12 px hint under it. */
export function FormGroup({
  label,
  required,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string | null;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="rd-fgrp">
      <label htmlFor={htmlFor} className="rd-label">
        {label}
        {required && (
          <>
            {" "}
            <span style={{ color: "var(--c-critical-fg)" }} aria-hidden="true">
              *
            </span>
          </>
        )}
      </label>
      {children}
      {(error || hint) && (
        <span id={`${htmlFor}-help`} className="rd-sm" style={{ color: error ? "var(--c-critical-fg)" : undefined }}>
          {error ?? hint}
        </span>
      )}
    </div>
  );
}

/** Native select in the mockup's field frame: keyboard and screen readers work everywhere, also on a phone. */
export function SelectBox({
  id,
  value,
  onChange,
  disabled,
  invalid,
  children,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={clsx("rd-field rd-field--sel", invalid && "rd-field--error")}>
      <select
        id={id}
        value={value}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={`${id}-help`}
        onChange={(e) => onChange(e.target.value)}
      >
        {children}
      </select>
      <Icon name="chevronDown" size="sm" />
    </div>
  );
}

/** Pick a doctor. Blocked doctors cannot get a device. */
export function DoctorSelect({
  value,
  doctors,
  onChange,
  disabled,
  label,
  hint,
}: {
  value: number | null;
  doctors: Doctor[];
  onChange: (id: number | null) => void;
  disabled?: boolean;
  label: string;
  hint?: string;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <FormGroup label={label} htmlFor={id} hint={hint}>
      <SelectBox id={id} value={value === null ? "" : String(value)} disabled={disabled} onChange={(v) => onChange(v ? Number(v) : null)}>
        <option value="">{t("devices.unassigned")}</option>
        {doctors.map((doctor) => (
          <option key={doctor.id} value={doctor.id} disabled={!doctor.is_active && doctor.id !== value}>
            {doctor.full_name}
            {doctor.clinic ? ` · ${doctor.clinic}` : ""}
            {doctor.is_active ? "" : ` (${t("doctors.blocked")})`}
          </option>
        ))}
      </SelectBox>
    </FormGroup>
  );
}

/** The health checks of one device: a word per check and what it is based on. */
export function ChecksList({ device }: { device: Device }) {
  const { t, i18n } = useTranslation();
  const detail = (name: (typeof CHECKS)[number]): string => {
    switch (name) {
      case "connection":
        return device.last_seen_at ? t("device.lastSeen", { when: formatRelative(device.last_seen_at, i18n.language) }) : t("device.never");
      case "battery":
        return device.battery_pct === null ? t("devices.noData") : t("devices.charged", { pct: device.battery_pct });
      case "signal":
        return device.wifi_rssi === null ? t("devices.noData") : `Wi-Fi · ${device.wifi_rssi} dBm`;
      case "firmware":
        return device.firmware_version
          ? device.latest_firmware && device.firmware_version !== device.latest_firmware
            ? t("devices.firmwareOutdated", { version: device.firmware_version, latest: device.latest_firmware })
            : device.latest_firmware
              ? t("devices.firmwareCurrent", { version: device.firmware_version })
              : t("devices.firmware", { version: device.firmware_version })
          : t("devices.noData");
      case "microphone":
        return device.mic_noise_db === null ? t("devices.noData") : t("devices.noiseFloor", { db: device.mic_noise_db });
      case "self_test":
        return device.last_self_test_at ? formatRelative(device.last_self_test_at, i18n.language) : t("devices.selfTestNever");
    }
  };
  return (
    <ul className="rd-checks">
      {CHECKS.map((name) => (
        <li key={name}>
          <span className="rd-dev-cell">
            <span className="rd-label">{t(`devices.check.${name}`)}</span>
            <span className="rd-sm" translate={name === "firmware" ? "no" : undefined}>
              {detail(name)}
            </span>
          </span>
          <span className="flex flex-none">
            <Chip look={CHECK_LOOK[device.checks[name]]} label={t(`devices.result.${device.checks[name]}`)} />
          </span>
        </li>
      ))}
    </ul>
  );
}
