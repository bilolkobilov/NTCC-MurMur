import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";

import { NotAvailablePage } from "../pages/StatusPages";
import { homePath, type Role, useSession } from "./session";

/** Logged in, password already changed, and the right role — otherwise send the user where they belong. */
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const current = useSession();
  const location = useLocation();
  if (!current) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  if (current.mustChangePassword) return <Navigate to="/change-password" replace />;
  if (current.role !== role) return <NotAvailablePage />;
  return children;
}

/** Any logged-in user (e.g. change password). */
export function RequireSession({ children }: { children: ReactNode }) {
  const current = useSession();
  if (!current) return <Navigate to="/login" replace />;
  return children;
}

/** "/" → the role's home, or login. */
export function HomeRedirect() {
  const current = useSession();
  if (!current) return <Navigate to="/login" replace />;
  if (current.mustChangePassword) return <Navigate to="/change-password" replace />;
  return <Navigate to={homePath(current.role)} replace />;
}

/** After login: go back to ?next= only if it belongs to this role's area (e.g. after a patient logged out on a
 * shared laptop, a doctor logging in must not land on /patient); otherwise the role's home. */
export function nextFor(next: string | null, role: Role): string {
  const home = homePath(role);
  return next && (next === home || next.startsWith(`${home}/`)) ? next : home;
}

/** Only a path inside this site may be used as ?next= (no open redirect to other hosts). */
export function safeNext(next: string | null): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  return next;
}
