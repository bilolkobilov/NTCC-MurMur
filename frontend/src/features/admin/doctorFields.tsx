import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";

export const USERNAME = /^[A-Za-z0-9._-]{3,64}$/;
export const MIN_PASSWORD = 8; // backend NewPassword

/** A readable random password (no look-alike characters), for the admin to hand to the doctor. */
export function generatePassword(length = 12): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/** Password input with a "Generate" button, shared by "add doctor" and "reset password". */
export function PasswordField({
  value,
  onChange,
  error,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-end gap-2">
      <TextField
        ref={inputRef}
        className="flex-1"
        label={t("login.password")}
        required
        autoComplete="new-password"
        spellCheck={false}
        translate="no"
        hint={t("doctors.passwordRule", { min: MIN_PASSWORD })}
        error={error}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <Button className="mb-[22px] shrink-0" onClick={() => onChange(generatePassword())}>
        {t("doctors.generate")}
      </Button>
    </div>
  );
}
