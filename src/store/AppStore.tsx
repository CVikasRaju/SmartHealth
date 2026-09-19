/**
 * Application store.
 *
 * The hospital record is loaded from the API on sign-in and every mutation is
 * written straight back to it. The client still applies its changes
 * optimistically through the pure reducer — so the UI never waits on the network
 * — and then reconciles with the rows the server actually committed. That
 * reconciliation is what makes the stores authoritative rather than decorative:
 * when a doctor prescribes, the stock figure that ends up on screen is the one
 * Postgres holds, not the one the browser guessed.
 *
 * Audit entries are the exception: the server writes the ledger itself and does
 * not echo it back, because the acting identity has to come from the verified
 * session rather than from the client.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
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
  Hospital,
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
import { useSession } from "@/store/SessionProvider";
import { ApiError, describeError, type AppliedPatch, type ProfileView } from "@/lib/apiClient";
import { HOME_VIEW, viewBelongsToRole } from "@/ui/navigation";
import BootScreen from "@/ui/BootScreen";
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

/** Progress of the client synchronisation with the API. */
export interface SyncState {
  /** Mutations in flight. */
  pending: number;
  /** Last failure, already formatted for display. */
  error: string | null;
  lastSyncedAt: string | null;
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
  setHospital: (hospitalId: string) => void;
  onboardHospital: (input: Omit<Hospital, "id" | "createdAt">) => Hospital;
  updateHospital: (id: string, patch: Partial<Hospital>) => void;
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
  /** Reload the record from the API, discarding local optimism. */
  resync: () => void;
}

interface AppStoreValue {
  state: AppState;
  derived: Derived;
  actions: AppActions;
  sync: SyncState;
  /** The signed-in account. */
  profile: ProfileView | null;
  /** Whether this session is backed by Postgres or the seeded dataset. */
  mode: "supabase" | "demo";
}

const AppStoreContext = createContext<AppStoreValue | null>(null);

/* ------------------------------------------------------------------ */
/* Provider                                                            */
/* ------------------------------------------------------------------ */

type LoadState = "loading" | "ready" | "error";

/**
 * Store provider.
 *
 * `initialState` bypasses the API entirely, which is how the render smoke test
 * exercises every portal without a server.
 */
export function AppStoreProvider({
  children,
  initialState,
}: {
  children: ReactNode;
  initialState?: AppState;
}) {
  const { api, mode: sessionMode, signOut } = useSession();

  const [state, dispatch] = useReducer(
    appReducer,
    undefined,
    () => initialState ?? createInitialAppState(),
  );

  const [loadState, setLoadState] = useState<LoadState>(initialState ? "ready" : "loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileView | null>(null);
  const [mode, setMode] = useState<"supabase" | "demo">(sessionMode);
  const [sync, setSync] = useState<SyncState>({ pending: 0, error: null, lastSyncedAt: null });

  // Lets a resync keep the operator on the page they were reading.
  const activeViewRef = useRef(state.activeView);
  activeViewRef.current = state.activeView;

  /* -------- Load and reconcile -------- */

  const load = useCallback(async () => {
    setLoadState("loading");
    try {
      const payload = await api.bootstrap();
      const role = payload.profile.role;

      dispatch({
        type: "state/replaceAll",
        db: payload.db,
        session: {
          role,
          staffId: payload.profile.staffId ?? payload.db.staff[0]?.id ?? "",
          patientId: payload.profile.patientId ?? payload.db.patients[0]?.id ?? "",
        },
        activeView: viewBelongsToRole(role, activeViewRef.current)
          ? activeViewRef.current
          : HOME_VIEW[role],
      });

      setProfile(payload.profile);
      setMode(payload.mode);
      setLoadError(null);
      setLoadState("ready");
    } catch (error) {
      const msg = describeError(error);
      if (/missing|expired|invalid|no_profile|unauthorized|401|403/i.test(msg)) {
        void signOut();
        return;
      }
      setLoadError(msg);
      setLoadState("error");
    }
  }, [api, signOut]);

  useEffect(() => {
    if (initialState) return;
    void load();
  }, [initialState, load]);

  /* -------- Mutation tracking -------- */

  const persist = useCallback(
    async (label: string, work: Promise<AppliedPatch>) => {
      setSync((current) => ({ ...current, pending: current.pending + 1 }));
      try {
        const applied = await work;
        dispatch({
          type: "state/merge",
          collections: applied.collections,
          counters: applied.counters,
        });
        setSync((current) => ({
          ...current,
          pending: Math.max(0, current.pending - 1),
          error: null,
          lastSyncedAt: new Date().toISOString(),
        }));
      } catch (error) {
        setSync((current) => ({
          ...current,
          pending: Math.max(0, current.pending - 1),
          error: `${label}. ${describeError(error)}`,
        }));

        // A rejected or conflicting write means this client's snapshot no longer
        // matches the server's, so the honest response is to reload it.
        const stale =
          error instanceof ApiError &&
          (error.code === "duplicate_id" || error.status === 401 || error.status === 403);
        if (stale) void load();
      }
    },
    [load],
  );

  const track = useCallback(
    (label: string, work: Promise<AppliedPatch>) => {
      void persist(label, work);
    },
    [persist],
  );

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

  const currentStaff =
    session.role === "patient" ? null : (staffById.get(session.staffId) ?? null);
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
      setHospital: (hospitalId) => send({ type: "session/setHospital", hospitalId }),
      onboardHospital: (input) => {
        const sequence = (db.counters.hospital ?? 0) + 1;
        const hospital: Hospital = {
          ...input,
          id: `hosp-mgl-${String(sequence).padStart(3, "0")}`,
          createdAt: new Date().toISOString(),
        };
        send({ type: "hospital/onboard", hospital, actor });
        track("Could not onboard the hospital facility", api.post("/hospitals", { hospital }));
        return hospital;
      },
      updateHospital: (id, patch) => {
        send({ type: "hospital/update", id, patch, actor });
        track("Could not update the hospital record", api.patch(`/hospitals/${id}`, patch));
      },
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
        track("Could not save the patient registration", api.post("/patients", { patient }));
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
        track("Could not save the appointment", api.post("/appointments", { appointment }));
        return appointment;
      },

      setAppointmentStatus: (id, status, queuePosition) => {
        send({ type: "appointment/status", id, status, queuePosition, actor });
        track(
          "Could not update the appointment",
          api.patch(`/appointments/${id}`, {
            status,
            queuePosition: queuePosition === undefined ? null : queuePosition,
          }),
        );
      },

      triageAppointment: (input) => {
        send({ type: "appointment/triage", ...input, actor });
        track(
          "Could not record the triage assessment",
          api.patch(`/appointments/${input.id}`, {
            acuity: input.acuity,
            triageNotes: input.notes,
            doctorId: input.doctorId,
          }),
        );
      },

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
        track("Could not save the prescription", api.post("/treatments", { treatment }));
        return treatment;
      },

      administer: (input) => {
        send({ type: "administration/record", ...input, actor });
        track(
          "Could not chart the dose",
          api.patch(`/administrations/${input.id}`, {
            status: input.status,
            vitalsId: input.vitalsId,
            notes: input.notes,
          }),
        );
      },

      recordVitals: (input) => {
        const sequence = (db.counters.vitals ?? 0) + 1;
        const vitals: VitalsRecord = {
          ...input,
          id: sequenceId("vitals", sequence),
          recordedBy: actor.id,
          recordedAt: new Date().toISOString(),
        };
        send({ type: "vitals/record", vitals, actor });
        track("Could not save the observation", api.post("/vitals", { vitals }));
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
        track("Could not raise the invoice", api.post("/invoices", { invoice }));
        return invoice;
      },

      collectPayment: ({ invoiceId, method, amount, reference }) => {
        const invoice = db.invoices.find((item) => item.id === invoiceId);
        if (!invoice) return;
        const transaction = splitPayment(invoice, method, roundMoney(amount), reference, actor.id);
        if (transaction.amountPaid <= 0) return;
        send({ type: "invoice/pay", invoiceId, transaction, actor });
        track(
          "Could not record the payment",
          api.post(`/invoices/${invoiceId}/payments`, {
            paymentMethod: method,
            amount: transaction.amountPaid,
            reference,
          }),
        );
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
          extractedFields: input.extractedFields.map((field) => ({
            ...field,
            // Field ids are scoped to this report: the parser cannot know the
            // report id when it runs, and a content hash alone collides across
            // reports sharing an identical line (rejected by the primary key).
            id: `field-${report.id}-${field.normalizedKey}`,
          })),
          medicalDisclaimer: MEDICAL_DISCLAIMER,
          doctorNotes: "",
          createdAt: new Date().toISOString(),
        };
        send({ type: "report/add", report, actor });
        track("Could not store the report", api.post("/reports", { report }));
        return report;
      },

      saveReportNote: (reportId, notes) => {
        send({ type: "report/note", reportId, notes, actor });
        track(
          "Could not save the physician note",
          api.patch(`/reports/${reportId}`, { doctorNotes: notes }),
        );
      },

      toggleReportArchive: (reportId, archived, reason) => {
        send({ type: "report/archive", reportId, archived, reason, actor });
        track(
          "Could not update the report",
          api.patch(`/reports/${reportId}`, {
            archived,
            resolvedReason: archived ? (reason ?? "Condition resolved") : null,
          }),
        );
      },

      resolvePatientCondition: (patientId, condition, mode) => {
        send({ type: "patient/resolveCondition", patientId, condition, action: mode, actor });
        track(
          "Could not update the patient record",
          api.patch(`/patients/${patientId}`, { condition, action: mode }),
        );
      },

      sendPatientInquiry: (patientId, subject, message, doctorId) => {
        send({ type: "patient/inquiry", patientId, subject, message, doctorId, actor });
        track(
          "Could not deliver the query",
          api.post("/inquiries", { patientId, subject, message, doctorId }),
        );
      },

      decideTransfer: (proposal, decision) => {
        send({ type: "transfer/decide", proposal, decision, actor });
        track(
          "Could not record the redistribution decision",
          api.post(`/transfers/${proposal.id}/decision`, { proposal, decision }),
        );
      },

      acknowledgeAlert: (alert) => {
        send({ type: "alert/acknowledge", alert, actor });
        track(
          "Could not acknowledge the alert",
          api.post(`/alerts/${alert.id}/acknowledge`, { alert }),
        );
      },

      resetDemo: () => {
        void (async () => {
          setSync((current) => ({ ...current, pending: current.pending + 1 }));
          try {
            const { db: reseeded } = await api.resetDemo();
            send({ type: "demo/reset", db: reseeded });
            setSync((current) => ({
              ...current,
              pending: Math.max(0, current.pending - 1),
              error: null,
              lastSyncedAt: new Date().toISOString(),
            }));
          } catch (error) {
            setSync((current) => ({
              ...current,
              pending: Math.max(0, current.pending - 1),
              error: `Could not reseed the demonstration data. ${describeError(error)}`,
            }));
          }
        })();
      },

      resync: () => void load(),
    };
  }, [actor, api, db.counters, db.invoices, load, staffById, track]);

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

  const value = useMemo<AppStoreValue>(
    () => ({ state, derived, actions, sync, profile, mode }),
    [state, derived, actions, sync, profile, mode],
  );

  if (loadState === "loading") {
    return (
      <BootScreen
        title="Loading the hospital record"
        detail="Fetching the formulary, patient register and clinical ledger from the database."
      />
    );
  }

  if (loadState === "error") {
    return (
      <BootScreen
        title="The hospital record could not be loaded"
        detail={loadError ?? undefined}
        onRetry={() => void load()}
        onSignOut={() => void signOut()}
      />
    );
  }

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

/** Reseed helper kept for tests and tooling that predate the API. */
export { createSeedDatabase };
