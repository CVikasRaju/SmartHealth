/**
 * Pure application reducer.
 *
 * Every clinical, supply, and financial mutation in the prototype flows through
 * this one function. Keeping it pure means a mutation can be replayed, tested,
 * or diffed without touching React, and it is what makes the audit trail
 * trustworthy: each case writes exactly one ledger entry.
 */

import type {
  Acuity,
  AdministrationStatus,
  Appointment,
  AppState,
  AppointmentStatus,
  AuditEntry,
  DatabaseState,
  Invoice,
  MedicalReport,
  Patient,
  PaymentTransaction,
  Role,
  ShortageAlert,
  TransferProposal,
  Treatment,
  VitalsRecord,
} from "@/types";
import { applyWardTransfer, dispenseStock } from "@/engine/shortageEngine";
import { derivePaymentStatus } from "@/engine/billingEngine";

/** Who performed an action, captured for the immutable audit ledger. */
export interface ActorRef {
  id: string;
  name: string;
  role: Role;
}

export type AppAction =
  | { type: "session/setRole"; role: Role }
  | { type: "session/setStaff"; staffId: string }
  | { type: "session/setPatient"; patientId: string }
  | { type: "session/setView"; view: string }
  | { type: "patient/register"; patient: Patient; actor: ActorRef }
  | { type: "appointment/create"; appointment: Appointment; actor: ActorRef }
  | {
      type: "appointment/status";
      id: string;
      status: AppointmentStatus;
      queuePosition?: number | null;
      actor: ActorRef;
    }
  | {
      type: "appointment/triage";
      id: string;
      acuity: Acuity;
      notes: string;
      doctorId: string;
      actor: ActorRef;
    }
  | { type: "treatment/create"; treatment: Treatment; actor: ActorRef }
  | {
      type: "administration/record";
      id: string;
      status: AdministrationStatus;
      vitalsId: string | null;
      notes: string;
      actor: ActorRef;
    }
  | { type: "vitals/record"; vitals: VitalsRecord; actor: ActorRef }
  | { type: "invoice/create"; invoice: Invoice; actor: ActorRef }
  | { type: "invoice/pay"; invoiceId: string; transaction: PaymentTransaction; actor: ActorRef }
  | { type: "report/add"; report: MedicalReport; actor: ActorRef }
  | { type: "report/note"; reportId: string; notes: string; actor: ActorRef }
  | {
      type: "transfer/decide";
      proposal: TransferProposal;
      decision: "approved" | "rejected";
      actor: ActorRef;
    }
  | { type: "alert/acknowledge"; alert: ShortageAlert; actor: ActorRef }
  | { type: "demo/reset"; db: DatabaseState };

/** Append an audit entry and advance the audit counter. */
function applyAudit(
  db: DatabaseState,
  actor: ActorRef,
  action: string,
  target: string,
  detail: string,
): DatabaseState {
  const sequence = (db.counters.audit ?? 0) + 1;
  const entry: AuditEntry = {
    id: `audit-${String(sequence).padStart(5, "0")}`,
    at: new Date().toISOString(),
    actorId: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    action,
    target,
    detail,
  };

  // The ledger is capped so a long demo session cannot grow without bound.
  return {
    ...db,
    auditLog: [entry, ...db.auditLog].slice(0, 500),
    counters: { ...db.counters, audit: sequence },
  };
}

function bumpCounter(db: DatabaseState, key: string): DatabaseState {
  return { ...db, counters: { ...db.counters, [key]: (db.counters[key] ?? 0) + 1 } };
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "session/setRole":
      return { ...state, session: { ...state.session, role: action.role } };

    case "session/setStaff":
      return { ...state, session: { ...state.session, staffId: action.staffId } };

    case "session/setPatient":
      return { ...state, session: { ...state.session, patientId: action.patientId } };

    case "session/setView":
      return { ...state, activeView: action.view };

    case "patient/register": {
      const db = applyAudit(
        { ...state.db, patients: [action.patient, ...state.db.patients] },
        action.actor,
        "patient.register",
        action.patient.mrn,
        `Registered ${action.patient.name} (${action.patient.gender}, ${action.patient.bloodGroup}) at the front desk.`,
      );
      return { ...state, db: bumpCounter(db, "patient") };
    }

    case "appointment/create": {
      const db = applyAudit(
        { ...state.db, appointments: [...state.db.appointments, action.appointment] },
        action.actor,
        "appointment.create",
        action.appointment.id,
        `Scheduled ${action.appointment.reason} for ${new Date(action.appointment.scheduledFor).toLocaleString("en-GB")}.`,
      );
      return { ...state, db: bumpCounter(db, "appointment") };
    }

    case "appointment/status": {
      const target = state.db.appointments.find((item) => item.id === action.id);
      const db = applyAudit(
        {
          ...state.db,
          appointments: state.db.appointments.map((appointment) =>
            appointment.id === action.id
              ? {
                  ...appointment,
                  status: action.status,
                  queuePosition:
                    action.queuePosition === undefined ? appointment.queuePosition : action.queuePosition,
                }
              : appointment,
          ),
        },
        action.actor,
        `appointment.${action.status}`,
        action.id,
        `Appointment for ${target?.reason ?? "unknown patient"} moved to ${action.status}.`,
      );
      return { ...state, db };
    }

    case "appointment/triage": {
      const db = applyAudit(
        {
          ...state.db,
          appointments: state.db.appointments.map((appointment) =>
            appointment.id === action.id
              ? {
                  ...appointment,
                  acuity: action.acuity,
                  triageNotes: action.notes,
                  doctorId: action.doctorId,
                  department:
                    state.db.staff.find((member) => member.id === action.doctorId)?.department ??
                    appointment.department,
                }
              : appointment,
          ),
        },
        action.actor,
        "appointment.triage",
        action.id,
        `Triaged as ${action.acuity}. ${action.notes}`,
      );
      return { ...state, db };
    }

    case "treatment/create": {
      // Writing a prescription dispenses the course immediately: physical stock
      // falls and the soft reservation is released, which is what makes the
      // shortage forecast move while the doctor is still in the room.
      const medicines = state.db.medicines.map((medicine) => {
        const lines = action.treatment.prescriptions.filter((line) => line.medicineId === medicine.id);
        if (lines.length === 0) return medicine;
        const units = lines.reduce((sum, line) => sum + line.quantity, 0);
        return dispenseStock(medicine, units);
      });

      const drugNames = action.treatment.prescriptions.map((line) => line.drugName).join(", ");
      const db = applyAudit(
        { ...state.db, medicines, treatments: [action.treatment, ...state.db.treatments] },
        action.actor,
        "treatment.create",
        action.treatment.patientId,
        `Charted ${action.treatment.diagnosis} (${action.treatment.icd10Code}) and dispensed ${drugNames}.`,
      );
      return { ...state, db: bumpCounter(db, "treatment") };
    }

    case "administration/record": {
      const target = state.db.administrations.find((item) => item.id === action.id);
      const db = applyAudit(
        {
          ...state.db,
          administrations: state.db.administrations.map((record) =>
            record.id === action.id
              ? {
                  ...record,
                  status: action.status,
                  administeredAt:
                    action.status === "given" ? new Date().toISOString() : record.administeredAt,
                  administeredBy: action.status === "given" ? action.actor.name : record.administeredBy,
                  vitalsId: action.vitalsId ?? record.vitalsId,
                  notes: action.notes || record.notes,
                }
              : record,
          ),
        },
        action.actor,
        `emar.${action.status}`,
        target?.patientId ?? action.id,
        `${action.status === "given" ? "Administered" : `Recorded as ${action.status}`} ${target?.drugName ?? "dose"}${action.notes ? ` — ${action.notes}` : ""}.`,
      );
      return { ...state, db };
    }

    case "vitals/record": {
      const db = applyAudit(
        { ...state.db, vitals: [action.vitals, ...state.db.vitals] },
        action.actor,
        "vitals.record",
        action.vitals.patientId,
        `Recorded vitals: ${action.vitals.systolic}/${action.vitals.diastolic} mmHg, ${action.vitals.heartRateBpm} bpm, SpO2 ${action.vitals.spo2}%.`,
      );
      return { ...state, db: bumpCounter(db, "vitals") };
    }

    case "invoice/create": {
      const db = applyAudit(
        { ...state.db, invoices: [action.invoice, ...state.db.invoices] },
        action.actor,
        "invoice.create",
        action.invoice.invoiceNumber,
        `Raised ${action.invoice.items.length} line item(s) for ${action.invoice.patientId}.`,
      );
      return { ...state, db: bumpCounter(db, "invoice") };
    }

    case "invoice/pay": {
      const db = applyAudit(
        {
          ...state.db,
          invoices: state.db.invoices.map((invoice) => {
            if (invoice.id !== action.invoiceId) return invoice;
            const updated: Invoice = {
              ...invoice,
              transactions: [...invoice.transactions, action.transaction],
            };
            return { ...updated, paymentStatus: derivePaymentStatus(updated) };
          }),
        },
        action.actor,
        "invoice.payment",
        action.invoiceId,
        `Collected ${action.transaction.paymentMethod.replace(/_/g, " ")} of ${action.transaction.amountPaid} (ref ${action.transaction.reference}).`,
      );
      return { ...state, db };
    }

    case "report/add": {
      const db = applyAudit(
        { ...state.db, reports: [action.report, ...state.db.reports] },
        action.actor,
        "report.upload",
        action.report.patientId,
        `Ingested ${action.report.fileName}; extracted ${action.report.extractedFields.length} biomarker value(s) at ${Math.round(
          action.report.ocrConfidence * 100,
        )}% confidence.`,
      );
      return { ...state, db: bumpCounter(db, "report") };
    }

    case "report/note": {
      const db = applyAudit(
        {
          ...state.db,
          reports: state.db.reports.map((report: MedicalReport) =>
            report.id === action.reportId ? { ...report, doctorNotes: action.notes } : report,
          ),
        },
        action.actor,
        "report.note",
        action.reportId,
        "Physician note recorded against the simplified report.",
      );
      return { ...state, db };
    }

    case "transfer/decide": {
      const isApproved = action.decision === "approved";
      const medicines = isApproved
        ? state.db.medicines.map((medicine) =>
            medicine.id === action.proposal.medicineId
              ? applyWardTransfer(
                  medicine,
                  action.proposal.fromWard,
                  action.proposal.toWard,
                  action.proposal.quantity,
                )
              : medicine,
          )
        : state.db.medicines;

      const db = applyAudit(
        {
          ...state.db,
          medicines,
          transferProposals: [
            {
              ...action.proposal,
              status: action.decision,
              decidedAt: new Date().toISOString(),
              decidedBy: action.actor.name,
            },
            ...state.db.transferProposals,
          ],
        },
        action.actor,
        `transfer.${action.decision}`,
        action.proposal.medicineId,
        isApproved
          ? `Moved ${action.proposal.quantity} units of ${action.proposal.drugName} from ${action.proposal.fromWard.replace(/_/g, " ")} to ${action.proposal.toWard.replace(/_/g, " ")}, projected SPS drop of ${action.proposal.estimatedSpsDrop} points.`
          : `Redistribution of ${action.proposal.drugName} to ${action.proposal.toWard.replace(/_/g, " ")} declined.`,
      );
      return { ...state, db: bumpCounter(db, "transfer") };
    }

    case "alert/acknowledge": {
      const db = applyAudit(
        {
          ...state.db,
          alerts: [
            { ...action.alert, acknowledged: true },
            ...state.db.alerts.filter((alert) => alert.id !== action.alert.id),
          ],
        },
        action.actor,
        "alert.acknowledge",
        action.alert.medicineId,
        `Acknowledged ${action.alert.tier} alert for ${action.alert.drugName} at score ${action.alert.sps}.`,
      );
      return { ...state, db };
    }

    case "demo/reset":
      return {
        ...state,
        db: action.db,
        session: { role: state.session.role, staffId: state.session.staffId, patientId: state.session.patientId },
      };

    default:
      return state;
  }
}
