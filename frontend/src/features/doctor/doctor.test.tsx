import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Patient, PatientRegistryRow } from "../../api/doctor";
import { session } from "../../app/session";
import { backend, bodyOf, ok, renderAt } from "../../test/utils";
import { validate } from "./patients/PatientFormPage";
import { suggestUsername } from "./patients/PatientPage";

const me = () => ok({ id: 1, username: "dr", role: "doctor", full_name: "Aziz Karimov", clinic: "Highlands Clinic" });

const ali: Patient = {
  id: 12,
  full_name: "Ali Valiyev",
  birth_year: 1990,
  sex: "male",
  height_cm: 175,
  weight_kg: 70.5,
  consent_given_at: null,
  has_login: false,
  created_at: "2026-11-08T08:00:00Z",
};

beforeEach(() => session.start({ token: "t", role: "doctor", mustChangePassword: false }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  session.end("loggedOut");
  session.takeEndReason();
});

const registryRow = (over: Partial<PatientRegistryRow> = {}): PatientRegistryRow => ({
  ...ali,
  last_exam: { id: 7, point: "MV", status: "analyzed", created_at: new Date().toISOString(), device_name: "MurMur #1" },
  result_status: "abnormal",
  needs_review: true,
  ...over,
});

const summary = { total: 4, assigned_today: 2, normal: 1, needs_review: 2, pending: 1 };

const registryBackend = (rows: (url: URL) => PatientRegistryRow[]) =>
  backend({
    "GET /api/auth/me": me,
    "GET /api/patients": (_, url) => ok(rows(url)),
    "GET /api/patients/summary": () => ok(summary),
  });

describe("patient registry", () => {
  test("/doctor opens the registry", async () => {
    registryBackend(() => []);
    const router = renderAt("/doctor");

    await waitFor(() => expect(router.state.location.pathname).toBe("/doctor/patients"));
    expect(await screen.findByRole("heading", { level: 1, name: "Patient registry" })).toBeInTheDocument();
  });

  test("a row shows the patient, age · sex, last recording and a status word; Open has a full name", async () => {
    registryBackend(() => [registryRow()]);
    renderAt("/doctor/patients");

    const row = (await screen.findByText("Ali Valiyev")).closest("tr")!;
    expect(within(row).getByText("№ 012")).toBeInTheDocument();
    expect(within(row).getByText(/· M$/)).toBeInTheDocument();
    expect(within(row).getByText("Abnormal")).toBeInTheDocument();
    // mock clinic data (mockClinic.ts): registered clinic + where the latest exam was analyzed
    expect(within(row).getByText("Highlands Clinic")).toBeInTheDocument(); // patient 12 → index 0
    expect(within(row).getByText(/Analyzed at .* · MurMur #1/)).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "Open record for Ali Valiyev" })).toHaveAttribute(
      "href",
      "/doctor/patients/12",
    );
  });

  test.each([
    [{ result_status: "normal", needs_review: true }, "Normal"],
    [{ result_status: "pending", needs_review: false, last_exam: null }, "Pending"],
    [{ result_status: "pending", needs_review: true }, "Awaiting review"],
    [{ result_status: "failed", needs_review: false }, "Re-record"],
    [{ result_status: "reviewed", needs_review: false }, "Reviewed"],
  ] as [Partial<PatientRegistryRow>, string][])("status %j shows the word “%s”", async (over, word) => {
    registryBackend(() => [registryRow(over)]);
    renderAt("/doctor/patients");

    const row = (await screen.findByText("Ali Valiyev")).closest("tr")!;
    expect(within(row).getByText(word)).toBeInTheDocument();
  });

  test("a patient with no exam says so", async () => {
    registryBackend(() => [registryRow({ last_exam: null, result_status: "pending", needs_review: false })]);
    renderAt("/doctor/patients");

    expect(await screen.findByText("No recording yet")).toBeInTheDocument();
    expect(screen.getByText("Not analyzed yet")).toBeInTheDocument();
  });

  test("summary figures show the backend numbers", async () => {
    registryBackend(() => []);
    renderAt("/doctor/patients");

    const tiles = await screen.findByRole("group", { name: "Summary" });
    expect(within(tiles).getByText("Assigned today").nextElementSibling).toHaveTextContent("2");
    expect(within(tiles).getByText("Needs review").nextElementSibling).toHaveTextContent("2");
    expect(within(tiles).getByText("Pending").nextElementSibling).toHaveTextContent("1");
  });

  test("the doctor shell: sidebar with the patient count, account menu, footer links", async () => {
    registryBackend(() => []);
    renderAt("/doctor/patients");

    const nav = await screen.findByRole("navigation", { name: "Main navigation" });
    expect(await within(nav).findByText("4")).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: /Patients/ })).toHaveAttribute("aria-current", "page");
    expect(await screen.findByRole("button", { name: "Account" })).toBeInTheDocument();
    expect(await screen.findByText("Highlands Clinic")).toBeInTheDocument(); // the clinic chip in the header
    expect(within(screen.getByRole("navigation", { name: "Footer" })).getAllByRole("link")).toHaveLength(4);
  });

  test("tabs and sort go into the URL and are sent to the API", async () => {
    const fetchMock = registryBackend(() => [registryRow()]);
    const router = renderAt("/doctor/patients");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("tab", { name: /Needs review/ }));
    await waitFor(() => expect(router.state.location.search).toBe("?status=needs_review"));
    await user.selectOptions(screen.getByRole("combobox", { name: "Sort" }), "priority");
    await waitFor(() => expect(router.state.location.search).toBe("?sort=priority&status=needs_review"));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url]) => String(url).includes("status=needs_review") && String(url).includes("sort=priority"),
        ),
      ).toBe(true),
    );
    expect(screen.getByRole("tab", { name: /Needs review/ })).toHaveAttribute("aria-selected", "true");
  });

  test("search goes into the URL after a pause and is sent to the API", async () => {
    const fetchMock = registryBackend((url) => (url.searchParams.get("q") === "ali" ? [registryRow()] : []));
    const router = renderAt("/doctor/patients");
    const user = userEvent.setup();

    await user.type(await screen.findByRole("searchbox", { name: "Search this list" }), "ali");

    await waitFor(() => expect(router.state.location.search).toBe("?q=ali"));
    expect(await screen.findByText("Ali Valiyev")).toBeInTheDocument();
    const searches = fetchMock.mock.calls.map(([url]) => String(url)).filter((u) => u.startsWith("/api/patients?"));
    expect(searches.some((u) => u.includes("q=ali"))).toBe(true);
    expect(searches.some((u) => u.includes("q=a&"))).toBe(false); // no request per keystroke
  });

  test("first-run and no-match empty states are different", async () => {
    registryBackend(() => []);
    renderAt("/doctor/patients");
    expect(await screen.findByRole("heading", { name: "Add your first patient" })).toBeInTheDocument();

    renderAt("/doctor/patients?q=zz");
    expect(await screen.findByRole("heading", { name: "No patient matches “zz”" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear search" })).toBeInTheDocument();
  });

  test("a load error explains and retries", async () => {
    let calls = 0;
    backend({
      "GET /api/auth/me": me,
      "GET /api/patients": () => (++calls === 1 ? { status: 404, body: { detail: "x" } } : ok([registryRow()])),
      "GET /api/patients/summary": () => ok(summary),
    });
    renderAt("/doctor/patients");

    await userEvent.setup().click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Ali Valiyev")).toBeInTheDocument();
  });

  test("Open is a keyboard-reachable link", async () => {
    registryBackend(() => [registryRow()]);
    renderAt("/doctor/patients");
    const open = await screen.findByRole("link", { name: "Open record for Ali Valiyev" });

    open.focus();

    expect(open).toHaveFocus();
  });
});

describe("patient form", () => {
  test("empty submit: inline errors, focus on the first, nothing sent", async () => {
    const fetchMock = backend({ "GET /api/auth/me": me });
    renderAt("/doctor/patients/new");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Add patient" }));

    expect(screen.getByText("Enter the patient's full name.")).toBeInTheDocument();
    expect(screen.getByText("Choose the sex.")).toBeInTheDocument();
    expect(screen.getByLabelText("Full name")).toHaveFocus();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  test("creating a patient sends clean numbers (70,5 → 70.5) and opens the patient page", async () => {
    let sent: unknown;
    backend({
      "GET /api/auth/me": me,
      "POST /api/patients": (init) => {
        sent = bodyOf(init);
        return { status: 201, body: { ...ali, consent_given_at: "2026-11-08T08:00:00Z" } };
      },
      "GET /api/patients/12/exams": () => ok([]),
      // The page refreshes the patient right after saving; a failing refresh must not hide the saved data.
      "GET /api/patients/12": () => ({ status: 500, body: { detail: "Internal Server Error" } }),
    });
    const router = renderAt("/doctor/patients/new");
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Full name"), "  Ali Valiyev ");
    await user.type(screen.getByLabelText("Year of birth"), "19x90");
    await user.click(screen.getByRole("radio", { name: "Male" }));
    await user.type(screen.getByLabelText("Height, cm"), "175");
    await user.type(screen.getByLabelText("Weight, kg"), "70,5");
    await user.click(screen.getByRole("checkbox", { name: /Signed consent form received/ }));
    await user.click(screen.getByRole("button", { name: "Add patient" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/doctor/patients/12"));
    expect(sent).toEqual({
      full_name: "Ali Valiyev",
      birth_year: 1990,
      sex: "male",
      height_cm: 175,
      weight_kg: 70.5,
      consent_given: true,
    });
    expect(await screen.findByText("Patient saved.")).toBeInTheDocument();
  });

  test("leaving with unsaved changes asks first", async () => {
    backend({ "GET /api/auth/me": me, "GET /api/patients": () => ok([]) });
    const router = renderAt("/doctor/patients/new");
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Full name"), "Ali");
    await user.click(screen.getByRole("link", { name: "Cancel" }));

    const dialog = await screen.findByRole("dialog", { name: "Leave without saving?" });
    await user.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    expect(router.state.location.pathname).toBe("/doctor/patients/new");
    expect(screen.getByLabelText("Full name")).toHaveValue("Ali");

    await user.click(screen.getByRole("link", { name: "Cancel" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Leave without saving" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/doctor/patients"));
  });

  test("validation rules", () => {
    const base = { fullName: "A", birthYear: "1990", sex: "male" as const, height: "", weight: "", consent: false };
    const now = new Date("2026-11-08");
    expect(validate(base, now)).toEqual({});
    expect(validate({ ...base, birthYear: "2027" }, now)).toHaveProperty("birthYear");
    expect(validate({ ...base, birthYear: "190" }, now)).toHaveProperty("birthYear");
    expect(validate({ ...base, height: "0" }, now)).toHaveProperty("height");
    expect(validate({ ...base, weight: "70,5" }, now)).toEqual({});
  });
});

describe("patient page", () => {
  test("consent: must tick the box, then it is recorded", async () => {
    const fetchMock = backend({
      "GET /api/auth/me": me,
      "GET /api/patients/12": () => ok(ali),
      "GET /api/patients/12/exams": () => ok([]),
      "POST /api/patients/12/consent": () => ok({ ...ali, consent_given_at: "2026-11-08T09:00:00Z" }),
    });
    renderAt("/doctor/patients/12");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Record consent" }));
    expect(screen.getByText("Tick the box to confirm you have the signed form.")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("/consent"))).toBe(false);

    await user.click(screen.getByRole("checkbox", { name: /I have the consent form/ }));
    await user.click(screen.getByRole("button", { name: "Record consent" }));

    expect(await screen.findByText(/Signed consent recorded on/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Start exam" }).length).toBeGreaterThan(0);
  });

  test("patient login: suggested username, one-time password shown once, Esc cannot close it", async () => {
    let sent: unknown;
    backend({
      "GET /api/auth/me": me,
      "GET /api/patients/12": () => ok(ali),
      "GET /api/patients/12/exams": () => ok([]),
      "POST /api/patients/12/login": (init) => {
        sent = bodyOf(init);
        return { status: 201, body: { username: "ali.valiyev", temporary_password: "Xk3-pQ9sTt" } };
      },
    });
    renderAt("/doctor/patients/12");
    const user = userEvent.setup();

    expect(await screen.findByLabelText("Username")).toHaveValue("ali.valiyev");
    await user.click(screen.getByRole("button", { name: "Create login" }));

    const dialog = await screen.findByRole("dialog", { name: "Login created" });
    expect(sent).toEqual({ username: "ali.valiyev" });
    expect(within(dialog).getByLabelText("One-time password")).toHaveValue("Xk3-pQ9sTt");
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Login created" })).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "I gave it to the patient" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByDisplayValue("Xk3-pQ9sTt")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Give a new one-time password" })).toBeInTheDocument();
  });

  test("a taken username gets a specific message", async () => {
    backend({
      "GET /api/auth/me": me,
      "GET /api/patients/12": () => ok(ali),
      "GET /api/patients/12/exams": () => ok([]),
      "POST /api/patients/12/login": () => ({ status: 409, body: { detail: "username already exists" } }),
    });
    renderAt("/doctor/patients/12");

    await userEvent.setup().click(await screen.findByRole("button", { name: "Create login" }));

    expect(await screen.findByText("This username is already taken. Choose another.")).toBeInTheDocument();
  });

  test("delete needs the typed name, then returns to the list with a notice", async () => {
    let deleted = false;
    backend({
      "GET /api/auth/me": me,
      "GET /api/patients/12": () => ok(ali),
      "GET /api/patients/12/exams": () => ok([{ id: 1, patient_id: 12, device_id: 1, point: "MV", status: "reviewed", created_at: ali.created_at, reviewed_at: ali.created_at }]),
      "DELETE /api/patients/12": () => {
        deleted = true;
        return { status: 204 };
      },
      "GET /api/patients": () => ok([]),
    });
    const router = renderAt("/doctor/patients/12");
    const user = userEvent.setup();

    await screen.findByText("Reviewed");
    await user.click(screen.getByRole("button", { name: "Delete patient" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete Ali Valiyev?" });
    expect(within(dialog).getByText(/1 exam with its recording/)).toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", { name: "Delete patient" });
    expect(confirm).toBeDisabled();

    await user.type(within(dialog).getByRole("textbox"), "ali valiyev");
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() => expect(router.state.location.pathname).toBe("/doctor/patients"));
    expect(deleted).toBe(true);
    expect(await screen.findByText(/Ali Valiyev was deleted/)).toBeInTheDocument();
  });
});

test("username suggestion from a Latin name only", () => {
  expect(suggestUsername("Ali Valiyev")).toBe("ali.valiyev");
  expect(suggestUsername("Gʻulom Oʻrinov")).toBe("gulom.orinov");
  expect(suggestUsername("Алишер Валиев")).toBe("");
  expect(suggestUsername("Bo")).toBe("");
});

test("numbers follow the language: 70.5 kg in English, 70,5 кг in Russian", async () => {
  const { formatNumber } = await import("../../lib/format");
  expect(formatNumber(70.5, "en")).toBe("70.5");
  expect(formatNumber(70.5, "ru")).toBe("70,5");
  expect(formatNumber(70.5, "uz")).toBe("70,5");
  expect(formatNumber(175, "ru")).toBe("175");
});
