import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { AuditEntry, Device, Doctor, Stats } from "../../api/admin";
import { session } from "../../app/session";
import { backend, bodyOf, ok, renderAt } from "../../test/utils";
import { generatePassword } from "./DoctorsPage";
import { signalWord } from "./DevicesPage";

const me = () => ok({ id: 1, username: "admin", role: "admin", full_name: "Admin" });
const doctors: Doctor[] = [
  { id: 2, username: "dr.aziz", full_name: "Aziz Karimov", is_active: true, created_at: "2026-11-01T08:00:00Z", patient_count: 4 },
  { id: 3, username: "dr.olga", full_name: "Olga Kim", is_active: false, created_at: "2026-11-02T08:00:00Z", patient_count: 0 },
];
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

test("create a doctor: validation, then the credentials are shown once to hand over", async () => {
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
  renderAt("/admin/doctors");
  const user = userEvent.setup();

  await user.click(await screen.findByRole("button", { name: "Add doctor" }));
  const dialog = await screen.findByRole("dialog", { name: "Add doctor" });
  await user.click(within(dialog).getByRole("button", { name: "Create doctor" }));
  expect(within(dialog).getByText("Enter the doctor's full name.")).toBeInTheDocument();
  expect(sent).toBeUndefined();

  await user.type(within(dialog).getByLabelText("Full name"), "Nodira Usmonova");
  await user.type(within(dialog).getByLabelText("Username"), "dr.new");
  await user.click(within(dialog).getByRole("button", { name: "Generate" }));
  const password = (within(dialog).getByLabelText("Password") as HTMLInputElement).value;
  expect(password).toHaveLength(12);
  await user.click(within(dialog).getByRole("button", { name: "Create doctor" }));

  const secret = await screen.findByRole("dialog", { name: "Doctor created" });
  expect(sent).toEqual({ full_name: "Nodira Usmonova", username: "dr.new", password });
  expect(within(secret).getByDisplayValue(password)).toBeInTheDocument();
  await user.click(within(secret).getByRole("button", { name: "I have handed it over" }));
  expect(screen.queryByDisplayValue(password)).not.toBeInTheDocument(); // gone for good
  expect(await screen.findByText("Nodira Usmonova")).toBeInTheDocument();
});

test("a taken username is explained, not a generic error", async () => {
  backend({
    "GET /api/auth/me": me,
    "GET /api/admin/doctors": () => ok(doctors),
    "POST /api/admin/doctors": () => ({ status: 409, body: { detail: "username already exists" } }),
  });
  renderAt("/admin/doctors");
  const user = userEvent.setup();

  await user.click(await screen.findByRole("button", { name: "Add doctor" }));
  const dialog = await screen.findByRole("dialog");
  await user.type(within(dialog).getByLabelText("Full name"), "Aziz Two");
  await user.type(within(dialog).getByLabelText("Username"), "dr.aziz");
  await user.type(within(dialog).getByLabelText("Password"), "long-enough-1");
  await user.click(within(dialog).getByRole("button", { name: "Create doctor" }));

  expect(await within(dialog).findByText(/username is already taken/i)).toBeInTheDocument();
});

test("blocking asks first and says what happens; a blocked doctor can be unblocked", async () => {
  const calls: string[] = [];
  backend({
    "GET /api/auth/me": me,
    "GET /api/admin/doctors": () => ok(doctors),
    "POST /api/admin/doctors/2/block": () => {
      calls.push("block 2");
      return ok({ ...doctors[0], is_active: false });
    },
    "POST /api/admin/doctors/3/unblock": () => {
      calls.push("unblock 3");
      return ok({ ...doctors[1], is_active: true });
    },
  });
  renderAt("/admin/doctors");
  const user = userEvent.setup();

  await user.click(await screen.findByRole("button", { name: "Block" }));
  const dialog = await screen.findByRole("dialog", { name: "Block Aziz Karimov?" });
  expect(within(dialog).getByText(/logged out at once/)).toBeInTheDocument();
  expect(calls).toEqual([]);
  await user.click(within(dialog).getByRole("button", { name: "Block" }));
  await waitFor(() => expect(calls).toEqual(["block 2"]));

  await user.click(screen.getByRole("button", { name: "Unblock" }));
  await waitFor(() => expect(calls).toEqual(["block 2", "unblock 3"]));
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

test("a password typed for one doctor is gone when the reset dialog opens for another", async () => {
  backend({ "GET /api/auth/me": me, "GET /api/admin/doctors": () => ok(doctors) });
  renderAt("/admin/doctors");
  const user = userEvent.setup();

  const [resetA, resetB] = await screen.findAllByRole("button", { name: "Reset password" });
  await user.click(resetA);
  await user.type(within(await screen.findByRole("dialog")).getByLabelText("Password"), "meant-for-aziz");
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
  await user.click(resetB);

  expect(within(await screen.findByRole("dialog", { name: /Olga Kim/ })).getByLabelText("Password")).toHaveValue("");
});
