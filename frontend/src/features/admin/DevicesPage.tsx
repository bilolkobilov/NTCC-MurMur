import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";

import { adminApi, CHECKS, type Device } from "../../api/admin";
import { EmptyState, ErrorState, SkeletonRows } from "../../components/ui/States";
import { formatDateTime, formatNumber, formatRelative } from "../../lib/format";
import { Button, ButtonLink, SearchField, SelectField, SummaryTile, Tabs, TitleToolbar } from "../../redesign/components";
import { Icon } from "../../redesign/Icon";
import {
  Chip,
  DAlert,
  DevIcon,
  HEALTH_LOOK,
  matchesQuery,
  matchesTab,
  maskSerial,
  Meter,
  signalWord,
  sortDevices,
  type DeviceSort,
  type DeviceTab,
} from "./deviceUi";

const TABS: DeviceTab[] = ["all", "healthy", "attention", "fault", "pending"];
const SORTS: DeviceSort[] = ["attention", "id", "sync"];
const SEGMENTS = [
  { health: "healthy", tone: "normal" },
  { health: "attention", tone: "borderline" },
  { health: "degraded", tone: "abnormal" },
  { health: "fault", tone: "critical" },
  { health: "pending", tone: "pending" },
] as const;

const csvCell = (value: string | number | null) => `"${String(value ?? "").replaceAll('"', '""')}"`;

/** The rows on screen as a CSV file (built in the browser: nothing is sent anywhere). */
function downloadCsv(rows: Device[]) {
  const head = ["id", "serial", "model", "clinic", "doctor", "location", "state", "health", "battery_pct", "firmware", "last_seen_at"];
  const lines = rows.map((d) =>
    [d.code, d.serial, d.model, d.clinic, d.doctor_name, d.location, d.state, d.health, d.battery_pct, d.firmware_version, d.last_seen_at]
      .map(csvCell)
      .join(","),
  );
  const url = URL.createObjectURL(new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "murmur-devices.csv";
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Devices (design "Admin: IoT devices"): one panel with the fleet summary, the health bar, status tabs and the
 * table. Search, clinic, tab and sort live in the URL, so reload and Back keep them. Live: refreshed every 5 s.
 * A row opens the device page.
 */
export function DevicesPage() {
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const clinic = params.get("clinic") ?? "all";
  const tab = TABS.find((x) => x === params.get("tab")) ?? "all";
  const sort = SORTS.find((x) => x === params.get("sort")) ?? "attention";
  const devices = useQuery({ queryKey: ["admin", "devices"], queryFn: adminApi.devices, refetchInterval: 5_000 });

  const change = (next: Partial<{ q: string; clinic: string; tab: DeviceTab; sort: DeviceSort }>) => {
    const merged = { q, clinic, tab, sort, ...next };
    setParams(
      {
        ...(merged.q ? { q: merged.q } : {}),
        ...(merged.clinic !== "all" ? { clinic: merged.clinic } : {}),
        ...(merged.tab !== "all" ? { tab: merged.tab } : {}),
        ...(merged.sort !== "attention" ? { sort: merged.sort } : {}),
      },
      { replace: true },
    );
  };

  const all = devices.data ?? [];
  const n = (value: number) => formatNumber(value, i18n.language);
  const clinics = [...new Set(all.map((d) => d.clinic).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b));
  const inScope = all.filter((d) => matchesQuery(d, q) && (clinic === "all" || d.clinic === clinic));
  const rows = sortDevices(
    inScope.filter((d) => matchesTab(d, tab)),
    sort,
  );
  const count = (x: DeviceTab) => inScope.filter((d) => matchesTab(d, x)).length;
  const online = all.filter((d) => d.state === "online").length;
  const attention = all.filter((d) => d.health === "attention").length;
  const degraded = all.filter((d) => d.health === "degraded").length;
  const faults = all.filter((d) => d.health === "fault").length;
  const segments = SEGMENTS.map((s) => ({ ...s, n: all.filter((d) => d.health === s.health).length }));
  const paired = all.filter((d) => d.state !== "pending");
  const withBattery = all.filter((d) => d.battery_pct !== null);
  const avgBattery = withBattery.length ? Math.round(withBattery.reduce((sum, d) => sum + (d.battery_pct ?? 0), 0) / withBattery.length) : null;
  const latest = all.find((d) => d.latest_firmware)?.latest_firmware ?? null;
  const onLatest = paired.filter((d) => d.firmware_version === latest).length;
  const filtered = !!q || clinic !== "all" || tab !== "all";

  return (
    <div className="flex flex-col gap-6">
      <TitleToolbar
        crumbsLabel={t("doctors.crumbs")}
        crumbs={[{ label: t("doctors.crumbAdmin") }, { label: t("devices.title") }]}
        title={t("devices.title")}
        description={t("devices.listBody")}
        actions={
          <>
            <Button icon="download" disabled={rows.length === 0} onClick={() => downloadCsv(rows)}>
              {t("devices.export")}
            </Button>
            <ButtonLink to="/admin/doctors/new" icon="userPlus">
              {t("doctors.add")}
            </ButtonLink>
            <ButtonLink to="/admin/devices/new" variant="primary" icon="plus">
              {t("devices.add")}
            </ButtonLink>
          </>
        }
      />

      <div className="flex flex-col gap-4">
        {devices.isError && devices.data && (
          <DAlert tone="crit" icon="alertOctagon">
            {t("devices.staleBody", { when: formatDateTime(new Date(devices.dataUpdatedAt).toISOString(), i18n.language) })}
          </DAlert>
        )}

        <div role="search" className="rd-searchbar">
          <SearchField
            className="flex-1 basis-64"
            label={t("devices.searchLabel")}
            placeholder={t("devices.searchPlaceholder")}
            type="search"
            autoComplete="off"
            spellCheck={false}
            value={q}
            onChange={(e) => change({ q: e.target.value })}
          />
          <SelectField
            className="w-full sm:w-[210px] sm:shrink-0"
            label={t("devices.clinic")}
            value={clinic}
            onChange={(e) => change({ clinic: e.target.value })}
            options={[
              { value: "all", label: t("doctors.allClinics", { count: clinics.length }) },
              ...clinics.map((c) => ({ value: c, label: c })),
            ]}
          />
          <SelectField
            className="w-full sm:w-[220px] sm:shrink-0"
            label={t("devices.sortLabel")}
            value={sort}
            onChange={(e) => change({ sort: e.target.value as DeviceSort })}
            options={SORTS.map((s) => ({ value: s, label: t(`devices.sort.${s}`) }))}
          />
        </div>

        <section aria-label={t("devices.registry")} className="rd-panel">
          {devices.data && (
            <>
              <div role="group" aria-label={t("devices.summaryLabel")} className="rd-tiles">
                <SummaryTile
                  icon="radio"
                  value={n(all.length)}
                  label={t("devices.tileTotal")}
                  sub={t("devices.tileClinics", { count: clinics.length })}
                />
                <SummaryTile
                  icon="checkCircle"
                  tone="normal"
                  value={n(online)}
                  label={t("devices.tileOnline")}
                  sub={t("devices.tileOfFleet", { pct: all.length ? Math.round((online / all.length) * 100) : 0 })}
                />
                <SummaryTile
                  icon="alertTriangle"
                  tone="abnormal"
                  value={n(attention + degraded)}
                  label={t("devices.tileAttention")}
                  sub={t("devices.tileAttentionSub", { attention, degraded })}
                />
                <SummaryTile icon="alertOctagon" tone="critical" value={n(faults)} label={t("devices.tileFaults")} sub={t("devices.tileFaultsSub")} />
              </div>

              <div className="flex flex-col gap-3 px-5 pb-5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="rd-label">{t("devices.fleetHealth")}</span>
                  <span className="rd-sm">
                    {[
                      avgBattery !== null && t("devices.fleetBattery", { pct: avgBattery }),
                      latest && t("devices.fleetFirmware", { n: onLatest, total: paired.length, version: latest }),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                <div
                  className="rd-hbar"
                  role="img"
                  aria-label={t("devices.barAria", {
                    healthy: segments[0].n,
                    attention: segments[1].n,
                    degraded: segments[2].n,
                    fault: segments[3].n,
                    pending: segments[4].n,
                  })}
                >
                  {segments.map((s) => (
                    <span key={s.health} className={`rd-bg-${s.tone}`} style={{ flex: `${s.n} 1 0`, minWidth: 0 }} />
                  ))}
                </div>
                <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-2 p-0">
                  {segments.map((s) => (
                    <li key={s.health} className="flex items-center gap-2">
                      <span className={`rd-dot rd-bg-${s.tone}`} aria-hidden="true" />
                      <span className="rd-body" style={{ color: "var(--c-ink)" }}>
                        {t(`devices.health.${s.health}`)}
                      </span>
                      <span className="rd-sm">{s.n}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}

          <div className="rd-panel__tabs" style={{ borderBottom: "1px solid var(--c-border)" }}>
            <Tabs
              label={t("devices.tabsLabel")}
              value={tab}
              onChange={(value) => change({ tab: value })}
              options={TABS.map((x) => ({ value: x, label: t(`devices.tab.${x}`), count: count(x) }))}
            />
          </div>

          {devices.isPending && <SkeletonRows rows={5} label={t("common.loading")} />}
          {devices.isError && !devices.data && <ErrorState error={devices.error} onRetry={() => void devices.refetch()} />}
          {devices.data && all.length === 0 && (
            <EmptyState
              title={t("devices.emptyTitle")}
              body={t("devices.emptyBody")}
              action={
                <ButtonLink to="/admin/devices/new" variant="primary">
                  {t("devices.add")}
                </ButtonLink>
              }
            />
          )}
          {all.length > 0 && rows.length === 0 && (
            <div className="flex flex-col items-center gap-3 px-5 py-12 text-center">
              <span className="rd-devicon" aria-hidden="true" style={{ width: 48, height: 48, borderRadius: "var(--r-full)" }}>
                <Icon name="search" size="lg" />
              </span>
              <h2 className="rd-h3">{t("devices.noMatchTitle")}</h2>
              <p className="rd-body" style={{ maxWidth: 360 }}>
                {t("devices.noMatchBody")}
              </p>
              {filtered && <Button onClick={() => setParams({}, { replace: true })}>{t("devices.clearFilters")}</Button>}
            </div>
          )}
          {rows.length > 0 && (
            <div className="rd-dev-scroll">
              <div role="table" aria-label={t("devices.tableLabel")}>
                <div role="row" className="rd-dev-row rd-dev-row--head">
                  <span role="columnheader" className="rd-cap">
                    {t("devices.colDevice")}
                  </span>
                  <span role="columnheader" className="rd-cap rd-col-x">
                    {t("devices.colClinic")}
                  </span>
                  <span role="columnheader" className="rd-cap">
                    {t("devices.colConnection")}
                  </span>
                  <span role="columnheader" className="rd-cap">
                    {t("devices.colHealth")}
                  </span>
                  <span role="columnheader" className="rd-cap">
                    {t("devices.colBattery")}
                  </span>
                  <span role="columnheader" className="rd-cap rd-col-x">
                    {t("devices.colSync")}
                  </span>
                  <span role="columnheader" className="rd-sr">
                    {t("devices.colDetails")}
                  </span>
                </div>
                {rows.map((d) => (
                  <DeviceRow key={d.id} device={d} />
                ))}
              </div>
            </div>
          )}

          {devices.data && all.length > 0 && (
            <div className="rd-footbar">
              <span className="rd-sm" role="status">
                {t("devices.showing", { shown: rows.length, total: all.length })}
              </span>
              <span className="rd-sm flex items-center gap-2">
                <Icon name="shield" size="sm" />
                {t("devices.telemetryOnly")}
              </span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

const CONNECTION = {
  online: { tone: "normal", icon: "wifi" },
  offline: { tone: "critical", icon: "wifiOff" },
  pending: { tone: "pending", icon: "clock" },
  disconnected: { tone: "abnormal", icon: "wifiOff" },
} as const;

function DeviceRow({ device: d }: { device: Device }) {
  const { t, i18n } = useTranslation();
  const conn = CONNECTION[d.state];
  const sub =
    d.state === "pending"
      ? t("devices.awaitingPairing")
      : d.state === "disconnected"
        ? t("devices.disconnectedBy")
        : d.state === "offline" && d.last_seen_at
          ? t("device.lastSeen", { when: formatRelative(d.last_seen_at, i18n.language) })
          : d.wifi_rssi === null
            ? "Wi-Fi"
            : `Wi-Fi · ${d.wifi_rssi} dBm (${t(`devices.signalShort.${signalWord(d.wifi_rssi)}`)})`;
  const problems = CHECKS.filter((name) => d.checks[name] === "warn" || d.checks[name] === "fail").map((name) => t(`devices.check.${name}`));
  const healthSub =
    d.health === "pending" ? t("devices.setupNeeded") : problems.length ? problems.join(", ") : d.health === "healthy" ? t("devices.allPassed") : "";

  return (
    <div role="row" className="rd-dev-row rd-dev-row--body">
      <div role="cell" className="flex min-w-0 items-center gap-3">
        <DevIcon />
        <span className="rd-dev-cell">
          <Link to={`/admin/devices/${d.id}`} translate="no" className="rd-label" style={{ textDecoration: "none" }}>
            {d.code}
          </Link>
          <span className="rd-sm">
            {d.model} · <span translate="no">{maskSerial(d.serial)}</span>
          </span>
        </span>
      </div>
      <div role="cell" className="rd-dev-cell rd-col-x">
        {d.doctor_name ? (
          <>
            <span className="rd-label flex items-center gap-[6px]">
              <span style={{ color: "var(--c-primary-ink)" }} className="inline-flex">
                <Icon name="building" size="sm" />
              </span>
              {d.clinic ?? <span className="rd-sm italic">{t("doctors.noClinic")}</span>}
            </span>
            <span className="rd-sm">{[d.location, d.doctor_name].filter(Boolean).join(" · ")}</span>
          </>
        ) : (
          <>
            <span className="rd-sm italic">{t("devices.unassigned")}</span>
            {d.location && <span className="rd-sm">{d.location}</span>}
          </>
        )}
      </div>
      <div role="cell" className="rd-dev-cell">
        <span className={`rd-conn rd-conn--${conn.tone}`}>
          <Icon name={conn.icon} size="sm" />
          {t(`devices.state.${d.state}`)}
        </span>
        <span className="rd-sm">{sub}</span>
      </div>
      <div role="cell" className="flex flex-col items-start gap-1">
        <Chip look={HEALTH_LOOK[d.health]} label={t(`devices.health.${d.health}`)} />
        {healthSub && <span className="rd-sm">{healthSub}</span>}
      </div>
      <div role="cell" className="flex flex-col gap-[6px]">
        {d.battery_pct === null ? (
          <span className="rd-sm">{t("devices.noData")}</span>
        ) : (
          <>
            <span className="flex items-center gap-[6px]">
              <span style={{ color: "var(--c-ink-2)" }} className="inline-flex">
                <Icon name="battery" size="sm" />
              </span>
              <span className="rd-label">{d.battery_pct}%</span>
              {d.battery_pct < 20 && <span style={{ font: "600 12px/16px var(--font)", color: "var(--c-abnormal-fg)" }}>{t("devices.low")}</span>}
            </span>
            <Meter pct={d.battery_pct} />
          </>
        )}
      </div>
      <div role="cell" className="rd-body rd-col-x" style={{ color: "var(--c-ink)" }}>
        {d.last_seen_at ? formatRelative(d.last_seen_at, i18n.language) : "—"}
      </div>
      <div role="cell" className="flex justify-end">
        <Link to={`/admin/devices/${d.id}`} className="rd-icon-btn" aria-label={t("devices.openDetails", { name: d.code })}>
          <Icon name="chevronRight" />
        </Link>
      </div>
    </div>
  );
}
