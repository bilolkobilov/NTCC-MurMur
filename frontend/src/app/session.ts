/**
 * The login session: access token + role, kept in sessionStorage (closes with the tab).
 * A tiny external store so React (useSyncExternalStore) and the API client share one source of truth.
 */
import { useSyncExternalStore } from "react";

export type Role = "admin" | "doctor" | "patient";
export type Session = { token: string; role: Role; mustChangePassword: boolean };
/** Why the user is on the login page, shown once there. */
export type EndReason = "expired" | "loggedOut" | null;

const KEY = "murmur.session";
const listeners = new Set<() => void>();
let current: Session | null = load();
let endReason: EndReason = null;

function load(): Session | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function save(session: Session | null): void {
  try {
    if (session) sessionStorage.setItem(KEY, JSON.stringify(session));
    else sessionStorage.removeItem(KEY);
  } catch {
    // storage blocked: the session still lives in memory for this page
  }
}

function set(session: Session | null): void {
  current = session;
  save(session);
  listeners.forEach((listener) => listener());
}

export const session = {
  get: (): Session | null => current,
  start(next: Session): void {
    endReason = null;
    set(next);
  },
  /** Password changed: new token, no forced change any more. */
  replaceToken(token: string): void {
    if (current) set({ ...current, token, mustChangePassword: false });
  },
  requirePasswordChange(): void {
    if (current && !current.mustChangePassword) set({ ...current, mustChangePassword: true });
  },
  end(reason: Exclude<EndReason, null>): void {
    endReason = reason;
    set(null);
  },
  /** Read once: the login page shows the message, then it is gone. */
  takeEndReason(): EndReason {
    const reason = endReason;
    endReason = null;
    return reason;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useSession(): Session | null {
  return useSyncExternalStore(session.subscribe, session.get, session.get);
}

/** Where each role lands after login. */
export function homePath(role: Role): string {
  return { admin: "/admin", doctor: "/doctor", patient: "/patient" }[role];
}
