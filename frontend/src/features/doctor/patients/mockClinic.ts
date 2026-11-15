/**
 * MOCK DATA, NOT FROM THE DATABASE. Until patients carry a clinic, the registry's "Registered clinic" column is filled
 * from this list so the design can be reviewed.
 *
 * TODO (owner decision pending): replace with real data. Needs `patients.clinic` (where the patient is registered) and
 * the clinic where the latest exam was analyzed (the exam's device / clinic), returned by `GET /api/patients`
 * (`PatientRegistryRow`) and shown by `PatientRegistry.tsx`. Then delete this file.
 */
const CLINICS = ["Highlands Clinic", "Valley Health Post", "Lakeside Center"];

/** Stable per patient, so a row does not change on refresh. */
export function mockRegisteredClinic(patientId: number): string {
  return CLINICS[patientId % CLINICS.length]!;
}

/** Where the latest exam was "analyzed" (mock: mostly the same clinic, sometimes another one). */
export function mockAnalyzedClinic(patientId: number): string {
  return CLINICS[(patientId % 4 === 0 ? patientId + 1 : patientId) % CLINICS.length]!;
}
