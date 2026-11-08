import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate, useSearchParams } from "react-router";

import { login } from "../api/auth";
import { errorMessage } from "../api/client";
import { nextFor, safeNext } from "../app/guards";
import { homePath, session, useSession } from "../app/session";
import { AuthLayout } from "../components/layout/AuthLayout";
import { Alert } from "../components/ui/Alert";
import { Button } from "../components/ui/Button";
import { TextField } from "../components/ui/TextField";

type Problems = { username?: string; password?: string };

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const current = useSession();
  const [endReason] = useState(() => session.takeEndReason());
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [problems, setProblems] = useState<Problems>({});
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const mutation = useMutation({
    mutationFn: () => login(username.trim(), password),
    onSuccess: (result) => {
      session.start({ token: result.access_token, role: result.role, mustChangePassword: result.must_change_password });
      if (result.must_change_password) navigate("/change-password", { replace: true });
      else navigate(nextFor(next, result.role), { replace: true });
    },
  });

  if (current && !mutation.isPending && !mutation.isSuccess) {
    return <Navigate to={current.mustChangePassword ? "/change-password" : homePath(current.role)} replace />;
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
  const failure = mutation.isError ? errorMessage(mutation.error) : null;

  return (
    <AuthLayout>
      <h1 className="text-headline font-semibold">{t("login.title")}</h1>
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4" noValidate>
        {endReason === "expired" && <Alert>{t("login.sessionEnded")}</Alert>}
        {endReason === "loggedOut" && <Alert tone="clear">{t("login.loggedOut")}</Alert>}
        {failure && <Alert tone="danger">{t(failure.key, failure.values ?? {})}</Alert>}
        <TextField
          ref={usernameRef}
          label={t("login.username")}
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          translate="no"
          required
          error={problems.username}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <TextField
          ref={passwordRef}
          label={t("login.password")}
          name="password"
          type="password"
          autoComplete="current-password"
          required
          error={problems.password}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button
          type="submit"
          variant="primary"
          busy={mutation.isPending}
          busyText={t("login.submitting")}
          className="mt-2 w-full"
        >
          {t("login.submit")}
        </Button>
        <p className="text-caption text-ink-500">{t("login.noSignup")}</p>
      </form>
    </AuthLayout>
  );
}
