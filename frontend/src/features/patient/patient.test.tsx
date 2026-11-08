import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { MyExam, MyProfile } from "../../api/patient";
import { session } from "../../app/session";
import { backend, ok, renderAt } from "../../test/utils";

const me = () => ok({ id: 9, username: "ali.v", role: "patient", full_name: "Ali Valiyev" });
const profile: MyProfile = {
  full_name: "Ali Valiyev",
  birth_year: 1990,
  sex: "male",
  height_cm: 178,
  weight_kg: 74,
  doctor_name: "Aziz Karimov",
};
const exams: MyExam[] = [
  {
    id: 21,
    point: "MV",
    created_at: "2026-11-08T09:00:00Z",
    reviewed_at: "2026-11-08T09:20:00Z",
    doctor_note: "Normal heart sounds.\nCome back in one year.",
  },
  {
    id: 14,
    point: "AV",
    created_at: "2026-10-01T09:00:00Z",
    reviewed_at: "2026-10-01T10:00:00Z",
    doctor_note: "Soft murmur, likely innocent. Control in 3 months.",
  },
];
const common = { "GET /api/auth/me": me, "GET /api/me": () => ok(profile) };

beforeEach(() => session.start({ token: "t", role: "patient", mustChangePassword: false }));
afterEach(() => {
  vi.restoreAllMocks();
  session.end("loggedOut");
  session.takeEndReason();
});

test("home lists the reviewed results with the doctor's name; a result opens with one tap", async () => {
  backend({ ...common, "GET /api/me/exams": () => ok(exams) });
  const router = renderAt("/patient");
  const user = userEvent.setup();

  expect(await screen.findByRole("heading", { name: "Your results" })).toBeInTheDocument();
  expect(await screen.findByText(/Your doctor, Aziz Karimov, publishes/)).toBeInTheDocument();
  const links = screen.getAllByRole("link", { name: /Listening point/ });
  expect(links.map((l) => l.textContent)).toEqual([
    expect.stringContaining("8 Nov 2026"),
    expect.stringContaining("1 Oct 2026"),
  ]);

  await user.click(links[0]);
  await waitFor(() => expect(router.state.location.pathname).toBe("/patient/results/21"));
  expect(await screen.findByRole("heading", { name: "Result of 8 Nov 2026" })).toBeInTheDocument();
});

test("a result shows the conclusion and where the doctor listened — and never anything about AI", async () => {
  // Even if the server ever sent AI fields, the page must not show them.
  const leaky = { ...exams[0], ai_result: { model_name: "cardiophon-murmur", label: "murmur", score: 0.87 } };
  backend({ ...common, "GET /api/me/exams": () => ok([leaky]) });
  renderAt("/patient/results/21");

  expect(await screen.findByText(/Come back in one year/)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Your doctor's conclusion" })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: /listened at the mitral valve point/ })).toBeInTheDocument();
  expect(screen.getByText("left side of the chest, below the nipple")).toBeInTheDocument();
  expect(await screen.findByText(/Reviewed by Aziz Karimov/)).toBeInTheDocument();

  const text = document.body.textContent ?? "";
  for (const word of [/\bAI\b/, /cardiophon/i, /probability/i, /murmur detected/i, /87/]) expect(text).not.toMatch(word);
});

test("no results yet: a calm explanation instead of an empty box", async () => {
  backend({ ...common, "GET /api/me/exams": () => ok([]) });
  renderAt("/patient");

  expect(await screen.findByRole("heading", { name: "No results yet" })).toBeInTheDocument();
});

test("a result that is not in the patient's list is 'not available', with a way back", async () => {
  backend({ ...common, "GET /api/me/exams": () => ok(exams) });
  renderAt("/patient/results/999");

  expect(await screen.findByRole("heading", { name: "This result is not available" })).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: /Your results/ }).length).toBeGreaterThan(0);
});

test("a patient who must change the temporary password is sent there first", async () => {
  session.start({ token: "t", role: "patient", mustChangePassword: true });
  backend({ ...common, "GET /api/me/exams": () => ok(exams) });
  const router = renderAt("/patient");

  await waitFor(() => expect(router.state.location.pathname).toBe("/change-password"));
});

test("Uzbek: dates, point and texts in Uzbek", async () => {
  const i18n = (await import("../../i18n")).default;
  await i18n.changeLanguage("uz");
  backend({ ...common, "GET /api/me/exams": () => ok(exams) });
  renderAt("/patient/results/21");

  expect(await screen.findByRole("heading", { name: "8-noyabr 2026 natijasi" })).toBeInTheDocument();
  expect(screen.getByText("koʻkrakning chap tomoni, koʻkrak soʻrgʻichidan pastroq")).toBeInTheDocument();
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
          ? ok([{ ...exams[1], id: 99, doctor_note: "Result of patient B." }])
          : { status: 401, body: { detail: "not authenticated" } },
  });
  const router = renderAt("/patient");
  expect(await screen.findByText(/Come back in one year/)).toBeInTheDocument();

  await act(async () => {
    session.end("loggedOut");
    session.start({ token: "t2", role: "patient", mustChangePassword: false });
    await router.navigate("/patient");
  });

  expect(screen.queryByText(/Come back in one year/)).not.toBeInTheDocument();
  expect(await screen.findByText("Result of patient B.")).toBeInTheDocument();
});
