import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { AIResult, EcgResult, ExamDetail, Patient } from "../../../api/doctor";
import { session } from "../../../app/session";
import { backend, bodyOf, ok, renderAt } from "../../../test/utils";
import { aiAnswered, aiOutcome } from "./aiOutcome";
import { ecgOutcome } from "./ecgOutcome";
import { gridScale, hexToRgb, PAPER_PX_PER_SEC, robustPeak } from "./HeartStrip";

// wavesurfer needs Web Audio and canvas, which jsdom lacks: a small fake records what the page asks of it.
const fake = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void;
  class FakeWaveSurfer {
    handlers: Record<string, Handler[]> = {};
    time = 0;
    playing = false;
    zooms: number[] = [];
    plugins: { options: Record<string, unknown>; destroy: () => void }[] = [];
    destroyed = false;
    blob: Blob | null = null;
    on(event: string, handler: Handler) {
      (this.handlers[event] ??= []).push(handler);
      return () => {};
    }
    emit(event: string, ...args: unknown[]) {
      this.handlers[event]?.forEach((handler) => handler(...args));
    }
    async loadBlob(blob: Blob) {
      this.blob = blob;
      this.emit("ready", 20);
    }
    getDuration = () => 20;
    getWrapper = () => ({ scrollWidth: 900 });
    zoom(pxPerSec: number) {
      this.zooms.push(pxPerSec);
    }
    setTime(seconds: number) {
      this.time = seconds;
      this.emit("timeupdate", seconds);
    }
    async playPause() {
      this.playing = !this.playing;
      this.emit(this.playing ? "play" : "pause");
    }
    registerPlugin<T extends { options: Record<string, unknown>; destroy: () => void }>(plugin: T) {
      this.plugins.push(plugin);
      return plugin;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  const instances: FakeWaveSurfer[] = [];
  return { FakeWaveSurfer, instances, last: () => instances[instances.length - 1] };
});
vi.mock("wavesurfer.js", () => ({
  default: {
    create: () => {
      const instance = new fake.FakeWaveSurfer();
      fake.instances.push(instance);
      return instance;
    },
  },
}));
vi.mock("wavesurfer.js/plugins/spectrogram", () => ({
  default: { create: (options: Record<string, unknown>) => ({ options, destroy: vi.fn() }) },
}));

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
const ai = (overrides: Partial<AIResult> = {}): AIResult => ({
  model_name: "cnn",
  model_version: "1.2",
  quality: "good",
  label: "murmur",
  score: 0.87,
  created_at: "2026-11-08T10:00:30Z",
  ...overrides,
});
function exam(overrides: Partial<ExamDetail> = {}): ExamDetail {
  return {
    id: 7,
    patient_id: 12,
    device_id: 1,
    point: "MV",
    status: "analyzed",
    created_at: "2026-11-08T10:00:00Z",
    reviewed_at: null,
    has_ecg: false,
    ecg_result: null,
    failure_reason: null,
    doctor_note: null,
    doctor_agrees_with_ai: null,
    updated_at: "2026-11-08T10:00:30Z",
    recording: { sample_rate: 4000, duration_s: 20, motion_detected: false, size_bytes: 160044, created_at: "2026-11-08T10:00:25Z" },
    ai_result: ai(),
    ...overrides,
  };
}
const common = {
  "GET /api/auth/me": me,
  "GET /api/patients/12": () => ok(patient),
  "GET /api/devices": () => ok([]),
  "GET /api/exams/7/audio": () => ok("RIFF"),
};

beforeEach(() => {
  fake.instances.length = 0;
  session.start({ token: "t", role: "doctor", mustChangePassword: false });
});
afterEach(() => {
  vi.restoreAllMocks();
  session.end("loggedOut");
  session.takeEndReason();
});

describe("AI outcome", () => {
  test.each([
    [ai(), "murmur", true],
    [ai({ label: "absent" }), "clear", true],
    [ai({ quality: "bad" }), "poorQuality", false], // too poor to judge, whatever the label says
    [ai({ label: "not_analyzed", quality: "unknown", score: null }), "unavailable", false],
    [null, "unavailable", false],
    [ai({ label: "S3" }), "other", false],
  ])("%#: %o → %s", (result, kind, answered) => {
    const outcome = aiOutcome(result);
    expect(outcome.kind).toBe(kind);
    expect(aiAnswered(outcome)).toBe(answered);
  });
});

test("one loud knock does not flatten the heartbeats", () => {
  const samples = new Float32Array(10_000).map((_, i) => 0.1 * Math.sin(i / 10));
  samples[5000] = 1; // a knock on the stethoscope
  expect(robustPeak(samples)).toBeCloseTo(0.1, 2);
  expect(robustPeak(new Float32Array())).toBe(0);
});

test("grid squares follow the real time scale", () => {
  expect(gridScale(PAPER_PX_PER_SEC)).toEqual({ majorS: 0.2, majorPx: 40, minorPx: 8, showMinor: true });
  expect(gridScale(45)).toMatchObject({ majorS: 1, majorPx: 45, showMinor: true }); // whole recording, laptop
  expect(gridScale(17)).toMatchObject({ majorS: 1, showMinor: false }); // whole recording, phone: no pink blur
});

describe("result and review", () => {
  test("murmur: the AI card, then agree + conclusion are required, then the saved conclusion is shown", async () => {
    let sent: unknown;
    let current = exam();
    const fetchSpy = backend({
      ...common,
      "GET /api/exams/7": () => ok(current),
      "PATCH /api/exams/7/review": (init) => {
        sent = bodyOf(init);
        current = exam({ status: "reviewed", doctor_note: "Systolic murmur.\nRefer to cardiology.", doctor_agrees_with_ai: true, reviewed_at: "2026-11-08T10:05:00Z" });
        return ok(current);
      },
    });
    renderAt("/doctor/exams/7");
    const user = userEvent.setup();

    expect(await screen.findByText("Murmur detected")).toBeInTheDocument();
    expect(screen.getByText("Murmur probability 87 %")).toBeInTheDocument();
    expect(screen.getByText("cnn 1.2")).toBeInTheDocument();
    expect(screen.getByText(/not a diagnosis/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Confirm review" }));
    expect(screen.getByText("Choose whether you agree with the AI.")).toBeInTheDocument();
    expect(screen.getByText("Write your conclusion.")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "I agree" })).toHaveFocus();
    expect(sent).toBeUndefined();

    await user.click(screen.getByRole("radio", { name: "I agree" }));
    await user.type(screen.getByLabelText("Conclusion"), "Systolic murmur.{Enter}Refer to cardiology.");
    await user.click(screen.getByRole("button", { name: "Confirm review" }));

    expect(await screen.findByText("You agreed with the AI")).toBeInTheDocument();
    expect(sent).toEqual({ note: "Systolic murmur.\nRefer to cardiology.", agrees_with_ai: true });
    expect(screen.getByText(/Refer to cardiology/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm review" })).not.toBeInTheDocument();

    // the recording was fetched with the login token, never through a public URL
    const audioCall = fetchSpy.mock.calls.find(([input]) => String(input).endsWith("/exams/7/audio"));
    expect(new Headers(audioCall?.[1]?.headers).get("Authorization")).toBe("Bearer t");
  });

  test("no AI answer (model not connected): no agree question, only the conclusion is sent", async () => {
    let sent: unknown;
    backend({
      ...common,
      "GET /api/exams/7": () => ok(exam({ ai_result: ai({ label: "not_analyzed", quality: "unknown", score: null, model_name: "dummy", model_version: "0.1.0" }) })),
      "PATCH /api/exams/7/review": (init) => {
        sent = bodyOf(init);
        return ok(exam({ status: "reviewed", doctor_note: "Normal.", reviewed_at: "2026-11-08T10:05:00Z" }));
      },
    });
    renderAt("/doctor/exams/7");
    const user = userEvent.setup();

    expect(await screen.findByText("No AI opinion")).toBeInTheDocument();
    expect(screen.getByText(/not connected yet/)).toBeInTheDocument();
    expect(screen.queryByText("Do you agree with the AI?")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Conclusion"), "  Normal.  ");
    await user.click(screen.getByRole("button", { name: "Confirm review" }));

    await waitFor(() => expect(sent).toEqual({ note: "Normal." }));
    expect(await screen.findByText("Normal.")).toBeInTheDocument();
    expect(screen.queryByText(/You (dis)?agreed/)).not.toBeInTheDocument();
  });

  test("reviewed already in another tab (409): the saved conclusion is shown with an explanation", async () => {
    let reviewedElsewhere = false;
    backend({
      ...common,
      "GET /api/exams/7": () =>
        ok(reviewedElsewhere ? exam({ status: "reviewed", doctor_note: "Written in the other tab.", doctor_agrees_with_ai: false, reviewed_at: "2026-11-08T10:04:00Z" }) : exam()),
      "PATCH /api/exams/7/review": () => {
        reviewedElsewhere = true;
        return { status: 409, body: { detail: "exam is 'reviewed', cannot become 'reviewed'" } };
      },
    });
    renderAt("/doctor/exams/7");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("radio", { name: "I disagree" }));
    await user.type(screen.getByLabelText("Conclusion"), "My note");
    await user.click(screen.getByRole("button", { name: "Confirm review" }));

    expect(await screen.findByText(/already reviewed, perhaps in another tab/)).toBeInTheDocument();
    expect(screen.getByText("Written in the other tab.")).toBeInTheDocument();
    expect(screen.getByText("You disagreed with the AI")).toBeInTheDocument();
  });

  test("poor quality: honest card with a way to record again", async () => {
    backend({ ...common, "GET /api/exams/7": () => ok(exam({ ai_result: ai({ quality: "bad" }) })) });
    renderAt("/doctor/exams/7");

    expect(await screen.findByText("Recording too poor to judge")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Record again" })).toHaveAttribute("href", "/doctor/patients/12/exam");
    expect(screen.queryByText("Do you agree with the AI?")).not.toBeInTheDocument();
  });

  test("leaving with an unsaved conclusion asks first", async () => {
    backend({ ...common, "GET /api/exams/7": () => ok(exam()) });
    const router = renderAt("/doctor/exams/7");
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Conclusion"), "Half written");
    await user.click(screen.getByRole("link", { name: /Ali Valiyev/ }));

    expect(await screen.findByRole("dialog", { name: "Leave without saving?" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/doctor/exams/7");
  });
});

describe("heart-sound strip", () => {
  test("play/pause, keyboard seeking, close-up zoom and spectrogram", async () => {
    backend({ ...common, "GET /api/exams/7": () => ok(exam()) });
    renderAt("/doctor/exams/7");
    const user = userEvent.setup();

    const play = await screen.findByRole("button", { name: "Play" });
    await waitFor(() => expect(play).toBeEnabled());
    const ws = fake.last();
    expect(await ws.blob?.text()).toBe('"RIFF"');
    expect(screen.getByText("1 big square = 1 s")).toBeInTheDocument(); // 900 px for 20 s: whole recording

    await user.click(play);
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();

    const strip = screen.getByRole("slider", { name: /Heart sound recording/ });
    fireEvent.keyDown(strip, { key: "ArrowRight" });
    expect(ws.time).toBe(0.5);
    fireEvent.keyDown(strip, { key: "ArrowRight", shiftKey: true });
    expect(ws.time).toBe(2.5);
    fireEvent.keyDown(strip, { key: "End" });
    expect(strip).toHaveAttribute("aria-valuenow", "20");
    expect(strip).toHaveAttribute("aria-valuetext", "0:20.0 of 0:20.0");

    await user.click(screen.getByRole("button", { name: "Close-up" }));
    expect(ws.zooms.at(-1)).toBe(PAPER_PX_PER_SEC);
    expect(screen.getByRole("button", { name: "Close-up" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Spectrogram" }));
    await waitFor(() => expect(ws.plugins).toHaveLength(1));
    expect(ws.plugins[0].options).toMatchObject({ frequencyMax: 1000, labels: true });
    await user.click(screen.getByRole("button", { name: "Spectrogram" }));
    expect(ws.plugins[0].destroy).toHaveBeenCalled();
  });

  test("a recording that cannot be loaded says so and can be retried", async () => {
    let fail = true;
    backend({
      ...common,
      "GET /api/exams/7": () => ok(exam()),
      "GET /api/exams/7/audio": () => (fail ? { status: 404, body: { detail: "recording not found" } } : ok("RIFF")),
    });
    renderAt("/doctor/exams/7");
    const user = userEvent.setup();

    expect(await screen.findByText(/could not be loaded/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
    fail = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Play" })).toBeEnabled());
  });

  test("the player is destroyed when the page is left", async () => {
    backend({ ...common, "GET /api/exams/7": () => ok(exam()) });
    const router = renderAt("/doctor/exams/7");
    await waitFor(() => expect(screen.getByRole("button", { name: "Play" })).toBeEnabled());

    await router.navigate("/doctor/patients/12");
    await waitFor(() => expect(fake.instances.every((ws) => ws.destroyed)).toBe(true));
  });
});

test("spectrogram colours read short and long hex (the CSS build writes white as #fff)", () => {
  expect(hexToRgb("#fff")).toEqual([1, 1, 1]);
  expect(hexToRgb("#c1121f")).toEqual([193 / 255, 18 / 255, 31 / 255]);
  expect(hexToRgb("oklch(0.5 0.1 20)")).toEqual([0, 0, 0]);
});

const ecgResult = (overrides: Partial<EcgResult> = {}): EcgResult => ({
  method_version: "ecg-rules 1.0",
  quality: "good",
  problem: null,
  channel: 1,
  heart_rate: 68,
  rr_cv: 0.04,
  beats: 22,
  rhythm_label: "no_af",
  rhythm_p_af: 0.03,
  rhythm_model_name: "ecg-rhythm",
  rhythm_model_version: "1.0.0",
  created_at: "2026-11-08T10:00:31Z",
  ...overrides,
});
const trace = { sample_rate: 250, channel: 1, samples_mv: Array.from({ length: 5000 }, (_, i) => Math.sin(i / 20)), r_peaks_s: [0.4, 1.3, 2.2] };

describe("ECG outcome", () => {
  test.each([
    [ecgResult(), "measured"],
    [ecgResult({ quality: "bad", problem: "lead_off", heart_rate: null }), "cannotJudge"],
    [ecgResult({ quality: "bad", problem: "something new", heart_rate: null }), "cannotJudge"],
    [null, "pending"],
  ])("%#: → %s", (result, kind) => {
    expect(ecgOutcome(result).kind).toBe(kind);
  });

  test("an unknown problem code is shown as unknown, never as a number", () => {
    expect(ecgOutcome(ecgResult({ quality: "bad", problem: "xyz", heart_rate: null }))).toEqual({
      kind: "cannotJudge",
      problem: "unknown",
    });
  });
});

describe("ECG card", () => {
  test("heart rate, rhythm and the strip with its heartbeats, under the sound", async () => {
    backend({ ...common, "GET /api/exams/7": () => ok(exam({ has_ecg: true, ecg_result: ecgResult() })), "GET /api/exams/7/ecg": () => ok(trace) });
    renderAt("/doctor/exams/7");

    const card = await screen.findByRole("region", { name: "ECG" });
    expect(card).toHaveTextContent("68");
    expect(card).toHaveTextContent("No atrial fibrillation found");
    expect(card).toHaveTextContent("Model: ecg-rhythm 1.0.0");
    expect(await screen.findByRole("img", { name: "ECG strip, 20 seconds, 3 beats" })).toBeInTheDocument();
  });

  test("AF suspected asks for a 12-lead confirmation", async () => {
    const result = ecgResult({ rhythm_label: "af_suspected", rhythm_p_af: 0.81 });
    backend({ ...common, "GET /api/exams/7": () => ok(exam({ has_ecg: true, ecg_result: result })), "GET /api/exams/7/ecg": () => ok(trace) });
    renderAt("/doctor/exams/7");

    const card = await screen.findByRole("region", { name: "ECG" });
    expect(card).toHaveTextContent("Atrial fibrillation suspected. Confirm with a 12-lead ECG.");
    expect(card).toHaveTextContent("AF probability 81 %");
  });

  test("a poor ECG says why it cannot be judged and shows no heart rate", async () => {
    const result = ecgResult({ quality: "bad", problem: "lead_off", heart_rate: null, rr_cv: null, rhythm_label: null });
    backend({ ...common, "GET /api/exams/7": () => ok(exam({ has_ecg: true, ecg_result: result })), "GET /api/exams/7/ecg": () => ok(trace) });
    renderAt("/doctor/exams/7");

    const card = await screen.findByRole("region", { name: "ECG" });
    expect(card).toHaveTextContent("The ECG cannot be judged. An electrode came off");
    expect(card).not.toHaveTextContent("Heart rate");
  });

  test("an exam without ECG says so in one quiet line", async () => {
    backend({ ...common, "GET /api/exams/7": () => ok(exam()) });
    renderAt("/doctor/exams/7");

    expect(await screen.findByText(/No ECG was recorded with this exam/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "ECG" })).not.toBeInTheDocument();
  });
});

test("a broken ECG from the device: the card says why, and no strip is fetched", async () => {
  const result = ecgResult({ quality: "bad", problem: "invalid", heart_rate: null, rr_cv: null, rhythm_label: null, channel: null });
  const fetchSpy = backend({ ...common, "GET /api/exams/7": () => ok(exam({ has_ecg: false, ecg_result: result })) });
  renderAt("/doctor/exams/7");

  const card = await screen.findByRole("region", { name: "ECG" });
  expect(card).toHaveTextContent("The device sent a broken or too short ECG");
  expect(card).toHaveTextContent("The sound was kept.");
  expect(fetchSpy.mock.calls.some(([url]) => String(url).endsWith("/ecg"))).toBe(false);
});
