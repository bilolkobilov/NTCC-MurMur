import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ExamDetail, Patient } from "../../../api/doctor";
import { session } from "../../../app/session";
import { backend, bodyOf, ok, renderAt } from "../../../test/utils";

const me = () => ok({ id: 1, username: "dr", role: "doctor", full_name: "Aziz Karimov" });
const patient: Patient = {
  id: 12,
  full_name: "Ali Valiyev",
  birth_year: 1990,
  sex: "male",
  height_cm: null,
  weight_kg: null,
  clinic: null,
  consent_given_at: "2026-11-08T08:00:00Z",
  has_login: false,
  created_at: "2026-11-08T08:00:00Z",
};
const devices = [
  { id: 1, name: "MurMur #1", serial: "MM-001", online: true, last_seen_at: new Date().toISOString() },
  { id: 2, name: "MurMur #2", serial: "MM-002", online: false, last_seen_at: null },
];
const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();
function exam(overrides: Partial<ExamDetail>): ExamDetail {
  return {
    id: 7,
    patient_id: 12,
    device_id: 1,
    point: "MV",
    status: "waiting",
    created_at: ago(2),
    reviewed_at: null,
    failure_reason: null,
    doctor_note: null,
    doctor_agrees_with_ai: null,
    updated_at: ago(2),
    recording: null,
    ai_result: null,
    has_ecg: false,
    ecg_result: null,
    ...overrides,
  };
}
const common = {
  "GET /api/auth/me": me,
  "GET /api/patients/12": () => ok(patient),
  "GET /api/devices": () => ok(devices),
};

beforeEach(() => session.start({ token: "t", role: "doctor", mustChangePassword: false }));
afterEach(() => {
  vi.restoreAllMocks();
  session.end("loggedOut");
  session.takeEndReason();
});

describe("new exam", () => {
  test("online device preselected, offline one explained; point required; start opens the live exam", async () => {
    let sent: unknown;
    backend({
      ...common,
      "POST /api/exams": (init) => {
        sent = bodyOf(init);
        return { status: 201, body: exam({ id: 31 }) };
      },
      "GET /api/exams/31": () => ok(exam({ id: 31 })),
    });
    const router = renderAt("/doctor/patients/12/exam");
    const user = userEvent.setup();

    const online = await screen.findByRole("radio", { name: /MurMur #1/ });
    expect(online).toBeChecked();
    expect(screen.getByRole("radio", { name: /MurMur #2/ })).toBeDisabled();
    expect(screen.getByText("Never connected")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Start recording" }));
    expect(screen.getByText("Choose where the stethoscope is placed.")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /AV/ })).toHaveFocus();

    await user.click(screen.getByRole("radio", { name: "MV — mitral valve" }));
    await user.click(screen.getByRole("button", { name: "Start recording" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/doctor/exams/31"));
    expect(sent).toEqual({ patient_id: 12, device_id: 1, point: "MV" });
    expect(await screen.findByText("Sending the command to MurMur #1…")).toBeInTheDocument();
  });

  test("arrow keys move between the chest points", async () => {
    backend({ ...common });
    renderAt("/doctor/patients/12/exam");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("radio", { name: /^AV/ }));
    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("radio", { name: /^PV/ })).toBeChecked();
  });

  test("without consent the exam cannot start and the page says why", async () => {
    backend({ ...common, "GET /api/patients/12": () => ok({ ...patient, consent_given_at: null }) });
    renderAt("/doctor/patients/12/exam");

    expect(await screen.findByRole("heading", { name: "Consent is not recorded" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start recording" })).not.toBeInTheDocument();
  });
});

describe("live exam", () => {
  test.each([
    [exam({ status: "waiting" }), "Sending the command to MurMur #1…", "Command sent"],
    [exam({ status: "recording", updated_at: ago(5) }), "Recording", "Recording"],
    [exam({ status: "uploaded" }), "Checking quality and analysing…", "Quality and AI"],
    [exam({ status: "analyzed" }), "Ready for your review", null],
  ])("%#: each status has its own screen and step", async (data, title, currentStep) => {
    backend({ ...common, "GET /api/exams/7": () => ok(data) });
    renderAt("/doctor/exams/7");

    expect(await screen.findByRole("heading", { level: 2, name: title })).toBeInTheDocument();
    const step = screen.getByRole("list", { name: "Exam progress" }).querySelector('[aria-current="step"]');
    if (currentStep) expect(step).toHaveTextContent(currentStep);
    else expect(step).toBeNull();
  });

  test("recording shows the seconds left, computed from the server's start time", async () => {
    backend({ ...common, "GET /api/exams/7": () => ok(exam({ status: "recording", updated_at: ago(5) })) });
    renderAt("/doctor/exams/7");

    expect(await screen.findByText(/^1[45] s$/)).toBeInTheDocument();
  });

  test("the page follows the exam by itself: waiting → recording → analysing → ready", async () => {
    const sequence = [
      exam({ status: "waiting" }),
      exam({ status: "recording", updated_at: ago(0) }),
      exam({ status: "uploaded" }),
      exam({ status: "analyzed" }),
    ];
    let call = 0;
    backend({ ...common, "GET /api/exams/7": () => ok(sequence[Math.min(call++, sequence.length - 1)]) });
    renderAt("/doctor/exams/7");

    expect(await screen.findByRole("heading", { name: /Sending the command/ })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Recording" }, { timeout: 3000 })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: /Checking quality/ }, { timeout: 3000 })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Ready for your review" }, { timeout: 3000 })).toBeInTheDocument();
    const callsAtEnd = call;
    await new Promise((r) => setTimeout(r, 1600));
    expect(call).toBe(callsAtEnd); // polling stopped at a final state
  }, 15_000);

  test("a device that does not respond: hints and a cancel that ends the exam", async () => {
    let current = exam({ status: "waiting", created_at: ago(20) });
    backend({
      ...common,
      "GET /api/exams/7": () => ok(current),
      "POST /api/exams/7/cancel": () => {
        current = exam({ status: "failed", failure_reason: "cancelled by doctor" });
        return ok(current);
      },
    });
    renderAt("/doctor/exams/7");
    const user = userEvent.setup();

    expect(await screen.findByRole("heading", { name: "The device is not responding" })).toBeInTheDocument();
    expect(screen.getByText(/connected to this laptop's Wi-Fi hotspot/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel exam" }));

    expect(await screen.findByRole("heading", { name: "Exam cancelled" })).toBeInTheDocument();
    expect(screen.getByText("You cancelled this exam before a recording arrived.")).toBeInTheDocument();
  });

  test("a failed recording explains why in the user's words and records again with one click", async () => {
    let sent: unknown;
    backend({
      ...common,
      "GET /api/exams/7": () =>
        ok(exam({ status: "failed", failure_reason: "re-record: too short (6.6 s, need at least 10 s)" })),
      "POST /api/exams": (init) => {
        sent = bodyOf(init);
        return { status: 201, body: exam({ id: 8 }) };
      },
      "GET /api/exams/8": () => ok(exam({ id: 8 })),
    });
    const router = renderAt("/doctor/exams/7");
    const user = userEvent.setup();

    expect(await screen.findByText("Too short: 6.6 s, at least 10 s are needed.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Record again" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/doctor/exams/8"));
    expect(sent).toEqual({ patient_id: 12, device_id: 1, point: "MV" });
  });

  test("a lost connection keeps the screen and says it is reconnecting", async () => {
    let call = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = new URL(String(input), "http://localhost").pathname;
      if (path === "/api/exams/7" && call++ > 0) throw new TypeError("Failed to fetch");
      const body =
        path === "/api/exams/7"
          ? exam({ status: "waiting" })
          : path === "/api/patients/12"
            ? patient
            : path === "/api/devices"
              ? devices
              : { id: 1, username: "dr", role: "doctor", full_name: "Aziz Karimov" };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    renderAt("/doctor/exams/7");

    expect(await screen.findByRole("heading", { name: /Sending the command/ })).toBeInTheDocument();
    expect(await screen.findByText(/Reconnecting/, {}, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Sending the command/ })).toBeInTheDocument();
  }, 15_000);
});

test("the live area announces changes politely to screen readers", async () => {
  backend({ ...common, "GET /api/exams/7": () => ok(exam({ status: "uploaded" })) });
  renderAt("/doctor/exams/7");

  const heading = await screen.findByRole("heading", { level: 2 });
  expect(heading.closest("[aria-live]")).toHaveAttribute("aria-live", "polite");
  expect(within(screen.getByRole("list", { name: "Exam progress" })).getAllByRole("listitem")).toHaveLength(4);
});

test("numbers inside a failure reason follow the language (6,6 s in Russian)", async () => {
  const i18n = (await import("../../../i18n")).default;
  await i18n.changeLanguage("ru");
  backend({
    ...common,
    "GET /api/exams/7": () => ok(exam({ status: "failed", failure_reason: "re-record: too short (6.6 s, need at least 10 s)" })),
  });
  renderAt("/doctor/exams/7");

  expect(await screen.findByText("Слишком коротко: 6,6 с, нужно не меньше 10 с.")).toBeInTheDocument();
  await i18n.changeLanguage("en");
});

test("the step track never claims steps that did not happen", async () => {
  backend({ ...common, "GET /api/exams/7": () => ok(exam({ status: "failed", failure_reason: "cancelled by doctor" })) });
  renderAt("/doctor/exams/7");

  await screen.findByRole("heading", { name: "Exam cancelled" });
  const steps = within(screen.getByRole("list", { name: "Exam progress" })).getAllByRole("listitem").map((li) => li.textContent);
  expect(steps).toEqual(["Done: Command sent", "Stopped here: Recording", "Next: Quality and AI", "Next: Result"]);
});

test("chest point targets (44 px) never overlap, even at the smallest drawing size", async () => {
  const { POINTS, MIN_DIAGRAM_WIDTH } = await import("./ChestPointPicker");
  const width = MIN_DIAGRAM_WIDTH;
  const height = (width * 6) / 5;
  const boxes = POINTS.map(({ x, y }) => ({ cx: (x / 100) * width, cy: (y / 100) * height }));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const apart = Math.abs(boxes[i].cx - boxes[j].cx) >= 44 || Math.abs(boxes[i].cy - boxes[j].cy) >= 44;
      expect(apart, `${POINTS[i].point}-${POINTS[j].point}`).toBe(true);
    }
  }
});

test("the 20 s sweep keeps its start: re-renders every 250 ms do not push it ahead", async () => {
  backend({ ...common, "GET /api/exams/7": () => ok(exam({ status: "recording", updated_at: ago(5) })) });
  renderAt("/doctor/exams/7");

  await screen.findByRole("heading", { name: "Recording" });
  const sweep = () => document.querySelector<HTMLElement>('[style*="sweep"]')!;
  const first = sweep().style.animationDelay;
  expect(Number.parseFloat(first)).toBeCloseTo(-5, 0);
  await new Promise((r) => setTimeout(r, 700)); // the countdown re-rendered a few times
  expect(sweep().style.animationDelay).toBe(first);
});
