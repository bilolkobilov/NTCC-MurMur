import { session } from "../app/session";
import { api, ApiError, errorMessage } from "./client";

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  session.end("loggedOut");
  session.takeEndReason();
});

test("sends the token and parses JSON", async () => {
  session.start({ token: "abc", role: "doctor", mustChangePassword: false });
  const fetchMock = respond(200, { ok: true });

  await expect(api("/patients")).resolves.toEqual({ ok: true });

  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe("/api/patients");
  expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer abc");
});

test("a 401 on an authenticated call ends the session as expired", async () => {
  session.start({ token: "old", role: "doctor", mustChangePassword: false });
  respond(401, { detail: "invalid or expired token" });

  await expect(api("/auth/me")).rejects.toBeInstanceOf(ApiError);

  expect(session.get()).toBeNull();
  expect(session.takeEndReason()).toBe("expired");
});

test("a 401 from the login form itself does not touch the session", async () => {
  respond(401, { detail: "wrong username or password" });

  const error = await api("/auth/login", { body: {} }).catch((e) => e);

  expect(errorMessage(error)).toEqual({ key: "errors.wrongCredentials" });
  expect(session.takeEndReason()).toBeNull();
});

test("403 'password change required' sends the user to change the password", async () => {
  session.start({ token: "t", role: "patient", mustChangePassword: false });
  respond(403, { detail: "password change required" });

  await api("/me").catch(() => undefined);

  expect(session.get()?.mustChangePassword).toBe(true);
});

test("429 turns Retry-After into whole minutes", async () => {
  respond(429, { detail: "too many wrong passwords, try again in 61 seconds" }, { "Retry-After": "61" });

  const error = await api("/auth/login", { body: {} }).catch((e) => e);

  expect(errorMessage(error)).toEqual({ key: "errors.tooManyAttempts", values: { minutes: 2 } });
});

test("no connection, validation errors and server errors get their own messages", async () => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
  expect(errorMessage(await api("/x").catch((e) => e))).toEqual({ key: "errors.network" });

  vi.restoreAllMocks();
  respond(422, { detail: [{ loc: ["body", "new_password"], msg: "too short" }] });
  expect(errorMessage(await api("/x").catch((e) => e))).toEqual({ key: "errors.invalidInput" });

  vi.restoreAllMocks();
  respond(500, { detail: "Internal Server Error" });
  expect(errorMessage(await api("/x").catch((e) => e))).toEqual({ key: "errors.server" });

  expect(errorMessage(new Error("boom"))).toEqual({ key: "errors.unknown" });
});

test("204 resolves to undefined", async () => {
  respond(204, undefined);
  await expect(api("/x", { method: "DELETE" })).resolves.toBeUndefined();
});
