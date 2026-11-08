import { api } from "./client";
import type { Point, Sex } from "./doctor";

/** The patient's own profile (`GET /api/me`). */
export type MyProfile = {
  full_name: string;
  birth_year: number;
  sex: Sex;
  height_cm: number | null;
  weight_kg: number | null;
  doctor_name: string;
};

/** A reviewed exam as the patient sees it. The backend sends no AI fields at all (schemas/patient.py MyExam). */
export type MyExam = {
  id: number;
  point: Point;
  created_at: string;
  reviewed_at: string;
  doctor_note: string;
};

export const patientApi = {
  profile: () => api<MyProfile>("/me"),
  exams: () => api<MyExam[]>("/me/exams"),
};
