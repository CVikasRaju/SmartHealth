/**
 * Shared display helpers.
 *
 * All formatting lives here so the clinical, supply, and billing screens render
 * numbers and dates identically. Nothing in this module reads state.
 */

const CURRENCY = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const CURRENCY_COMPACT = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  notation: "compact",
  maximumFractionDigits: 1,
});

const DATE = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const DATE_SHORT = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" });
const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "short" });

/** Join conditional class names. */
export function cx(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(" ");
}

export function formatCurrency(amount: number, options: { compact?: boolean } = {}): string {
  if (!Number.isFinite(amount)) return "—";
  return options.compact ? CURRENCY_COMPACT.format(amount) : CURRENCY.format(amount);
}

export function formatNumber(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : DATE.format(date);
}

export function formatDateShort(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : DATE_SHORT.format(date);
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : TIME.format(date);
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `${DATE.format(date)} · ${TIME.format(date)}`;
}

/** Human label such as "Today", "Yesterday", or "12 Sep 2026". */
export function formatDayLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const today = startOfDay(new Date());
  const target = startOfDay(date);
  const diff = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return `Today (${WEEKDAY.format(date)})`;
  if (diff === -1) return `Yesterday (${WEEKDAY.format(date)})`;
  if (diff === 1) return `Tomorrow (${WEEKDAY.format(date)})`;
  return DATE.format(date);
}

export function startOfDay(date: Date): Date {
  const copy = new Date(date.getTime());
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function isSameDay(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

/** Signed distance in days from now; negative means in the past. */
export function daysFromNow(iso: string): number {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.round((startOfDay(date).getTime() - startOfDay(new Date()).getTime()) / 86_400_000);
}

export function relativeFromNow(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const minutes = Math.round((date.getTime() - Date.now()) / 60_000);
  const absolute = Math.abs(minutes);

  if (absolute < 1) return "just now";
  if (absolute < 60) return minutes < 0 ? `${absolute} min ago` : `in ${absolute} min`;

  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return hours < 0 ? `${Math.abs(hours)} h ago` : `in ${hours} h`;

  const days = Math.round(hours / 24);
  if (days === -1) return "yesterday";
  if (days === 1) return "tomorrow";
  return days < 0 ? `${Math.abs(days)} days ago` : `in ${days} days`;
}

export function initials(fullName: string): string {
  const parts = fullName
    .replace(/^(Dr\.?|Sister|Nurse|Mr\.?|Mrs\.?|Ms\.?)\s+/i, "")
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Drop honorifics so tables show a compact, consistent name. */
export function displayName(fullName: string): string {
  return fullName.replace(/^(Dr\.?|Sister)\s+/i, "").trim();
}

export function percent(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

export function titleCase(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ageFromDob(dob: string): number {
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return 0;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDelta = now.getMonth() - birth.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < birth.getDate())) age--;
  return Math.max(0, age);
}
