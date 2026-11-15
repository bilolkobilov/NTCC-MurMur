/**
 * The only place that talks HTTP to the backend (same origin, paths start with /api).
 * - adds the Bearer token
 * - 401 on an authenticated call → the session ends ("expired"); the router sends the user to login
 * - 403 "password change required" → the router sends the user to the change-password page
 * - every failure becomes an ApiError; `errorMessage()` turns it into words in the user's language
 */
import { session } from "../app/session";

export class ApiError extends Error {
  readonly status: number; // 0 = no connection
  readonly detail: string;
  readonly retryAfterSeconds?: number;
  /** Wrong-password tries left before the login is paused (`X-Attempts-Left` on a failed login). */
  readonly attemptsLeft?: number;

  constructor(status: number, detail: string, retryAfterSeconds?: number, attemptsLeft?: number) {
    super(`${status} ${detail}`);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    this.retryAfterSeconds = retryAfterSeconds;
    this.attemptsLeft = attemptsLeft;
  }
}

type Options = { method?: string; body?: unknown; signal?: AbortSignal };

function readDetail(payload: unknown, fallback: string): string {
  const detail = (payload as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return "validation"; // FastAPI 422: list of field errors
  return fallback;
}

/** One request with the token; every failure (no connection, 4xx/5xx) becomes an ApiError. */
async function send(path: string, options: Options, accept: string): Promise<Response> {
  const token = session.get()?.token;
  const headers: Record<string, string> = { Accept: accept };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "network");
  }
  if (response.ok) return response;

  const payload = await response.json().catch(() => null);
  const detail = readDetail(payload, response.statusText);
  const retryAfter = Number(response.headers.get("Retry-After")) || undefined;

  if (response.status === 401 && token) session.end("expired");
  if (response.status === 403 && detail === "password change required") session.requirePasswordChange();
  const left = response.headers.get("X-Attempts-Left");
  throw new ApiError(response.status, detail, retryAfter, left === null ? undefined : Number(left));
}

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const response = await send(path, options, "application/json");
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** A file behind the login (e.g. the exam's WAV): fetched with the token, never put in a URL. */
export async function apiBlob(path: string, options: Options = {}): Promise<Blob> {
  return (await send(path, options, "*/*")).blob();
}

/** i18n key + values for a failure. Backend details are matched here, in one place. */
export function errorMessage(error: unknown): { key: string; values?: Record<string, unknown> } {
  if (!(error instanceof ApiError)) return { key: "errors.unknown" };
  const byDetail: Record<string, string> = {
    "wrong username or password": "errors.wrongCredentials",
    "account is blocked": "errors.blocked",
    "current password is wrong": "errors.currentPasswordWrong",
    "new password must be different": "errors.passwordSame",
  };
  if (byDetail[error.detail]) return { key: byDetail[error.detail] };
  if (error.status === 0) return { key: "errors.network" };
  if (error.status === 429) {
    const minutes = Math.max(1, Math.ceil((error.retryAfterSeconds ?? 60) / 60));
    return { key: "errors.tooManyAttempts", values: { minutes } };
  }
  if (error.status === 422) return { key: "errors.invalidInput" };
  if (error.status === 404) return { key: "errors.notFound" };
  if (error.status === 409) return { key: "errors.conflict" };
  if (error.status === 403) return { key: "errors.forbidden" };
  if (error.status >= 500) return { key: "errors.server" };
  return { key: "errors.unknown" };
}
