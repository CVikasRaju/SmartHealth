/**
 * SmartMedic domain model.
 *
 * These interfaces are the single contract shared by the seeded in-memory
 * database, the calculation engines, and every role portal. They intentionally
 * mirror the field names documented in `docs/database-schema.md` so the
 * prototype can be swapped onto a real API without renaming anything.
 */

/* ------------------------------------------------------------------ */
/* Shared primitives                                                   */
/* ------------------------------------------------------------------ */

/** Portal identities. `patient` is a distinct, restricted portal identity. */
export type Role = "admin" | "doctor" | "nurse" | "receptionist" | "cashier" | "patient";

/** Staff identities only, i.e. every role that is not the patient portal. */
export type StaffRole = Exclude<Role, "patient">;

/** Risk banding produced by the shortage engine's SPS score. */
export type RiskTier = "critical" | "high" | "moderate" | "normal";

export type Gender = "male" | "female" | "other";

/** Physical locations that hold their own medicine stock. */
export type WardId =
  | "ICU"
  | "EMERGENCY"
  | "GENERAL_A"
  | "GENERAL_B"
  | "PEDIATRICS"
  | "CENTRAL_STORE";

export const WARD_LABELS: Record<WardId, string> = {
  ICU: "Intensive Care Unit",
  EMERGENCY: "Emergency Department",
  GENERAL_A: "General Ward A",
  GENERAL_B: "General Ward B",
  PEDIATRICS: "Pediatric Ward",
  CENTRAL_STORE: "Central Pharmacy Store",
};

export const ALL_WARDS: WardId[] = [
  "ICU",
  "EMERGENCY",
  "GENERAL_A",
  "GENERAL_B",
  "PEDIATRICS",
  "CENTRAL_STORE",
];

/* ------------------------------------------------------------------ */
/* Workforce                                                           */
/* ------------------------------------------------------------------ */

export interface StaffMember {
  id: string;
  employeeId: string;
  fullName: string;
  role: StaffRole;
  department: string;
  email: string;
  contactNumber: string;
  shift: "morning" | "evening" | "night" | "rotational";
  /** Shift start hour (24h clock) used to build the eMAR round schedule. */
  shiftStartHour: number;
}

/* ------------------------------------------------------------------ */
/* Inventory & supply chain                                            */
/* ------------------------------------------------------------------ */

export type MedicineCategory =
  | "antibiotic"
  | "analgesic"
  | "cardiovascular"
  | "antidiabetic"
  | "respiratory"
  | "emergency"
  | "gastro"
  | "iv_fluid";

export type MedicineForm = "tablet" | "capsule" | "injection" | "iv_fluid" | "inhaler" | "syrup";

export interface Supplier {
  name: string;
  /** Contracted, paper lead time in days. */
  contractedLeadTimeDays: number;
  /** Vendor reliability penalty index, 1.0 (perfect) to 1.8 (chronic under-delivery). */
  reliabilityIndex: number;
  /** Observed delivery durations for the last N purchase orders, oldest first. */
  leadTimeHistory: number[];
}

/** Regional distributor pressure for a single molecule. */
export interface RegionalAlert {
  /** 0 - 15 risk points contributed straight into the SPS formula. */
  pressureIndex: number;
  /** Host facilities currently reporting the same molecule as constrained. */
  neighbouringFacilities: number;
  note: string;
}

/** Stock held by one ward, with the ward's own target holding (par level). */
export interface WardStock {
  ward: WardId;
  quantity: number;
  /** Par level: the quantity this ward wants on hand before a transfer is sane. */
  parLevel: number;
}

export interface Medicine {
  id: string;
  sku: string;
  brandName: string;
  genericName: string;
  category: MedicineCategory;
  form: MedicineForm;
  strength: string;
  /** Dispensing unit, e.g. "tablet", "vial", "bottle". */
  unit: string;
  /** Charge price per dispensing unit in INR. */
  unitPrice: number;
  currentStock: number;
  /** Soft-reserved by pending prescriptions; not physically on the shelf. */
  allocatedStock: number;
  reorderThreshold: number;
  economicOrderQuantity: number;
  /** Mandatory safety stock expressed in days of cover. */
  safetyStockDays: number;
  /** Daily dispense counts, oldest first. Drives the EWMA burn rate. */
  consumptionHistory: number[];
  regionalAlert: RegionalAlert;
  supplier: Supplier;
  /** Therapeutic equivalents by medicine id, used for CPOE substitution hints. */
  therapeuticAlternatives: string[];
  wardStock: WardStock[];
  controlledSubstance: boolean;
  lastRestockedAt: string;
}

/* ------------------------------------------------------------------ */
/* Predictive shortage intelligence                                    */
/* ------------------------------------------------------------------ */

export type RiskDriverCode = "burn" | "lead" | "regional" | "buffer";

/** One leg of the dynamic triangulated shortage metric. */
export interface RiskDriver {
  code: RiskDriverCode;
  label: string;
  /** Human readable evidence shown in the control room drill-down. */
  detail: string;
  points: number;
  maxPoints: number;
}

/** Per-ward days of cover, derived from the ward's par level and share of demand. */
export interface WardCoverage {
  ward: WardId;
  quantity: number;
  parLevel: number;
  /** Expected daily draw for this ward, apportioned by its par level. */
  expectedDailyDemand: number;
  /** Days of cover this ward holds against its own expected draw. */
  coverDays: number;
  atRisk: boolean;
}

export interface RiskAssessment {
  medicineId: string;
  sku: string;
  brandName: string;
  genericName: string;
  category: MedicineCategory;
  form: MedicineForm;
  availableStock: number;
  /** EWMA based daily consumption, i.e. D_t in the spec. */
  dailyBurnRate: number;
  /** Long-window average used as the surge baseline. */
  baselineBurnRate: number;
  /** Signed percentage change of burn rate against baseline. */
  burnTrendPct: number;
  /** Days of inventory remaining. */
  dir: number;
  dynamicLeadTimeDays: number;
  contractedLeadTimeDays: number;
  leadTimeSlippagePct: number;
  safetyStockDays: number;
  /** Combined non-stock risk signals (Psi). */
  psi: number;
  /** Shortage probability score, 0 - 100. */
  sps: number;
  tier: RiskTier;
  projectedStockoutDate: string;
  /** Latest date a purchase order can be raised and still arrive in time. */
  reorderByDate: string;
  drivers: RiskDriver[];
  recommendation: string;
  /** EWMA curve, oldest first, for the drill-down sparkline. */
  burnSeries: number[];
  /** Wards whose cover has fallen below the at-risk threshold. */
  wardsAtRisk: number;
  /** Ward with the thinnest cover, or null when nothing is held at ward level. */
  worstWard: WardId | null;
  /** Units sitting above ward par levels that an inter-ward transfer could release. */
  strandedUnits: number;
  coverageByWard: WardCoverage[];
}

export interface TransferProposal {
  id: string;
  medicineId: string;
  drugName: string;
  fromWard: WardId;
  toWard: WardId;
  quantity: number;
  surplusAtSource: number;
  deficitAtTarget: number;
  rationale: string;
  /** Projected reduction in the molecule's facility SPS score. */
  estimatedSpsDrop: number;
  /** Wards whose cover is lifted back above the at-risk threshold by this move. */
  wardsRecovered: number;
  status: "proposed" | "approved" | "rejected";
  decidedAt?: string;
  decidedBy?: string;
}

export interface ScenarioInput {
  id: string;
  label: string;
  description: string;
  /** Percentage surge applied to every EWMA burn rate. */
  demandSurgePct: number;
  /** Extra days added to the dynamic supplier lead time. */
  leadTimeSlippageDays: number;
  /** Added directly to each molecule's regional pressure index. */
  regionalPressureDelta: number;
  /** Percentage of shelf stock removed (e.g. a ward-level spillage/recall). */
  stockWriteOffPct: number;
}

export interface ScenarioProjection {
  medicineId: string;
  drugName: string;
  baselineSps: number;
  projectedSps: number;
  baselineDir: number;
  projectedDir: number;
  baselineTier: RiskTier;
  projectedTier: RiskTier;
  escalated: boolean;
}

export interface ScenarioResult {
  input: ScenarioInput;
  projections: ScenarioProjection[];
  criticalCount: number;
  highCount: number;
  headline: string;
}

export interface ShortageAlert {
  id: string;
  medicineId: string;
  drugName: string;
  tier: RiskTier;
  sps: number;
  message: string;
  createdAt: string;
  acknowledged: boolean;
}

/* ------------------------------------------------------------------ */
/* Patients & operations                                               */
/* ------------------------------------------------------------------ */

export interface Allergy {
  allergen: string;
  severity: "mild" | "moderate" | "severe";
  reaction: string;
}

export interface EmergencyContact {
  name: string;
  relation: string;
  contact: string;
}

export interface Admission {
  isAdmitted: boolean;
  ward?: WardId;
  bedNumber?: string;
}

export interface Patient {
  id: string;
  mrn: string;
  name: string;
  dob: string;
  gender: Gender;
  bloodGroup: string;
  contact: string;
  email: string;
  allergies: Allergy[];
  emergencyContact: EmergencyContact;
  currentAdmission: Admission;
  chronicConditions: string[];
  resolvedConditions?: string[];
  registeredAt: string;
}

/** Triage acuity assigned by the receptionist at check-in. */
export type Acuity = "critical" | "urgent" | "standard" | "routine";

export type AppointmentStatus =
  | "scheduled"
  | "checked_in"
  | "in_consult"
  | "completed"
  | "cancelled"
  | "no_show";

export interface Appointment {
  id: string;
  patientId: string;
  doctorId: string;
  department: string;
  scheduledFor: string;
  reason: string;
  status: AppointmentStatus;
  acuity: Acuity;
  triageNotes: string;
  queuePosition: number | null;
  createdAt: string;
}

export type FrequencyKey =
  | "once_daily"
  | "twice_daily"
  | "thrice_daily"
  | "four_times_daily"
  | "sos"
  | "stat";

/** Doses per day per frequency key; `sos`/`stat` are treated as on-demand. */
export const FREQUENCY_DOSES_PER_DAY: Record<FrequencyKey, number> = {
  once_daily: 1,
  twice_daily: 2,
  thrice_daily: 3,
  four_times_daily: 4,
  sos: 1,
  stat: 1,
};

export const FREQUENCY_LABELS: Record<FrequencyKey, string> = {
  once_daily: "Once daily (OD)",
  twice_daily: "Twice daily (BD)",
  thrice_daily: "Three times daily (TDS)",
  four_times_daily: "Four times daily (QDS)",
  sos: "As required (SOS)",
  stat: "Immediately (STAT)",
};

export type DispenseStatus = "pending" | "dispensed" | "substituted" | "cancelled";

export interface PrescriptionLine {
  id: string;
  medicineId: string;
  drugName: string;
  dosage: string;
  frequency: FrequencyKey;
  durationDays: number;
  /** Total dispensing units consumed across the course. */
  quantity: number;
  route: "oral" | "iv" | "im" | "sc" | "inhaled" | "topical";
  instructions: string;
  /** Set when the doctor accepted a suggested therapeutic equivalent. */
  substituteFor: string | null;
  dispenseStatus: DispenseStatus;
  /** Non-blocking stock advisory captured at prescribing time. */
  stockAdvisory: string | null;
}

export interface Treatment {
  id: string;
  patientId: string;
  doctorId: string;
  diagnosis: string;
  icd10Code: string;
  prescriptions: PrescriptionLine[];
  linkedReportIds: string[];
  notes: string;
  createdAt: string;
}

export type AdministrationStatus = "given" | "held" | "refused" | "missed";

export interface MedicationAdministration {
  id: string;
  prescriptionId: string;
  patientId: string;
  medicineId: string;
  drugName: string;
  dose: string;
  route: PrescriptionLine["route"];
  scheduledFor: string;
  status: AdministrationStatus;
  administeredAt: string | null;
  administeredBy: string | null;
  site: string | null;
  notes: string;
  /** Vitals captured at the bedside immediately before administration. */
  vitalsId: string | null;
}

export interface VitalsRecord {
  id: string;
  patientId: string;
  recordedBy: string;
  recordedAt: string;
  temperatureC: number;
  heartRateBpm: number;
  systolic: number;
  diastolic: number;
  respiratoryRate: number;
  spo2: number;
  painScore: number;
  notes: string;
}

/* ------------------------------------------------------------------ */
/* Revenue cycle                                                       */
/* ------------------------------------------------------------------ */

export type InvoiceItemType =
  | "consultation"
  | "medication"
  | "procedure"
  | "diagnostic_report"
  | "room_charge";

export interface InvoiceItem {
  id: string;
  itemType: InvoiceItemType;
  description: string;
  quantity: number;
  unitPrice: number;
}

export type PaymentMethod = "cash" | "credit_card" | "debit_card" | "upi" | "insurance_claim";

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  credit_card: "Credit Card",
  debit_card: "Debit Card",
  upi: "UPI",
  insurance_claim: "Insurance Claim",
};

export interface PaymentTransaction {
  id: string;
  paymentMethod: PaymentMethod;
  amountPaid: number;
  reference: string;
  processedAt: string;
  processedBy: string;
}

export type PaymentStatus = "unpaid" | "partially_paid" | "paid" | "refunded";

export interface Invoice {
  id: string;
  invoiceNumber: string;
  patientId: string;
  cashierId: string;
  items: InvoiceItem[];
  /** GST-style tax applied on the taxable subtotal. */
  taxPct: number;
  paymentStatus: PaymentStatus;
  transactions: PaymentTransaction[];
  notes: string;
  createdAt: string;
}

/** Derived totals; always recomputed, never stored. */
export interface InvoiceTotals {
  subtotal: number;
  taxAmount: number;
  grandTotal: number;
  amountPaid: number;
  balanceDue: number;
}

/* ------------------------------------------------------------------ */
/* Medical report simplifier                                           */
/* ------------------------------------------------------------------ */

export type BiomarkerCategory =
  | "glycemic"
  | "renal"
  | "hematology"
  | "lipid"
  | "thyroid"
  | "electrolyte"
  | "hepatic"
  | "inflammatory";

export type BiomarkerStatus =
  | "normal"
  | "low"
  | "elevated"
  | "critical_low"
  | "critical_high"
  | "unknown";

export const BIOMARKER_STATUS_LABELS: Record<BiomarkerStatus, string> = {
  normal: "Within range",
  low: "Below range",
  elevated: "Above range",
  critical_low: "Markedly low",
  critical_high: "Markedly high",
  unknown: "Unclassified",
};

export interface ReferenceRange {
  min: number;
  max: number;
  /** Display form, e.g. "70 - 99". */
  text: string;
  /** Optional panic thresholds used to promote a value to a critical band. */
  criticalLow?: number;
  criticalHigh?: number;
}

export interface ExtractedField {
  id: string;
  /** Display name as matched in the dictionary, e.g. "Fasting Blood Sugar (FBS)". */
  testName: string;
  /** Normalised key, e.g. "fbs". Empty string when the line was unrecognised. */
  normalizedKey: string;
  value: number;
  valueText: string;
  unit: string;
  referenceRange: ReferenceRange;
  status: BiomarkerStatus;
  plainLanguageExplanation: string;
  category: BiomarkerCategory;
  /** Simulated OCR confidence, 0 - 1. */
  confidence: number;
  /** The raw alias that matched, kept for auditability of the extraction. */
  matchedAlias: string;
}

export type OcrStatus = "pending" | "processing" | "completed" | "failed";

export type ReportCategory =
  | "blood_panel"
  | "renal_panel"
  | "lipid_profile"
  | "thyroid_panel"
  | "urinalysis"
  | "general";

export const REPORT_CATEGORY_LABELS: Record<ReportCategory, string> = {
  blood_panel: "Blood Panel (CBC / Glycemic)",
  renal_panel: "Renal Function Panel",
  lipid_profile: "Lipid Profile",
  thyroid_panel: "Thyroid Panel",
  urinalysis: "Urinalysis",
  general: "General / Other",
};

export interface MedicalReport {
  id: string;
  patientId: string;
  uploadedBy: string;
  uploadedByRole: Role;
  fileName: string;
  fileMimeType: string;
  fileSizeBytes: number;
  reportCategory: ReportCategory;
  reportDate: string;
  ocrExtractionStatus: OcrStatus;
  /** Mean simulated OCR confidence across matched fields, 0 - 1. */
  ocrConfidence: number;
  rawOcrText: string;
  extractedFields: ExtractedField[];
  medicalDisclaimer: string;
  doctorNotes: string;
  archived?: boolean;
  resolvedReason?: string;
  createdAt: string;
}

export interface TrendPoint {
  date: string;
  value: number;
  reportId: string;
}

export interface BiomarkerTrend {
  normalizedKey: string;
  testName: string;
  unit: string;
  category: BiomarkerCategory;
  referenceRange: ReferenceRange;
  history: TrendPoint[];
  latest: number;
  previous: number | null;
  delta: number | null;
  deltaPct: number | null;
  direction: "rising" | "falling" | "stable";
  status: BiomarkerStatus;
  plainLanguageExplanation: string;
}

/* ------------------------------------------------------------------ */
/* Governance                                                          */
/* ------------------------------------------------------------------ */

export interface AuditEntry {
  id: string;
  at: string;
  actorId: string;
  actorName: string;
  actorRole: Role;
  action: string;
  target: string;
  detail: string;
}

/* ------------------------------------------------------------------ */
/* Application state                                                   */
/* ------------------------------------------------------------------ */

export interface DatabaseState {
  staff: StaffMember[];
  patients: Patient[];
  medicines: Medicine[];
  appointments: Appointment[];
  treatments: Treatment[];
  administrations: MedicationAdministration[];
  vitals: VitalsRecord[];
  invoices: Invoice[];
  reports: MedicalReport[];
  transferProposals: TransferProposal[];
  alerts: ShortageAlert[];
  auditLog: AuditEntry[];
  /** Counters backing the human-readable IDs the prototype generates. */
  counters: Record<string, number>;
}

/** Every collection in the database, i.e. anything a sync patch can carry. */
export type CollectionKey = Exclude<keyof DatabaseState, "counters">;

export interface SessionState {
  role: Role;
  /** Active staff member for staff roles. */
  staffId: string;
  /** Active patient for the patient portal. */
  patientId: string;
}

export interface AppState {
  db: DatabaseState;
  session: SessionState;
  /** Which module the current role is viewing. */
  activeView: string;
}
