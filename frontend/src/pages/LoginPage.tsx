import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
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

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const current = useSession();
  const [endReason] = useState(() => session.takeEndReason());
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

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
    if (!mutation.isPending) mutation.mutate();
  };
  const failure = mutation.isError ? errorMessage(mutation.error) : null;

  return (
    <AuthLayout>
      <h1 className="text-2xl font-semibold tracking-tight">{t("login.title")}</h1>
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4" noValidate>
        {endReason === "expired" && <Alert>{t("login.sessionEnded")}</Alert>}
        {endReason === "loggedOut" && <Alert tone="clear">{t("login.loggedOut")}</Alert>}
        {failure && <Alert tone="danger">{t(failure.key, failure.values ?? {})}</Alert>}
        <TextField
          label={t("login.username")}
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <TextField
          label={t("login.password")}
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button
          type="submit"
          variant="primary"
          busy={mutation.isPending}
          busyText={t("login.submitting")}
          disabled={!username.trim() || !password}
          className="mt-2 w-full"
        >
          {t("login.submit")}
        </Button>
        <p className="text-xs text-ink-500">{t("login.noSignup")}</p>
      </form>
    </AuthLayout>
  );
}
