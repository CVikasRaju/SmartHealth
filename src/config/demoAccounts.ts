/**
 * Demonstration accounts.
 *
 * The identities `npm run seed` provisions in Supabase, declared once so the
 * sign-in screen and `npm run verify:live` cannot disagree. They live in a plain
 * module rather than inside the page because a list advertised in the UI is a
 * promise, and a promise is worth checking against the identity provider.
 *
 * These credentials are for evaluation only. Delete or replace the accounts
 * before the system holds anything real.
 */

import type { Role } from "../types";

export interface DemoAccount {
  role: Role;
  email: string;
  /** How the account is described on the sign-in screen. */
  label: string;
}

/** The password every seeded identity shares. */
export const DEMO_PASSWORD = "SmartMedic@2026";

export const SEEDED_ACCOUNTS: readonly DemoAccount[] = [
  { role: "superadmin", email: "superadmin@smartmedic.io", label: "Super Admin (Platform Governance)" },
  { role: "admin", email: "meera.krishnan@smartmedic.io", label: "Hospital Admin (KMC Hospital)" },
  { role: "doctor", email: "dr.sharma@smartmedic.io", label: "Doctor (Pulmonology / OPD)" },
  { role: "nurse", email: "fatima.sheikh@smartmedic.io", label: "Nurse (ICU & Wards)" },
  { role: "receptionist", email: "kavya.nair@smartmedic.io", label: "Receptionist (Front Desk / Triage)" },
  { role: "cashier", email: "arjun.deshpande@smartmedic.io", label: "Cashier (Billing & POS)" },
  { role: "patient", email: "priya.sharma@example.com", label: "Patient (Health Record Portal)" },
];
