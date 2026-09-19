/**
 * Presentation tokens.
 *
 * Every screen pulls its risk, status, and role colouring from here so a
 * critical shortage looks identical in the control room, the CPOE banner, and
 * the alert rail.
 */

import type {
  Acuity,
  AdministrationStatus,
  AppointmentStatus,
  BiomarkerStatus,
  PaymentStatus,
  RiskTier,
  Role,
} from "@/types";

export interface Token {
  label: string;
  /** Tailwind classes for text, background and border chips. */
  chip: string;
  /** Solid hex used for charts and dots. */
  hex: string;
  /** Short severity ordering, 0 (calm) to 3 (severe). */
  rank: number;
}

export const RISK_TOKENS: Record<RiskTier, Token> = {
  critical: {
    label: "Critical",
    chip: "border-rose-400/40 bg-rose-500/15 text-rose-200",
    hex: "#f43f5e",
    rank: 3,
  },
  high: {
    label: "High",
    chip: "border-orange-400/40 bg-orange-500/15 text-orange-200",
    hex: "#fb923c",
    rank: 2,
  },
  moderate: {
    label: "Moderate",
    chip: "border-yellow-400/40 bg-yellow-500/15 text-yellow-200",
    hex: "#facc15",
    rank: 1,
  },
  normal: {
    label: "Normal",
    chip: "border-emerald-400/40 bg-emerald-500/15 text-emerald-200",
    hex: "#34d399",
    rank: 0,
  },
};

export const ACUITY_TOKENS: Record<Acuity, Token> = {
  critical: { label: "Critical", chip: "border-rose-400/40 bg-rose-500/15 text-rose-200", hex: "#f43f5e", rank: 3 },
  urgent: { label: "Urgent", chip: "border-orange-400/40 bg-orange-500/15 text-orange-200", hex: "#fb923c", rank: 2 },
  standard: { label: "Standard", chip: "border-sky-400/40 bg-sky-500/15 text-sky-200", hex: "#38bdf8", rank: 1 },
  routine: { label: "Routine", chip: "border-slate-400/30 bg-slate-500/15 text-slate-300", hex: "#94a3b8", rank: 0 },
};

export const APPOINTMENT_STATUS_TOKENS: Record<AppointmentStatus, Token> = {
  scheduled: { label: "Scheduled", chip: "border-sky-400/40 bg-sky-500/10 text-sky-200", hex: "#38bdf8", rank: 0 },
  checked_in: { label: "Checked in", chip: "border-cyan-400/40 bg-cyan-500/10 text-cyan-200", hex: "#22d3ee", rank: 1 },
  in_consult: { label: "In consult", chip: "border-violet-400/40 bg-violet-500/10 text-violet-200", hex: "#a78bfa", rank: 2 },
  completed: { label: "Completed", chip: "border-emerald-400/40 bg-emerald-500/10 text-emerald-200", hex: "#34d399", rank: 3 },
  cancelled: { label: "Cancelled", chip: "border-slate-500/30 bg-slate-500/10 text-slate-400", hex: "#64748b", rank: 3 },
  no_show: { label: "No show", chip: "border-amber-400/30 bg-amber-500/10 text-amber-200", hex: "#fbbf24", rank: 3 },
};

export const BIOMARKER_STATUS_TOKENS: Record<BiomarkerStatus, Token> = {
  normal: { label: "Within range", chip: "border-emerald-400/40 bg-emerald-500/10 text-emerald-200", hex: "#34d399", rank: 0 },
  low: { label: "Below range", chip: "border-amber-400/40 bg-amber-500/10 text-amber-200", hex: "#fbbf24", rank: 1 },
  elevated: { label: "Above range", chip: "border-orange-400/40 bg-orange-500/10 text-orange-200", hex: "#fb923c", rank: 2 },
  critical_low: { label: "Markedly low", chip: "border-rose-400/40 bg-rose-500/15 text-rose-200", hex: "#f43f5e", rank: 3 },
  critical_high: { label: "Markedly high", chip: "border-rose-400/40 bg-rose-500/15 text-rose-200", hex: "#f43f5e", rank: 3 },
  unknown: { label: "Unclassified", chip: "border-slate-500/30 bg-slate-500/10 text-slate-400", hex: "#64748b", rank: 0 },
};

export const PAYMENT_STATUS_TOKENS: Record<PaymentStatus, Token> = {
  paid: { label: "Paid", chip: "border-emerald-400/40 bg-emerald-500/10 text-emerald-200", hex: "#34d399", rank: 0 },
  partially_paid: { label: "Partly paid", chip: "border-amber-400/40 bg-amber-500/10 text-amber-200", hex: "#fbbf24", rank: 1 },
  unpaid: { label: "Unpaid", chip: "border-rose-400/40 bg-rose-500/10 text-rose-200", hex: "#f43f5e", rank: 2 },
  refunded: { label: "Refunded", chip: "border-slate-500/30 bg-slate-500/10 text-slate-400", hex: "#64748b", rank: 3 },
};

export const ADMINISTRATION_STATUS_TOKENS: Record<AdministrationStatus, Token> = {
  given: { label: "Given", chip: "border-emerald-400/40 bg-emerald-500/10 text-emerald-200", hex: "#34d399", rank: 0 },
  held: { label: "Held", chip: "border-amber-400/40 bg-amber-500/10 text-amber-200", hex: "#fbbf24", rank: 1 },
  refused: { label: "Refused", chip: "border-orange-400/40 bg-orange-500/10 text-orange-200", hex: "#fb923c", rank: 2 },
  missed: { label: "Missed", chip: "border-rose-400/40 bg-rose-500/10 text-rose-200", hex: "#f43f5e", rank: 3 },
};

export const SEVERITY_TOKENS: Record<"mild" | "moderate" | "severe", Token> = {
  mild: { label: "Mild", chip: "border-slate-400/30 bg-slate-500/10 text-slate-300", hex: "#94a3b8", rank: 0 },
  moderate: { label: "Moderate", chip: "border-amber-400/40 bg-amber-500/10 text-amber-200", hex: "#fbbf24", rank: 1 },
  severe: { label: "Severe", chip: "border-rose-400/40 bg-rose-500/15 text-rose-200", hex: "#f43f5e", rank: 2 },
};

export interface RoleMeta {
  label: string;
  /** Persona shown in the switcher, so a judge knows who they are acting as. */
  persona: string;
  summary: string;
  accent: string;
}

export const ROLE_META: Record<Role, RoleMeta> = {
  admin: {
    label: "Admin",
    persona: "Meera Krishnan · Hospital Administration",
    summary: "System-wide shortage control room, scenario simulation and hospital analytics.",
    accent: "#f43f5e",
  },
  doctor: {
    label: "Doctor",
    persona: "Dr. Ramesh Sharma · Pulmonology & General Medicine",
    summary: "Outpatient queue and CPOE prescribing with live stock guards and substitutes.",
    accent: "#22d3ee",
  },
  nurse: {
    label: "Nurse",
    persona: "Sister Fatima Sheikh · Intensive Care Unit",
    summary: "Bedside eMAR administration round and vitals recording.",
    accent: "#34d399",
  },
  receptionist: {
    label: "Receptionist",
    persona: "Kavya Nair · Front Office & Triage",
    summary: "Patient registration, triage acuity and appointment scheduling.",
    accent: "#a78bfa",
  },
  cashier: {
    label: "Cashier",
    persona: "Arjun Deshpande · Billing & Revenue Cycle",
    summary: "Itemised invoicing, POS collection and payment reconciliation.",
    accent: "#fbbf24",
  },
  patient: {
    label: "Patient",
    persona: "Priya Sharma · MRN-2026-0002",
    summary: "Report simplifier portal with plain-language explanations and trendlines.",
    accent: "#38bdf8",
  },
};

/** Ordered palette for multi-series charts. */
export const CHART_PALETTE = ["#22d3ee", "#a78bfa", "#34d399", "#fbbf24", "#fb923c", "#f43f5e", "#38bdf8"];
