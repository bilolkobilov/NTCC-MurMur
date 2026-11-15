// TEMPORARY — REDESIGN STAGING AREA. REMOVE `src/redesign/` once all mockups are applied.
//
// Living style guide for the new palette and components, fed only by `sampleData.ts` (no API, no router, no
// i18n), so it can never crash the app. It is NOT routed anywhere. To look at it, temporarily add
// `{ path: "/redesign", element: <RedesignPreview /> }` to the routes in `app/App.tsx` (and do not commit that line),
// or render it from a scratch test.
import { useState } from "react";

import { Avatar, Button, Breadcrumbs, Card, CountBadge, FilterPill, FormField, IconButton, SearchField, SegmentedControl, Sidebar, StatusChip, Tabs, TitleToolbar } from "./components";
import { PALETTE, SAMPLE_NAV, SAMPLE_PORTALS, SAMPLE_STATUSES, SAMPLE_TABS } from "./sampleData";

export function RedesignPreview() {
  const [nav, setNav] = useState("patients");
  const [tab, setTab] = useState("overview");
  const [portal, setPortal] = useState("doctor");
  const [pill, setPill] = useState("all");

  return (
    <main className="rd-preview" aria-label="Redesign preview">
      <TitleToolbar
        crumbsLabel="Breadcrumb"
        crumbs={[{ label: "Redesign" }, { label: "Preview" }]}
        title="Redesign preview"
        description="Temporary page: new palette and reusable components with fake data."
        actions={
          <>
            <Button icon="download">Export</Button>
            <Button variant="primary" icon="plus">
              New patient
            </Button>
          </>
        }
      />

      <section aria-label="Palette">
        <h2 className="rd-h2">Palette</h2>
        {PALETTE.map((g) => (
          <div key={g.group} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span className="rd-cap">{g.group}</span>
            <div className="rd-swatches">
              {g.tokens.map((t) => (
                <div key={t.name} className="rd-swatch">
                  <div className="rd-swatch__chip" style={{ background: `var(${t.name})` }} />
                  <div className="rd-swatch__meta">
                    <span className="rd-label">{t.name}</span>
                    <code>{t.value}</code>
                    <span className="rd-sm">{t.use}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section aria-label="Buttons and chips">
        <h2 className="rd-h2">Buttons, chips, badges</h2>
        <div className="rd-row">
          <Button variant="primary">Primary</Button>
          <Button>Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="primary" busy busyText="Verifying…">
            Sign in
          </Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
          <IconButton icon="bell" label="Notifications, 3 unread" count={3} />
          <IconButton icon="help" label="Help and support" />
          <Avatar initials="EV" />
        </div>
        <div className="rd-row">
          {SAMPLE_STATUSES.map((s) => (
            <StatusChip key={s.status} {...s} />
          ))}
          <CountBadge value={10} />
          <CountBadge value={4} critical />
        </div>
      </section>

      <section aria-label="Fields and filters">
        <h2 className="rd-h2">Fields and filters</h2>
        <div className="rd-row">
          <SearchField label="Search" placeholder="Search patients, devices, reports" shortcut="Ctrl K" style={{ minWidth: 360 }} />
          <SegmentedControl label="Portal" options={SAMPLE_PORTALS} value={portal} onChange={setPortal} />
          <FilterPill label="All" count={10} pressed={pill === "all"} onClick={() => setPill("all")} />
          <FilterPill label="Urgent" count={2} criticalCount icon="alertOctagon" pressed={pill === "urgent"} onClick={() => setPill("urgent")} />
        </div>
        <div className="rd-row" style={{ alignItems: "flex-start" }}>
          <FormField label="Full name" hint="As on the ID card" defaultValue="Maria Santos" style={{ width: 320 }} />
          <FormField label="Year of birth" error="Enter a year between 1900 and 2026" defaultValue="1850" style={{ width: 320 }} />
        </div>
        <Tabs label="Patient sections" options={SAMPLE_TABS} value={tab} onChange={setTab} />
        <Breadcrumbs label="Breadcrumb" items={[{ label: "Doctor portal" }, { label: "Patient registry", href: "#" }, { label: "M. Santos · MRN ••••8041" }]} />
      </section>

      <section aria-label="Navigation and cards">
        <h2 className="rd-h2">Sidebar and card</h2>
        <div className="rd-row" style={{ alignItems: "flex-start", gap: 24 }}>
          <Sidebar
            brand="MurMur"
            tagline="Clinical telemetry"
            navLabel="Doctor navigation"
            section="Clinical suite"
            items={SAMPLE_NAV}
            activeId={nav}
            onSelect={setNav}
            note={{ title: "Secure session", text: "Signs out after 15 min of inactivity" }}
          />
          <Card title="Latest auscultation" meta={<StatusChip status="ai" label="AI-assisted" />} className="rd-preview-card">
            <p className="rd-body">Mitral valve · 30 s · fake sample data only.</p>
          </Card>
        </div>
      </section>
    </main>
  );
}
