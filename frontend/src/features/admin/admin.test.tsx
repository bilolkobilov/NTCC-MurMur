import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { AuditEntry, Device, Doctor, DoctorProfile, Stats } from "../../api/admin";
import { session } from "../../app/session";
import { backend, bodyOf, ok, renderAt } from "../../test/utils";
import { generatePassword } from "./doctorFields";
import { signalWord } from "./DevicesPage";

const me = () => ok({ id: 1, username: "admin", role: "admin", full_name: "Admin" });
const doctors: Doctor[] = [
  { id: 2, username: "dr.aziz", full_name: "Aziz Karimov", clinic: "Highlands Clinic", is_active: true, created_at: "2026-11-01T08:00:00Z", last_login_at: "2026-11-14T08:00:00Z", patient_count: 4, status: "active" },
  { id: 3, username: "dr.olga", full_name: "Olga Kim", clinic: null, is_active: false, created_at: "2026-11-02T08:00:00Z", last_login_at: "2026-11-03T08:00:00Z", patient_count: 0, status: "suspended" },
  { id: 4, username: "dr.new", full_name: "Nodira Usmonova", clinic: "Lakeside Center", is_active: true, created_at: "2026-11-10T08:00:00Z", last_login_at: null, patient_count: 0, status: "invited" },
];
const profileOf = (doctor: Doctor): DoctorProfile => ({
  ...doctor,
  password_changed_at: null,
  workload: { patients: doctor.patient_count, seen_today: 1, recordings_30d: 12, devices_30d: 2, needs_review: 3, median_review_minutes: 14 },
  devices: [{ id: 1, name: "MurMur #1", serial: "MM-001", online: true, last_seen_at: new Date().toISOString() }],
});
const profileRoutes = () => ({
  "GET /api/admin/doctors/2": () => ok(profileOf(doctors[0]!)),
  "GET /api/admin/doctors/3": () => ok(profileOf(doctors[1]!)),
  "GET /api/admin/doctors/2/patients": () => ok([{ id: 7, full_name: "Ali Valiyev", birth_year: 1980, sex: "male", last_exam_at: null }]),
  "GET /api/admin/doctors/3/patients": () => ok([]),
  "GET /api/admin/doctors/2/activity": () => ok([{ id: 1, action: "exam.read", object_type: "exam", created_at: "2026-11-14T09:00:00Z" }]),
  "GET /api/admin/doctors/3/activity": () => ok([]),
});
const device = (overrides: Partial<Device> = {}): Device => ({
  id: 1,
  name: "MurMur #1",
  serial: "MM-001",
  doctor_id: 2,
  online: true,
  last_seen_at: new Date().toISOString(),
  wifi_rssi: -58,
  firmware_version: "0.3.1",
  created_at: "2026-11-01T08:00:00Z",
  ...overrides,
});
const stats: Stats = {
  doctors_total: 2,
  doctors_active: 1,
  patients_total: 4,
  devices_total: 2,
  devices_online: 1,
  exams_today: 3,
  exams_by_status: { waiting: 0, recording: 0, uploaded: 0, analyzed: 1, reviewed: 5, failed: 2 },
  analyzer: { name: "cardiophon-murmur", version: "1.1.0" },
};

beforeEach(() => session.start({ token: "t", role: "admin", mustChangePassword: false }));
afterEach(() => {
  vi.restoreAllMocks();
  session.end("loggedOut");
  session.takeEndReason();
});

test("overview: exams today, pipeline by status, devices and the AI model — counts only", async () => {
  backend({
    "GET /api/auth/me": me,
    "GET /api/admin/stats": () => ok(stats),
    "GET /api/admin/devices": () => ok([device(), device({ id: 2, name: "MurMur #2", online: false, last_seen_at: null })]),
  });
  renderAt("/admin");

  expect(await screen.findByRole("heading", { name: "3 exams today" })).toBeInTheDocument();
  expect(screen.getByText("cardiophon-murmur 1.1.0")).toBeInTheDocument();
  expect(screen.getByText("1 active of 2")).toBeInTheDocument();
  expect(screen.getByText(/never recordings, AI results or doctors' notes/)).toBeInTheDocument();
  expect(await screen.findByText("Never connected")).toBeInTheDocument();
});

test("add a doctor page: validation, then the credentials are shown once to hand over", async () => {
  let sent: unknown;
  let list = [...doctors];
  backend({
    "GET /api/auth/me": me,
    "GET /api/admin/doctors": () => ok(list),
    "POST /api/admin/doctors": (init) => {
      sent = bodyOf(init);
      const created = { ...doctors[0], id: 9, username: "dr.new", full_name: "Nodira Usmonova", patient_count: 0 };
      list = [...list, created];
      return { status: 201, body: created };
    },
  });
  const router = renderAt("/admin/doctors");
  const user = userEvent.setup();

  await user.click(await screen.findByRole("link", { name: "Add doctor" }));
  expect(router.state.location.pathname).toBe("/admin/doctors/new");
  await user.click(await screen.findByRole("button", { name: "Create doctor" }));
  expect(screen.getByText("Enter the doctor's full name.")).toBeInTheDocument();
  expect(screen.getByLabelText("Full name")).toHaveFocus();
  expect(sent).toBeUndefined();

  await user.type(screen.getByLabelText("Full name"), "Nodira Usmonova");
  await user.type(screen.getByLabelText("Clinic"), "Lakeside Center");
  await user.type(screen.getByLabelText("Username"), "dr.new");
  await user.click(screen.getByRole("button", { name: "Generate" }));
  const password = (screen.getByLabelText("Password") as HTMLInputElement).value;
  expect(password).toHaveLength(12);
  await user.click(screen.getByRole("button", { name: "Create doctor" }));

  expect(await screen.findByRole("heading", { name: "Hand over the login" })).toBeInTheDocument();
  expect(sent).toEqual({ full_name: "Nodira Usmonova", username: "dr.new", password, clinic: "Lakeside Center" });
  expect(screen.getByDisplayValue(password)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Add another doctor" }));
  expect(screen.queryByDisplayValue(password)).not.toBeInTheDocument(); // gone for good
  expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
});

test("a taken username is explained, not a generic error", async () => {
  backend({
    "GET /api/auth/me": me,
    "GET /api/admin/doctors": () => ok(doctors),
    "POST /api/admin/doctors": () => ({ status: 409, body: { detail: "username already exists" } }),
  });
  renderAt("/admin/doctors/new");
  const user = userEvent.setup();

  await user.type(await screen.findByLabelText("Full name"), "Aziz Two");
  await user.type(screen.getByLabelText("Username"), "dr.aziz");
  await user.type(screen.getByLabelText("Password"), "long-enough-1");
  await user.click(screen.getByRole("button", { name: "Create doctor" }));

  expect(await screen.findByText(/username is already taken/i)).toBeInTheDocument();
});

test("blocking asks first and says what happens; a blocked doctor can be unblocked", async () => {
  const calls: string[] = [];
  backend({
    "GET /api/auth/me": me,
    ...profileRoutes(),
    "POST /api/admin/doctors/2/block": () => {
      calls.push("block 2");
      return ok({ ...doctors[0], is_active: false });
    },
    "POST /api/admin/doctors/3/unblock": () => {
      calls.push("unblock 3");
      return ok({ ...doctors[1], is_active: true });
    },
  });
  renderAt("/admin/doctors/2");
  const user = userEvent.setup();

  await user.click(await screen.findByRole("button", { name: "Block" }));
  const dialog = await screen.findByRole("dialog", { name: "Block Aziz Karimov?" });
  expect(within(dialog).getByText(/logged out at once/)).toBeInTheDocument();
  expect(calls).toEqual([]);
  await user.click(within(dialog).getByRole("button", { name: "Block" }));
  await waitFor(() => expect(calls).toEqual(["block 2"]));
});

test("a suspended doctor offers Unblock instead of Block", async () => {
  const calls: string[] = [];
  backend({
    "GET /api/auth/me": me,
    ...profileRoutes(),
    "POST /api/admin/doctors/3/unblock": () => {
      calls.push("unblock 3");
      return ok({ ...doctors[1], is_active: true });
    },
  });
  renderAt("/admin/doctors/3");
  const user = userEvent.setup();

  expect(await screen.findByRole("heading", { name: "Olga Kim" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Block" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Unblock" }));
  await waitFor(() => expect(calls).toEqual(["unblock 3"]));
});

test("register a device: the key is shown once; then the list shows it live", async () => {
  let sent: unknown;
  backend({
    "GET /api/auth/me": me,
    "GET /api/admin/doctors": () => ok(doctors),
    "GET /api/admin/devices": () => ok([device()]),
    "POST /api/admin/devices": (init) => {
      sent = bodyOf(init);
      return { status: 201, body: { ...device({ id: 5, name: "MurMur #3", serial: "MM-003", online: false }), api_key: "k3y-once" } };
    },
  });
  renderAt("/admin/devices");
  const user = userEvent.setup();

  expect(await screen.findByText("MM-001")).toBeInTheDocument();
  expect(screen.getByText(/Wi-Fi: strong/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Register device" }));
  const dialog = await screen.findByRole("dialog", { name: "Register device" });
  await user.type(within(dialog).getByLabelText("Name"), "MurMur #3");
  await user.type(within(dialog).getByLabelText("Serial number"), "MM-003");
  await user.selectOptions(within(dialog).getByLabelText("Doctor"), "Aziz Karimov");
  expect(within(dialog).getByRole("option", { name: "Olga Kim (Blocked)" })).toBeDisabled();
  await user.click(within(dialog).getByRole("button", { name: "Register" }));

  const secret = await screen.findByRole("dialog", { name: "Device registered" });
  expect(sent).toEqual({ name: "MurMur #3", serial: "MM-003", doctor_id: 2 });
  expect(within(secret).getByDisplayValue("k3y-once")).toBeInTheDocument();
  await user.keyboard("{Escape}"); // a one-time secret cannot be dismissed by accident
  expect(screen.getByRole("dialog", { name: "Device registered" })).toBeInTheDocument();
});

test("rotating a key warns that the old one stops at once", async () => {
  let rotated = false;
  backend({
    "GET /api/auth/me": me,
    "GET /api/admin/doctors": () => ok(doctors),
    "GET /api/admin/devices": () => ok([device()]),
    "POST /api/admin/devices/1/rotate-key": () => {
      rotated = true;
      return ok({ ...device(), api_key: "n3w-key" });
    },
  });
  renderAt("/admin/devices");
  const user = userEvent.setup();

  await user.click(await screen.findByRole("button", { name: "New key" }));
  const dialog = await screen.findByRole("dialog", { name: "New key for MurMur #1?" });
  expect(within(dialog).getByText(/stops working at once/)).toBeInTheDocument();
  expect(rotated).toBe(false);
  await user.click(within(dialog).getByRole("button", { name: "Create new key" }));
  expect(await screen.findByDisplayValue("n3w-key")).toBeInTheDocument();
});

test("reassigning a device sends the new doctor (or none)", async () => {
  const sent: unknown[] = [];
  backend({
    "GET /api/auth/me": me,
    "GET /api/admin/doctors": () => ok(doctors),
    "GET /api/admin/devices": () => ok([device()]),
    "PATCH /api/admin/devices/1": (init) => {
      sent.push(bodyOf(init));
      return ok(device({ doctor_id: null }));
    },
  });
  renderAt("/admin/devices");
  const user = userEvent.setup();

  await user.selectOptions(await screen.findByLabelText("Doctor"), "Not assigned");
  await waitFor(() => expect(sent).toEqual([{ doctor_id: null }]));
});

test("audit log: pages of 50 and the filter live in the URL", async () => {
  const urls: string[] = [];
  const entry = (id: number): AuditEntry => ({
    id,
    user_id: 2,
    username: "dr.aziz",
    role: "doctor",
    action: "exam.read",
    object_type: "exam",
    object_id: id,
    created_at: "2026-11-08T09:00:00Z",
  });
  backend({
    "GET /api/auth/me": me,
    "GET /api/admin/audit": (_init, url) => {
      urls.push(url.search);
      const offset = Number(url.searchParams.get("offset"));
      return ok(Array.from({ length: offset === 0 ? 51 : 3 }, (_, i) => entry(1000 - offset - i)));
    },
  });
  const router = renderAt("/admin/audit");
  const user = userEvent.setup();

  expect(await screen.findAllByText("Opened an exam")).toHaveLength(50);
  expect(screen.getByRole("button", { name: /Newer/ })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: /Older/ }));
  await waitFor(() => expect(router.state.location.search).toBe("?page=2"));
  expect(await screen.findByText("#950")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Older/ })).toBeDisabled();

  await user.click(screen.getByRole("button", { name: "Exams" }));
  await waitFor(() => expect(router.state.location.search).toBe("?action=exam"));
  expect(urls.at(-1)).toBe("?limit=51&offset=0&action=exam");
});

test("helpers: Wi-Fi words and generated passwords", () => {
  expect([signalWord(-50), signalWord(-65), signalWord(-80)]).toEqual(["strong", "ok", "weak"]);
  const a = generatePassword();
  expect(a).toMatch(/^[a-zA-Z2-9]{12}$/);
  expect(a).not.toMatch(/[01lIoO]/);
  expect(generatePassword()).not.toBe(a);
});

test("a password typed in the reset dialog is gone when it is opened again", async () => {
  backend({ "GET /api/auth/me": me, ...profileRoutes() });
  renderAt("/admin/doctors/2");
  const user = userEvent.setup();

  await user.click(await screen.findByRole("button", { name: "Reset password" }));
  await user.type(within(await screen.findByRole("dialog")).getByLabelText("Password"), "meant-for-aziz");
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Reset password" }));

  expect(within(await screen.findByRole("dialog", { name: /Aziz Karimov/ })).getByLabelText("Password")).toHaveValue("");
});

test("the doctors list: summary, status tabs, search and clinic filter live in the URL; a row opens the profile", async () => {
  backend({ "GET /api/auth/me": me, "GET /api/admin/doctors": () => ok(doctors), ...profileRoutes() });
  const router = renderAt("/admin/doctors");
  const user = userEvent.setup();

  expect(await screen.findByText("Showing 3 of 3 doctors")).toBeInTheDocument();
  const summary = screen.getByRole("group", { name: "Summary" });
  expect(within(summary).getAllByText("1")).toHaveLength(3); // active, invited, suspended
  expect(screen.getByText("Never signed in")).toBeInTheDocument();
  expect(screen.getByText("No clinic")).toBeInTheDocument();

  await user.click(screen.getByRole("tab", { name: "Invited" }));
  await waitFor(() => expect(router.state.location.search).toBe("?status=invited"));
  expect(screen.getByText("Showing 1 of 3 doctors")).toBeInTheDocument();
  expect(screen.queryByText("Aziz Karimov")).not.toBeInTheDocument();

  await user.click(screen.getByRole("tab", { name: "All" }));
  await user.selectOptions(screen.getByLabelText("Clinic"), "Highlands Clinic");
  expect(screen.getByText("Showing 1 of 3 doctors")).toBeInTheDocument();
  await user.type(screen.getByRole("searchbox"), "zzz");
  expect(await screen.findByText("No doctors match these filters")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(await screen.findByText("Showing 3 of 3 doctors")).toBeInTheDocument();

  await user.click(screen.getByRole("link", { name: "Open profile of Aziz Karimov" }));
  expect(router.state.location.pathname).toBe("/admin/doctors/2");
});

test("the admin profile: counts and a patient table without results; name and clinic are edited together", async () => {
  let sent: unknown;
  backend({
    "GET /api/auth/me": me,
    ...profileRoutes(),
    "PATCH /api/admin/doctors/2": (init) => {
      sent = bodyOf(init);
      return ok({ ...doctors[0], clinic: "Lakeside Center" });
    },
  });
  renderAt("/admin/doctors/2");
  const user = userEvent.setup();

  expect(await screen.findByRole("heading", { name: "Aziz Karimov" })).toBeInTheDocument();
  expect(screen.getByText("Recordings, 30 days")).toBeInTheDocument();
  expect(screen.getByText("MM-001")).toBeInTheDocument();
  expect(screen.getByText("Last sign-in")).toBeInTheDocument();
  await user.click(screen.getByRole("tab", { name: /Patients/ }));
  expect(await screen.findByText("Ali Valiyev")).toBeInTheDocument();
  expect(screen.queryByRole("columnheader", { name: "Status" })).not.toBeInTheDocument(); // no results for the admin
  expect(screen.queryByRole("link", { name: /Open record/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole("tab", { name: "Activity" }));
  expect(await screen.findByText("Opened an exam")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Edit details" }));
  const dialog = await screen.findByRole("dialog", { name: "Edit Aziz Karimov" });
  const clinic = within(dialog).getByLabelText("Clinic");
  await user.clear(clinic);
  await user.type(clinic, "Lakeside Center");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  await waitFor(() => expect(sent).toEqual({ full_name: "Aziz Karimov", clinic: "Lakeside Center" }));
});
