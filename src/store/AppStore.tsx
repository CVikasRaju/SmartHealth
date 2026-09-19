/**
 * In-memory application store.
 *
 * This provider is the prototype's entire backend: it owns the seeded database,
 * re-derives the shortage forecast whenever inventory or consumption changes,
 * and persists the session to localStorage so a demo survives a refresh.
 *
 * The persisted snapshot is keyed to the calendar day. Reopening the prototype
 * on a later date re-seeds instead of restoring, which keeps the appointment
 * queue and the "today" figures meaningful without any server clock to trust.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import type {
  Acuity,
  AdministrationStatus,
  Allergy,
  AppState,
  Appointment,
  AppointmentStatus,
  BiomarkerTrend,
  EmergencyContact,
  ExtractedField,
  FrequencyKey,
  Gender,
  Invoice,
  InvoiceItem,
  MedicalReport,
  MedicationAdministration,
  Medicine,
  Patient,
  PaymentMethod,
  PrescriptionLine,
  ReportCategory,
  RiskAssessment,
  Role,
  ShortageAlert,
  StaffMember,
  TransferProposal,
  Treatment,
  VitalsRecord,
  WardId,
} from "@/types";
import { createInitialAppState, createSeedDatabase } from "@/data/mockData";
import { appReducer, type ActorRef, type AppAction } from "@/store/reducer";
import {
  assessInventory,
  buildAlertPayload,
  buildTransferProposals,
  summarisePortfolio,
  type PortfolioSummary,
} from "@/engine/shortageEngine";
import { MEDICAL_DISCLAIMER, buildTrendSeries } from "@/engine/reportEngine";
import {
  computeInvoiceTotals,
  nextInvoiceNumber,
  roundMoney,
  splitPayment,
  summariseRevenue,
  type RevenueSummary,
} from "@/engine/billingEngine";
import { isSameDay } from "@/utils/format";

const STORAGE_KEY = "smartmedic.session.v1";
const STORAGE_VERSION = 1;

/** Calendar-day key used to decide whether a stored snapshot is stale. */
function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function sequenceId(prefix: string, sequence: number, width = 4): string {
  return `${prefix}-${String(sequence).padStart(width, "0")}`;
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 7);
}

/* ------------------------------------------------------------------ */
/* Derived view of the database                                        */
/* ------------------------------------------------------------------ */

export interface Derived {
  /** Assessment clock shared by this render pass. */
  referenceDate: Date;
  assessments: RiskAssessment[];
  assessmentById: Map<string, RiskAssessment>;
  portfolio: PortfolioSummary;
  /** Live, undecided redistribution proposals from the shortage engine. */
  proposals: TransferProposal[];
  /** Already-actioned proposals, newest first. */
  decisionLedger: TransferProposal[];
  /** Unacknowledged critical and high alerts across the formulary. */
  alerts: ShortageAlert[];
  patientsById: Map<string, Patient>;
  medicinesById: Map<string, Medicine>;
  staffById: Map<string, StaffMember>;
  doctors: StaffMember[];
  currentStaff: StaffMember | null;
  currentPatient: Patient | null;
  revenue: RevenueSummary;
  invoiceTotals: (invoice: Invoice) => ReturnType<typeof computeInvoiceTotals>;
  reportsFor: (patientId: string) => MedicalReport[];
  trendsFor: (patientId: string) => BiomarkerTrend[];
  treatmentsFor: (patientId: string) => Treatment[];
  appointmentsFor: (patientId: string) => Appointment[];
  todaysQueue: () => Appointment[];
  admissionsFor: (ward: WardId) => Patient[];
  emarFor: (ward: WardId) => MedicationAdministration[];
}

/* ------------------------------------------------------------------ */
/* Action surface                                                      */
/* ------------------------------------------------------------------ */

export interface RegisterPatientInput {
  name: string;
  dob: string;
  gender: Gender;
  bloodGroup: string;
  contact: string;
  email: string;
  allergies: Allergy[];
  emergencyContact: EmergencyContact;
  chronicConditions: string[];
}

export interface ScheduleAppointmentInput {
  patientId: string;
  doctorId: string;
  scheduledFor: string;
  reason: string;
  acuity: Acuity;
  triageNotes: string;
}

export interface PrescribeInput {
  patientId: string;
  doctorId: string;
  diagnosis: string;
  icd10Code: string;
  notes: string;
  linkedReportIds: string[];
  prescriptions: {
    medicineId: string;
    drugName: string;
    dosage: string;
    frequency: FrequencyKey;
    durationDays: number;
    quantity: number;
    route: PrescriptionLine["route"];
    instructions: string;
    substituteFor: string | null;
    stockAdvisory: string | null;
  }[];
}

export interface UploadReportInput {
  patientId: string;
  fileName: string;
  fileMimeType: string;
  fileSizeBytes: number;
  reportCategory: ReportCategory;
  reportDate: string;
  rawOcrText: string;
  extractedFields: ExtractedField[];
  ocrConfidence: number;
}

export interface CreateInvoiceInput {
  patientId: string;
  items: Omit<InvoiceItem, "id">[];
  taxPct?: number;
  notes?: string;
}

export interface AppActions {
  setRole: (role: Role) => void;
  setView: (view: string) => void;
  setActiveStaff: (staffId: string) => void;
  setActivePatient: (patientId: string) => void;
  registerPatient: (input: RegisterPatientInput) => Patient;
  scheduleAppointment: (input: ScheduleAppointmentInput) => Appointment;
  setAppointmentStatus: (id: string, status: AppointmentStatus, queuePosition?: number | null) => void;
  triageAppointment: (input: { id: string; acuity: Acuity; notes: string; doctorId: string }) => void;
  prescribe: (input: PrescribeInput) => Treatment;
  administer: (input: {
    id: string;
    status: AdministrationStatus;
    vitalsId: string | null;
    notes: string;
  }) => void;
  recordVitals: (input: Omit<VitalsRecord, "id" | "recordedAt" | "recordedBy">) => VitalsRecord;
  createInvoice: (input: CreateInvoiceInput) => Invoice;
  collectPayment: (input: {
    invoiceId: string;
    method: PaymentMethod;
    amount: number;
    reference: string;
  }) => void;
  uploadReport: (input: UploadReportInput) => MedicalReport;
  saveReportNote: (reportId: string, notes: string) => void;
  toggleReportArchive: (reportId: string, archived: boolean, reason?: string) => void;
  resolvePatientCondition: (patientId: string, condition: string, action: "resolve" | "reactivate") => void;
  sendPatientInquiry: (patientId: string, subject: string, message: string, doctorId?: string) => void;
  decideTransfer: (proposal: TransferProposal, decision: "approved" | "rejected") => void;
  acknowledgeAlert: (alert: ShortageAlert) => void;
  resetDemo: () => void;
}

interface AppStoreValue {
  state: AppState;
  derived: Derived;
  actions: AppActions;
}

const AppStoreContext = createContext<AppStoreValue | null>(null);

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

interface PersistedSnapshot {
  version: number;
  seededOn: string;
  state: AppState;
}

function loadSnapshot(): AppState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedSnapshot;
    if (parsed.version !== STORAGE_VERSION) return null;
    if (parsed.seededOn !== todayKey()) return null;
    if (!parsed.state?.db?.medicines?.length) return null;
    return parsed.state;
  } catch {
    // A corrupt or unreadable snapshot must never block the demo from booting.
    return null;
  }
}

function persistSnapshot(state: AppState): void {
  if (typeof window === "undefined") return;
  try {
    const payload: PersistedSnapshot = { version: STORAGE_VERSION, seededOn: todayKey(), state };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage pressure or private-mode restrictions are non-fatal here.
  }
}

/* ------------------------------------------------------------------ */
/* Provider                                                            */
/* ------------------------------------------------------------------ */

/**
 * Store provider.
 *
 * `initialState` bypasses both the persisted snapshot and the seed, which is
 * how the render smoke test exercises every portal without a browser.
 */
export function AppStoreProvider({
  children,
  initialState,
}: {
  children: ReactNode;
  initialState?: AppState;
}) {
  const [state, dispatch] = useReducer(
    appReducer,
    undefined,
    () => initialState ?? loadSnapshot() ?? createInitialAppState(),
  );

  useEffect(() => {
    persistSnapshot(state);
  }, [state]);

  const { db, session } = state;

  /* -------- Lookup maps -------- */

  const patientsById = useMemo(() => new Map(db.patients.map((item) => [item.id, item])), [db.patients]);
  const medicinesById = useMemo(() => new Map(db.medicines.map((item) => [item.id, item])), [db.medicines]);
  const staffById = useMemo(() => new Map(db.staff.map((item) => [item.id, item])), [db.staff]);
  const doctors = useMemo(() => db.staff.filter((member) => member.role === "doctor"), [db.staff]);

  /* -------- Forecast -------- */

  const referenceDate = useMemo(() => new Date(), [db.medicines]);

  const assessments = useMemo(
    () => assessInventory(db.medicines, { referenceDate }),
    [db.medicines, referenceDate],
  );

  const assessmentById = useMemo(
    () => new Map(assessments.map((item) => [item.medicineId, item])),
    [assessments],
  );

  const portfolio = useMemo(() => summarisePortfolio(assessments, db.medicines), [assessments, db.medicines]);

  const decisionLedger = useMemo(
    () =>
      db.transferProposals
        .slice()
        .sort((a, b) => new Date(b.decidedAt ?? 0).getTime() - new Date(a.decidedAt ?? 0).getTime()),
    [db.transferProposals],
  );

  const proposals = useMemo(() => {
    const decidedIds = new Set(db.transferProposals.map((item) => item.id));
    return buildTransferProposals(db.medicines, assessments, decidedIds, referenceDate);
  }, [db.medicines, db.transferProposals, assessments, referenceDate]);

  const alerts = useMemo<ShortageAlert[]>(() => {
    const acknowledged = new Set(db.alerts.map((item) => item.id));
    return assessments
      .filter((item) => item.tier === "critical" || item.tier === "high")
      .map((item) => {
        const payload = buildAlertPayload(item);
        return {
          id: `alert-${item.medicineId}-${item.tier}`,
          medicineId: item.medicineId,
          drugName: item.brandName,
          tier: item.tier,
          sps: item.sps,
          message: payload.message,
          createdAt: referenceDate.toISOString(),
          acknowledged: false,
        };
      })
      .filter((alert) => !acknowledged.has(alert.id));
  }, [assessments, db.alerts, referenceDate]);

  const revenue = useMemo(() => summariseRevenue(db.invoices), [db.invoices]);

  /* -------- Selectors -------- */

  const reportsFor = useCallback(
    (patientId: string) =>
      db.reports
        .filter((report) => report.patientId === patientId)
        .slice()
        .sort((a, b) => new Date(b.reportDate).getTime() - new Date(a.reportDate).getTime()),
    [db.reports],
  );

  const trendsFor = useCallback((patientId: string) => buildTrendSeries(db.reports, patientId), [db.reports]);

  const treatmentsFor = useCallback(
    (patientId: string) => db.treatments.filter((treatment) => treatment.patientId === patientId),
    [db.treatments],
  );

  const appointmentsFor = useCallback(
    (patientId: string) => db.appointments.filter((appointment) => appointment.patientId === patientId),
    [db.appointments],
  );

  const todaysQueue = useCallback(
    () =>
      db.appointments
        .filter((appointment) => isSameDay(new Date(appointment.scheduledFor), new Date()))
        .slice()
        .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime()),
    [db.appointments],
  );

  const admissionsFor = useCallback(
    (ward: WardId) =>
      db.patients.filter(
        (patient) => patient.currentAdmission.isAdmitted && patient.currentAdmission.ward === ward,
      ),
    [db.patients],
  );

  const emarFor = useCallback(
    (ward: WardId) => {
      const patientIds = new Set(
        db.patients
          .filter((patient) => patient.currentAdmission.isAdmitted && patient.currentAdmission.ward === ward)
          .map((patient) => patient.id),
      );
      return db.administrations
        .filter((record) => patientIds.has(record.patientId))
        .slice()
        .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime());
    },
    [db.administrations, db.patients],
  );

  const invoiceTotals = useCallback((invoice: Invoice) => computeInvoiceTotals(invoice), []);

  /* -------- Actor resolution -------- */

  const currentStaff = session.role === "patient" ? null : (staffById.get(session.staffId) ?? null);
  const currentPatient = patientsById.get(session.patientId) ?? null;

  const actor: ActorRef = useMemo(() => {
    if (session.role === "patient") {
      const patient = patientsById.get(session.patientId);
      return {
        id: patient?.id ?? "patient-portal",
        name: patient?.name ?? "Patient portal",
        role: "patient",
      };
    }
    const member = staffById.get(session.staffId);
    return {
      id: member?.id ?? "system",
      name: member?.fullName ?? "System",
      role: session.role,
    };
  }, [patientsById, session.patientId, session.role, session.staffId, staffById]);

  /* -------- Actions -------- */

  const actions = useMemo<AppActions>(() => {
    const send = (action: AppAction) => dispatch(action);

    return {
      setRole: (role) => send({ type: "session/setRole", role }),
      setView: (view) => send({ type: "session/setView", view }),
      setActiveStaff: (staffId) => send({ type: "session/setStaff", staffId }),
      setActivePatient: (patientId) => send({ type: "session/setPatient", patientId }),

      registerPatient: (input) => {
        const sequence = (db.counters.patient ?? 0) + 1;
        const patient: Patient = {
          id: `patient-${randomSuffix()}`,
          mrn: `MRN-${new Date().getFullYear()}-${String(sequence).padStart(4, "0")}`,
          name: input.name.trim(),
          dob: input.dob,
          gender: input.gender,
          bloodGroup: input.bloodGroup,
          contact: input.contact.trim(),
          email: input.email.trim(),
          allergies: input.allergies,
          emergencyContact: input.emergencyContact,
          currentAdmission: { isAdmitted: false },
          chronicConditions: input.chronicConditions,
          registeredAt: new Date().toISOString(),
        };
        send({ type: "patient/register", patient, actor });
        return patient;
      },

      scheduleAppointment: (input) => {
        const sequence = (db.counters.appointment ?? 0) + 1;
        const appointment: Appointment = {
          id: sequenceId("appt", sequence),
          patientId: input.patientId,
          doctorId: input.doctorId,
          department: staffById.get(input.doctorId)?.department ?? "General Medicine",
          scheduledFor: input.scheduledFor,
          reason: input.reason.trim(),
          status: "scheduled",
          acuity: input.acuity,
          triageNotes: input.triageNotes.trim(),
          queuePosition: null,
          createdAt: new Date().toISOString(),
        };
        send({ type: "appointment/create", appointment, actor });
        return appointment;
      },

      setAppointmentStatus: (id, status, queuePosition) =>
        send({ type: "appointment/status", id, status, queuePosition, actor }),

      triageAppointment: (input) => send({ type: "appointment/triage", ...input, actor }),

      prescribe: (input) => {
        const sequence = (db.counters.treatment ?? 0) + 1;
        const prescriptions: PrescriptionLine[] = input.prescriptions.map((line, index) => ({
          id: `rx-${String(sequence).padStart(4, "0")}-${index + 1}`,
          medicineId: line.medicineId,
          drugName: line.drugName,
          dosage: line.dosage,
          frequency: line.frequency,
          durationDays: line.durationDays,
          quantity: line.quantity,
          route: line.route,
          instructions: line.instructions,
          substituteFor: line.substituteFor,
          dispenseStatus: line.substituteFor ? "substituted" : "dispensed",
          stockAdvisory: line.stockAdvisory,
        }));

        const treatment: Treatment = {
          id: sequenceId("treat", sequence),
          patientId: input.patientId,
          doctorId: input.doctorId,
          diagnosis: input.diagnosis.trim(),
          icd10Code: input.icd10Code.trim(),
          prescriptions,
          linkedReportIds: input.linkedReportIds,
          notes: input.notes.trim(),
          createdAt: new Date().toISOString(),
        };
        send({ type: "treatment/create", treatment, actor });
        return treatment;
      },

      administer: (input) => send({ type: "administration/record", ...input, actor }),

      recordVitals: (input) => {
        const sequence = (db.counters.vitals ?? 0) + 1;
        const vitals: VitalsRecord = {
          ...input,
          id: sequenceId("vitals", sequence),
          recordedBy: actor.id,
          recordedAt: new Date().toISOString(),
        };
        send({ type: "vitals/record", vitals, actor });
        return vitals;
      },

      createInvoice: (input) => {
        const sequence = (db.counters.invoice ?? 0) + 1;
        const invoice: Invoice = {
          id: `inv-${randomSuffix()}`,
          invoiceNumber: nextInvoiceNumber(sequence),
          patientId: input.patientId,
          cashierId: actor.id,
          items: input.items.map((item, index) => ({
            ...item,
            id: `item-${sequence}-${index + 1}`,
          })),
          taxPct: input.taxPct ?? 5,
          paymentStatus: "unpaid",
          transactions: [],
          notes: input.notes?.trim() ?? "",
          createdAt: new Date().toISOString(),
        };
        send({ type: "invoice/create", invoice, actor });
        return invoice;
      },

      collectPayment: ({ invoiceId, method, amount, reference }) => {
        const invoice = db.invoices.find((item) => item.id === invoiceId);
        if (!invoice) return;
        const transaction = splitPayment(invoice, method, roundMoney(amount), reference, actor.id);
        if (transaction.amountPaid <= 0) return;
        send({ type: "invoice/pay", invoiceId, transaction, actor });
      },

      uploadReport: (input) => {
        const sequence = (db.counters.report ?? 0) + 1;
        const report: MedicalReport = {
          id: sequenceId("report", sequence, 5),
          patientId: input.patientId,
          uploadedBy: actor.id,
          uploadedByRole: actor.role,
          fileName: input.fileName,
          fileMimeType: input.fileMimeType,
          fileSizeBytes: input.fileSizeBytes,
          reportCategory: input.reportCategory,
          reportDate: input.reportDate,
          ocrExtractionStatus: "completed",
          ocrConfidence: input.ocrConfidence,
          rawOcrText: input.rawOcrText,
          extractedFields: input.extractedFields,
          medicalDisclaimer: MEDICAL_DISCLAIMER,
          doctorNotes: "",
          createdAt: new Date().toISOString(),
        };
        send({ type: "report/add", report, actor });
        return report;
      },

      saveReportNote: (reportId, notes) => send({ type: "report/note", reportId, notes, actor }),

      toggleReportArchive: (reportId, archived, reason) =>
        send({ type: "report/archive", reportId, archived, reason, actor }),

      resolvePatientCondition: (patientId, condition, action) =>
        send({ type: "patient/resolveCondition", patientId, condition, action, actor }),

      sendPatientInquiry: (patientId, subject, message, doctorId) =>
        send({ type: "patient/inquiry", patientId, subject, message, doctorId, actor }),

      decideTransfer: (proposal, decision) => send({ type: "transfer/decide", proposal, decision, actor }),

      acknowledgeAlert: (alert) => send({ type: "alert/acknowledge", alert, actor }),

      resetDemo: () => {
        try {
          window.localStorage.removeItem(STORAGE_KEY);
        } catch {
          // Ignore storage failures; reseeding still works in memory.
        }
        send({ type: "demo/reset", db: createSeedDatabase() });
      },
    };
  }, [actor, db.counters, db.invoices, staffById]);

  const derived = useMemo<Derived>(
    () => ({
      referenceDate,
      assessments,
      assessmentById,
      portfolio,
      proposals,
      decisionLedger,
      alerts,
      patientsById,
      medicinesById,
      staffById,
      doctors,
      currentStaff,
      currentPatient,
      revenue,
      invoiceTotals,
      reportsFor,
      trendsFor,
      treatmentsFor,
      appointmentsFor,
      todaysQueue,
      admissionsFor,
      emarFor,
    }),
    [
      referenceDate,
      assessments,
      assessmentById,
      portfolio,
      proposals,
      decisionLedger,
      alerts,
      patientsById,
      medicinesById,
      staffById,
      doctors,
      currentStaff,
      currentPatient,
      revenue,
      invoiceTotals,
      reportsFor,
      trendsFor,
      treatmentsFor,
      appointmentsFor,
      todaysQueue,
      admissionsFor,
      emarFor,
    ],
  );

  const value = useMemo<AppStoreValue>(() => ({ state, derived, actions }), [state, derived, actions]);

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>;
}

/** Access the store. Throws when used outside the provider. */
export function useApp(): AppStoreValue {
  const context = useContext(AppStoreContext);
  if (!context) {
    throw new Error("useApp must be used inside an AppStoreProvider");
  }
  return context;
}

/** Convenience hook for components that only need the action surface. */
export function useActions(): AppActions {
  return useApp().actions;
}

/** Convenience hook for components that only need derived data. */
export function useDerived(): Derived {
  return useApp().derived;
}
