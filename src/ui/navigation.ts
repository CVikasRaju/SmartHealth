/**
 * Navigation model.
 *
 * Each role portal declares its own modules. The RBAC matrix in
 * `docs/user-roles.md` maps directly onto these lists: a cashier simply has no
 * route for the shortage control room rather than a hidden button.
 */

import type { Role } from "@/types";
import type { IconName } from "@/ui/Icon";

export interface NavItem {
  id: string;
  label: string;
  icon: IconName;
  description: string;
}

export const NAV_BY_ROLE: Record<Role, NavItem[]> = {
  admin: [
    {
      id: "admin.control-room",
      label: "Shortage control room",
      icon: "shortage",
      description: "Live risk board across the formulary with drill-down evidence.",
    },
    {
      id: "admin.sandbox",
      label: "Scenario sandbox",
      icon: "sandbox",
      description: "Re-forecast the formulary under demand, supply and regional shocks.",
    },
    {
      id: "admin.analytics",
      label: "Hospital analytics",
      icon: "analytics",
      description: "Occupancy, revenue cycle and departmental throughput.",
    },
    {
      id: "admin.governance",
      label: "Governance & audit",
      icon: "governance",
      description: "Staff directory, alert ledger and the immutable action trail.",
    },
  ],
  doctor: [
    {
      id: "doctor.queue",
      label: "OPD queue",
      icon: "queue",
      description: "Today's consultations with triage acuity and patient context.",
    },
    {
      id: "doctor.prescribe",
      label: "CPOE console",
      icon: "prescribe",
      description: "Computerised prescribing with live stock guards and substitutes.",
    },
    {
      id: "doctor.reports",
      label: "Report simplifier",
      icon: "report",
      description: "Simplified lab panels and longitudinal biomarker trends.",
    },
  ],
  nurse: [
    {
      id: "nurse.emar",
      label: "eMAR round",
      icon: "emar",
      description: "Bedside medication administration schedule and charting.",
    },
    {
      id: "nurse.vitals",
      label: "Vitals & notes",
      icon: "vitals",
      description: "Bedside observation recording and shift notes.",
    },
    {
      id: "nurse.stock",
      label: "Ward stock",
      icon: "stock",
      description: "Ward-level holdings, par levels and cover by molecule.",
    },
  ],
  receptionist: [
    {
      id: "reception.register",
      label: "Patient registration",
      icon: "register",
      description: "Register new patients and capture allergies and contacts.",
    },
    {
      id: "reception.schedule",
      label: "Appointments & triage",
      icon: "calendar",
      description: "Schedule consultations, check patients in and set acuity.",
    },
    {
      id: "reception.reports",
      label: "Report intake",
      icon: "report",
      description: "Upload outside laboratory reports and run extraction.",
    },
  ],
  cashier: [
    {
      id: "cashier.invoices",
      label: "Invoice desk",
      icon: "invoice",
      description: "Build itemised invoices from clinical encounters.",
    },
    {
      id: "cashier.pos",
      label: "POS checkout",
      icon: "pos",
      description: "Collect payment by cash, card, UPI or insurance claim.",
    },
    {
      id: "cashier.reconciliation",
      label: "Reconciliation",
      icon: "reconcile",
      description: "Daily collection summary by payment method and status.",
    },
  ],
  patient: [
    {
      id: "patient.reports",
      label: "My reports",
      icon: "report",
      description: "Upload a lab report and read the plain-language explanation.",
    },
    {
      id: "patient.trends",
      label: "Health trends",
      icon: "trends",
      description: "Longitudinal biomarker history against reference ranges.",
    },
    {
      id: "patient.appointments",
      label: "Appointments",
      icon: "calendar",
      description: "Upcoming and past consultations, with prescribed medication.",
    },
  ],
};

/** Landing view for each role. */
export const HOME_VIEW: Record<Role, string> = {
  admin: "admin.control-room",
  doctor: "doctor.queue",
  nurse: "nurse.emar",
  receptionist: "reception.schedule",
  cashier: "cashier.invoices",
  patient: "patient.reports",
};

/** Default staff member and patient for each role, used when switching roles. */
export const ROLE_DEFAULTS: Record<Role, { staffId: string; patientId: string }> = {
  admin: { staffId: "staff-admin-1", patientId: "patient-2" },
  doctor: { staffId: "staff-doctor-1", patientId: "patient-2" },
  nurse: { staffId: "staff-nurse-1", patientId: "patient-1" },
  receptionist: { staffId: "staff-reception-1", patientId: "patient-4" },
  cashier: { staffId: "staff-cashier-1", patientId: "patient-3" },
  patient: { staffId: "staff-admin-1", patientId: "patient-2" },
};

/** Resolve the nav item for a view id, falling back to the role's landing page. */
export function findNavItem(role: Role, viewId: string): NavItem {
  const items = NAV_BY_ROLE[role];
  return items.find((item) => item.id === viewId) ?? items[0];
}

/** True when the view id belongs to the given role. */
export function viewBelongsToRole(role: Role, viewId: string): boolean {
  return NAV_BY_ROLE[role].some((item) => item.id === viewId);
}
