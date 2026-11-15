import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { AuditEntry, Device, Doctor, DoctorProfile, Stats } from "../../api/admin";
import { session } from "../../app/session";
import { backend, bodyOf, ok, renderAt } from "../../test/utils";
import { generatePassword } from "./doctorFields";
import { maskIp, maskMac, maskSerial, matchesQuery, matchesTab, signalWord, sortDevices } from "./deviceUi";

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
  code: "MM-0001",
  name: "MM-0001",
  serial: "SN-5516-0042",
  model: "MurMur S2",
  location: "Ward 2",
  doctor_id: 2,
  doctor_name: "Aziz Karimov",
  clinic: "Highlands Clinic",
  online: true,
  last_seen_at: new Date().toISOString(),
  wifi_rssi: -58,
  firmware_version: "0.3.1",
  battery_pct: 72,
  mic_noise_db: 24,
  wifi_ssid: "Clinic-Wifi",
  ip: "10.30.4.41",
  mac: "AA:BB:CC:4E:2A:91",
  gateway: "10.30.4.1",
  disconnected_at: null,
  disconnect_reason: null,
  last_self_test_at: null,
  last_self_test_ok: null,
  created_at: "2026-11-01T08:00:00Z",
  state: "online",
  health: "healthy",
  checks: { connection: "pass", battery: "pass", signal: "pass", firmware: "nodata", microphone: "pass", self_test: "nodata" },
  busy: false,
  latest_firmware: null,
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

const fleet = () => [
  device(),
  device({ id: 2, code: "MM-0002", serial: "SN-1000-0002", clinic: "Lakeside Center", doctor_name: "Nodira Usmonova", battery_pct: 12, health: "fault", checks: { ...device().checks, battery: "fail" } }),
  device({ id: 3, code: "MM-0003", serial: "SN-1000-0003", clinic: null, doctor_id: null, doctor_name: null, online: false, last_seen_at: null, state: "pending", health: "pending", battery_pct: null }),
];

test("devices list: summary, status tabs, clinic filter, needs-attention first, and Details opens the device page", async () => {
  backend({
    "GET /api/auth/me": me,
    "GET /api/admin/stats": () => ok(stats),
    "GET /api/admin/doctors": () => ok(doctors),
    "GET /api/admin/devices": () => ok(fleet()),
    "GET /api/admin/devices/1": () => ok(device()),
    "GET /api/admin/devices/1/activity": () => ok([]),
  });
  const router = renderAt("/admin/devices");
  const user = userEvent.setup();

  const table = await screen.findByRole("table", { name: "Devices" });
  const rowNames = () => within(table).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0]!.textContent);
  expect(rowNames()[0]).toContain("MM-0002"); // the fault comes first
  expect(screen.getByText("Showing 3 of 3 devices")).toBeInTheDocument();
  expect(within(table).getByText("72%")).toBeInTheDocument();
  expect(within(table).getByText("Awaiting first connection")).toBeInTheDocument();
  expect(within(table).queryByText("SN-5516-0042")).not.toBeInTheDocument(); // the serial is masked here
  expect(within(table).getAllByText("••••0042")).toHaveLength(1);

  await user.click(screen.getByRole("tab", { name: /Pending/ }));
  expect(router.state.location.search).toBe("?tab=pending");
  expect(rowNames()).toHaveLength(1);
  await user.click(screen.getByRole("tab", { name: /^All/ }));

  await user.selectOptions(screen.getByLabelText("Clinic"), "Lakeside Center");
  expect(rowNames()).toHaveLength(1);
  await user.selectOptions(screen.getByLabelText("Clinic"), "All clinics (2)");
  await user.type(screen.getByRole("searchbox", { name: "Search devices" }), "zzz");
  expect(await screen.findByText("No devices match your filters")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Clear filters" }));

  await user.click(await screen.findByRole("link", { name: "Details of MM-0001" }));
  expect(router.state.location.pathname).toBe("/admin/devices/1");
});

test("devices list: no devices registered yet offers to register one", async () => {
  backend({ "GET /api/auth/me": me, "GET /api/admin/stats": () => ok(stats), "GET /api/admin/devices": () => ok([]) });
  renderAt("/admin/devices");

  expect(await screen.findByText("No devices registered yet")).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: "Register device" }).length).toBeGreaterThan(0);
});

test("register a device page: serial is required, the key is then shown once, and the form is wiped", async () => {
  let sent: unknown;
  backend({
    "GET /api/auth/me": me,
    "GET /api/admin/doctors": () => ok(doctors),
    "POST /api/admin/devices": (init) => {
      sent = bodyOf(init);
      return { status: 201, body: { ...device({ id: 5, code: "MM-0005", online: false, state: "pending", health: "pending" }), api_key: "k3y-once" } };
    },
  });
  renderAt("/admin/devices/new");
  const user = userEvent.setup();

  await user.click(await screen.findByRole("button", { name: "Register device" }));
  expect(screen.getByText("Enter the serial number.")).toBeInTheDocument();
  expect(screen.getByLabelText(/Serial number/)).toHaveFocus();
  expect(sent).toBeUndefined();

  await user.type(screen.getByLabelText(/Serial number/), "SN-5516-0042");
  await user.selectOptions(screen.getByLabelText(/^Model/), "MurMur S3");
  await user.type(screen.getByLabelText("Room or location"), "Ward 2");
  await user.selectOptions(screen.getByLabelText("Assign to a doctor"), "Aziz Karimov · Highlands Clinic");
  expect(screen.getByText("Clinic: Highlands Clinic")).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Olga Kim (Blocked)" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Register device" }));

  expect(await screen.findByRole("heading", { name: "Pair the device" })).toBeInTheDocument();
  expect(sent).toEqual({ serial: "SN-5516-0042", model: "MurMur S3", location: "Ward 2", doctor_id: 2 });
  expect(screen.getByDisplayValue("k3y-once")).toBeInTheDocument();
  expect(screen.getByText(/MM-0005 is registered/)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Register another" }));
  expect(screen.queryByDisplayValue("k3y-once")).not.toBeInTheDocument(); // gone for good
  expect((screen.getByLabelText(/Serial number/) as HTMLInputElement).value).toBe("");
});

test("a taken serial number is explained, not a generic error", async () => {
  backend({
    "GET /api/auth/me": me,
    "GET /api/admin/doctors": () => ok(doctors),
    "POST /api/admin/devices": () => ({ status: 409, body: { detail: "serial already exists" } }),
  });
  renderAt("/admin/devices/new");
  const user = userEvent.setup();

  await user.type(await screen.findByLabelText(/Serial number/), "SN-1");
  await user.click(screen.getByRole("button", { name: "Register device" }));

  expect(await screen.findByText("A device with this serial number already exists.")).toBeInTheDocument();
});

const detailRoutes = (state: { device: Device }, calls: string[] = []) => ({
  "GET /api/auth/me": me,
  "GET /api/admin/doctors": () => ok(doctors),
  "GET /api/admin/devices/1": () => ok(state.device),
  "GET /api/admin/devices/1/activity": () =>
    ok([{ id: 9, user_id: 1, username: "admin", role: "admin", action: "device.create", object_type: "device", object_id: 1, created_at: "2026-11-15T09:00:00Z" }]),
  "PATCH /api/admin/devices/1": (init?: RequestInit) => {
    calls.push(`assign ${JSON.stringify(bodyOf(init))}`);
    return ok(state.device);
  },
  "POST /api/admin/devices/1/rotate-key": () => {
    calls.push("rotate");
    return ok({ ...state.device, api_key: "n3w-key" });
  },
  "POST /api/admin/devices/1/disconnect": (init?: RequestInit) => {
    calls.push(`disconnect ${JSON.stringify(bodyOf(init))}`);
    state.device = device({ state: "disconnected", disconnected_at: "2026-11-15T10:00:00Z", disconnect_reason: "lost" });
    return ok(state.device);
  },
  "POST /api/admin/devices/1/reconnect": () => {
    calls.push("reconnect");
    state.device = device();
    return ok(state.device);
  },
});

test("device detail: network (partly masked), checks, the admin's activity, and the new-key warning", async () => {
  const calls: string[] = [];
  backend(detailRoutes({ device: device() }, calls));
  renderAt("/admin/devices/1");
  const user = userEvent.setup();

  expect(await screen.findByRole("heading", { name: "MM-0001" })).toBeInTheDocument();
  expect(screen.getByText("10.30.••.41")).toBeInTheDocument();
  expect(screen.getByText("••:••:••:4E:2A:91")).toBeInTheDocument();
  expect(screen.getByText("SN-5516-0042")).toBeInTheDocument(); // full serial on the detail page
  expect(await screen.findByText("Registered a device")).toBeInTheDocument();
  expect(screen.getByText("Noise floor 24 dB (limit 35 dB)")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "New key" }));
  const dialog = await screen.findByRole("dialog", { name: "New key for MM-0001?" });
  expect(within(dialog).getByText(/stops working at once/)).toBeInTheDocument();
  expect(calls).toEqual([]);
  await user.click(within(dialog).getByRole("button", { name: "Create new key" }));
  expect(await screen.findByDisplayValue("n3w-key")).toBeInTheDocument();
  await user.keyboard("{Escape}"); // a one-time secret cannot be dismissed by accident
  expect(screen.getByDisplayValue("n3w-key")).toBeInTheDocument();
});

test("device detail: reassigning sends the new doctor (or none)", async () => {
  const calls: string[] = [];
  backend(detailRoutes({ device: device() }, calls));
  renderAt("/admin/devices/1");
  const user = userEvent.setup();

  await user.selectOptions(await screen.findByLabelText("Doctor"), "Not assigned");
  await waitFor(() => expect(calls).toEqual(['assign {"doctor_id":null}']));
});

test("device detail: disconnecting needs a reason; reconnecting is one click", async () => {
  const calls: string[] = [];
  backend(detailRoutes({ device: device() }, calls));
  renderAt("/admin/devices/1");
  const user = userEvent.setup();

  await user.click((await screen.findAllByRole("button", { name: "Disconnect from network" }))[0]!);
  const group = await screen.findByRole("group", { name: "Disconnect MM-0001 from the network?" });
  await user.click(within(group).getByRole("button", { name: "Disconnect MM-0001" }));
  expect(within(group).getByText("Choose a reason. It is saved to the audit log.")).toBeInTheDocument();
  expect(calls).toEqual([]);
  await user.selectOptions(within(group).getByLabelText(/Reason/), "Device lost or stolen");
  await user.click(within(group).getByRole("button", { name: "Disconnect MM-0001" }));

  expect(await screen.findByText(/Reason: Device lost or stolen/)).toBeInTheDocument();
  expect(screen.getByText("MM-0001 is blocked from the network.")).toBeInTheDocument();
  expect(calls).toEqual(['disconnect {"reason":"lost"}']);
  await user.click(screen.getByRole("button", { name: "Reconnect to network" }));
  await waitFor(() => expect(calls).toEqual(['disconnect {"reason":"lost"}', "reconnect"]));
});

test("device detail: a device that is recording cannot be disconnected", async () => {
  backend(detailRoutes({ device: device({ busy: true }) }));
  renderAt("/admin/devices/1");

  for (const button of await screen.findAllByRole("button", { name: "Disconnect from network" })) expect(button).toBeDisabled();
  expect(screen.getByText("In use right now.")).toBeInTheDocument();
});

test("device list helpers: masks, search, tabs and the needs-attention order", () => {
  expect(maskSerial("SN-5516-5503")).toBe("••••5503");
  expect(maskIp("10.30.4.41")).toBe("10.30.••.41");
  expect(maskMac("AA:BB:CC:4E:2A:91")).toBe("••:••:••:4E:2A:91");
  const [a, b, c] = fleet() as [Device, Device, Device];
  expect(sortDevices([a, c, b], "attention").map((d) => d.code)).toEqual(["MM-0002", "MM-0003", "MM-0001"]);
  expect(sortDevices([c, a, b], "id").map((d) => d.code)).toEqual(["MM-0001", "MM-0002", "MM-0003"]);
  expect(matchesQuery(a, "ward")).toBe(true);
  expect(matchesQuery(a, "s3")).toBe(false);
  expect(matchesTab(b, "fault")).toBe(true);
  expect(matchesTab(b, "attention")).toBe(false);
  expect(matchesTab(c, "pending")).toBe(true);
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
