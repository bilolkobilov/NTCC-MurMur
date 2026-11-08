import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useRef, useState } from "react";
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

type Problems = { current?: string; password?: string; repeat?: string };

export function ChangePasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const current = useSession();
  const firstTime = !!current?.mustChangePassword;
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [problems, setProblems] = useState<Problems>({});
  const currentRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const repeatRef = useRef<HTMLInputElement>(null);

  const mutation = useMutation({
    mutationFn: () => changePassword(currentPassword, password),
    onSuccess: (result) => {
      session.replaceToken(result.access_token); // every older token is dead now
      if (firstTime) navigate(homePath(result.role), { replace: true });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (mutation.isPending) return;
    const passwordProblem = newPasswordProblem(password, repeat);
    const found: Problems = {
      current: currentPassword
        ? undefined
        : t(firstTime ? "changePassword.oneTimeRequired" : "changePassword.currentRequired"),
      password: passwordProblem && passwordProblem !== "changePassword.mismatch" ? t(passwordProblem) : undefined,
      repeat: passwordProblem === "changePassword.mismatch" ? t(passwordProblem) : undefined,
    };
    setProblems(found);
    if (found.current) return currentRef.current?.focus();
    if (found.password) return passwordRef.current?.focus();
    if (found.repeat) return repeatRef.current?.focus();
    mutation.mutate();
  };
  const failure = mutation.isError ? errorMessage(mutation.error) : null;

  return (
    <AuthLayout>
      <h1 className="text-headline font-semibold">
        {firstTime ? t("changePassword.firstTimeTitle") : t("changePassword.title")}
      </h1>
      {firstTime && <p className="mt-2 text-ink-500">{t("changePassword.firstTimeHint")}</p>}
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4" noValidate>
        {failure && <Alert tone="danger">{t(failure.key, failure.values ?? {})}</Alert>}
        {mutation.isSuccess && !firstTime && <Alert tone="clear">{t("changePassword.saved")}</Alert>}
        <TextField
          ref={currentRef}
          label={firstTime ? t("changePassword.currentOneTime") : t("changePassword.current")}
          type="password"
          autoComplete="current-password"
          required
          error={problems.current}
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
        <TextField
          ref={passwordRef}
          label={t("changePassword.new")}
          type="password"
          autoComplete="new-password"
          required
          hint={t("changePassword.rules")}
          error={problems.password}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <TextField
          ref={repeatRef}
          label={t("changePassword.repeat")}
          type="password"
          autoComplete="new-password"
          required
          error={problems.repeat}
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
        />
        <Button
          type="submit"
          variant="primary"
          busy={mutation.isPending}
          busyText={t("changePassword.submitting")}
          className="mt-2 w-full"
        >
          {t("changePassword.submit")}
        </Button>
        {!firstTime && current && (
          <Link
            to={homePath(current.role)}
            className="text-center text-label text-ink-500 underline-offset-4 hover:text-ink-900 hover:underline"
          >
            {t("pages.goHome")}
          </Link>
        )}
      </form>
    </AuthLayout>
  );
}
