import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { adminApi, type Device, type DeviceWithKey, type Doctor } from "../../api/admin";
import { ApiError, errorMessage } from "../../api/client";
import { Alert } from "../../components/ui/Alert";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { SecretDialog } from "../../components/ui/SecretDialog";
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from "../../components/ui/States";
import { TextField } from "../../components/ui/TextField";
import { formatRelative } from "../../lib/format";
import { OnlineBadge } from "../../components/device/OnlineBadge";

/** Wi-Fi strength in words (RSSI in dBm): what the admin needs to decide "move the device closer". */
export function signalWord(rssi: number): "strong" | "ok" | "weak" {
  return rssi >= -60 ? "strong" : rssi >= -72 ? "ok" : "weak";
}

/**
 * Devices: register (the API key is shown once), assign to a doctor, rotate a lost key, and watch them live
 * (online, Wi-Fi, firmware — refreshed every 5 s).
 */
export function DevicesPage() {
  const { t, i18n } = useTranslation();
  const devices = useQuery({ queryKey: ["admin", "devices"], queryFn: adminApi.devices, refetchInterval: 5_000 });
  const doctors = useQuery({ queryKey: ["admin", "doctors"], queryFn: adminApi.doctors });
  const [registering, setRegistering] = useState(false);
  const [rotating, setRotating] = useState<Device | null>(null);
  const [key, setKey] = useState<{ device: DeviceWithKey; kind: "created" | "rotated" } | null>(null);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={t("devices.title")}
        meta={
          devices.data &&
          t("devices.onlineOf", { online: devices.data.filter((d) => d.online).length, total: devices.data.length })
        }
        actions={
          <Button variant="primary" onClick={() => setRegistering(true)}>
            {t("devices.add")}
          </Button>
        }
      />
      {devices.isError && devices.data && (
        <div className="mb-4">
          <Alert>{t("live.reconnecting")}</Alert>
        </div>
      )}
      <div className="overflow-hidden rounded-card border border-line bg-surface">
        {devices.isPending && <SkeletonRows rows={3} label={t("common.loading")} />}
        {devices.isError && !devices.data && <ErrorState error={devices.error} onRetry={() => void devices.refetch()} />}
        {devices.data?.length === 0 && (
          <EmptyState
            title={t("devices.emptyTitle")}
            body={t("devices.emptyBody")}
            action={
              <Button variant="primary" onClick={() => setRegistering(true)}>
                {t("devices.add")}
              </Button>
            }
          />
        )}
        {devices.data && devices.data.length > 0 && (
          <ul className="divide-y divide-line">
            {devices.data.map((device) => (
              <li key={device.id} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] md:items-center">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{device.name}</p>
                  <p translate="no" className="font-mono text-caption text-ink-500">
                    {device.serial}
                  </p>
                </div>
                <div className="flex flex-col gap-0.5 text-label">
                  <OnlineBadge online={device.online} />
                  <span className="text-caption text-ink-500">
                    {device.last_seen_at
                      ? t("device.lastSeen", { when: formatRelative(device.last_seen_at, i18n.language) })
                      : t("device.never")}
                  </span>
                  {device.wifi_rssi !== null && (
                    <span className="text-caption text-ink-500 tabular-nums">
                      {t("devices.wifi", { signal: t(`devices.signal.${signalWord(device.wifi_rssi)}`) })} ·{" "}
                      <span className="font-mono">{device.wifi_rssi} dBm</span>
                    </span>
                  )}
                  {device.firmware_version && (
                    <span translate="no" className="font-mono text-caption text-ink-500">
                      {t("devices.firmware", { version: device.firmware_version })}
                    </span>
                  )}
                </div>
                <AssignSelect device={device} doctors={doctors.data ?? []} />
                <Button variant="ghost" onClick={() => setRotating(device)}>
                  {t("devices.rotate")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <RegisterDialog
        key={registering ? "register-open" : "register-closed"}
        open={registering}
        doctors={doctors.data ?? []}
        onClose={() => setRegistering(false)}
        onCreated={(device) => {
          setRegistering(false);
          setKey({ device, kind: "created" });
        }}
      />
      <RotateDialog
        device={rotating}
        onClose={() => setRotating(null)}
        onRotated={(device) => {
          setRotating(null);
          setKey({ device, kind: "rotated" });
        }}
      />
      <SecretDialog
        open={!!key}
        title={key?.kind === "rotated" ? t("devices.keyRotatedTitle") : t("devices.keyCreatedTitle")}
        description={t("devices.keyBody", { name: key?.device.name ?? "" })}
        secrets={key ? [{ label: t("devices.apiKey"), value: key.device.api_key }] : []}
        acknowledge={t("devices.keyDone")}
        onClose={() => setKey(null)}
      />
    </div>
  );
}

function useDevicesRefresh() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "devices"] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "stats"] });
  };
}

/** Native select: keyboard and screen readers work everywhere, also on a phone. Blocked doctors cannot get a device. */
function DoctorSelect({
  value,
  doctors,
  onChange,
  disabled,
  label,
}: {
  value: number | null;
  doctors: Doctor[];
  onChange: (id: number | null) => void;
  disabled?: boolean;
  label: string;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-label font-medium text-ink-700">
        {label}
      </label>
      <select
        id={id}
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        className="min-h-11 rounded-control border border-line-strong bg-field px-3 text-body text-ink-900 hover:border-ink-300 focus:border-ink-900 focus:bg-surface focus:outline-2 focus:outline-offset-1 focus:outline-ink-900/15 disabled:opacity-60"
      >
        <option value="">{t("devices.unassigned")}</option>
        {doctors.map((doctor) => (
          <option key={doctor.id} value={doctor.id} disabled={!doctor.is_active && doctor.id !== value}>
            {doctor.full_name}
            {doctor.is_active ? "" : ` (${t("doctors.blocked")})`}
          </option>
        ))}
      </select>
    </div>
  );
}

function AssignSelect({ device, doctors }: { device: Device; doctors: Doctor[] }) {
  const { t } = useTranslation();
  const refresh = useDevicesRefresh();
  const assign = useMutation({
    mutationFn: (doctorId: number | null) => adminApi.assignDevice(device.id, doctorId),
    onSuccess: refresh,
  });
  return (
    <div>
      <DoctorSelect
        label={t("devices.doctor")}
        value={device.doctor_id}
        doctors={doctors}
        disabled={assign.isPending}
        onChange={(id) => assign.mutate(id)}
      />
      {assign.isError && <p className="mt-1 text-caption text-danger">{t(errorMessage(assign.error).key)}</p>}
    </div>
  );
}

function RegisterDialog({
  open,
  doctors,
  onClose,
  onCreated,
}: {
  open: boolean;
  doctors: Doctor[];
  onClose: () => void;
  onCreated: (device: DeviceWithKey) => void;
}) {
  const { t } = useTranslation();
  const refresh = useDevicesRefresh();
  const [form, setForm] = useState<{ name: string; serial: string; doctorId: number | null }>({
    name: "",
    serial: "",
    doctorId: null,
  });
  const [problems, setProblems] = useState<{ name?: string; serial?: string }>({});
  const create = useMutation({
    mutationFn: () => adminApi.createDevice({ name: form.name.trim(), serial: form.serial.trim(), doctor_id: form.doctorId }),
    onSuccess: (device) => {
      refresh();
      onCreated(device);
      setForm({ name: "", serial: "", doctorId: null });
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found: typeof problems = {};
    if (!form.name.trim()) found.name = t("devices.nameRequired");
    if (!form.serial.trim()) found.serial = t("devices.serialRequired");
    setProblems(found);
    if (Object.keys(found).length === 0) create.mutate();
  };
  const failure =
    create.error instanceof ApiError && create.error.detail === "serial already exists"
      ? t("devices.serialTaken")
      : create.isError
        ? t(errorMessage(create.error).key)
        : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={t("devices.add")}
      description={t("devices.addBody")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" form="register-device" variant="primary" busy={create.isPending} busyText={t("common.saving")}>
            {t("devices.register")}
          </Button>
        </>
      }
    >
      <form id="register-device" noValidate onSubmit={submit} className="flex flex-col gap-4">
        {failure && <Alert tone="danger">{failure}</Alert>}
        <TextField
          label={t("devices.name")}
          required
          autoComplete="off"
          placeholder="MurMur #3"
          error={problems.name}
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
        <TextField
          label={t("devices.serial")}
          required
          autoComplete="off"
          translate="no"
          spellCheck={false}
          placeholder="MM-003"
          hint={t("devices.serialHint")}
          error={problems.serial}
          value={form.serial}
          onChange={(e) => setForm((f) => ({ ...f, serial: e.target.value }))}
        />
        <DoctorSelect
          label={t("devices.doctor")}
          value={form.doctorId}
          doctors={doctors}
          onChange={(doctorId) => setForm((f) => ({ ...f, doctorId }))}
        />
      </form>
    </Dialog>
  );
}

function RotateDialog({
  device,
  onClose,
  onRotated,
}: {
  device: Device | null;
  onClose: () => void;
  onRotated: (device: DeviceWithKey) => void;
}) {
  const { t } = useTranslation();
  const refresh = useDevicesRefresh();
  const rotate = useMutation({
    mutationFn: (id: number) => adminApi.rotateKey(id),
    onSuccess: (d) => {
      refresh();
      onRotated(d);
    },
  });
  return (
    <Dialog
      open={!!device}
      onOpenChange={(next) => !next && onClose()}
      title={t("devices.rotateTitle", { name: device?.name ?? "" })}
      description={t("devices.rotateBody")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            variant="danger"
            busy={rotate.isPending}
            busyText={t("common.saving")}
            onClick={() => device && rotate.mutate(device.id)}
          >
            {t("devices.rotateConfirm")}
          </Button>
        </>
      }
    >
      {rotate.isError && <Alert tone="danger">{t(errorMessage(rotate.error).key)}</Alert>}
    </Dialog>
  );
}
