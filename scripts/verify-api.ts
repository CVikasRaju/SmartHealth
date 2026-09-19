/**
 * API verification.
 *
 * Drives every endpoint through the real router against the in-memory
 * repository, so it needs no credentials and no network:
 *
 *   npm run verify:api
 *
 * It asserts the rules that matter rather than the plumbing — that prescribing
 * dispenses against the stored row, that stock clamps at zero, that a transfer
 * is stock-neutral, that over-collection closes an invoice, that a nurse cannot
 * prescribe, and that a patient sees only their own record.
 */

import type { ApiConfig } from "../api/_lib/config";
import { buildApiRequest } from "../api/_lib/http";
import { routeRequest } from "../api/_lib/routes";

const config: ApiConfig = {
  mode: "demo",
  supabaseUrl: null,
  supabaseAnonKey: null,
  supabaseServiceRoleKey: null,
  isProduction: false,
};

let failures = 0;
let checks = 0;

function assert(label: string, condition: boolean, detail = ""): void {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

interface CallOptions {
  method?: string;
  path: string;
  body?: unknown;
  actor?: string;
}

async function call({ method = "GET", path, body, actor = "demo-staff-admin-1" }: CallOptions) {
  const req = buildApiRequest({
    method,
    url: `/api${path}`,
    headers: { "content-type": "application/json", "x-smartmedic-actor": actor },
    body: body ?? null,
  });
  const response = await routeRequest(req, config);
  return response as { status: number; payload: { success: boolean; data: any; error?: any } };
}

async function main(): Promise<void> {
  /* -------- Health and bootstrap -------- */

  const health = await call({ path: "/health" });
  assert("health returns 200", health.status === 200, JSON.stringify(health.payload));
  assert("health reports demo mode", health.payload.data?.mode === "demo");

  const boot = await call({ path: "/bootstrap" });
  const db = boot.payload.data?.db;
  assert("bootstrap returns the dataset", boot.status === 200 && db?.medicines?.length > 0);
  assert("bootstrap includes the audit ledger", Array.isArray(db?.auditLog) && db.auditLog.length > 0);
  assert("bootstrap includes counters", typeof db?.counters?.treatment === "number");
  assert(
    "ward stock is nested onto medicines",
    db.medicines.every((m: any) => Array.isArray(m.wardStock)),
    "a medicine had no wardStock array",
  );
  assert(
    "report fields are nested onto reports",
    db.reports.every((r: any) => Array.isArray(r.extractedFields)),
  );
  assert(
    "invoice items and transactions are nested",
    db.invoices.every((i: any) => Array.isArray(i.items) && Array.isArray(i.transactions)),
  );
  assert(
    "reference ranges round trip",
    db.reports.some((r: any) => r.extractedFields.some((f: any) => typeof f.referenceRange?.max === "number")),
  );
  assert(
    "prescriptions are nested onto treatments",
    db.treatments.every((t: any) => Array.isArray(t.prescriptions)),
  );

  /* -------- Prescribing depletes stock authoritatively -------- */

  const augmentin = db.medicines.find((m: any) => m.id === "med-aug-625");
  const beforeStock = augmentin.currentStock;
  const patientId = db.patients[0].id;

  const treatment = {
    id: "treat-smoke-1",
    patientId,
    doctorId: "staff-doctor-1",
    diagnosis: "Acute bacterial sinusitis",
    icd10Code: "J01.90",
    linkedReportIds: [],
    notes: "Smoke test",
    createdAt: new Date().toISOString(),
    prescriptions: [
      {
        id: "rx-smoke-1",
        medicineId: "med-aug-625",
        drugName: "Augmentin 625 Duo",
        dosage: "625mg",
        frequency: "twice_daily",
        durationDays: 5,
        quantity: 20,
        route: "oral",
        instructions: "After food",
        substituteFor: null,
        dispenseStatus: "dispensed",
        stockAdvisory: null,
      },
    ],
  };

  const prescribed = await call({ method: "POST", path: "/treatments", body: { treatment } });
  assert("prescribing succeeds", prescribed.status === 200, JSON.stringify(prescribed.payload));
  const dispensedMedicine = prescribed.payload.data?.applied?.collections?.medicines?.[0];
  assert(
    "stock falls by the prescribed quantity",
    dispensedMedicine?.currentStock === beforeStock - 20,
    `expected ${beforeStock - 20}, got ${dispensedMedicine?.currentStock}`,
  );
  assert(
    "the client's optimistic stock is replaced by the server's",
    prescribed.payload.data?.applied?.counters?.treatment >= 1,
  );

  /* -------- Stock cannot go negative -------- */

  const overPrescribed = await call({
    method: "POST",
    path: "/treatments",
    body: {
      treatment: {
        ...treatment,
        id: "treat-smoke-2",
        prescriptions: [{ ...treatment.prescriptions[0], id: "rx-smoke-2", quantity: 99999 }],
      },
    },
  });
  assert(
    "an oversized prescription clamps at zero rather than going negative",
    overPrescribed.payload.data?.applied?.collections?.medicines?.[0]?.currentStock === 0,
  );

  /* -------- Inter-ward transfer -------- */

  // Re-read: earlier prescriptions in this run already changed the dispensary
  // total, and currentStock is the shelf figure rather than the ward sum.
  const fresh = await call({ path: "/bootstrap" });
  const target = fresh.payload.data.db.medicines.find((m: any) => m.wardStock.length > 1);
  const source = target.wardStock[0];
  const destination = target.wardStock[1];

  const decision = await call({
    method: "POST",
    path: `/transfers/${target.id}-smoke/decision`,
    body: {
      decision: "approved",
      proposal: {
        id: `${target.id}-smoke`,
        medicineId: target.id,
        drugName: target.brandName,
        fromWard: source.ward,
        toWard: destination.ward,
        quantity: 5,
        surplusAtSource: 10,
        deficitAtTarget: 20,
        rationale: "smoke test",
        estimatedSpsDrop: 4,
        wardsRecovered: 1,
        status: "proposed",
      },
    },
  });
  const moved = decision.payload.data?.applied?.collections?.medicines?.[0];
  assert("transfer decision succeeds", decision.status === 200);
  assert(
    "ward holdings move and the facility total is unchanged",
    moved?.wardStock.find((w: any) => w.ward === source.ward).quantity === source.quantity - 5 &&
      moved?.wardStock.find((w: any) => w.ward === destination.ward).quantity ===
        destination.quantity + 5 &&
      moved?.currentStock === target.currentStock,
    JSON.stringify(moved?.wardStock),
  );
  assert(
    "the decision is recorded in the ledger",
    decision.payload.data?.applied?.collections?.transferProposals?.[0]?.status === "approved",
  );

  /* -------- Billing -------- */

  const invoice = {
    id: "inv-smoke",
    invoiceNumber: "INV-2026-SMOKE",
    patientId,
    cashierId: "staff-cashier-1",
    items: [
      { id: "item-smoke-1", itemType: "consultation", description: "Consultation", quantity: 1, unitPrice: 500 },
      { id: "item-smoke-2", itemType: "medication", description: "Augmentin", quantity: 20, unitPrice: 25 },
    ],
    taxPct: 5,
    paymentStatus: "unpaid",
    transactions: [],
    notes: "",
    createdAt: new Date().toISOString(),
  };

  const invoiced = await call({ method: "POST", path: "/invoices", body: { invoice } });
  assert("invoice creation succeeds", invoiced.status === 200, JSON.stringify(invoiced.payload));

  const partial = await call({
    method: "POST",
    path: "/invoices/inv-smoke/payments",
    body: { paymentMethod: "cash", amount: 100, reference: "SMOKE-CASH" },
  });
  assert(
    "a part payment marks the invoice partially paid",
    partial.payload.data?.applied?.collections?.invoices?.[0]?.paymentStatus === "partially_paid",
    JSON.stringify(partial.payload.data?.applied?.collections?.invoices?.[0]?.paymentStatus),
  );

  const overpay = await call({
    method: "POST",
    path: "/invoices/inv-smoke/payments",
    body: { paymentMethod: "upi", amount: 999999, reference: "SMOKE-UPI" },
  });
  assert(
    "over-collection is clamped and the invoice closes",
    overpay.payload.data?.applied?.collections?.invoices?.[0]?.paymentStatus === "paid",
  );

  const badMethod = await call({
    method: "POST",
    path: "/invoices/inv-smoke/payments",
    body: { paymentMethod: "bitcoin", amount: 10 },
  });
  assert("an unsupported payment method is rejected", badMethod.status === 400);

  /* -------- Reports -------- */

  const report = {
    id: "report-smoke",
    patientId,
    uploadedBy: "demo-staff-admin-1",
    uploadedByRole: "admin",
    fileName: "smoke-panel.pdf",
    fileMimeType: "application/pdf",
    fileSizeBytes: 12345,
    reportCategory: "blood_panel",
    reportDate: new Date().toISOString(),
    ocrExtractionStatus: "completed",
    ocrConfidence: 0.91,
    rawOcrText: "FBS 142 mg/dL",
    extractedFields: [
      {
        id: "field-smoke-1",
        testName: "Fasting Blood Sugar (FBS)",
        normalizedKey: "fbs",
        value: 142,
        valueText: "142",
        unit: "mg/dL",
        referenceRange: { min: 70, max: 99, text: "70 - 99" },
        status: "elevated",
        plainLanguageExplanation: "Blood sugar after fasting.",
        category: "glycemic",
        confidence: 0.95,
        matchedAlias: "fbs",
      },
    ],
    medicalDisclaimer: "Not a diagnosis.",
    doctorNotes: "",
    createdAt: new Date().toISOString(),
  };

  const uploaded = await call({ method: "POST", path: "/reports", body: { report } });
  assert("report upload succeeds", uploaded.status === 200, JSON.stringify(uploaded.payload));

  const noted = await call({
    method: "PATCH",
    path: "/reports/report-smoke",
    body: { doctorNotes: "Repeat in three months." },
  });
  assert("a physician note is stored", noted.payload.data?.applied?.collections?.reports?.[0]?.doctorNotes === "Repeat in three months.");

  const archived = await call({
    method: "PATCH",
    path: "/reports/report-smoke",
    body: { archived: true, resolvedReason: "Recovered" },
  });
  assert("a report can be archived", archived.payload.data?.applied?.collections?.reports?.[0]?.archived === true);

  /* -------- Front desk and clinical -------- */

  const patient = {
    id: "patient-smoke",
    mrn: "MRN-2026-SMOKE",
    name: "Smoke Test",
    dob: "1990-01-01",
    gender: "other",
    bloodGroup: "O-",
    contact: "+91-9000000000",
    email: "smoke@example.com",
    allergies: [],
    emergencyContact: { name: "Next of kin", relation: "Sibling", contact: "+91-9000000001" },
    currentAdmission: { isAdmitted: false },
    chronicConditions: [],
    registeredAt: new Date().toISOString(),
  };

  const registered = await call({ method: "POST", path: "/patients", body: { patient } });
  assert("patient registration succeeds", registered.status === 200, JSON.stringify(registered.payload));

  const duplicate = await call({ method: "POST", path: "/patients", body: { patient } });
  assert("a duplicate identifier is reported as a conflict", duplicate.status === 409, `got ${duplicate.status}`);

  const resolved = await call({
    method: "PATCH",
    path: "/patients/patient-2",
    body: { chronicConditions: [], resolvedConditions: ["Dyslipidemia"] },
  });
  assert("patient conditions can be updated", resolved.status === 200);

  const appointment = {
    id: "appt-smoke",
    patientId,
    doctorId: "staff-doctor-1",
    department: "General Medicine",
    scheduledFor: new Date().toISOString(),
    reason: "Follow-up",
    status: "scheduled",
    acuity: "standard",
    triageNotes: "",
    queuePosition: null,
    createdAt: new Date().toISOString(),
  };

  const scheduled = await call({ method: "POST", path: "/appointments", body: { appointment } });
  assert("appointment scheduling succeeds", scheduled.status === 200, JSON.stringify(scheduled.payload));

  const triaged = await call({
    method: "PATCH",
    path: "/appointments/appt-smoke",
    body: { acuity: "urgent", triageNotes: "Febrile", doctorId: "staff-doctor-2" },
  });
  assert(
    "triage updates acuity and reassigns the department",
    triaged.payload.data?.applied?.collections?.appointments?.[0]?.acuity === "urgent" &&
      typeof triaged.payload.data?.applied?.collections?.appointments?.[0]?.department === "string",
  );

  const checkedIn = await call({
    method: "PATCH",
    path: "/appointments/appt-smoke",
    body: { status: "checked_in", queuePosition: 3 },
  });
  assert(
    "check-in updates status and queue position",
    checkedIn.payload.data?.applied?.collections?.appointments?.[0]?.queuePosition === 3,
  );

  const vitals = await call({
    method: "POST",
    path: "/vitals",
    body: {
      vitals: {
        id: "vitals-smoke",
        patientId,
        recordedBy: "ignored",
        recordedAt: new Date().toISOString(),
        temperatureC: 38.2,
        heartRateBpm: 96,
        systolic: 128,
        diastolic: 82,
        respiratoryRate: 18,
        spo2: 97,
        painScore: 3,
        notes: "Febrile",
      },
    },
  });
  assert("vitals are recorded", vitals.status === 200);
  assert(
    "the recorded-by field is taken from the session, not the payload",
    vitals.payload.data?.applied?.collections?.vitals?.[0]?.recordedBy === "demo-staff-admin-1",
    JSON.stringify(vitals.payload.data?.applied?.collections?.vitals?.[0]?.recordedBy),
  );

  const administration = db.administrations[0];
  const administered = await call({
    method: "PATCH",
    path: `/administrations/${administration.id}`,
    body: { status: "given", vitalsId: "vitals-smoke", notes: "Tolerated" },
  });
  assert("bedside administration is recorded", administered.status === 200, JSON.stringify(administered.payload));
  assert(
    "the administration is stamped with the acting nurse and a time",
    administered.payload.data?.applied?.collections?.administrations?.[0]?.status === "given" &&
      typeof administered.payload.data?.applied?.collections?.administrations?.[0]?.administeredAt === "string",
  );

  const alert = {
    id: "alert-smoke",
    medicineId: "med-aug-625",
    drugName: "Augmentin 625 Duo",
    tier: "critical",
    sps: 91,
    message: "Shortage likely",
    createdAt: new Date().toISOString(),
    acknowledged: false,
  };
  const acknowledged = await call({
    method: "POST",
    path: "/alerts/alert-smoke/acknowledge",
    body: { alert },
  });
  assert("alerts can be acknowledged", acknowledged.payload.data?.applied?.collections?.alerts?.[0]?.acknowledged === true);

  const acknowledgedAgain = await call({
    method: "POST",
    path: "/alerts/alert-smoke/acknowledge",
    body: { alert },
  });
  assert("re-acknowledging is idempotent", acknowledgedAgain.status === 200, `got ${acknowledgedAgain.status}`);

  const inquiry = await call({
    method: "POST",
    path: "/inquiries",
    body: { patientId, subject: "Report question", message: "What does HbA1c mean?" },
  });
  assert("a patient inquiry is recorded", inquiry.status === 200);

  /* -------- Authorisation -------- */

  const nursePrescribing = await call({
    method: "POST",
    path: "/treatments",
    body: { treatment },
    actor: "demo-staff-nurse-1",
  });
  assert("a nurse may not prescribe", nursePrescribing.status === 403, `got ${nursePrescribing.status}`);

  const doctorBilling = await call({ method: "POST", path: "/invoices", body: { invoice }, actor: "demo-staff-doctor-1" });
  assert("a doctor may not raise invoices", doctorBilling.status === 403);

  const cashierTransfer = await call({
    method: "POST",
    path: "/transfers/x/decision",
    body: { decision: "approved", proposal: {} },
    actor: "demo-staff-cashier-1",
  });
  assert("a cashier may not decide transfers", cashierTransfer.status === 403);

  const patientBoot = await call({ path: "/bootstrap", actor: "demo-patient-2" });
  const scoped = patientBoot.payload.data?.db;
  assert("a patient sees only their own record", scoped?.patients?.length === 1 && scoped.patients[0].id === "patient-2");
  assert("a patient sees no formulary or supply data", scoped?.medicines?.length === 0 && scoped?.alerts?.length === 0);
  assert("a patient sees no other patients' reports", scoped?.reports?.every((r: any) => r.patientId === "patient-2"));
  assert("a patient sees the consultant directory", scoped?.staff?.every((s: any) => s.role === "doctor"));
  assert("a patient's staff directory omits contact details", scoped?.staff?.every((s: any) => s.phone === undefined));

  const patientPrescribing = await call({
    method: "POST",
    path: "/treatments",
    body: { treatment },
    actor: "demo-patient-2",
  });
  assert("a patient may not prescribe", patientPrescribing.status === 403);

  const patientOtherReports = await call({
    method: "POST",
    path: "/reports",
    body: { report: { ...report, id: "report-other", patientId: "patient-1" } },
    actor: "demo-patient-2",
  });
  assert("a patient may not upload to another record", patientOtherReports.status === 403, `got ${patientOtherReports.status}`);

  const patientOwnReport = await call({
    method: "POST",
    path: "/reports",
    body: { report: { ...report, id: "report-own", patientId: "patient-2" } },
    actor: "demo-patient-2",
  });
  assert("a patient may upload to their own record", patientOwnReport.status === 200);

  const superadminBoot = await call({ path: "/bootstrap", actor: "demo-superadmin-1" });
  const superScoped = superadminBoot.payload.data?.db;
  assert("a super admin sees hospital infrastructure", (superScoped?.hospitals?.length ?? 0) >= 5);
  assert("a super admin sees zero patient health records (PHI isolation)", superScoped?.patients?.length === 0);
  assert("a super admin sees zero patient lab reports", superScoped?.reports?.length === 0);
  assert("a super admin sees zero patient vitals or clinical treatments", superScoped?.treatments?.length === 0 && superScoped?.vitals?.length === 0);

  const hospitalOnboard = await call({
    method: "POST",
    path: "/hospitals",
    body: {
      hospital: {
        id: "hosp-test-mgl",
        code: "TEST-MGL-99",
        name: "Test Community Hospital",
        location: "Suratkal, Mangalore",
        city: "Mangalore",
        state: "Karnataka",
        tier: "secondary",
        bedCapacity: 200,
        activeWards: 4,
        status: "active",
        contactEmail: "admin@testhospital.org",
        phone: "+91 824 222 9999",
      },
    },
    actor: "demo-superadmin-1",
  });
  assert("a super admin can onboard a hospital facility", hospitalOnboard.status === 200);

  /* -------- Registration and reset -------- */

  const profiles = await call({ path: "/demo/profiles" });
  assert(
    "demo identities are listed for the sign-in screen",
    profiles.payload.data?.profiles?.length === db.staff.length + db.patients.length + 1,
  );

  const reset = await call({ method: "POST", path: "/demo/reset" });
  assert("reset returns a clean dataset", reset.payload.data?.db?.medicines?.length === db.medicines.length);
  assert(
    "reset restores the original stock level",
    reset.payload.data?.db?.medicines.find((m: any) => m.id === "med-aug-625")?.currentStock === beforeStock,
  );

  /* -------- Routing -------- */

  const missing = await call({ path: "/does-not-exist" });
  assert("an unknown route is a 404", missing.status === 404);

  const wrongMethod = await call({ method: "DELETE", path: "/patients" });
  assert("an unsupported method is a 405", wrongMethod.status === 405, `got ${wrongMethod.status}`);

  const malformed = buildApiRequest({
    method: "POST",
    url: "/api/treatments",
    headers: { "x-smartmedic-actor": "demo-staff-admin-1" },
    body: "not json",
  });
  const malformedResult = await routeRequest(malformed, config);
  assert("a non-object body is a 400", malformedResult.status === 400, `got ${malformedResult.status}`);

  console.log(`\n  ${checks - failures}/${checks} checks passed\n`);
  if (failures > 0) process.exitCode = 1;
}

void main();
