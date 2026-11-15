// TEMPORARY — REDESIGN STAGING AREA. REMOVE `src/redesign/` once all mockups are applied.
//
// Reusable components from "Murmur — Common Layout Components Redesign.html" (frames #4 navigation, #5 header /
// toolbars, #6 palette). They are NOT used by any real page yet and must not replace `components/ui/*` until the
// owner approves the redesign. Rules kept from the mockup:
//   - no text is built in here: every label comes from the caller (so uz / ru / en stay in the locale files);
//   - status = icon + word + colour, never colour alone; active nav = tint + 3 px bar + aria-current;
//   - every interactive target is at least 44 px.
import { clsx } from "clsx";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";
import { useId } from "react";
import { Link, type LinkProps } from "react-router";

import { Icon, type IconName } from "./Icon";
import "./redesign.css";

// ---- Button -------------------------------------------------------------------------------------------------------

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "dangerline";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  icon?: IconName;
  block?: boolean;
  /** While true the button cannot be pressed again and shows `busyText` (double-click protection, as the live Button). */
  busy?: boolean;
  busyText?: string;
};

export function Button({ variant = "secondary", icon, block, busy, busyText, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={clsx("rd-btn", `rd-btn--${variant}`, block && "rd-btn--block", className)}
    >
      {busy ? <span className="rd-spin" aria-hidden="true" /> : icon && <Icon name={icon} size="sm" />}
      {busy && busyText ? busyText : children}
    </button>
  );
}

/** A real link that looks like a `Button` (Ctrl+click and middle-click keep working). */
export function ButtonLink({ variant = "secondary", icon, className, children, ...rest }: LinkProps & { variant?: ButtonVariant; icon?: IconName }) {
  return (
    <Link {...rest} className={clsx("rd-btn", `rd-btn--${variant}`, className as string)}>
      {icon && <Icon name={icon} size="sm" />}
      {children}
    </Link>
  );
}

/** 44 px icon-only button. `label` is the accessible name; `count` adds the red count bubble (include it in `label`). */
export function IconButton({ icon, label, count, ...rest }: { icon: IconName; label: string; count?: number } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">) {
  return (
    <button type="button" aria-label={label} {...rest} className={clsx("rd-icon-btn", rest.className)}>
      <Icon name={icon} />
      {count ? <span className="rd-icon-btn__count">{count}</span> : null}
    </button>
  );
}

// ---- Status chip and count badge ----------------------------------------------------------------------------------

export type Status = "normal" | "borderline" | "abnormal" | "critical" | "pending" | "ai";

/** Fixed icon per status so the chip never relies on colour alone. */
const STATUS_ICON: Record<Status, IconName> = {
  normal: "checkCircle",
  borderline: "alertTriangle",
  abnormal: "alertTriangle",
  critical: "alertOctagon",
  pending: "clock",
  ai: "sparkles",
};

/** Colours: green = normal only, violet = AI only. `label` is the visible word and comes from the caller. */
export function StatusChip({ status, label }: { status: Status; label: string }) {
  return (
    <span className={clsx("rd-chip", `rd-chip--${status}`)}>
      <Icon name={STATUS_ICON[status]} />
      {label}
    </span>
  );
}

export function CountBadge({ value, critical }: { value: number | string; critical?: boolean }) {
  return <span className={clsx("rd-badge", critical && "rd-badge--critical")}>{value}</span>;
}

// ---- Fields -------------------------------------------------------------------------------------------------------

/** 44 px toolbar field (search, filters). `label` is screen-reader only; `shortcut` shows a `kbd` hint. */
export function SearchField({ label, shortcut, className, ...input }: { label: string; shortcut?: string } & ComponentProps<"input">) {
  return (
    <label className={clsx("rd-field", className)}>
      <span className="rd-sr">{label}</span>
      <Icon name="search" />
      <input type="search" {...input} />
      {shortcut && <kbd>{shortcut}</kbd>}
    </label>
  );
}

/** 44 px toolbar select (sort, filters). `label` is screen-reader only. Native `<select>`: keyboard and mobile for free. */
export function SelectField({ label, options, className, ...select }: { label: string; options: { value: string; label: string }[] } & Omit<ComponentProps<"select">, "children">) {
  return (
    <label className={clsx("rd-field rd-field--select", className)}>
      <span className="rd-sr">{label}</span>
      <select {...select}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon name="chevronDown" size="sm" />
    </label>
  );
}

/** 48 px form field: visible label, optional hint, error with icon (`role="alert"`), all linked for screen readers. */
export function FormField({ label, hint, error, className, ...input }: { label: string; hint?: string; error?: string } & ComponentProps<"input">) {
  const id = useId();
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
  return (
    <div className={clsx("rd-textfield", className)}>
      <label htmlFor={id} className="rd-textfield__label">
        {label}
      </label>
      <div className={clsx("rd-input", error && "rd-input--error")}>
        <input id={id} {...input} aria-invalid={error ? true : undefined} aria-describedby={describedBy} className="rd-input__native" />
      </div>
      {hint && !error && (
        <p id={`${id}-hint`} className="rd-sm">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="rd-textfield__error">
          <Icon name="alertTriangle" size="sm" />
          {error}
        </p>
      )}
    </div>
  );
}

// ---- Selection controls -------------------------------------------------------------------------------------------

type Option<T extends string> = { value: T; label: string; count?: number };

/** Two-to-three way switch (the mockup's portal switch). Uses `aria-pressed`, like the mockup. */
export function SegmentedControl<T extends string>({ label, options, value, onChange }: { label: string; options: Option<T>[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="rd-seg">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} className="rd-seg__btn" onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Underline tabs, optional count badge. Panels are the caller's job (`aria-controls` can be added via the option id). */
export function Tabs<T extends string>({ label, options, value, onChange }: { label: string; options: Option<T>[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" aria-label={label} className="rd-tabs">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} className="rd-tab" onClick={() => onChange(o.value)}>
          {o.label}
          {o.count !== undefined && <CountBadge value={o.count} />}
        </button>
      ))}
    </div>
  );
}

/** Toggle filter button (All / Urgent / Check / Normal). The mockup also has underline tabs for the same job — pick one. */
export function FilterPill({ label, count, criticalCount, icon, pressed, onClick }: { label: string; count?: number; criticalCount?: boolean; icon?: IconName; pressed: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={pressed} className="rd-pill" onClick={onClick}>
      {icon && <Icon name={icon} size="sm" />}
      {label}
      {count !== undefined && <CountBadge value={count} critical={criticalCount} />}
    </button>
  );
}

// ---- Navigation ---------------------------------------------------------------------------------------------------

export function BrandMark({ size = 40 }: { size?: number }) {
  return (
    <span className="rd-brand-mark" style={{ width: size, height: size }}>
      <Icon name="activity" size="lg" />
    </span>
  );
}

export type NavEntry = { id: string; label: string; icon: IconName; badge?: number; critical?: boolean };

/** One 48 px nav row. Render it inside a router `<NavLink>` later; for now it is a button (mockup). */
export function NavItem({ item, active, onSelect }: { item: NavEntry; active: boolean; onSelect?: (id: string) => void }) {
  return (
    <button type="button" className="rd-nav-item" aria-current={active ? "page" : undefined} onClick={() => onSelect?.(item.id)}>
      <Icon name={item.icon} />
      <span style={{ flex: 1 }}>{item.label}</span>
      {item.badge !== undefined && <CountBadge value={item.badge} critical={item.critical} />}
    </button>
  );
}

/** 264 px sidebar: brand block, one captioned section of links, and the secure-session note at the bottom. */
export function Sidebar({ brand, tagline, navLabel, section, items, activeId, onSelect, note }: {
  brand: string;
  tagline: string;
  navLabel: string;
  section: string;
  items: NavEntry[];
  activeId: string;
  onSelect?: (id: string) => void;
  note?: { title: string; text: string };
}) {
  return (
    <aside className="rd-sidebar" aria-label={navLabel}>
      <div>
        <div className="rd-sidebar__brand">
          <BrandMark />
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span className="rd-wordmark">{brand}</span>
            <span className="rd-cap">{tagline}</span>
          </span>
        </div>
        <nav aria-label={navLabel} className="rd-sidebar__nav">
          <div className="rd-cap rd-sidebar__section">{section}</div>
          {items.map((item) => (
            <NavItem key={item.id} item={item} active={item.id === activeId} onSelect={onSelect} />
          ))}
        </nav>
      </div>
      {note && (
        <div className="rd-sidebar__note">
          <Icon name="shield" />
          <div>
            <span className="rd-label">{note.title}</span>
            <span className="rd-sm">{note.text}</span>
          </div>
        </div>
      )}
    </aside>
  );
}

export type Crumb = { label: string; href?: string };

/** The last crumb is the current page (ink, 600, `aria-current`). */
export function Breadcrumbs({ label, items }: { label: string; items: Crumb[] }) {
  return (
    <nav aria-label={label}>
      <ol className="rd-crumbs">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={c.label} aria-current={last ? "page" : undefined}>
              {!last && c.href ? <a href={c.href}>{c.label}</a> : c.label}
              {!last && <Icon name="chevronRight" size="sm" className="rd-crumb-sep" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ---- Surfaces -----------------------------------------------------------------------------------------------------

export function Avatar({ initials, size, soft }: { initials: string; size?: "sm"; soft?: boolean }) {
  return (
    <span className={clsx("rd-avatar", size === "sm" && "rd-avatar--sm", soft && "rd-avatar--soft")} aria-hidden="true">
      {initials}
    </span>
  );
}

export function Card({ title, meta, children, className }: { title?: string; meta?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx("rd-card", className)}>
      {title && (
        <header className="rd-card__head">
          <h3 className="rd-h3">{title}</h3>
          {meta}
        </header>
      )}
      <div className="rd-card__body">{children}</div>
    </section>
  );
}

/** Title toolbar: breadcrumb, h1, one-line description, secondary action(s) + ONE primary action (pass them as `actions`). */
export function TitleToolbar({ crumbs, crumbsLabel, title, description, actions }: { crumbs?: Crumb[]; crumbsLabel?: string; title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="rd-toolbar">
      {crumbs && crumbsLabel && <Breadcrumbs label={crumbsLabel} items={crumbs} />}
      <div className="rd-toolbar__row">
        <div className="rd-toolbar__title">
          <h1 className="rd-h1">{title}</h1>
          {description && <p className="rd-body">{description}</p>}
        </div>
        {actions && <div className="rd-toolbar__actions">{actions}</div>}
      </div>
    </div>
  );
}

/** Summary figure: small icon + label above a 32 px number (the design draws them inside one panel, no card each). */
export function SummaryTile({ icon, value, label, tone, sub }: { icon: IconName; value: number | string; label: string; tone?: "normal" | "abnormal" | "pending" | "critical"; sub?: string }) {
  return (
    <div className="rd-tile">
      <span className="rd-tile__label">
        <span className={clsx("rd-tile__icon", tone && `rd-tile__icon--${tone}`)}>
          <Icon name={icon} size="sm" />
        </span>
        {label}
      </span>
      <span className="rd-tile__value">{value}</span>
      {sub && <span className="rd-sm">{sub}</span>}
    </div>
  );
}
