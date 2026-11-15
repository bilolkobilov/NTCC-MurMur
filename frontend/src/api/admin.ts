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
  sex: "male" | "female";
  last_exam_at: string | null;
};

export type ActivityEntry = { id: number; action: string; object_type: string; created_at: string };

export type Device = {
  id: number;
  name: string;
  serial: string;
  doctor_id: number | null;
  online: boolean;
  last_seen_at: string | null;
  wifi_rssi: number | null;
  firmware_version: string | null;
  created_at: string;
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
  createDevice: (body: { name: string; serial: string; doctor_id: number | null }) =>
    api<DeviceWithKey>("/admin/devices", { body }),
  assignDevice: (id: number, doctorId: number | null) =>
    api<Device>(`/admin/devices/${id}`, { method: "PATCH", body: { doctor_id: doctorId } }),
  rotateKey: (id: number) => api<DeviceWithKey>(`/admin/devices/${id}/rotate-key`, { method: "POST" }),
  /** One page, newest first. Asks for one extra row to know whether an older page exists. */
  audit: (page: number, action: string | null) => {
    const query = new URLSearchParams({ limit: String(AUDIT_PAGE + 1), offset: String(page * AUDIT_PAGE) });
    if (action) query.set("action", action);
    return api<AuditEntry[]>(`/admin/audit?${query}`);
  },
};
