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
  return <section className={cx("sm-panel", padded && "p-4", className)}>{children}</section>;
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
    <header className={cx("mb-3.5 flex items-start justify-between gap-4 border-b border-rule-soft pb-3", className)}>
      <div className="flex min-w-0 items-start gap-2.5">
        {icon ? <span className="mt-0.5 text-ink-400">{icon}</span> : null}
        <div className="min-w-0">
          <h2 className="text-[15px] leading-snug">{title}</h2>
          {subtitle ? <p className="mt-1 text-xs leading-relaxed text-ink-500">{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-2.5 flex items-baseline gap-2">
      <h3 className="sm-eyebrow text-ink-500">{children}</h3>
      {hint ? <span className="text-[11px] text-ink-400">{hint}</span> : null}
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
    <div className={cx("border border-dashed border-rule-strong bg-paper-tint px-5 py-8 text-center", className)}>
      <p className="text-sm font-semibold text-ink-700">{title}</p>
      {description ? <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-ink-500">{description}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
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
    <span className={cx("sm-chip", token ? token.chip : "border-rule bg-canvas text-ink-500", className)}>
      {token ? <span className="h-1.5 w-1.5" style={{ background: token.hex }} /> : null}
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
      className={cx("w-full overflow-hidden border border-rule-soft bg-canvas", className)}
      style={{ height }}
      role="progressbar"
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="h-full transition-[width] duration-500" style={{ width: `${ratio * 100}%`, background: color }} />
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
    <div className="border border-rule-soft bg-paper-tint p-3">
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
/* Stat tiles                                                          */
/* ------------------------------------------------------------------ */

export function StatTile({
  label,
  value,
  hint,
  tone = "default",
  footer,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "danger" | "warning" | "success" | "accent";
  footer?: ReactNode;
}) {
  const tones: Record<string, string> = {
    default: "text-ink-900",
    danger: "text-risk-critical",
    warning: "text-risk-high",
    success: "text-risk-normal",
    accent: "text-accent",
  };

  return (
    <div className="border border-rule bg-paper p-3.5">
      <p className="sm-eyebrow">{label}</p>
      <p className={cx("mt-1.5 font-serif text-3xl leading-none", tones[tone])}>{value}</p>
      {hint ? <p className="mt-1.5 text-[11px] leading-relaxed text-ink-500">{hint}</p> : null}
      {footer ? <div className="mt-3 border-t border-rule-soft pt-2.5">{footer}</div> : null}
    </div>
  );
}

export function KeyValue({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="sm-eyebrow">{item.label}</dt>
          <dd className="mt-0.5 truncate text-sm text-ink-900">{item.value}</dd>
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
  primary: "border border-accent bg-accent text-white hover:bg-accent-deep font-semibold",
  secondary: "border border-rule-strong bg-paper text-ink-900 hover:bg-canvas",
  ghost: "border border-transparent text-ink-500 hover:border-rule hover:bg-canvas hover:text-ink-900",
  danger: "border border-risk-critical/50 bg-risk-critical/[0.07] text-risk-critical hover:bg-risk-critical/[0.14]",
  success: "border border-risk-normal/50 bg-risk-normal/[0.07] text-risk-normal hover:bg-risk-normal/[0.14]",
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
        "inline-flex items-center justify-center gap-1.5 transition disabled:cursor-not-allowed disabled:opacity-40",
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
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
      {error ? <span className="mt-1 block text-[11px] font-medium text-risk-critical">{error}</span> : null}
      {!error && hint ? <span className="mt-1 block text-[11px] text-ink-400">{hint}</span> : null}
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
    <div className={cx("flex flex-wrap items-end gap-0 border-b border-rule", className)}>
      {tabs.map((tab) => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={cx(
              "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs transition",
              isActive
                ? "border-accent bg-paper font-semibold text-accent"
                : "border-transparent text-ink-500 hover:border-rule hover:text-ink-900",
            )}
          >
            {tab.label}
            {tab.badge !== undefined ? (
              <span className="border border-rule bg-canvas px-1.5 text-[10px] font-semibold text-ink-500">
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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-900/45 p-4 sm:p-8">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx("animate-rise-in w-full border border-rule-strong bg-paper shadow-sheet", width)}
      >
        <div className="flex items-start justify-between gap-4 border-b border-rule bg-canvas px-4 py-3">
          <div>
            <h2 className="text-base leading-tight">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-xs text-ink-500">{subtitle}</p> : null}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} title="Close">
            ✕
          </Button>
        </div>
        <div className="max-h-[68vh] overflow-y-auto p-4">{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-rule bg-canvas px-4 py-3">{footer}</div> : null}
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
