import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";

import { changePassword } from "../api/auth";
import { errorMessage } from "../api/client";
import { homePath, session, useSession } from "../app/session";
import { AuthLayout } from "../components/layout/AuthLayout";
import { Alert } from "../components/ui/Alert";
import { Button } from "../components/ui/Button";
import { TextField } from "../components/ui/TextField";

const MIN = 8;
const MAX_BYTES = 72; // bcrypt limit, same rule as the backend

/** Returns an i18n key for the first problem with the new password, or null. */
export function newPasswordProblem(password: string, repeat: string): string | null {
  if (password.length < MIN) return "changePassword.tooShort";
  if (new TextEncoder().encode(password).length > MAX_BYTES) return "changePassword.tooLong";
  if (password !== repeat) return "changePassword.mismatch";
  return null;
}

export function ChangePasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const current = useSession();
  const firstTime = !!current?.mustChangePassword;
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => changePassword(currentPassword, password),
    onSuccess: (result) => {
      session.replaceToken(result.access_token); // every older token is dead now
      if (firstTime) navigate(homePath(result.role), { replace: true });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = newPasswordProblem(password, repeat);
    setProblem(found);
    if (!found && !mutation.isPending) mutation.mutate();
  };
  const failure = mutation.isError ? errorMessage(mutation.error) : null;

  return (
    <AuthLayout>
      <h1 className="text-2xl font-semibold tracking-tight text-balance">
        {firstTime ? t("changePassword.firstTimeTitle") : t("changePassword.title")}
      </h1>
      {firstTime && <p className="mt-2 text-sm text-ink-500 text-pretty">{t("changePassword.firstTimeHint")}</p>}
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4" noValidate>
        {failure && <Alert tone="danger">{t(failure.key, failure.values ?? {})}</Alert>}
        {mutation.isSuccess && !firstTime && <Alert tone="clear">{t("changePassword.saved")}</Alert>}
        <TextField
          label={firstTime ? t("changePassword.currentOneTime") : t("changePassword.current")}
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
        <TextField
          label={t("changePassword.new")}
          type="password"
          autoComplete="new-password"
          hint={t("changePassword.rules")}
          error={problem && problem !== "changePassword.mismatch" ? t(problem) : undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <TextField
          label={t("changePassword.repeat")}
          type="password"
          autoComplete="new-password"
          error={problem === "changePassword.mismatch" ? t(problem) : undefined}
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
        />
        <Button
          type="submit"
          variant="primary"
          busy={mutation.isPending}
          busyText={t("changePassword.submitting")}
          disabled={!currentPassword || !password || !repeat}
          className="mt-2 w-full"
        >
          {t("changePassword.submit")}
        </Button>
        {!firstTime && current && (
          <Link to={homePath(current.role)} className="text-center text-sm text-ink-500 underline-offset-4 hover:underline">
            {t("pages.goHome")}
          </Link>
        )}
      </form>
    </AuthLayout>
  );
}
