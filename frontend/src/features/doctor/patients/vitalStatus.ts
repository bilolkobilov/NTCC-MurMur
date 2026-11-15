/**
 * Where a vital sign sits against its reference range. The "normal" ranges are the ones printed in the design
 * (HR 60–100, BP below 130/80, SpO₂ 95–100, RR 12–20, temperature 36.1–37.2, BMI 18.5–24.9); "borderline" is the band just
 * outside them, anything further is "abnormal". A screening aid for the doctor, not a diagnosis.
 */
export type VitalLevel = "normal" | "borderline" | "abnormal";

const within = (v: number, lo: number, hi: number) => v >= lo && v <= hi;

export function heartRateLevel(v: number): VitalLevel {
  return within(v, 60, 100) ? "normal" : within(v, 50, 110) ? "borderline" : "abnormal";
}

export function bloodPressureLevel(systolic: number, diastolic: number): VitalLevel {
  if (systolic < 90 || diastolic < 60) return "abnormal";
  if (systolic < 130 && diastolic < 80) return "normal";
  return systolic < 140 && diastolic < 90 ? "borderline" : "abnormal";
}

export function spo2Level(v: number): VitalLevel {
  return v >= 95 ? "normal" : v >= 92 ? "borderline" : "abnormal";
}

export function respRateLevel(v: number): VitalLevel {
  return within(v, 12, 20) ? "normal" : within(v, 10, 24) ? "borderline" : "abnormal";
}

export function temperatureLevel(v: number): VitalLevel {
  return within(v, 36.1, 37.2) ? "normal" : within(v, 35.5, 38) ? "borderline" : "abnormal";
}

export function bmiLevel(v: number): VitalLevel {
  return v >= 18.5 && v < 25 ? "normal" : v >= 17 && v < 30 ? "borderline" : "abnormal";
}

export const bmi = (heightCm: number, weightKg: number) => weightKg / (heightCm / 100) ** 2;
