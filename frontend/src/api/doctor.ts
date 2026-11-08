/** Doctor endpoints (backend `app/api/doctor.py`). */
import { api } from "./client";

export type Sex = "male" | "female";
export type Point = "AV" | "PV" | "TV" | "MV";
export type ExamStatus = "waiting" | "recording" | "uploaded" | "analyzed" | "reviewed" | "failed";

export type Patient = {
  id: number;
  full_name: string;
  birth_year: number;
  sex: Sex;
  height_cm: number | null;
  weight_kg: number | null;
  consent_given_at: string | null;
  has_login: boolean;
  created_at: string;
};

export type PatientInput = {
  full_name: string;
  birth_year: number;
  sex: Sex;
  height_cm: number | null;
  weight_kg: number | null;
};

export type ExamSummary = {
  id: number;
  patient_id: number;
  device_id: number;
  point: Point;
  status: ExamStatus;
  created_at: string;
  reviewed_at: string | null;
};

export type ExamListItem = ExamSummary & { patient_full_name: string };

export type RecordingInfo = {
  sample_rate: number;
  duration_s: number;
  motion_detected: boolean;
  size_bytes: number;
  created_at: string;
};

export type AIResult = {
  model_name: string;
  model_version: string;
  quality: string;
  label: string;
  score: number | null;
  created_at: string;
};

export type ExamDetail = ExamSummary & {
  failure_reason: string | null;
  doctor_note: string | null;
  doctor_agrees_with_ai: boolean | null;
  updated_at: string;
  recording: RecordingInfo | null;
  ai_result: AIResult | null;
};

export type DoctorDevice = { id: number; name: string; serial: string; online: boolean; last_seen_at: string | null };

export type OneTimeLogin = { username: string; temporary_password: string };

export const PAGE_SIZE = 50;

export const doctorApi = {
  listPatients: (search: string, offset = 0) =>
    api<Patient[]>(
      `/patients?${new URLSearchParams({ ...(search ? { q: search } : {}), limit: String(PAGE_SIZE), offset: String(offset) })}`,
    ),
  getPatient: (id: number) => api<Patient>(`/patients/${id}`),
  createPatient: (input: PatientInput & { consent_given: boolean }) => api<Patient>("/patients", { body: input }),
  updatePatient: (id: number, input: Partial<PatientInput>) =>
    api<Patient>(`/patients/${id}`, { method: "PATCH", body: input }),
  deletePatient: (id: number) => api<void>(`/patients/${id}`, { method: "DELETE" }),
  recordConsent: (id: number) => api<Patient>(`/patients/${id}/consent`, { method: "POST" }),
  createLogin: (id: number, username: string) => api<OneTimeLogin>(`/patients/${id}/login`, { body: { username } }),
  resetPassword: (id: number) => api<OneTimeLogin>(`/patients/${id}/reset-password`, { method: "POST" }),
  patientExams: (id: number) => api<ExamSummary[]>(`/patients/${id}/exams`),
  listExams: (status?: ExamStatus, limit = 20) =>
    api<ExamListItem[]>(`/exams?${new URLSearchParams({ ...(status ? { status } : {}), limit: String(limit) })}`),
  myDevices: () => api<DoctorDevice[]>("/devices"),
  startExam: (patientId: number, deviceId: number, point: Point) =>
    api<ExamDetail>("/exams", { body: { patient_id: patientId, device_id: deviceId, point } }),
  getExam: (id: number) => api<ExamDetail>(`/exams/${id}`),
  cancelExam: (id: number) => api<ExamDetail>(`/exams/${id}/cancel`, { method: "POST" }),
};
