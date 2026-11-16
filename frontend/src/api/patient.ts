import { api } from "./client";
import type { Point, Sex } from "./doctor";

/** The patient's own profile (`GET /api/me`). Name, birth year and clinic come from the clinic; contact fields are theirs. */
export type MyProfile = {
  patient_id: number;
  full_name: string;
  birth_year: number;
  sex: Sex;
  height_cm: number | null;
  weight_kg: number | null;
  doctor_name: string;
  doctor_clinic: string | null;
  clinic: string | null;
  registered_at: string;
  password_changed_at: string | null;
  latest_analysis: { clinic: string | null; device_code: string | null; at: string } | null;
  heart_rate: number | null;
  heart_rate_at: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
};

/** The fields a patient may change (`PATCH /api/me`). An empty string clears a field. */
export type ContactUpdate = Pick<MyProfile, "phone" | "email" | "city" | "emergency_contact_name" | "emergency_contact_phone">;

/**
 * A reviewed exam as the patient sees it: the doctor's note and the AI's yes/no label. The backend never sends the
 * AI score, the model or whether the doctor agreed (schemas/patient.py MyExam).
 */
export type MyExam = {
  id: number;
  point: Point;
  created_at: string;
  reviewed_at: string;
  doctor_note: string;
  doctor_name: string;
  clinic: string | null;
  device_code: string | null;
  ai_label: "murmur" | "absent" | null;
  recording_quality: "good" | "bad" | "unknown" | null;
};

export const patientApi = {
  profile: () => api<MyProfile>("/me"),
  updateContact: (body: Partial<ContactUpdate>) => api<MyProfile>("/me", { method: "PATCH", body }),
  exams: () => api<MyExam[]>("/me/exams"),
};
