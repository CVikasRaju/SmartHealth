/**
 * Presentation tokens.
 *
 * Every screen pulls its risk, status, and role colouring from here so a
 * critical shortage looks identical in the control room, the CPOE banner, and
 * the alert rail.
 *
 * The palette is deliberately restrained: a single institutional navy for
 * interactive chrome, and a muted, print-safe severity ramp that stays legible
 * on white paper and on a clinic's washed-out monitor alike.
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

const CRITICAL_CHIP = "border-risk-critical/45 bg-risk-critical/[0.07] text-risk-critical";
const HIGH_CHIP = "border-risk-high/45 bg-risk-high/[0.07] text-risk-high";
const MODERATE_CHIP = "border-risk-moderate/45 bg-risk-moderate/[0.07] text-risk-moderate";
const NORMAL_CHIP = "border-risk-normal/45 bg-risk-normal/[0.07] text-risk-normal";
const NEUTRAL_CHIP = "border-rule bg-canvas text-ink-500";

export const RISK_TOKENS: Record<RiskTier, Token> = {
  critical: { label: "Critical", chip: CRITICAL_CHIP, hex: "#a4232b", rank: 3 },
  high: { label: "High", chip: HIGH_CHIP, hex: "#a1590f", rank: 2 },
  moderate: { label: "Moderate", chip: MODERATE_CHIP, hex: "#8a6a06", rank: 1 },
  normal: { label: "Normal", chip: NORMAL_CHIP, hex: "#1c6b3c", rank: 0 },
};

export const ACUITY_TOKENS: Record<Acuity, Token> = {
  critical: { label: "Critical", chip: CRITICAL_CHIP, hex: "#a4232b", rank: 3 },
  urgent: { label: "Urgent", chip: HIGH_CHIP, hex: "#a1590f", rank: 2 },
  standard: { label: "Standard", chip: "border-accent/40 bg-accent-soft text-accent", hex: "#14416b", rank: 1 },
  routine: { label: "Routine", chip: NEUTRAL_CHIP, hex: "#767d87", rank: 0 },
};

export const APPOINTMENT_STATUS_TOKENS: Record<AppointmentStatus, Token> = {
  scheduled: { label: "Scheduled", chip: "border-accent/40 bg-accent-soft text-accent", hex: "#14416b", rank: 0 },
  checked_in: { label: "Checked in", chip: "border-accent/40 bg-accent-soft text-accent", hex: "#1c5f6b", rank: 1 },
  in_consult: { label: "In consult", chip: "border-rule-strong bg-canvas text-ink-700", hex: "#5a3a7a", rank: 2 },
  completed: { label: "Completed", chip: NORMAL_CHIP, hex: "#1c6b3c", rank: 3 },
  cancelled: { label: "Cancelled", chip: NEUTRAL_CHIP, hex: "#98a0a8", rank: 3 },
  no_show: { label: "No show", chip: MODERATE_CHIP, hex: "#8a6a06", rank: 3 },
};

export const BIOMARKER_STATUS_TOKENS: Record<BiomarkerStatus, Token> = {
  normal: { label: "Within range", chip: NORMAL_CHIP, hex: "#1c6b3c", rank: 0 },
  low: { label: "Below range", chip: MODERATE_CHIP, hex: "#8a6a06", rank: 1 },
  elevated: { label: "Above range", chip: HIGH_CHIP, hex: "#a1590f", rank: 2 },
  critical_low: { label: "Markedly low", chip: CRITICAL_CHIP, hex: "#a4232b", rank: 3 },
  critical_high: { label: "Markedly high", chip: CRITICAL_CHIP, hex: "#a4232b", rank: 3 },
  unknown: { label: "Unclassified", chip: NEUTRAL_CHIP, hex: "#767d87", rank: 0 },
};

export const PAYMENT_STATUS_TOKENS: Record<PaymentStatus, Token> = {
  paid: { label: "Paid", chip: NORMAL_CHIP, hex: "#1c6b3c", rank: 0 },
  partially_paid: { label: "Partly paid", chip: MODERATE_CHIP, hex: "#8a6a06", rank: 1 },
  unpaid: { label: "Unpaid", chip: CRITICAL_CHIP, hex: "#a4232b", rank: 2 },
  refunded: { label: "Refunded", chip: NEUTRAL_CHIP, hex: "#767d87", rank: 3 },
};

export const ADMINISTRATION_STATUS_TOKENS: Record<AdministrationStatus, Token> = {
  given: { label: "Given", chip: NORMAL_CHIP, hex: "#1c6b3c", rank: 0 },
  held: { label: "Held", chip: MODERATE_CHIP, hex: "#8a6a06", rank: 1 },
  refused: { label: "Refused", chip: HIGH_CHIP, hex: "#a1590f", rank: 2 },
  missed: { label: "Missed", chip: CRITICAL_CHIP, hex: "#a4232b", rank: 3 },
};

export const SEVERITY_TOKENS: Record<"mild" | "moderate" | "severe", Token> = {
  mild: { label: "Mild", chip: NEUTRAL_CHIP, hex: "#767d87", rank: 0 },
  moderate: { label: "Moderate", chip: MODERATE_CHIP, hex: "#8a6a06", rank: 1 },
  severe: { label: "Severe", chip: CRITICAL_CHIP, hex: "#a4232b", rank: 2 },
};

export interface RoleMeta {
  label: string;
  /** Persona shown in the switcher, so a judge knows who they are acting as. */
  persona: string;
  summary: string;
  accent: string;
}

/**
 * Role accents are drawn from one institutional family rather than a neon set,
 * so six portals stay visually distinct without looking like six products.
 */
export const ROLE_META: Record<Role, RoleMeta> = {
  admin: {
    label: "Admin",
    persona: "Meera Krishnan · Hospital Administration",
    summary: "System-wide shortage control room, scenario simulation and hospital analytics.",
    accent: "#14416b",
  },
  doctor: {
    label: "Doctor",
    persona: "Dr. Ramesh Sharma · Pulmonology & General Medicine",
    summary: "Outpatient queue and CPOE prescribing with live stock guards and substitutes.",
    accent: "#1c5f6b",
  },
  nurse: {
    label: "Nurse",
    persona: "Sister Fatima Sheikh · Intensive Care Unit",
    summary: "Bedside eMAR administration round and vitals recording.",
    accent: "#1c6b3c",
  },
  receptionist: {
    label: "Receptionist",
    persona: "Kavya Nair · Front Office & Triage",
    summary: "Patient registration, triage acuity and appointment scheduling.",
    accent: "#5a3a7a",
  },
  cashier: {
    label: "Cashier",
    persona: "Arjun Deshpande · Billing & Revenue Cycle",
    summary: "Itemised invoicing, POS collection and payment reconciliation.",
    accent: "#8a6a06",
  },
  patient: {
    label: "Patient",
    persona: "Priya Sharma · MRN-2026-0002",
    summary: "Report simplifier portal with plain-language explanations and trendlines.",
    accent: "#3a4a5c",
  },
};

/** Ordered palette for multi-series charts. */
export const CHART_PALETTE = ["#14416b", "#1c6b3c", "#8a6a06", "#5a3a7a", "#a1590f", "#a4232b", "#1c5f6b"];

/** Default series colour, so a chart with no explicit colour still matches the chrome. */
export const CHART_PRIMARY = "#14416b";
