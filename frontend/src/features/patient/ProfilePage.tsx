import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";

import { errorMessage } from "../../api/client";
import { type ContactUpdate, type MyProfile, patientApi } from "../../api/patient";
import { ErrorState, SkeletonRows } from "../../components/ui/States";
import { ageFromBirthYear, formatDate, initials } from "../../lib/format";
import { Avatar, Button, ButtonLink, DAlert, DCard, FormField, KvRow } from "../../redesign/components";

type Fields = { [K in keyof ContactUpdate]-?: string };
const PHONE = /^[0-9+()\- ]{5,32}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const fieldsOf = (p: MyProfile): Fields => ({
  phone: p.phone ?? "",
  email: p.email ?? "",
  city: p.city ?? "",
  emergency_contact_name: p.emergency_contact_name ?? "",
  emergency_contact_phone: p.emergency_contact_phone ?? "",
});

/**
 * The patient's profile (design "Patient profile"). Name, birth year, sex and clinic are managed by the clinic and
 * only shown; the five contact fields are the patient's own and are saved with `PATCH /api/me`. The interface
 * language is the switch in the header, not a stored setting.
 */
export function ProfilePage() {
  const { t } = useTranslation();
  const profile = useQuery({ queryKey: ["me"], queryFn: patientApi.profile });
  if (profile.isError && !profile.data) return <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />;
  if (!profile.data) return <SkeletonRows rows={5} label={t("common.loading")} />;
  return <ProfileView profile={profile.data} />;
}

function ProfileView({ profile }: { profile: MyProfile }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Fields>(() => fieldsOf(profile));
  const [saved, setSaved] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [editing, setEditing] = useState(false);

  const save = useMutation({
    mutationFn: (body: Fields) => patientApi.updateContact(body),
    onSuccess: (updated) => {
      queryClient.setQueryData(["me"], updated);
      setValues(fieldsOf(updated));
      setSaved(true);
      setEditing(false);
    },
  });

  const phoneError = (v: string) => (v && !PHONE.test(v.trim()) ? t("portal.profile.phoneInvalid") : undefined);
  const errors = {
    phone: phoneError(values.phone),
    email: values.email && !EMAIL.test(values.email.trim()) ? t("portal.profile.emailInvalid") : undefined,
    emergency_contact_phone: phoneError(values.emergency_contact_phone),
  };
  const dirty = (Object.keys(values) as (keyof Fields)[]).some((k) => values[k] !== fieldsOf(profile)[k]);
  const hasErrors = Object.values(errors).some(Boolean);
  const change = (field: keyof Fields) => (e: { target: { value: string } }) => {
    setSaved(false);
    setValues((v) => ({ ...v, [field]: e.target.value }));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (save.isPending) return;
    setShowErrors(true);
    if (!hasErrors) save.mutate(values);
  };
  const shown = (field: keyof typeof errors) => (showErrors ? errors[field] : undefined);
  const failure = save.isError ? errorMessage(save.error) : null;

  const latest = profile.latest_analysis;
  const clinicLine = (value: string | null, withClinic: string, without: string, params: Record<string, string>) =>
    value ? t(withClinic, { ...params, clinic: value }) : t(without, params);
  const notSet = t("portal.profile.notSet");
  const row = (label: string, value: ReactNode) => <KvRow label={label}>{value}</KvRow>;

  return (
    <div className="pt-page">
      <h1 className="rd-h1">{t("portal.profile.title")}</h1>
      <div className="pt-profile">
        <div className="pt-profile__rail">
          <section className="pt-block pt-identity" aria-label={profile.full_name}>
            <span className="rd-avatar rd-avatar--xl rd-avatar--soft" aria-hidden="true">
              {initials(profile.full_name)}
            </span>
            <div className="pt-cell">
              <h2 className="rd-h3">{profile.full_name}</h2>
              <p className="rd-sm">{t("portal.profile.idLine", { id: profile.patient_id })}</p>
              {profile.clinic && <p className="rd-sm">{t("portal.results.registered", { clinic: profile.clinic })}</p>}
            </div>
          </section>

          <DCard id="pt-team" title={t("portal.profile.teamTitle")} icon="stethoscope">
            <div className="pt-block__body">
              <div className="pt-doctor">
                <Avatar initials={initials(profile.doctor_name)} size="sm" soft />
                <div className="pt-cell">
                  <span className="rd-label">{profile.doctor_name}</span>
                  {profile.doctor_clinic && <span className="rd-sm">{profile.doctor_clinic}</span>}
                </div>
              </div>
            </div>
          </DCard>
        </div>

        <div className="pt-profile__main">
          <DCard id="pt-personal" title={t("portal.profile.personalTitle")} icon="user">
            <div className="rd-dcard__body">
              <p className="rd-sm">{t("portal.profile.managed")}</p>
              <dl style={{ margin: 0 }}>
                {row(t("portal.profile.fullName"), profile.full_name)}
                {row(
                  t("portal.profile.birthYear"),
                  t("portal.profile.birthYearValue", { year: profile.birth_year, age: ageFromBirthYear(profile.birth_year) }),
                )}
                {row(t("portal.profile.sex"), t(`sex.${profile.sex}`))}
                {row(
                  t("portal.profile.registeredAt"),
                  clinicLine(profile.clinic, "portal.profile.registeredValue", "portal.profile.registeredValueNoClinic", {
                    date: formatDate(profile.registered_at, lang),
                  }),
                )}
                {row(
                  t("portal.profile.latest"),
                  latest
                    ? clinicLine(latest.clinic, "portal.profile.latestValue", "portal.profile.latestValueNoClinic", {
                        date: formatDate(latest.at, lang),
                        device: latest.device_code ?? "—",
                      })
                    : t("portal.profile.latestNone"),
                )}
              </dl>
            </div>
          </DCard>

          <DCard
            id="pt-contact"
            title={t("portal.profile.contactTitle")}
            icon="clipboard"
            meta={
              !editing && (
                <Button
                  icon="pencil"
                  onClick={() => {
                    setSaved(false);
                    setEditing(true);
                  }}
                >
                  {t("portal.profile.edit")}
                </Button>
              )
            }
          >
            {editing ? (
              <form className="rd-dcard__body pt-form" onSubmit={submit} noValidate>
                <FormField
                  label={t("portal.profile.phone")}
                  type="tel"
                  autoComplete="tel"
                  value={values.phone}
                  onChange={change("phone")}
                  error={shown("phone")}
                  maxLength={32}
                />
                <FormField
                  label={t("portal.profile.email")}
                  type="email"
                  autoComplete="email"
                  value={values.email}
                  onChange={change("email")}
                  error={shown("email")}
                  maxLength={200}
                />
                <FormField label={t("portal.profile.city")} autoComplete="address-level2" value={values.city} onChange={change("city")} maxLength={100} />
                <FormField
                  label={t("portal.profile.emergencyName")}
                  value={values.emergency_contact_name}
                  onChange={change("emergency_contact_name")}
                  maxLength={200}
                />
                <FormField
                  label={t("portal.profile.emergencyPhone")}
                  type="tel"
                  value={values.emergency_contact_phone}
                  onChange={change("emergency_contact_phone")}
                  error={shown("emergency_contact_phone")}
                  maxLength={32}
                  className="pt-form__wide"
                />
                {failure && (
                  <div className="pt-form__wide">
                    <DAlert tone="crit" icon="alertTriangle" role="alert">
                      {t(failure.key, failure.values ?? {})}
                    </DAlert>
                  </div>
                )}
                <div className="pt-form__actions">
                  <Button type="submit" variant="primary" disabled={!dirty} busy={save.isPending} busyText={t("portal.profile.saving")}>
                    {t("portal.profile.save")}
                  </Button>
                  <Button
                    onClick={() => {
                      setValues(fieldsOf(profile));
                      setShowErrors(false);
                      save.reset();
                      setEditing(false);
                    }}
                  >
                    {t("portal.profile.cancel")}
                  </Button>
                </div>
                <p className="rd-sm pt-form__wide">{t("portal.profile.privacy")}</p>
              </form>
            ) : (
              <div className="rd-dcard__body">
                {saved && (
                  <DAlert tone="ok" icon="checkCircle" role="status">
                    {t("portal.profile.saved")}
                  </DAlert>
                )}
                <dl style={{ margin: 0 }}>
                  {row(t("portal.profile.phone"), profile.phone ?? notSet)}
                  {row(t("portal.profile.email"), profile.email ?? notSet)}
                  {row(t("portal.profile.city"), profile.city ?? notSet)}
                  {row(t("portal.profile.emergencyName"), profile.emergency_contact_name ?? notSet)}
                  {row(t("portal.profile.emergencyPhone"), profile.emergency_contact_phone ?? notSet)}
                </dl>
                <p className="rd-sm">{t("portal.profile.privacy")}</p>
              </div>
            )}
          </DCard>

          <DCard id="pt-security" title={t("portal.profile.securityTitle")} icon="lock">
            <div className="rd-dcard__body">
              <div className="pt-row">
                <div className="pt-cell">
                  <span className="rd-label">{t("portal.profile.password")}</span>
                  <span className="rd-sm">
                    {profile.password_changed_at
                      ? t("portal.profile.passwordChanged", { date: formatDate(profile.password_changed_at, lang) })
                      : t("portal.profile.passwordNever")}
                  </span>
                </div>
                <ButtonLink to="/change-password">{t("portal.profile.change")}</ButtonLink>
              </div>
              <div className="pt-row">
                <div className="pt-cell">
                  <span className="rd-label">{t("portal.profile.recordsTitle")}</span>
                  <span className="rd-sm">{t("portal.profile.recordsHint")}</span>
                </div>
                <ButtonLink to="/patient/records" icon="download">
                  {t("portal.profile.recordsButton")}
                </ButtonLink>
              </div>
            </div>
          </DCard>
        </div>
      </div>
    </div>
  );
}
