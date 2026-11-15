import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";

import { adminApi, DISCONNECT_REASONS, type Device, type DeviceWithKey, type DisconnectReason } from "../../api/admin";
import { errorMessage } from "../../api/client";
import { Dialog } from "../../components/ui/Dialog";
import { SecretDialog } from "../../components/ui/SecretDialog";
import { ErrorState, SkeletonRows } from "../../components/ui/States";
import { formatDate, formatDateTime, formatRelative } from "../../lib/format";
import { Breadcrumbs, Button } from "../../redesign/components";
import { Icon } from "../../redesign/Icon";
import {
  batteryTone,
  Chip,
  ChecksList,
  DAlert,
  DCard,
  DevIcon,
  DoctorSelect,
  FormGroup,
  KvRow,
  maskIp,
  maskMac,
  Meter,
  SelectBox,
  signalWord,
  STATE_LOOK,
} from "./deviceUi";

function useDeviceRefresh(id: number) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "devices"] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "device", id] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "device", id, "activity"] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "stats"] });
  };
}

/** One device (design "Admin: device detail"): network, health checks, battery, information, audit log. */
export function DeviceDetailPage() {
  const { t, i18n } = useTranslation();
  const id = Number(useParams().deviceId);
  const refresh = useDeviceRefresh(id);
  const reasonId = useId();
  const device = useQuery({
    queryKey: ["admin", "device", id],
    queryFn: () => adminApi.device(id),
    enabled: Number.isInteger(id) && id > 0,
    refetchInterval: 5_000,
  });
  const doctors = useQuery({ queryKey: ["admin", "doctors"], queryFn: adminApi.doctors });
  const activity = useQuery({ queryKey: ["admin", "device", id, "activity"], queryFn: () => adminApi.deviceActivity(id) });
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState<DisconnectReason | "">("");
  const [reasonProblem, setReasonProblem] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [key, setKey] = useState<DeviceWithKey | null>(null);
  const [queued, setQueued] = useState(false);

  const cancelConfirm = () => {
    setConfirming(false);
    setReason("");
    setReasonProblem(false);
    disconnect.reset();
  };
  const disconnect = useMutation({
    mutationFn: (value: DisconnectReason) => adminApi.disconnectDevice(id, value),
    onSuccess: () => {
      refresh();
      cancelConfirm();
    },
  });
  const reconnect = useMutation({ mutationFn: () => adminApi.reconnectDevice(id), onSuccess: refresh });
  const selfTest = useMutation({
    mutationFn: () => adminApi.selfTest(id),
    onSuccess: () => {
      setQueued(true);
      refresh();
    },
  });
  const assign = useMutation({ mutationFn: (doctorId: number | null) => adminApi.assignDevice(id, doctorId), onSuccess: refresh });

  if (device.isPending) return <SkeletonRows rows={5} label={t("common.loading")} />;
  if (device.isError || !device.data) return <ErrorState error={device.error} onRetry={() => void device.refetch()} />;
  const d = device.data;
  const disconnected = d.state === "disconnected";
  const when = (iso: string | null) => (iso ? formatRelative(iso, i18n.language) : t("devices.noData"));
  const confirmDisconnect = () => {
    if (!reason) return setReasonProblem(true);
    disconnect.mutate(reason);
  };
  const askDisconnect = () => {
    setConfirming(true);
    setReasonProblem(false);
  };
  const noData = t("devices.noData");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Breadcrumbs
          label={t("doctors.crumbs")}
          items={[{ label: t("doctors.crumbAdmin") }, { label: t("devices.title"), href: "/admin/devices" }, { label: d.code }]}
        />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <DevIcon large />
            <div className="flex flex-col gap-2">
              <h1 translate="no" className="rd-h1">
                {d.code}
              </h1>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="rd-body">{[d.model, d.clinic, d.location].filter(Boolean).join(" · ")}</span>
                <Chip look={STATE_LOOK[d.state]} label={t(`devices.state.${d.state}`)} />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {disconnected ? (
              <Button variant="primary" icon="wifi" busy={reconnect.isPending} busyText={t("common.saving")} onClick={() => reconnect.mutate()}>
                {t("devices.reconnect")}
              </Button>
            ) : (
              <>
                <Button icon="play" busy={selfTest.isPending} busyText={t("common.saving")} disabled={d.state !== "online"} onClick={() => selfTest.mutate()}>
                  {t("devices.runSelfTest")}
                </Button>
                <Button variant="dangerline" icon="wifiOff" disabled={d.busy} onClick={askDisconnect}>
                  {t("devices.disconnect")}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-col gap-4" style={{ flex: "1 1 560px" }}>
          <DCard
            id="net-h"
            icon="wifi"
            title={t("devices.networkTitle")}
            meta={
              d.wifi_rssi !== null && d.state === "online" ? (
                <span className="rd-sm">{t("devices.signalLine", { rssi: d.wifi_rssi, word: t(`devices.signal.${signalWord(d.wifi_rssi)}`) })}</span>
              ) : undefined
            }
          >
            <div className="rd-dcard__body">
              <div aria-live="polite" className="flex flex-col gap-4 empty:hidden">
                {disconnected && (
                  <DAlert tone="crit" icon="alertOctagon">
                    <strong>{t("devices.blockedTitle", { code: d.code })}</strong>{" "}
                    {t("devices.disconnectedAlert", { reason: t(`devices.reason.${d.disconnect_reason ?? "maintenance"}`) })}
                  </DAlert>
                )}
                {d.busy && !disconnected && (
                  <DAlert tone="warn" icon="alertTriangle">
                    <strong>{t("devices.inUse")}</strong> {t("devices.inUseBody")}
                  </DAlert>
                )}
                {d.state === "pending" && (
                  <DAlert tone="info" icon="clock">
                    {t("devices.pendingAlert")}
                  </DAlert>
                )}
                {queued && !selfTest.isError && (
                  <DAlert tone="info" icon="clock">
                    {t("devices.selfTestQueued", { name: d.code })}
                  </DAlert>
                )}
                {selfTest.isError && (
                  <DAlert tone="crit" icon="alertOctagon">
                    {t(errorMessage(selfTest.error).key)}
                  </DAlert>
                )}
                {reconnect.isError && (
                  <DAlert tone="crit" icon="alertOctagon">
                    {t(errorMessage(reconnect.error).key)}
                  </DAlert>
                )}
              </div>
              <dl className="m-0" style={{ borderTop: "1px solid var(--c-border)" }}>
                <KvRow label={t("devices.statusLabel")}>{disconnected ? t("devices.disconnectedBy") : t(`devices.state.${d.state}`)}</KvRow>
                <KvRow label={t("devices.network")}>
                  <span translate="no">{d.wifi_ssid && !disconnected ? `${d.wifi_ssid} (Wi-Fi)` : disconnected ? t("devices.none") : noData}</span>
                </KvRow>
                <KvRow label={t("devices.ip")}>
                  <span translate="no">{d.ip ? maskIp(d.ip) : noData}</span>
                </KvRow>
                <KvRow label={t("devices.mac")}>
                  <span translate="no">{d.mac ? maskMac(d.mac) : noData}</span>
                </KvRow>
                <KvRow label={t("devices.gateway")}>
                  <span translate="no">{d.gateway ? maskIp(d.gateway) : noData}</span>
                </KvRow>
                <KvRow label={disconnected ? t("devices.disconnectedSince") : t("devices.lastSeen")}>
                  {disconnected ? when(d.disconnected_at) : when(d.last_seen_at)}
                </KvRow>
              </dl>

              {confirming && !disconnected && (
                <div role="group" aria-labelledby="confirm-h" className="rd-confirm">
                  <div className="flex items-center gap-3">
                    <span style={{ color: "var(--c-critical-fg)" }} className="inline-flex">
                      <Icon name="alertTriangle" />
                    </span>
                    <h3 className="rd-h3" id="confirm-h">
                      {t("devices.disconnectTitle", { name: d.code })}
                    </h3>
                  </div>
                  <ul className="m-0 flex flex-col gap-1 pl-5">
                    <li className="rd-body">{t("devices.disconnect1")}</li>
                    <li className="rd-body">{t("devices.disconnect2")}</li>
                    <li className="rd-body">{t("devices.disconnect3")}</li>
                  </ul>
                  {disconnect.isError && (
                    <DAlert tone="crit" icon="alertOctagon">
                      {t(errorMessage(disconnect.error).key)}
                    </DAlert>
                  )}
                  <div className="flex max-w-[420px] flex-col">
                    <FormGroup
                      label={t("devices.reasonLabel")}
                      required
                      htmlFor={reasonId}
                      hint={t("devices.reasonHint")}
                      error={reasonProblem ? t("devices.reasonRequired") : null}
                    >
                      <SelectBox
                        id={reasonId}
                        value={reason}
                        invalid={reasonProblem}
                        onChange={(value) => {
                          setReason(value as DisconnectReason | "");
                          setReasonProblem(false);
                        }}
                      >
                        <option value="">{t("devices.reasonPlaceholder")}</option>
                        {DISCONNECT_REASONS.map((r) => (
                          <option key={r} value={r}>
                            {t(`devices.reason.${r}`)}
                          </option>
                        ))}
                      </SelectBox>
                    </FormGroup>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="danger" busy={disconnect.isPending} busyText={t("common.saving")} onClick={confirmDisconnect}>
                      {t("devices.disconnectConfirm", { name: d.code })}
                    </Button>
                    <Button onClick={cancelConfirm}>{t("devices.keepConnected")}</Button>
                  </div>
                </div>
              )}

              {!disconnected && !confirming && (
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <span className="rd-sm" style={{ maxWidth: 420 }}>
                    {t("devices.disconnectNote")}
                  </span>
                  <Button variant="dangerline" disabled={d.busy} onClick={askDisconnect}>
                    {t("devices.disconnect")}
                  </Button>
                </div>
              )}
            </div>
          </DCard>

          <DCard
            id="hc-h"
            title={t("devices.checksTitle")}
            meta={<span className="rd-sm">{d.last_self_test_at ? t("devices.lastRun", { when: when(d.last_self_test_at) }) : t("devices.selfTestNever")}</span>}
          >
            <ChecksList device={d} />
          </DCard>
        </div>

        <div className="flex flex-col gap-4" style={{ flex: "0 0 360px" }}>
          <section className="rd-dcard" aria-labelledby="bat-h">
            <div className="rd-dcard__body" style={{ gap: "var(--s-3)" }}>
              <div className="flex items-baseline justify-between">
                <h2 className="rd-h3" id="bat-h">
                  {t("devices.colBattery")}
                </h2>
                <span className="rd-label" data-tone={d.battery_pct === null ? undefined : batteryTone(d.battery_pct)}>
                  {d.battery_pct === null ? noData : `${d.battery_pct}%`}
                </span>
              </div>
              {d.battery_pct !== null && <Meter pct={d.battery_pct} />}
              <span className="rd-sm" translate="no">
                {d.firmware_version
                  ? d.latest_firmware
                    ? d.firmware_version === d.latest_firmware
                      ? t("devices.firmwareCurrent", { version: d.firmware_version })
                      : t("devices.firmwareOutdated", { version: d.firmware_version, latest: d.latest_firmware })
                    : t("devices.firmware", { version: d.firmware_version })
                  : noData}
              </span>
            </div>
          </section>

          <DCard id="info-h" title={t("devices.infoTitle")}>
            <dl className="m-0" style={{ padding: "0 var(--s-5) var(--s-2)" }}>
              <KvRow label={t("devices.deviceId")}>
                <span translate="no">{d.code}</span>
              </KvRow>
              <KvRow label={t("devices.serial")}>
                <span translate="no">{d.serial}</span>
              </KvRow>
              <KvRow label={t("devices.model")}>{d.model}</KvRow>
              <KvRow label={t("devices.clinic")}>{d.clinic ?? noData}</KvRow>
              <KvRow label={t("devices.location")}>{d.location ?? noData}</KvRow>
              <KvRow label={t("devices.registered")}>{formatDate(d.created_at, i18n.language)}</KvRow>
            </dl>
          </DCard>

          <DCard id="manage-h" title={t("devices.manageTitle")}>
            <div className="rd-dcard__body">
              <DoctorSelect
                label={t("devices.doctor")}
                value={d.doctor_id}
                doctors={doctors.data ?? []}
                disabled={assign.isPending}
                onChange={(doctorId) => assign.mutate(doctorId)}
              />
              {assign.isError && (
                <DAlert tone="crit" icon="alertOctagon">
                  {t(errorMessage(assign.error).key)}
                </DAlert>
              )}
              <Button icon="lock" onClick={() => setRotating(true)}>
                {t("devices.rotate")}
              </Button>
              <span className="rd-sm">{t("devices.rotateHint")}</span>
            </div>
          </DCard>

          <DCard id="log-h" title={t("devices.auditTitle")} meta={<span className="rd-sm">{t("devices.activityTitle")}</span>}>
            <ul className="m-0 list-none" style={{ padding: "0 var(--s-5)" }}>
              {activity.data?.length === 0 && (
                <li className="rd-log">
                  <span className="rd-sm">{t("devices.activityEmpty")}</span>
                </li>
              )}
              {activity.data?.map((entry) => (
                <li key={entry.id} className="rd-log">
                  <span className="rd-log__dot" aria-hidden="true" />
                  <span className="flex flex-col gap-[2px]">
                    <span className="rd-body" style={{ color: "var(--c-ink)" }}>
                      {t(`audit.actions.${entry.action.replaceAll(".", "_")}`, { defaultValue: entry.action })}
                    </span>
                    <span className="rd-sm">
                      {formatDateTime(entry.created_at, i18n.language)}
                      {entry.username ? ` · ${entry.username}` : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </DCard>
        </div>
      </div>

      <RotateDialog
        device={d}
        open={rotating}
        onClose={() => setRotating(false)}
        onRotated={(rotated) => {
          setRotating(false);
          refresh();
          setKey(rotated);
        }}
      />
      <SecretDialog
        open={!!key}
        title={t("devices.keyRotatedTitle")}
        description={t("devices.keyBody", { name: key?.code ?? "" })}
        secrets={key ? [{ label: t("devices.apiKey"), value: key.api_key }] : []}
        acknowledge={t("devices.keyDone")}
        onClose={() => setKey(null)}
      />
    </div>
  );
}

function RotateDialog({
  device,
  open,
  onClose,
  onRotated,
}: {
  device: Device;
  open: boolean;
  onClose: () => void;
  onRotated: (device: DeviceWithKey) => void;
}) {
  const { t } = useTranslation();
  const rotate = useMutation({ mutationFn: () => adminApi.rotateKey(device.id), onSuccess: onRotated });
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={t("devices.rotateTitle", { name: device.code })}
      description={t("devices.rotateBody")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="danger" busy={rotate.isPending} busyText={t("common.saving")} onClick={() => rotate.mutate()}>
            {t("devices.rotateConfirm")}
          </Button>
        </>
      }
    >
      {rotate.isError && (
        <DAlert tone="crit" icon="alertOctagon">
          {t(errorMessage(rotate.error).key)}
        </DAlert>
      )}
    </Dialog>
  );
}
