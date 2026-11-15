import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { DoctorProfile } from "../../api/admin";
import { session } from "../../app/session";
import { backend, ok, renderAt } from "../../test/utils";

const profile: DoctorProfile = {
  id: 2,
  username: "dr.aziz",
  full_name: "Aziz Karimov",
  clinic: "Highlands Clinic",
  is_active: true,
  created_at: "2026-11-01T08:00:00Z",
  last_login_at: "2026-11-14T08:00:00Z",
  password_changed_at: "2026-11-05T08:00:00Z",
  patient_count: 4,
  status: "active",
  workload: { patients: 4, seen_today: 2, recordings_30d: 12, devices_30d: 1, needs_review: 3, median_review_minutes: null },
  devices: [],
};
const patient = {
  id: 7,
  full_name: "Ali Valiyev",
  birth_year: 1980,
  sex: "male",
  height_cm: null,
  weight_kg: null,
  consent_given_at: null,
  has_login: false,
  created_at: "2026-11-01T08:00:00Z",
  last_exam: null,
  result_status: "pending",
  needs_review: false,
};

beforeEach(() => session.start({ token: "t", role: "doctor", mustChangePassword: false }));
afterEach(() => {
  vi.restoreAllMocks();
  session.end("loggedOut");
  session.takeEndReason();
});

test("the doctor's own profile: workload, locked clinic, own patients with results, change password — nothing editable", async () => {
  backend({
    "GET /api/auth/me": () => ok({ id: 2, username: "dr.aziz", role: "doctor", full_name: "Aziz Karimov", clinic: "Highlands Clinic" }),
    "GET /api/patients/summary": () => ok({ total: 4, assigned_today: 0, normal: 0, needs_review: 0, pending: 1 }),
    "GET /api/profile": () => ok(profile),
    "GET /api/profile/activity": () => ok([{ id: 1, action: "patient.create", object_type: "patient", created_at: "2026-11-14T09:00:00Z" }]),
    "GET /api/patients": () => ok([patient]),
  });
  renderAt("/doctor/profile");
  const user = userEvent.setup();

  expect(await screen.findByRole("heading", { name: "Aziz Karimov" })).toBeInTheDocument();
  expect(screen.getByRole("note")).toHaveTextContent(/managed by an administrator/);
  expect(screen.getByText("Set by administrator")).toBeInTheDocument();
  expect(screen.getByText("12")).toBeInTheDocument(); // recordings in 30 days
  expect(screen.getByText("—")).toBeInTheDocument(); // no median review time yet
  expect(screen.queryByRole("button", { name: /Edit|Block|Reset password/ })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Change password" })).toHaveAttribute("href", "/change-password");

  const patients = await screen.findByRole("table", { name: "Assigned patients" });
  expect(within(patients).getByText("Ali Valiyev")).toBeInTheDocument();
  expect(within(patients).getByRole("link", { name: "Open record for Ali Valiyev" })).toHaveAttribute("href", "/doctor/patients/7");
  await user.click(screen.getByRole("tab", { name: "Activity" }));
  expect(await screen.findByText("Added a patient")).toBeInTheDocument();
});

test("a doctor cannot open the admin pages", async () => {
  backend({ "GET /api/auth/me": () => ok({ id: 2, username: "dr.aziz", role: "doctor", full_name: "Aziz Karimov" }) });
  renderAt("/admin/doctors/2");
  expect(await screen.findByRole("heading", { name: "Not available for your account" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Aziz Karimov" })).not.toBeInTheDocument();
});
