import { api } from "./client";
import type { ExamStatus } from "./doctor";

export type Doctor = {
  id: number;
  username: string;
  full_name: string;
  clinic: string | null;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
  patient_count: number;
  /** suspended = blocked by the admin; invited = the account never signed in yet. */
  status: "active" | "invited" | "suspended";
};

export type DoctorWorkload = {
  patients: number;
  seen_today: number;
  recordings_30d: number;
  devices_30d: number;
  needs_review: number;
  median_review_minutes: number | null;
};

export type DoctorProfile = Doctor & {
  password_changed_at: string | null;
  workload: DoctorWorkload;
  devices: { id: number; name: string; serial: string; online: boolean; last_seen_at: string | null }[];
};

/** What the admin sees of a doctor's patient: who and when — never recordings, AI results or notes. */
export type DoctorPatientRow = {
  id: number;
  full_name: string;
  birth_year: number;
  sex: "male" | "female" | "other";
  last_exam_at: string | null;
};

export type ActivityEntry = { id: number; action: string; object_type: string; created_at: string };

export type DeviceState = "pending" | "online" | "offline" | "disconnected";
export type DeviceHealth = "pending" | "healthy" | "attention" | "degraded" | "fault";
export type CheckResult = "pass" | "warn" | "fail" | "nodata";
export const CHECKS = ["connection", "battery", "signal", "firmware", "microphone", "self_test"] as const;
export type CheckName = (typeof CHECKS)[number];
export type DisconnectReason = "maintenance" | "lost" | "security" | "retired";
export const DISCONNECT_REASONS: DisconnectReason[] = ["maintenance", "lost", "security", "retired"];
export const DEVICE_MODELS = ["MurMur S2", "MurMur S3"] as const;

export type Device = {
  id: number;
  /** MM-0007: the short id people say aloud. */
  code: string;
  name: string;
  serial: string;
  model: string;
  location: string | null;
  doctor_id: number | null;
  doctor_name: string | null;
  /** The assigned doctor's clinic. */
  clinic: string | null;
  online: boolean;
  last_seen_at: string | null;
  wifi_rssi: number | null;
  firmware_version: string | null;
  battery_pct: number | null;
  mic_noise_db: number | null;
  wifi_ssid: string | null;
  ip: string | null;
  mac: string | null;
  gateway: string | null;
  disconnected_at: string | null;
  disconnect_reason: DisconnectReason | null;
  last_self_test_at: string | null;
  last_self_test_ok: boolean | null;
  created_at: string;
  state: DeviceState;
  health: DeviceHealth;
  checks: Record<CheckName, CheckResult>;
  /** An exam is being recorded on it right now. */
  busy: boolean;
  latest_firmware: string | null;
};

/** A device with its API key — returned only by "register" and "rotate key", shown once. */
export type DeviceWithKey = Device & { api_key: string };

export type Stats = {
  doctors_total: number;
  doctors_active: number;
  patients_total: number;
  devices_total: number;
  devices_online: number;
  exams_today: number;
  exams_by_status: Record<ExamStatus, number>;
  analyzer: { name: string; version: string };
};

export type AuditEntry = {
  id: number;
  user_id: number | null;
  username: string | null;
  role: string | null;
  action: string;
  object_type: string;
  object_id: number | null;
  created_at: string;
};

export const AUDIT_PAGE = 50;

export const adminApi = {
  stats: () => api<Stats>("/admin/stats"),
  doctors: () => api<Doctor[]>("/admin/doctors"),
  createDoctor: (body: { username: string; password: string; full_name: string; clinic: string | null }) =>
    api<Doctor>("/admin/doctors", { body }),
  doctor: (id: number) => api<DoctorProfile>(`/admin/doctors/${id}`),
  doctorPatients: (id: number) => api<DoctorPatientRow[]>(`/admin/doctors/${id}/patients?limit=200`),
  doctorActivity: (id: number) => api<ActivityEntry[]>(`/admin/doctors/${id}/activity?limit=30`),
  updateDoctor: (id: number, body: { full_name?: string; clinic?: string | null }) =>
    api<Doctor>(`/admin/doctors/${id}`, { method: "PATCH", body }),
  setDoctorActive: (id: number, active: boolean) =>
    api<Doctor>(`/admin/doctors/${id}/${active ? "unblock" : "block"}`, { method: "POST" }),
  resetDoctorPassword: (id: number, password: string) =>
    api<Doctor>(`/admin/doctors/${id}/password`, { body: { password } }),
  devices: () => api<Device[]>("/admin/devices"),
  device: (id: number) => api<Device>(`/admin/devices/${id}`),
  createDevice: (body: {
    serial: string;
    model: string;
    location: string | null;
    doctor_id: number | null;
  }) => api<DeviceWithKey>("/admin/devices", { body }),
  assignDevice: (id: number, doctorId: number | null) =>
    api<Device>(`/admin/devices/${id}`, { method: "PATCH", body: { doctor_id: doctorId } }),
  rotateKey: (id: number) => api<DeviceWithKey>(`/admin/devices/${id}/rotate-key`, { method: "POST" }),
  disconnectDevice: (id: number, reason: DisconnectReason) =>
    api<Device>(`/admin/devices/${id}/disconnect`, { method: "POST", body: { reason } }),
  reconnectDevice: (id: number) => api<Device>(`/admin/devices/${id}/reconnect`, { method: "POST" }),
  selfTest: (id: number) => api<Device>(`/admin/devices/${id}/self-test`, { method: "POST" }),
  deleteDevice: (id: number) => api<void>(`/admin/devices/${id}`, { method: "DELETE" }),
  deviceActivity: (id: number) => api<AuditEntry[]>(`/admin/devices/${id}/activity?limit=30`),
  /** One page, newest first. Asks for one extra row to know whether an older page exists. */
  audit: (page: number, action: string | null) => {
    const query = new URLSearchParams({ limit: String(AUDIT_PAGE + 1), offset: String(page * AUDIT_PAGE) });
    if (action) query.set("action", action);
    return api<AuditEntry[]>(`/admin/audit?${query}`);
  },
};
