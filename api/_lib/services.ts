/**
 * Domain services.
 *
 * Every rule that must not be forgeable lives here rather than in the browser:
 * stock is dispensed against the row read from the database (not against the
 * number the client reports), a ward transfer is re-applied server-side, invoice
 * status is recomputed from the transaction ledger, and the audit entry is
 * written with the authenticated identity rather than a client-supplied one.
 *
 * Each handler returns a `StatePatch` — the rows the client should merge into
 * its optimistic state — plus the advanced ID counters. Audit rows are
 * deliberately not echoed back: the client already appended its own optimistic
 * entry, and the authoritative ledger is what a fresh bootstrap returns.
 */

import { createSeedDatabase } from "../../src/data/mockData.js";
import {
  applyWardTransfer,
  dispenseStock,
} from "../../src/engine/shortageEngine.js";
import { derivePaymentStatus, roundMoney, splitPayment } from "../../src/engine/billingEngine.js";
import type { DatabaseState, Medicine, PaymentMethod, WardId } from "../../src/types";

import { ANONYMOUS_ACTOR } from "./auth.js";
import {
  HttpError,
  ok,
  optionalString,
  readBody,
  requireArray,
  requireEnum,
  requireNumber,
  requirePatientScope,
  requireRole,
  requireString,
  type RequestContext,
  type RouteResult,
} from "./http.js";
import type { CollectionName } from "./registry.js";
import { DuplicateIdError, type ProfileRecord } from "./repo/types.js";

/** Rows for the client to merge, keyed by collection. */
export interface StatePatch {
  collections: Partial<Record<CollectionName, unknown[]>>;
  counters?: Record<string, number>;
}

const PAYMENT_METHODS: readonly PaymentMethod[] = [
  "cash",
  "credit_card",
  "debit_card",
  "upi",
  "insurance_claim",
];

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "invalid_body", `Field "${label}" must be an object.`);
  }
  return value as Record<string, unknown>;
}

function numberOrZero(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return 0;
}

/** Render a possibly-absent number for an audit sentence. */
function describeNumber(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  return "?";
}

/**
 * Append the immutable audit entry. The actor is taken from the verified
 * session, so a client cannot attribute an action to somebody else.
 */
async function audit(
  ctx: RequestContext,
  action: string,
  target: string,
  detail: string,
  deltas: Record<string, number> = {},
): Promise<Record<string, number>> {
  const counters = await ctx.repo.bumpCounters({ audit: 1, ...deltas });
  const sequence = counters.audit ?? 1;

  await ctx.repo.insert("auditLog", {
    id: `audit-${String(sequence).padStart(5, "0")}`,
    at: new Date().toISOString(),
    actorId: ctx.actor.id,
    actorName: ctx.actor.fullName,
    actorRole: ctx.actor.role,
    action,
    target,
    detail,
  });

  return counters;
}

/**
 * Insert a row, falling back to an update when the id already exists. Needed for
 * records the client derives and may re-submit, such as a re-decided transfer.
 */
async function insertOrUpdate(
  ctx: RequestContext,
  collection: CollectionName,
  row: Record<string, unknown>,
): Promise<void> {
  try {
    await ctx.repo.insert(collection, row);
  } catch (error) {
    if (!(error instanceof DuplicateIdError)) throw error;
    const patch = { ...row };
    delete patch.id;
    await ctx.repo.update(collection, String(row.id), patch);
  }
}

function patch(collections: StatePatch["collections"], counters?: Record<string, number>): RouteResult {
  return ok({ applied: { collections, counters } satisfies StatePatch });
}

/* ------------------------------------------------------------------ */
/* Snapshot scoping                                                    */
/* ------------------------------------------------------------------ */

/**
 * Reduce the snapshot to what the caller is entitled to see. Staff receive the
 * whole hospital record; a patient account receives only its own clinical,
 * billing and report data plus the consultant directory.
 *
 * Super Admin receives platform governance entities (hospitals, facility admins,
 * and aggregate regional shortage telemetry) with ZERO PHI / patient clinical records.
 */
export function scopeSnapshot(db: DatabaseState, profile: ProfileRecord): DatabaseState {
  if (profile.role === "patient") {
    const patientId = profile.patientId;
    const own = <T extends { patientId: string }>(rows: T[]): T[] =>
      rows.filter((row) => row.patientId === patientId);

    return {
      hospitals: db.hospitals ?? [],
      staff: db.staff
        .filter((member) => member.role === "doctor")
        .map((member) => ({ ...member, contactNumber: "", email: "" })),
      patients: db.patients.filter((patient) => patient.id === patientId),
      // The formulary is not exposed: supply position is commercial information.
      medicines: [],
      appointments: own(db.appointments),
      treatments: own(db.treatments),
      administrations: own(db.administrations),
      vitals: own(db.vitals),
      invoices: own(db.invoices),
      reports: own(db.reports),
      transferProposals: [],
      alerts: [],
      // The ledger names other patients, so it stays with staff.
      auditLog: [],
      counters: db.counters,
    };
  }

  if (profile.role === "superadmin") {
    // ZERO PHI ACCESS GUARANTEE (HIPAA Privacy Compliance):
    // Super Admin sees hospital infrastructure and aggregate network telemetry.
    // Patients, individual appointments, treatments, vitals, invoices, and lab reports are strictly omitted.
    return {
      hospitals: db.hospitals ?? [],
      staff: db.staff.filter((member) => member.role === "admin"),
      patients: [],
      medicines: db.medicines,
      appointments: [],
      treatments: [],
      administrations: [],
      vitals: [],
      invoices: [],
      reports: [],
      transferProposals: db.transferProposals,
      alerts: db.alerts,
      auditLog: db.auditLog.filter(
        (entry) =>
          entry.action.startsWith("hospital.") ||
          entry.action.startsWith("transfer.") ||
          entry.action.startsWith("alert."),
      ),
      counters: db.counters,
    };
  }

  return db;
}

/* ------------------------------------------------------------------ */
/* Read endpoints                                                      */
/* ------------------------------------------------------------------ */

/**
 * Health, and the browser's public auth configuration.
 *
 * This is the only endpoint that answers before authentication, so it carries
 * the two things a client needs before it can sign in: which mode the API is in,
 * and — because a Vite build inlines `VITE_*` variables at build time, which
 * means a deployment rebuilt without them would otherwise have no way to reach
 * the identity provider at all — the publishable Supabase client settings.
 *
 * Both values are public by design. The `anon` key ships inside every Supabase
 * browser bundle, and it grants nothing here: row level security is enabled on
 * every table and no policy exists, so only the service role can read a row.
 * That service role key is server-side only and is never included in a response.
 */
export async function handleHealth(ctx: RequestContext): Promise<RouteResult> {
  const authenticated = ctx.actor.id !== ANONYMOUS_ACTOR.id;
  return ok({
    status: "ok",
    mode: ctx.config.mode,
    authenticated,
    actorRole: authenticated ? ctx.actor.role : null,
    auth:
      ctx.config.mode === "supabase"
        ? { url: ctx.config.supabaseUrl, anonKey: ctx.config.supabaseAnonKey }
        : null,
  });
}

export async function handleBootstrap(ctx: RequestContext): Promise<RouteResult> {
  if (ctx.config.mode === "supabase") {
    await ctx.repo.markLogin(ctx.actor.id);
  }
  const db = await ctx.repo.loadState();
  return ok({ profile: ctx.actor, db: scopeSnapshot(db, ctx.actor), mode: ctx.config.mode });
}

/** Demo-only: the identities the local sign-in screen offers. */
export async function handleDemoProfiles(ctx: RequestContext): Promise<RouteResult> {
  if (ctx.config.mode !== "demo") {
    throw new HttpError(404, "not_found", "Demo identities are only available in demo mode.");
  }
  const profiles = await ctx.repo.listProfiles();
  return ok({
    profiles: profiles.map((profile) => ({
      id: profile.id,
      fullName: profile.fullName,
      role: profile.role,
      email: profile.email,
    })),
  });
}

/* ------------------------------------------------------------------ */
/* Front desk and clinical writes                                      */
/* ------------------------------------------------------------------ */

export async function handleRegisterPatient(ctx: RequestContext): Promise<RouteResult> {
  requireRole(ctx, ["admin", "receptionist", "doctor", "nurse"]);
  const body = readBody(ctx);
  const patient = asRecord(body.patient, "patient");
  // Validate the client-generated key before it becomes a primary key.
  requireString(patient, "id");
  const mrn = requireString(patient, "mrn");
  const name = requireString(patient, "name");

  await ctx.repo.insert("patients", patient);
  const counters = await audit(
    ctx,
    "patient.register",
    mrn,
    `Registered ${name} (${optionalString(patient, "gender", "unspecified")}, ${optionalString(patient, "bloodGroup", "unknown")}) at the front desk.`,
    { patient: 1 },
  );

  return patch({ patients: [{ ...patient }] }, counters);
}

export async function handlePatchPatient(ctx: RequestContext): Promise<RouteResult> {
  requireRole(ctx, ["admin", "doctor", "nurse", "receptionist"]);
  const patientId = ctx.params.id;
  const body = readBody(ctx);

  const db = await ctx.repo.loadState();
  const patient = db.patients.find((row) => row.id === patientId);
  if (!patient) throw new HttpError(404, "not_found", `No patient "${patientId}".`);

  const chronicConditions = Array.isArray(body.chronicConditions)
    ? (body.chronicConditions as string[])
    : patient.chronicConditions;
  const resolvedConditions = Array.isArray(body.resolvedConditions)
    ? (body.resolvedConditions as string[])
    : (patient.resolvedConditions ?? []);

  const updated = { ...patient, chronicConditions, resolvedConditions };
  await ctx.repo.update("patients", patientId, { chronicConditions, resolvedConditions });

  const resolved = chronicConditions.length < patient.chronicConditions.length;
  const counters = await audit(
    ctx,
    resolved ? "patient.condition.resolve" : "patient.condition.reactivate",
    patientId,
    resolved ? "Marked a chronic condition as resolved." : "Re-activated a chronic condition.",
  );

  return patch({ patients: [updated] }, counters);
}

export async function handleCreateAppointment(ctx: RequestContext): Promise<RouteResult> {
  const body = readBody(ctx);
  const appointment = asRecord(body.appointment, "appointment");
  const patientId = requireString(appointment, "patientId");

  // Scheduling is a front-desk function; a patient may book for themselves only.
  if (ctx.actor.role === "patient") {
    requirePatientScope(ctx, patientId);
  } else {
    requireRole(ctx, ["admin", "receptionist"]);
  }

  await ctx.repo.insert("appointments", appointment);
  const counters = await audit(
    ctx,
    "appointment.create",
    requireString(appointment, "id"),
    `Scheduled ${optionalString(appointment, "reason", "a consultation")} for ${new Date(
      optionalString(appointment, "scheduledFor", new Date().toISOString()),
    ).toLocaleString("en-GB")}.`,
    { appointment: 1 },
  );

  return patch({ appointments: [{ ...appointment }] }, counters);
}

export async function handlePatchAppointment(ctx: RequestContext): Promise<RouteResult> {
  // Reception triages and checks in; the clinician moves the patient through the
  // consultation itself.
  requireRole(ctx, ["admin", "receptionist", "doctor"]);
  const appointmentId = ctx.params.id;
  const body = readBody(ctx);

  const db = await ctx.repo.loadState();
  const appointment = db.appointments.find((row) => row.id === appointmentId);
  if (!appointment) throw new HttpError(404, "not_found", `No appointment "${appointmentId}".`);

  const updates: Record<string, unknown> = {};
  if (typeof body.status === "string") updates.status = body.status;
  if (body.queuePosition === null || typeof body.queuePosition === "number") {
    updates.queuePosition = body.queuePosition;
  }
  if (typeof body.acuity === "string") updates.acuity = body.acuity;
  if (typeof body.triageNotes === "string") updates.triageNotes = body.triageNotes;
  if (typeof body.doctorId === "string") {
    updates.doctorId = body.doctorId;
    updates.department =
      db.staff.find((member) => member.id === body.doctorId)?.department ?? appointment.department;
  }
  if (Object.keys(updates).length === 0) {
    throw new HttpError(400, "invalid_body", "No supported appointment fields were supplied.");
  }

  await ctx.repo.update("appointments", appointmentId, updates);
  const updated = { ...appointment, ...updates };
  const counters = await audit(
    ctx,
    typeof body.acuity === "string" ? "appointment.triage" : `appointment.${String(updates.status ?? "update")}`,
    appointmentId,
    typeof body.acuity === "string"
      ? `Triaged as ${String(body.acuity)}. ${optionalString(body, "triageNotes")}`
      : `Appointment for ${appointment.reason} moved to ${String(updates.status ?? appointment.status)}.`,
  );

  return patch({ appointments: [updated] }, counters);
}

/**
 * Record a consultation and dispense its prescriptions.
 *
 * The consumption is applied to the medicine read from the database, so two
 * clinicians prescribing concurrently cannot both subtract from the same stale
 * number. The client's optimistic figure is replaced by the returned row.
 */
export async function handleCreateTreatment(ctx: RequestContext): Promise<RouteResult> {
  requireRole(ctx, ["doctor", "admin"]);
  const body = readBody(ctx);
  const treatment = asRecord(body.treatment, "treatment");
  requireString(treatment, "id");
  const lines = requireArray(treatment, "prescriptions").map((line) =>
    asRecord(line, "prescription line"),
  );
  if (lines.length === 0) {
    throw new HttpError(400, "invalid_body", "A consultation must contain at least one prescription.");
  }

  const db = await ctx.repo.loadState();
  const byId = new Map<string, Medicine>(db.medicines.map((medicine) => [medicine.id, medicine]));
  const touched = new Map<string, Medicine>();

  for (const line of lines) {
    const medicineId = requireString(line, "medicineId");
    const medicine = byId.get(medicineId);
    if (!medicine) {
      throw new HttpError(400, "unknown_medicine", `No formulary entry with id "${medicineId}".`);
    }
    const dispensed = dispenseStock(medicine, numberOrZero(line.quantity));
    byId.set(medicineId, dispensed);
    touched.set(medicineId, dispensed);
  }

  for (const medicine of touched.values()) {
    await ctx.repo.update("medicines", medicine.id, {
      currentStock: medicine.currentStock,
      allocatedStock: medicine.allocatedStock,
    });
  }

  await ctx.repo.insert("treatments", treatment);
  const drugNames = lines.map((line) => optionalString(line, "drugName", "medicine")).join(", ");
  const counters = await audit(
    ctx,
    "treatment.create",
    requireString(treatment, "patientId"),
    `Charted ${optionalString(treatment, "diagnosis", "a diagnosis")} (${optionalString(
      treatment,
      "icd10Code",
      "unclassified",
    )}) and dispensed ${drugNames}.`,
    { treatment: 1 },
  );

  return patch(
    {
      treatments: [{ ...treatment }],
      medicines: [...touched.values()].map((medicine) => ({ ...medicine })),
    },
    counters,
  );
}

export async function handlePatchAdministration(ctx: RequestContext): Promise<RouteResult> {
  requireRole(ctx, ["nurse", "doctor", "admin"]);
  const administrationId = ctx.params.id;
  const body = readBody(ctx);
  const status = requireEnum(body, "status", ["given", "held", "refused", "missed"] as const);

  const db = await ctx.repo.loadState();
  const record = db.administrations.find((row) => row.id === administrationId);
  if (!record) throw new HttpError(404, "not_found", `No administration record "${administrationId}".`);

  const updates: Record<string, unknown> = {
    status,
    notes: optionalString(body, "notes", record.notes),
    administeredAt: status === "given" ? new Date().toISOString() : record.administeredAt,
    administeredBy: status === "given" ? ctx.actor.fullName : record.administeredBy,
    vitalsId: typeof body.vitalsId === "string" ? body.vitalsId : record.vitalsId,
  };

  await ctx.repo.update("administrations", administrationId, updates);
  const counters = await audit(
    ctx,
    `emar.${status}`,
    record.patientId,
    `${status === "given" ? "Administered" : `Recorded as ${status}`} ${record.drugName}${
      updates.notes ? ` - ${String(updates.notes)}` : ""
    }.`,
  );

  return patch({ administrations: [{ ...record, ...updates }] }, counters);
}

export async function handleCreateVitals(ctx: RequestContext): Promise<RouteResult> {
  requireRole(ctx, ["nurse", "doctor", "admin"]);
  const body = readBody(ctx);
  const vitals = asRecord(body.vitals, "vitals");
  requireString(vitals, "id");
  const patientId = requireString(vitals, "patientId");

  const record = { ...vitals, recordedBy: ctx.actor.id, recordedAt: new Date().toISOString() };
  await ctx.repo.insert("vitals", record);
  const counters = await audit(
    ctx,
    "vitals.record",
    patientId,
    `Recorded vitals: ${describeNumber(vitals.systolic)}/${describeNumber(
      vitals.diastolic,
    )} mmHg, ${describeNumber(vitals.heartRateBpm)} bpm, SpO2 ${describeNumber(vitals.spo2)}%.`,
    { vitals: 1 },
  );

  return patch({ vitals: [record] }, counters);
}

/* ------------------------------------------------------------------ */
/* Revenue cycle                                                       */
/* ------------------------------------------------------------------ */

export async function handleCreateInvoice(ctx: RequestContext): Promise<RouteResult> {
  requireRole(ctx, ["cashier", "admin"]);
  const body = readBody(ctx);
  const invoice = asRecord(body.invoice, "invoice");
  requireString(invoice, "id");

  await ctx.repo.insert("invoices", invoice);
  const counters = await audit(
    ctx,
    "invoice.create",
    requireString(invoice, "invoiceNumber"),
    `Raised ${requireArray(invoice, "items").length} line item(s) for ${optionalString(invoice, "patientId")}.`,
    { invoice: 1 },
  );

  return patch({ invoices: [{ ...invoice }] }, counters);
}

export async function handleCollectPayment(ctx: RequestContext): Promise<RouteResult> {
  requireRole(ctx, ["cashier", "admin"]);
  const invoiceId = ctx.params.id;
  const body = readBody(ctx);
  const method = requireEnum(body, "paymentMethod", PAYMENT_METHODS);

  const db = await ctx.repo.loadState();
  const invoice = db.invoices.find((row) => row.id === invoiceId);
  if (!invoice) throw new HttpError(404, "not_found", `No invoice "${invoiceId}".`);

  const transaction = splitPayment(
    invoice,
    method,
    roundMoney(requireNumber(body, "amount")),
    optionalString(body, "reference"),
    ctx.actor.fullName,
  );
  if (transaction.amountPaid <= 0) {
    throw new HttpError(400, "invalid_amount", "The collected amount must be greater than zero.");
  }

  const transactions = [...invoice.transactions, transaction];
  const paymentStatus = derivePaymentStatus({ ...invoice, transactions });
  await ctx.repo.update("invoices", invoiceId, { transactions, paymentStatus });

  const counters = await audit(
    ctx,
    "invoice.payment",
    invoiceId,
    `Collected ${method.replace(/_/g, " ")} of ${transaction.amountPaid} (ref ${transaction.reference}).`,
  );

  return patch({ invoices: [{ ...invoice, transactions, paymentStatus }] }, counters);
}

/* ------------------------------------------------------------------ */
/* Report simplifier                                                   */
/* ------------------------------------------------------------------ */

export async function handleCreateReport(ctx: RequestContext): Promise<RouteResult> {
  const body = readBody(ctx);
  const report = asRecord(body.report, "report");
  requireString(report, "id");
  const patientId = requireString(report, "patientId");

  if (ctx.actor.role === "patient") {
    requirePatientScope(ctx, patientId);
  } else {
    requireRole(ctx, ["admin", "doctor", "nurse", "receptionist"]);
  }

  const fields = Array.isArray(report.extractedFields) ? report.extractedFields.length : 0;
  await ctx.repo.insert("reports", report);
  const counters = await audit(
    ctx,
    "report.upload",
    patientId,
    `Ingested ${optionalString(report, "fileName", "a report")}; extracted ${fields} biomarker value(s) at ${Math.round(
      numberOrZero(report.ocrConfidence) * 100,
    )}% confidence.`,
    { report: 1 },
  );

  return patch({ reports: [{ ...report }] }, counters);
}

export async function handlePatchReport(ctx: RequestContext): Promise<RouteResult> {
  requireRole(ctx, ["admin", "doctor", "nurse"]);
  const reportId = ctx.params.id;
  const body = readBody(ctx);

  const db = await ctx.repo.loadState();
  const report = db.reports.find((row) => row.id === reportId);
  if (!report) throw new HttpError(404, "not_found", `No report "${reportId}".`);

  const updates: Record<string, unknown> = {};
  if (typeof body.doctorNotes === "string") updates.doctorNotes = body.doctorNotes;
  if (typeof body.archived === "boolean") {
    updates.archived = body.archived;
    updates.resolvedReason = body.archived
      ? optionalString(body, "resolvedReason", "Condition resolved")
      : null;
  }
  if (Object.keys(updates).length === 0) {
    throw new HttpError(400, "invalid_body", "No supported report fields were supplied.");
  }

  await ctx.repo.update("reports", reportId, updates);
  const counters = await audit(
    ctx,
    typeof body.archived === "boolean"
      ? body.archived
        ? "report.archive"
        : "report.unarchive"
      : "report.note",
    reportId,
    typeof body.archived === "boolean"
      ? body.archived
        ? `Archived report as recovered/resolved (${String(updates.resolvedReason)}).`
        : "Restored report to the active profile."
      : "Physician note recorded against the simplified report.",
  );

  return patch({ reports: [{ ...report, ...updates }] }, counters);
}

/** A patient query is recorded in the audit ledger only. */
export async function handlePatientInquiry(ctx: RequestContext): Promise<RouteResult> {
  const body = readBody(ctx);
  const patientId = requireString(body, "patientId");
  requirePatientScope(ctx, patientId);

  const counters = await audit(
    ctx,
    "patient.inquiry",
    patientId,
    `Submitted query: "${optionalString(body, "subject", "General")}" - ${optionalString(body, "message")}`,
  );

  return ok({ applied: { collections: {}, counters } satisfies StatePatch });
}

/* ------------------------------------------------------------------ */
/* Shortage intelligence                                               */
/* ------------------------------------------------------------------ */

export async function handleDecideTransfer(ctx: RequestContext): Promise<RouteResult> {
  requireRole(ctx, ["admin"]);
  const body = readBody(ctx);
  const proposal = asRecord(body.proposal, "proposal");
  requireString(proposal, "id");
  const decision = requireEnum(body, "decision", ["approved", "rejected"] as const);
  const medicineId = requireString(proposal, "medicineId");

  const decided = {
    ...proposal,
    status: decision,
    decidedAt: new Date().toISOString(),
    decidedBy: ctx.actor.fullName,
  };

  const collections: StatePatch["collections"] = { transferProposals: [decided] };

  if (decision === "approved") {
    const db = await ctx.repo.loadState();
    const medicine = db.medicines.find((row) => row.id === medicineId);
    if (!medicine) throw new HttpError(404, "not_found", `No formulary entry "${medicineId}".`);

    const moved = applyWardTransfer(
      medicine,
      requireString(proposal, "fromWard") as WardId,
      requireString(proposal, "toWard") as WardId,
      requireNumber(proposal, "quantity"),
    );
    // A transfer is stock-neutral by construction: only ward holdings change.
    await ctx.repo.update("medicines", medicineId, { wardStock: moved.wardStock });
    collections.medicines = [{ ...moved }];
  }

  await insertOrUpdate(ctx, "transferProposals", decided);
  const counters = await audit(
    ctx,
    `transfer.${decision}`,
    medicineId,
    decision === "approved"
      ? `Moved ${String(proposal.quantity)} units of ${optionalString(proposal, "drugName", "stock")} from ${String(
          proposal.fromWard,
        ).replace(/_/g, " ")} to ${String(proposal.toWard).replace(/_/g, " ")}.`
      : `Redistribution of ${optionalString(proposal, "drugName", "stock")} was declined.`,
    { transfer: 1 },
  );

  return patch(collections, counters);
}

export async function handleAcknowledgeAlert(ctx: RequestContext): Promise<RouteResult> {
  requireRole(ctx, ["admin", "doctor", "nurse"]);
  const body = readBody(ctx);
  const alert = asRecord(body.alert, "alert");
  const alertId = ctx.params.id;

  const acknowledged = {
    ...alert,
    id: alertId,
    acknowledged: true,
    acknowledgedBy: ctx.actor.fullName,
    acknowledgedAt: new Date().toISOString(),
  };

  await insertOrUpdate(ctx, "alerts", acknowledged);
  const counters = await audit(
    ctx,
    "alert.acknowledge",
    requireString(alert, "medicineId"),
    `Acknowledged ${optionalString(alert, "tier", "shortage")} alert for ${optionalString(
      alert,
      "drugName",
      "a medicine",
    )} at score ${describeNumber(alert.sps)}.`,
  );

  return patch({ alerts: [acknowledged] }, counters);
}

/* ------------------------------------------------------------------ */
/* Demo management                                                     */
/* ------------------------------------------------------------------ */

export async function handleResetDemo(ctx: RequestContext): Promise<RouteResult> {
  requireRole(ctx, ["admin", "superadmin"]);
  const seed = createSeedDatabase();
  await ctx.repo.reset(seed);
  return ok({ db: scopeSnapshot(seed, ctx.actor), counters: seed.counters });
}

/* ------------------------------------------------------------------ */
/* Multi-tenant hospital management                                   */
/* ------------------------------------------------------------------ */

export async function handleCreateHospital(ctx: RequestContext): Promise<RouteResult> {
  requireRole(ctx, ["superadmin", "admin"]);
  const body = readBody(ctx);
  const hospital = asRecord(body.hospital, "hospital");
  requireString(hospital, "id");
  const name = requireString(hospital, "name");
  const code = requireString(hospital, "code");

  await ctx.repo.insert("hospitals", hospital);
  const counters = await audit(
    ctx,
    "hospital.onboard",
    code,
    `Onboarded healthcare facility ${name} (${code}) into the regional network.`,
    { hospital: 1 },
  );

  return patch({ hospitals: [{ ...hospital }] }, counters);
}

export async function handlePatchHospital(ctx: RequestContext): Promise<RouteResult> {
  requireRole(ctx, ["superadmin", "admin"]);
  const hospitalId = ctx.params.id;
  const body = readBody(ctx);

  const updates: Record<string, unknown> = {};
  if (typeof body.status === "string") updates.status = body.status;
  if (typeof body.adminName === "string") updates.adminName = body.adminName;
  if (typeof body.adminEmail === "string") updates.adminEmail = body.adminEmail;
  if (typeof body.bedCapacity === "number") updates.bedCapacity = body.bedCapacity;
  if (typeof body.activeWards === "number") updates.activeWards = body.activeWards;

  await ctx.repo.update("hospitals", hospitalId, updates);
  const counters = await audit(
    ctx,
    "hospital.update",
    hospitalId,
    `Updated hospital metadata / status for facility ${hospitalId}.`,
  );

  return patch({ hospitals: [{ id: hospitalId, ...updates }] }, counters);
}
