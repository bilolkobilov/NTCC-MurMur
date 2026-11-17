import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate, useSearchParams } from "react-router";

import { login, loginAdmin } from "../api/auth";
import { ApiError, errorMessage } from "../api/client";
import { nextFor, safeNext } from "../app/guards";
import { homePath, type Role, session, useSession } from "../app/session";
import {
  AuthAlert,
  AuthButton,
  AuthField,
  AuthSegmented,
} from "../components/auth/AuthControls";
import { AuthLayout } from "../components/layout/AuthLayout";

type Problems = { username?: string; password?: string };

/** The roles on the public card. Administrators have their own page, /login/admin. */
const ROLES: Role[] = ["doctor", "patient"];

export function LoginPage({ admin = false }: { admin?: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const current = useSession();
  const [endReason] = useState(() => session.takeEndReason());
  const [chosen, setRole] = useState<Role>("doctor");
  const role: Role = admin ? "admin" : chosen;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [problems, setProblems] = useState<Problems>({});
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const mutation = useMutation({
    mutationFn: () =>
      admin
        ? loginAdmin(username.trim(), password)
        : login(username.trim(), password, role),
    onSuccess: (result) => {
      session.start({
        token: result.access_token,
        role: result.role,
        mustChangePassword: result.must_change_password,
      });
      if (result.must_change_password)
        navigate("/change-password", { replace: true });
      else navigate(nextFor(next, result.role), { replace: true });
    },
  });

  if (current && !mutation.isPending && !mutation.isSuccess) {
    return (
      <Navigate
        to={
          current.mustChangePassword
            ? "/change-password"
            : homePath(current.role)
        }
        replace
      />
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (mutation.isPending) return;
    const found: Problems = {
      username: username.trim() ? undefined : t("login.usernameRequired"),
      password: password ? undefined : t("login.passwordRequired"),
    };
    setProblems(found);
    if (found.username) return usernameRef.current?.focus();
    if (found.password) return passwordRef.current?.focus();
    mutation.mutate();
  };

  const pending = mutation.isPending;
  const error = mutation.isError ? mutation.error : null;
  const attemptsLeft =
    error instanceof ApiError && error.status === 401
      ? error.attemptsLeft
      : undefined;
  const failure =
    error && attemptsLeft === undefined ? errorMessage(error) : null;

  return (
    <AuthLayout>
      <div className="flex flex-col gap-2">
        <h1 className="text-headline font-semibold sm:text-display">
          {t("login.title")}
        </h1>
        <p className="text-body text-ink-700">{t(`login.sub.${role}`)}</p>
      </div>
      <form
        onSubmit={submit}
        className="flex flex-col gap-4"
        noValidate
        aria-label={t("login.title")}
      >
        {endReason === "expired" && (
          <AuthAlert tone="info">{t("login.sessionEnded")}</AuthAlert>
        )}
        {endReason === "loggedOut" && (
          <AuthAlert tone="success">{t("login.loggedOut")}</AuthAlert>
        )}
        {attemptsLeft !== undefined && (
          <AuthAlert tone="critical" title={t("login.failedTitle")}>
            {t("login.failedBody", { count: attemptsLeft })}
          </AuthAlert>
        )}
        {failure && (
          <AuthAlert tone="critical">
            {t(failure.key, failure.values ?? {})}
          </AuthAlert>
        )}
        {!admin && (
          <div className="flex items-center gap-3">
            <span className="text-caption text-ink-500">
              {t("login.roleLabel")}
            </span>
            <AuthSegmented
              label={t("login.roleLabel")}
              value={role}
              disabled={pending}
              onChange={setRole}
              options={ROLES.map((value) => ({
                value,
                label: t(`roles.${value}`),
              }))}
            />
          </div>
        )}
        <AuthField
          ref={usernameRef}
          label={t(`login.identity.${role}`)}
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          translate="no"
          disabled={pending}
          error={problems.username}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <AuthField
          ref={passwordRef}
          label={t("login.password")}
          name="password"
          type="password"
          autoComplete="current-password"
          disabled={pending}
          reveal={{
            show: t("login.showPassword"),
            hide: t("login.hidePassword"),
          }}
          error={problems.password}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <AuthButton
          type="submit"
          busy={pending}
          busyText={t("login.submitting")}
        >
          {t("login.title")}
        </AuthButton>
        {pending && (
          <p role="status" className="text-center text-caption text-ink-500">
            {t("login.verifying")}
          </p>
        )}
        {!admin && (
          <p className="text-center text-caption text-ink-500">
            {t("login.noSignup")}
          </p>
        )}
      </form>
    </AuthLayout>
  );
}
