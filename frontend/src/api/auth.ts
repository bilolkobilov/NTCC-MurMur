import type { Role } from "../app/session";
import { api } from "./client";

export type TokenResponse = { access_token: string; token_type: string; role: Role; must_change_password: boolean };
export type Account = { id: number; username: string; role: Role; full_name: string; clinic?: string | null };

export const login = (username: string, password: string, role: Role) =>
  api<TokenResponse>("/auth/login", { body: { username, password, role } });

export const changePassword = (currentPassword: string, newPassword: string) =>
  api<TokenResponse>("/auth/change-password", {
    body: { current_password: currentPassword, new_password: newPassword },
  });

export const me = () => api<Account>("/auth/me");

/** Administrators sign in through their own endpoint (page: /login/admin). */
export const loginAdmin = (username: string, password: string) =>
  api<TokenResponse>("/auth/admin/login", { body: { username, password } });
