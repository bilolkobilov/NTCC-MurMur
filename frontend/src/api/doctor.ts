/** Doctor endpoints (backend `app/api/doctor.py`). */
import type { ActivityEntry, DoctorProfile } from "./admin";
import { api, apiBlob } from "./client";

export type Sex = "male" | "female" | "other";
export type Point = "AV" | "PV" | "TV" | "MV";
export type ExamStatus = "waiting" | "recording" | "uploaded" | "analyzed" | "reviewed" | "failed";

export type Patient = {
  id: number;
  full_name: string;
  birth_year: number;
  sex: Sex;
  height_cm: number | null;
  weight_kg: number | null;
  /** The doctor's clinic when the patient was registered (a snapshot). */
  clinic: string | null;
  consent_given_at: string | null;
  has_login: boolean;
  created_at: string;
};

export type ResultStatus = "normal" | "abnormal" | "pending" | "failed" | "reviewed";
export type PatientSort = "recent" | "name" | "priority";
export type PatientStatusFilter = "all" | "needs_review" | "pending";

/** A patient in the registry: the patient plus the latest exam and the status the backend derived from it. */
export type PatientRegistryRow = Patient & {
  last_exam: { id: number; point: Point; status: ExamStatus; created_at: string; device_name: string | null; clinic: string | null } | null;
  result_status: ResultStatus;
  needs_review: boolean;
};

export type PatientSummary = {
  total: number;
  assigned_today: number;
  normal: number;
  needs_review: number;
  pending: number;
};

export type PatientInput = {
  full_name: string;
  birth_year: number;
  sex: Sex;
  height_cm: number;
  weight_kg: number;
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

/** An exam in the patient's recording history: the exam plus length, device, clinic and the derived result status. */
export type PatientExamRow = ExamSummary & {
  duration_s: number | null;
  device_name: string | null;
  device_code: string | null;
  clinic: string | null;
  result_status: ResultStatus;
  needs_review: boolean;
  ai_label: string | null;
};

/** One set of vital signs the doctor entered; every value is optional. */
export type VitalsInput = {
  heart_rate: number | null;
  systolic: number | null;
  diastolic: number | null;
  spo2: number | null;
  resp_rate: number | null;
  temp_c: number | null;
};
export type Vitals = VitalsInput & { id: number; created_at: string; recorded_by: string };

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

export type DoctorDevice = {
  id: number;
  name: string;
  serial: string;
  code: string;
  model: string;
  location: string | null;
  clinic: string | null;
  battery_pct: number | null;
  online: boolean;
  last_seen_at: string | null;
};

export type OneTimeLogin = { username: string; temporary_password: string };

export const PAGE_SIZE = 50;

export const doctorApi = {
  myProfile: () => api<DoctorProfile>("/profile"),
  myActivity: () => api<ActivityEntry[]>("/profile/activity?limit=30"),
  listPatients: (params: { q: string; sort: PatientSort; status: PatientStatusFilter }, offset = 0) =>
    api<PatientRegistryRow[]>(
      `/patients?${new URLSearchParams({
        ...(params.q ? { q: params.q } : {}),
        sort: params.sort,
        status: params.status,
        limit: String(PAGE_SIZE),
        offset: String(offset),
      })}`,
    ),
  patientSummary: () => api<PatientSummary>("/patients/summary"),
  getPatient: (id: number) => api<Patient>(`/patients/${id}`),
  createPatient: (input: PatientInput & { consent_given: boolean }) => api<Patient>("/patients", { body: input }),
  updatePatient: (id: number, input: Partial<PatientInput>) =>
    api<Patient>(`/patients/${id}`, { method: "PATCH", body: input }),
  deletePatient: (id: number) => api<void>(`/patients/${id}`, { method: "DELETE" }),
  recordConsent: (id: number) => api<Patient>(`/patients/${id}/consent`, { method: "POST" }),
  createLogin: (id: number, username: string) => api<OneTimeLogin>(`/patients/${id}/login`, { body: { username } }),
  resetPassword: (id: number) => api<OneTimeLogin>(`/patients/${id}/reset-password`, { method: "POST" }),
  latestVitals: (id: number) => api<Vitals | null>(`/patients/${id}/vitals/latest`),
  recordVitals: (id: number, input: VitalsInput) => api<Vitals>(`/patients/${id}/vitals`, { body: input }),
  patientExams: (id: number) => api<PatientExamRow[]>(`/patients/${id}/exams`),
  myDevices: () => api<DoctorDevice[]>("/devices"),
  startExam: (patientId: number, deviceId: number, point: Point) =>
    api<ExamDetail>("/exams", { body: { patient_id: patientId, device_id: deviceId, point } }),
  getExam: (id: number) => api<ExamDetail>(`/exams/${id}`),
  cancelExam: (id: number) => api<ExamDetail>(`/exams/${id}/cancel`, { method: "POST" }),
  examAudio: (id: number, signal?: AbortSignal) => apiBlob(`/exams/${id}/audio`, { signal }),
  /** `agreesWithAi` must be null when the AI gave no answer (backend checks it). */
  reviewExam: (id: number, note: string, agreesWithAi: boolean | null) =>
    api<ExamDetail>(`/exams/${id}/review`, {
      method: "PATCH",
      body: agreesWithAi === null ? { note } : { note, agrees_with_ai: agreesWithAi },
    }),
};
