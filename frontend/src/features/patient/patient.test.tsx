import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { MyExam, MyProfile } from "../../api/patient";
import { session } from "../../app/session";
import { backend, bodyOf, ok, renderAt } from "../../test/utils";

const me = () => ok({ id: 9, username: "ali.v", role: "patient", full_name: "Ali Valiyev" });
const profile: MyProfile = {
  patient_id: 12,
  full_name: "Ali Valiyev",
  birth_year: 1990,
  sex: "male",
  height_cm: 178,
  weight_kg: 74,
  doctor_name: "Aziz Karimov",
  doctor_clinic: "Highlands Clinic",
  clinic: "Highlands Clinic",
  registered_at: "2026-01-05T09:00:00Z",
  password_changed_at: "2026-09-02T09:00:00Z",
  latest_analysis: { clinic: "Highlands Clinic", device_code: "MM-0412", at: "2026-11-08T09:20:00Z" },
  heart_rate: 72,
  heart_rate_at: "2026-11-08T09:00:00Z",
  phone: "+998 90 123 45 34",
  email: null,
  city: null,
  emergency_contact_name: null,
  emergency_contact_phone: null,
};
const exam = (over: Partial<MyExam>): MyExam => ({
  id: 1,
  point: "AV",
  created_at: "2026-11-08T09:00:00Z",
  reviewed_at: "2026-11-08T09:20:00Z",
  doctor_note: "",
  doctor_name: "Aziz Karimov",
  clinic: "Highlands Clinic",
  device_code: "MM-0412",
  ai_label: "absent",
  recording_quality: "good",
  ...over,
});
const exams: MyExam[] = [
  exam({ id: 21, point: "MV", ai_label: "murmur", doctor_note: "Soft sound at the mitral position.\nCome back in two months." }),
  exam({ id: 22, point: "AV", doctor_note: "Normal heart sounds." }),
  exam({
    id: 14,
    point: "AV",
    created_at: "2026-10-01T09:00:00Z",
    reviewed_at: "2026-10-01T10:00:00Z",
    doctor_note: "Control in 3 months.",
  }),
];
const common = { "GET /api/auth/me": me, "GET /api/me": () => ok(profile) };

beforeEach(() => session.start({ token: "t", role: "patient", mustChangePassword: false }));
afterEach(() => {
  vi.restoreAllMocks();
  session.end("loggedOut");
  session.takeEndReason();
});

test("results: the latest visit with its summary, one row per position and the doctor's note", async () => {
  backend({ ...common, "GET /api/me/exams": () => ok(exams) });
  renderAt("/patient");

  expect(await screen.findByRole("heading", { name: "Your results" })).toBeInTheDocument();
  expect(await screen.findByText("72")).toBeInTheDocument(); // heart rate from the doctor's vitals
  expect(screen.getByText("1 of 2")).toBeInTheDocument(); // murmur: one of two answered positions
  expect(screen.getByText("2 of 2")).toBeInTheDocument(); // recordings good enough
  expect(screen.getByText("AI-assisted screening")).toBeInTheDocument();

  const table = screen.getByRole("table");
  expect(within(table).getByRole("row", { name: /MV.*Murmur detected.*For follow-up/ })).toBeInTheDocument();
  expect(within(table).getByRole("row", { name: /AV.*No murmur.*Normal/ })).toBeInTheDocument();
  // the position with a murmur is open first: its note is on the right
  expect(screen.getByRole("heading", { name: "Note from your doctor" })).toBeInTheDocument();
  expect(screen.getByText(/Soft sound at the mitral position/)).toBeInTheDocument();
});

test("results: Details opens another position; View opens an earlier visit", async () => {
  backend({ ...common, "GET /api/me/exams": () => ok(exams) });
  renderAt("/patient");
  const user = userEvent.setup();
  await screen.findByText(/Soft sound at the mitral position/);

  await user.click(screen.getAllByRole("button", { name: "Details: AV" })[0]);
  expect(await screen.findByText("Normal heart sounds.")).toBeInTheDocument();

  expect(screen.getByText("Earlier visits")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /View visit of 1 Oct 2026/ }));
  expect(await screen.findByText("Control in 3 months.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /View visit of 8 Nov 2026/ })).toBeInTheDocument(); // the other visit is now "earlier"
});

test("results: only the yes / no label is shown; the score, the model and the doctor's agreement never are", async () => {
  // Even if the server ever sent them, the page must not show them.
  const leaky = { ...exams[0], ai_result: { model_name: "cardiophon-murmur", score: 0.87 }, score: 0.87, doctor_agrees_with_ai: true };
  backend({ ...common, "GET /api/me/exams": () => ok([leaky]) });
  renderAt("/patient");

  expect(await screen.findByText(/Soft sound at the mitral position/)).toBeInTheDocument();
  const text = document.body.textContent ?? "";
  for (const word of [/cardiophon/i, /probability/i, /87/, /agree/i]) expect(text).not.toMatch(word);
});

test("results: when the AI gave no answer the page says so and shows no AI mark", async () => {
  const noAnswer = exam({ id: 5, ai_label: null, recording_quality: "unknown", doctor_note: "Fine." });
  backend({ ...common, "GET /api/me/exams": () => ok([noAnswer]) });
  renderAt("/patient");

  expect((await screen.findAllByText("No AI answer")).length).toBeGreaterThan(0);
  expect(screen.getByText("The computer gave no answer")).toBeInTheDocument();
  expect(screen.queryByText("AI-assisted screening")).not.toBeInTheDocument();
});

test("results: no results yet is a calm explanation", async () => {
  backend({ ...common, "GET /api/me/exams": () => ok([]) });
  renderAt("/patient");

  const table = await screen.findByRole("table");
  expect(within(table).getByRole("columnheader", { name: "Position" })).toBeInTheDocument();
  expect(within(table).getByText("No results yet")).toBeInTheDocument();
  // the rest of the design stays in place, empty
  expect(screen.getByRole("heading", { name: "Heart rate" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Murmur screening" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Note from your doctor" })).toBeInTheDocument();
  expect(screen.getByText("No earlier visits yet.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Download report (PDF)" })).toBeDisabled();
});

test("results: 'Download report' opens the print dialog (Save as PDF)", async () => {
  backend({ ...common, "GET /api/me/exams": () => ok(exams) });
  const print = vi.spyOn(window, "print").mockImplementation(() => {});
  renderAt("/patient");
  const user = userEvent.setup();

  await user.click(await screen.findByRole("button", { name: "Download report (PDF)" }));
  expect(print).toHaveBeenCalled();
});

test("profile: clinic data is shown, not editable; the tab bar leads there", async () => {
  backend({ ...common, "GET /api/me/exams": () => ok(exams) });
  renderAt("/patient");
  const user = userEvent.setup();
  await screen.findByRole("heading", { name: "Your results" });

  await user.click(screen.getAllByRole("link", { name: "Profile" })[0]);
  expect(await screen.findByRole("heading", { name: "Your profile" })).toBeInTheDocument();
  expect(screen.getAllByText("Ali Valiyev").length).toBeGreaterThan(0);
  expect(screen.getByText("1990 (36 years)")).toBeInTheDocument();
  expect(screen.getByText("Highlands Clinic, 8 Nov 2026 (device MM-0412)")).toBeInTheDocument();
  expect(screen.getByText(/^Changed 2 Sep/)).toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: /Full name/ })).not.toBeInTheDocument();
  expect(screen.queryByText(/two-step|SMS|photo/i)).not.toBeInTheDocument();
});

test("profile: saving contact details sends them and confirms; a bad email is stopped before the request", async () => {
  const spy = backend({
    ...common,
    "PATCH /api/me": (init) => ok({ ...profile, ...bodyOf(init) }),
  });
  renderAt("/patient/profile");
  const user = userEvent.setup();
  expect(await screen.findByText("+998 90 123 45 34")).toBeInTheDocument(); // read-only until Edit
  expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Edit" }));
  const email = await screen.findByLabelText("Email");
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled(); // nothing changed yet

  await user.type(email, "ali-at-example");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByText("Enter an email like name@example.com.")).toBeInTheDocument();
  expect(spy.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);

  await user.clear(email);
  await user.type(email, "ali@example.com");
  await user.type(screen.getByLabelText("City"), "Tashkent");
  await user.click(screen.getByRole("button", { name: "Save changes" }));

  expect(await screen.findByText("Contact details saved.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument(); // back to read-only
  expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  const patch = spy.mock.calls.find(([, init]) => init?.method === "PATCH")!;
  expect(bodyOf(patch[1])).toMatchObject({ email: "ali@example.com", city: "Tashkent", phone: "+998 90 123 45 34" });
});

test("records: every reviewed note on one printable page", async () => {
  backend({ ...common, "GET /api/me/exams": () => ok(exams) });
  const print = vi.spyOn(window, "print").mockImplementation(() => {});
  renderAt("/patient/records");
  const user = userEvent.setup();

  expect(await screen.findByRole("heading", { name: "My records" })).toBeInTheDocument();
  expect(screen.getByText("Control in 3 months.")).toBeInTheDocument();
  expect(screen.getByText("Normal heart sounds.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Print or save as PDF" }));
  expect(print).toHaveBeenCalled();
});

test("a patient who must change the temporary password is sent there first", async () => {
  session.start({ token: "t", role: "patient", mustChangePassword: true });
  backend({ ...common, "GET /api/me/exams": () => ok(exams) });
  const router = renderAt("/patient");

  await waitFor(() => expect(router.state.location.pathname).toBe("/change-password"));
});

test("Uzbek: title, dates and texts in Uzbek", async () => {
  const i18n = (await import("../../i18n")).default;
  await i18n.changeLanguage("uz");
  backend({ ...common, "GET /api/me/exams": () => ok(exams) });
  renderAt("/patient");

  expect(await screen.findByRole("heading", { name: "Natijalaringiz" })).toBeInTheDocument();
  expect(await screen.findByText(/8-noyabr 2026 kuni tashrif/)).toBeInTheDocument();
  await i18n.changeLanguage("en");
});

test("the next person on a shared phone never sees the previous patient's results, not even for a moment", async () => {
  // Like the real API: the answer depends on whose token is sent; no token = 401.
  const token = (init: RequestInit | undefined) => new Headers(init?.headers).get("Authorization");
  backend({
    ...common,
    "GET /api/me/exams": (init) =>
      token(init) === "Bearer t"
        ? ok(exams)
        : token(init) === "Bearer t2"
          ? ok([exam({ id: 99, doctor_note: "Result of patient B." })])
          : { status: 401, body: { detail: "not authenticated" } },
  });
  const router = renderAt("/patient");
  expect(await screen.findByText(/Come back in two months/)).toBeInTheDocument();

  await act(async () => {
    session.end("loggedOut");
    session.start({ token: "t2", role: "patient", mustChangePassword: false });
    await router.navigate("/patient");
  });

  expect(screen.queryByText(/Come back in two months/)).not.toBeInTheDocument();
  expect(await screen.findByText("Result of patient B.")).toBeInTheDocument();
});
