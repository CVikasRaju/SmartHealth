/**
 * Shared UI primitives.
 *
 * Small, unopinionated building blocks used by every portal: surfaces, chips,
 * form controls, stat tiles, and a modal. Keeping them here means the clinical
 * and financial screens share one visual language without a component library.
 *
 * The styling follows a printed-record convention: white sheets, hairline
 * rules, squared corners, and no glow or blur effects anywhere.
 */

import type { ChangeEvent, ReactNode } from "react";
import { useEffect } from "react";
import { cx } from "@/utils/format";
import { CHART_PRIMARY, type Token } from "@/ui/theme";

/* ------------------------------------------------------------------ */
/* Surfaces                                                            */
/* ------------------------------------------------------------------ */

export function Panel({
  children,
  className,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return <section className={cx("sm-panel", padded && "p-4 sm:p-5", className)}>{children}</section>;
}

export function PanelHeader({
  title,
  subtitle,
  icon,
  actions,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cx("mb-4 flex items-start justify-between gap-4 border-b border-rule-soft pb-3", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon ? <span className="mt-0.5 text-accent">{icon}</span> : null}
        <div className="min-w-0">
          <h2 className="text-base font-bold tracking-tight text-ink-900">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs leading-relaxed text-ink-500">{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline gap-2">
      <h3 className="sm-eyebrow">{children}</h3>
      {hint ? <span className="text-xs text-ink-400">{hint}</span> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("border border-dashed border-rule-strong/40 bg-canvas/40 px-6 py-7 text-center rounded", className)}>
      <p className="text-xs font-semibold text-ink-800">{title}</p>
      {description ? <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-ink-500">{description}</p> : null}
      {action ? <div className="mt-3 flex justify-center">{action}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Chips and indicators                                                */
/* ------------------------------------------------------------------ */

export function Chip({
  children,
  token,
  className,
}: {
  children?: ReactNode;
  token?: Token;
  className?: string;
}) {
  return (
    <span className={cx("sm-chip", token ? token.chip : "border-rule bg-canvas text-ink-600", className)}>
      {token ? <span className="h-1.5 w-1.5 rounded-full" style={{ background: token.hex }} /> : null}
      {children ?? token?.label}
    </span>
  );
}

export function Dot({ color, pulse = false }: { color: string; pulse?: boolean }) {
  return (
    <span className="relative inline-flex h-2 w-2">
      {pulse ? (
        <span
          className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full"
          style={{ background: color }}
        />
      ) : null}
      <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: color }} />
    </span>
  );
}

export function ProgressBar({
  value,
  max = 100,
  color = CHART_PRIMARY,
  className,
  height = 6,
}: {
  value: number;
  max?: number;
  color?: string;
  className?: string;
  height?: number;
}) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div
      className={cx("w-full overflow-hidden rounded-sm border border-rule-soft bg-canvas", className)}
      style={{ height }}
      role="progressbar"
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="h-full transition-[width] duration-300" style={{ width: `${ratio * 100}%`, background: color }} />
    </div>
  );
}

/** Compact horizontal meter used for triangulated signal legs. */
export function SignalMeter({
  label,
  detail,
  points,
  maxPoints,
  color,
}: {
  label: string;
  detail: string;
  points: number;
  maxPoints: number;
  color: string;
}) {
  const ratio = maxPoints > 0 ? Math.min(1, points / maxPoints) : 0;
  return (
    <div className="border border-rule-soft bg-paper-tint p-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold text-ink-900">{label}</span>
        <span className="text-xs text-ink-500">
          <span className="font-semibold text-ink-900">{points.toFixed(1)}</span> / {maxPoints}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden border border-rule-soft bg-canvas">
        <div className="h-full" style={{ width: `${ratio * 100}%`, background: color }} />
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-ink-500">{detail}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stat tiles and key-value grids                                      */
/* ------------------------------------------------------------------ */

export function StatTile({
  label,
  value,
  hint,
  tone = "default",
  trend,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "accent" | "danger" | "warn" | "warning" | "success" | "neutral";
  trend?: ReactNode;
  className?: string;
}) {
  const tones: Record<string, string> = {
    default: "border-rule bg-paper",
    neutral: "border-rule bg-paper",
    accent: "border-accent/30 bg-accent-soft text-accent",
    danger: "border-risk-critical/30 bg-risk-critical/[0.04]",
    warn: "border-risk-high/30 bg-risk-high/[0.04]",
    warning: "border-risk-high/30 bg-risk-high/[0.04]",
    success: "border-risk-normal/30 bg-risk-normal/[0.04]",
  };

  return (
    <div className={cx("rounded border p-3.5 shadow-panel", tones[tone] ?? tones.default, className)}>
      <div className="flex items-start justify-between gap-2">
        <span className="sm-eyebrow">{label}</span>
        {trend}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="font-serif text-2xl font-semibold tracking-tight text-ink-900">{value}</span>
      </div>
      {hint ? <p className="mt-1 text-[11px] leading-relaxed text-ink-500">{hint}</p> : null}
    </div>
  );
}

export function MetricStrip({
  items,
  metrics,
  className,
}: {
  items?: { label: string; value: ReactNode; hint?: ReactNode; tone?: string }[];
  metrics?: { label: string; value: ReactNode; hint?: ReactNode; tone?: string }[];
  className?: string;
}) {
  const list = items ?? metrics ?? [];
  return (
    <div className={cx("grid grid-cols-2 gap-3 sm:grid-cols-4", className)}>
      {list.map((metric) => (
        <div key={metric.label} className="rounded border border-rule bg-paper p-3 shadow-panel">
          <p className="sm-eyebrow">{metric.label}</p>
          <p className="mt-1 font-serif text-xl font-semibold text-ink-900">{metric.value}</p>
          {metric.hint ? <p className="mt-0.5 text-[10px] text-ink-400">{metric.hint}</p> : null}
        </div>
      ))}
    </div>
  );
}

export function KeyValue({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="sm-eyebrow">{item.label}</dt>
          <dd className="mt-0.5 truncate text-xs font-medium text-ink-900">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";

export interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  size?: "sm" | "md";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
  title?: string;
  fullWidth?: boolean;
}

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "border border-accent bg-accent text-white hover:bg-accent-deep transition",
  secondary: "border border-rule bg-paper text-ink-800 hover:border-rule-strong hover:bg-canvas transition",
  ghost: "border border-transparent text-ink-600 hover:bg-canvas hover:text-ink-900 transition",
  danger: "border border-risk-critical/40 bg-risk-critical/[0.06] text-risk-critical hover:bg-risk-critical/[0.12] transition",
  success: "border border-risk-normal/40 bg-risk-normal/[0.06] text-risk-normal hover:bg-risk-normal/[0.12] transition",
};

export function Button({
  children,
  onClick,
  variant = "secondary",
  size = "md",
  disabled,
  type = "button",
  className,
  title,
  fullWidth,
}: ButtonProps) {
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded font-medium disabled:cursor-not-allowed disabled:opacity-40",
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-xs",
        BUTTON_VARIANTS[variant],
        fullWidth && "w-full",
        className,
      )}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Form controls                                                       */
/* ------------------------------------------------------------------ */

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx("block", className)}>
      <span className="sm-label">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs font-medium text-risk-critical">{error}</span> : null}
      {!error && hint ? <span className="mt-1 block text-xs text-ink-400">{hint}</span> : null}
    </label>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  type = "text",
  required,
  min,
  max,
  step,
  disabled,
}: {
  value: string | number;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}) {
  return (
    <input
      className="sm-input"
      value={value}
      type={type}
      required={required}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
    />
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  disabled,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; disabled?: boolean }[];
  disabled?: boolean;
}) {
  return (
    <select
      className="sm-input"
      value={value}
      disabled={disabled}
      onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(event.target.value as T)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled} className="bg-paper">
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function TextArea({
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      className="sm-input resize-y"
      rows={rows}
      value={value}
      placeholder={placeholder}
      onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Tabs                                                                */
/* ------------------------------------------------------------------ */

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: { id: T; label: string; badge?: ReactNode }[];
  active: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-wrap gap-1 border-b border-rule pb-px", className)}>
      {tabs.map((tab) => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={cx(
              "inline-flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-xs font-semibold transition",
              isActive
                ? "border-accent bg-accent-soft text-accent"
                : "border-transparent text-ink-600 hover:border-rule hover:text-ink-900",
            )}
          >
            {tab.label}
            {tab.badge !== undefined ? (
              <span className={cx("rounded px-1.5 py-0.2 text-[10px]", isActive ? "bg-accent text-white" : "bg-canvas text-ink-500")}>
                {tab.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Overlay                                                             */
/* ------------------------------------------------------------------ */

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = "max-w-2xl",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4 sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx("animate-rise-in w-full rounded-lg border border-rule-strong bg-paper shadow-sheet overflow-hidden", width)}
      >
        <div className="flex items-start justify-between gap-4 border-b border-rule bg-canvas/40 px-5 py-3.5">
          <div>
            <h2 className="text-sm font-bold text-ink-900 leading-tight">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-xs text-ink-500 leading-relaxed">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-6 w-6 place-items-center rounded text-ink-400 hover:bg-canvas hover:text-ink-800 transition"
            title="Close"
          >
            ✕
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-5">{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-rule bg-canvas/30 px-5 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tables                                                              */
/* ------------------------------------------------------------------ */

export function DataTable({
  head,
  children,
  className,
  empty,
}: {
  head: (string | ReactNode)[];
  children: ReactNode;
  className?: string;
  empty?: ReactNode;
}) {
  const isEmpty = Array.isArray(children) ? children.length === 0 : !children;
  return (
    <div className={cx("-mx-1 overflow-x-auto", className)}>
      <table className="w-full min-w-[42rem] border-collapse">
        <thead>
          <tr>
            {head.map((cell, index) => (
              <th key={index} className="sm-th">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isEmpty ? (
            <tr>
              <td className="sm-td text-center text-ink-400" colSpan={head.length}>
                {empty ?? "No records."}
              </td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  );
}
