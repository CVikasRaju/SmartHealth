/**
 * Seeded in-memory database.
 *
 * The prototype runs with zero backend setup, so this module synthesises a
 * complete hospital dataset: staff across five roles, four patient records with
 * one linked patient-portal account, a twelve-line formulary distributed across
 * wards, live appointments, prescriptions, bedside administration records,
 * invoices, and six parsed laboratory reports.
 *
 * Consumption histories are produced by a seeded PRNG, so every reload of the
 * demo shows identical forecasts while still looking like a real dispensing
 * ledger with weekday dips and acute surges.
 */

import type {
  Allergy,
  AppState,
  Appointment,
  AuditEntry,
  DatabaseState,
  FrequencyKey,
  Hospital,
  Invoice,
  MedicalReport,
  Medicine,
  MedicineCategory,
  MedicineForm,
  Patient,
  PrescriptionLine,
  ReportCategory,
  StaffMember,
  Treatment,
  VitalsRecord,
  WardStock,
} from "@/types";
// Relative rather than aliased: the seed is also consumed by the database seed
// script and the serverless API, neither of which resolves the `@/` alias.
import { FREQUENCY_DOSES_PER_DAY } from "../types";
import { MEDICAL_DISCLAIMER, parseReportText } from "../engine/reportEngine";

/* ------------------------------------------------------------------ */
/* Deterministic clock helpers                                         */
/* ------------------------------------------------------------------ */

/** ISO timestamp for `hour:minute` local time, offset by whole days. */
function isoAt(hour: number, minute: number, dayOffset = 0): string {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  date.setDate(date.getDate() + dayOffset);
  return date.toISOString();
}

export function isoDaysAgo(days: number, hour = 9, minute = 0): string {
  return isoAt(hour, minute, -days);
}

export function isoDaysAhead(days: number, hour = 9, minute = 0): string {
  return isoAt(hour, minute, days);
}

/* ------------------------------------------------------------------ */
/* Consumption history synthesis                                       */
/* ------------------------------------------------------------------ */

/**
 * Deterministic 32-bit PRNG (mulberry32). Chosen because it is tiny, dependency
 * free, and produces the same stream for the same seed on every machine.
 */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ConsumptionProfile {
  seed: number;
  /** Typical daily dispense count at the start of the window. */
  baseline: number;
  /** Compounding daily drift, e.g. 0.004 = +0.4% per day on the trend. */
  drift: number;
  /** Fractional day-to-day noise, e.g. 0.16 = ±16%. */
  jitter: number;
  /** Optional demand surge applied to the most recent N days. */
  surge?: { daysAgo: number; multiplier: number };
  days?: number;
}

/**
 * Build a dispensing ledger. Weekend dispensary loads are visibly lighter,
 * which the EWMA naturally smooths out, and an optional surge window models an
 * infection wave hitting the formulary.
 */
export function buildConsumption({ seed, baseline, drift, jitter, surge, days = 30 }: ConsumptionProfile): number[] {
  const random = createRandom(seed);
  const series: number[] = [];

  for (let index = 0; index < days; index++) {
    const daysAgo = days - 1 - index;
    let value = baseline * (1 + drift) ** index;

    // Weekends carry a lighter outpatient and theatre load.
    if (daysAgo % 7 === 0 || daysAgo % 7 === 6) value *= 0.74;
    if (surge && daysAgo <= surge.daysAgo) value *= surge.multiplier;

    value *= 1 + (random() - 0.5) * 2 * jitter;
    series.push(Math.max(0, Math.round(value)));
  }

  return series;
}

/* ------------------------------------------------------------------ */
/* Formulary                                                           */
/* ------------------------------------------------------------------ */

/** A seeded medicine declares ward stock; `currentStock` is derived from it. */
export type SeedMedicine = Omit<Medicine, "currentStock" | "consumptionHistory"> & {
  consumption: ConsumptionProfile;
};

/**
 * Ward holdings always sum to the facility total, so `currentStock` is derived
 * rather than declared. That removes any chance of the seed disagreeing with
 * itself once the transfer balancer starts moving stock between wards.
 */
function sumWardStock(wardStock: WardStock[]): number {
  return wardStock.reduce((total, holding) => total + holding.quantity, 0);
}

export const HOSPITALS: Hospital[] = [
  {
    id: "hosp-kmc-mgl",
    code: "KMC-MGL-01",
    name: "KMC Hospital Mangalore",
    location: "Dr. B. R. Ambedkar Circle, Hampankatta",
    city: "Mangalore",
    state: "Karnataka",
    tier: "tertiary",
    bedCapacity: 500,
    activeWards: 6,
    status: "active",
    contactEmail: "admin.kmc@smartmedic.io",
    phone: "+91 824 244 4590",
    adminId: "staff-admin-1",
    adminName: "Meera Krishnan",
    adminEmail: "meera.krishnan@smartmedic.io",
    createdAt: "2025-01-15T00:00:00.000Z",
  },
  {
    id: "hosp-fmmc-mgl",
    code: "FMMC-MGL-02",
    name: "Father Muller Medical College Hospital",
    location: "Father Muller Road, Kankanady",
    city: "Mangalore",
    state: "Karnataka",
    tier: "tertiary",
    bedCapacity: 1250,
    activeWards: 8,
    status: "active",
    contactEmail: "admin.fmmc@smartmedic.io",
    phone: "+91 824 223 8000",
    adminId: "staff-admin-fmmc",
    adminName: "Dr. Antony S. D'Souza",
    adminEmail: "admin.fmmc@smartmedic.io",
    createdAt: "2025-02-01T00:00:00.000Z",
  },
  {
    id: "hosp-ajh-mgl",
    code: "AJH-MGL-03",
    name: "A.J. Hospital & Research Centre",
    location: "NH 66, Kuntikan",
    city: "Mangalore",
    state: "Karnataka",
    tier: "tertiary",
    bedCapacity: 650,
    activeWards: 7,
    status: "active",
    contactEmail: "admin.ajh@smartmedic.io",
    phone: "+91 824 222 5555",
    adminId: "staff-admin-ajh",
    adminName: "Dr. Prashanth Marla",
    adminEmail: "admin.ajh@smartmedic.io",
    createdAt: "2025-03-10T00:00:00.000Z",
  },
  {
    id: "hosp-ysh-mgl",
    code: "YSH-MGL-04",
    name: "Yenepoya Specialty Hospital",
    location: "Kodiabail",
    city: "Mangalore",
    state: "Karnataka",
    tier: "secondary",
    bedCapacity: 350,
    activeWards: 5,
    status: "active",
    contactEmail: "admin.ysh@smartmedic.io",
    phone: "+91 824 423 8855",
    adminId: "staff-admin-ysh",
    adminName: "Dr. Farhaad Yenepoya",
    adminEmail: "admin.ysh@smartmedic.io",
    createdAt: "2025-04-12T00:00:00.000Z",
  },
  {
    id: "hosp-wdh-mgl",
    code: "WDH-MGL-05",
    name: "Wenlock District Government Hospital",
    location: "Opposite D.C. Office, Hampankatta",
    city: "Mangalore",
    state: "Karnataka",
    tier: "district",
    bedCapacity: 750,
    activeWards: 6,
    status: "active",
    contactEmail: "admin.wenlock@smartmedic.io",
    phone: "+91 824 242 4310",
    adminId: "staff-admin-wdh",
    adminName: "Dr. Sadashiva Shanbhogue",
    adminEmail: "admin.wenlock@smartmedic.io",
    createdAt: "2025-05-01T00:00:00.000Z",
  },
];

const STAFF: StaffMember[] = [
  {
    id: "staff-admin-1",
    hospitalId: "hosp-kmc-mgl",
    employeeId: "EMP-1001",
    fullName: "Meera Krishnan",
    role: "admin",
    department: "Hospital Administration",
    email: "meera.krishnan@smartmedic.io",
    contactNumber: "+91-9845001101",
    shift: "morning",
    shiftStartHour: 8,
  },
  {
    id: "staff-doctor-1",
    hospitalId: "hosp-kmc-mgl",
    employeeId: "EMP-2001",
    fullName: "Dr. Ramesh Sharma",
    role: "doctor",
    department: "Pulmonology & General Medicine",
    email: "dr.sharma@smartmedic.io",
    contactNumber: "+91-9845002201",
    shift: "morning",
    shiftStartHour: 9,
  },
  {
    id: "staff-doctor-2",
    hospitalId: "hosp-kmc-mgl",
    employeeId: "EMP-2002",
    fullName: "Dr. Nandita Rao",
    role: "doctor",
    department: "Internal Medicine & Endocrinology",
    email: "dr.rao@smartmedic.io",
    contactNumber: "+91-9845002202",
    shift: "evening",
    shiftStartHour: 14,
  },
  {
    id: "staff-nurse-1",
    hospitalId: "hosp-kmc-mgl",
    employeeId: "EMP-3001",
    fullName: "Sister Fatima Sheikh",
    role: "nurse",
    department: "Intensive Care Unit",
    email: "fatima.sheikh@smartmedic.io",
    contactNumber: "+91-9845003301",
    shift: "morning",
    shiftStartHour: 7,
  },
  {
    id: "staff-nurse-2",
    hospitalId: "hosp-kmc-mgl",
    employeeId: "EMP-3002",
    fullName: "Joseph Thomas",
    role: "nurse",
    department: "General Ward A",
    email: "joseph.thomas@smartmedic.io",
    contactNumber: "+91-9845003302",
    shift: "night",
    shiftStartHour: 19,
  },
  {
    id: "staff-reception-1",
    hospitalId: "hosp-kmc-mgl",
    employeeId: "EMP-4001",
    fullName: "Kavya Nair",
    role: "receptionist",
    department: "Front Office & Triage",
    email: "kavya.nair@smartmedic.io",
    contactNumber: "+91-9845004401",
    shift: "morning",
    shiftStartHour: 7,
  },
  {
    id: "staff-cashier-1",
    hospitalId: "hosp-kmc-mgl",
    employeeId: "EMP-5001",
    fullName: "Arjun Deshpande",
    role: "cashier",
    department: "Billing & Revenue Cycle",
    email: "arjun.deshpande@smartmedic.io",
    contactNumber: "+91-9845005501",
    shift: "morning",
    shiftStartHour: 8,
  },
];

const PATIENTS: Patient[] = [
  {
    id: "patient-1",
    mrn: "MRN-2026-0001",
    name: "Aarav Menon",
    dob: "1991-04-18",
    gender: "male",
    bloodGroup: "B+",
    contact: "+91-9845012345",
    email: "aarav.menon@example.com",
    allergies: [
      { allergen: "Penicillin", severity: "severe", reaction: "Anaphylaxis — airway swelling within minutes" },
      { allergen: "Dust mite", severity: "mild", reaction: "Rhinitis" },
    ],
    emergencyContact: { name: "Divya Menon", relation: "Spouse", contact: "+91-9845012346" },
    currentAdmission: { isAdmitted: true, ward: "ICU", bedNumber: "ICU-04" },
    chronicConditions: ["Hypertension", "Seasonal bronchospasm"],
    registeredAt: isoDaysAgo(420, 10, 15),
  },
  {
    id: "patient-2",
    mrn: "MRN-2026-0002",
    name: "Priya Sharma",
    dob: "1985-03-12",
    gender: "female",
    bloodGroup: "O+",
    contact: "+91-9876543210",
    email: "priya.sharma@example.com",
    allergies: [{ allergen: "Sulfa drugs", severity: "moderate", reaction: "Widespread urticarial rash" }],
    emergencyContact: { name: "Rohit Sharma", relation: "Spouse", contact: "+91-9876543211" },
    currentAdmission: { isAdmitted: false },
    chronicConditions: ["Type 2 Diabetes Mellitus (12 years)", "Dyslipidemia", "Stage 2 hypertension"],
    registeredAt: isoDaysAgo(560, 11, 30),
  },
  {
    id: "patient-3",
    mrn: "MRN-2026-0003",
    name: "Mohammed Irfan",
    dob: "1968-11-02",
    gender: "male",
    bloodGroup: "A-",
    contact: "+91-9900123456",
    email: "mohammed.irfan@example.com",
    allergies: [{ allergen: "Ibuprofen", severity: "moderate", reaction: "Gastric erosion, epigastric pain" }],
    emergencyContact: { name: "Sana Irfan", relation: "Daughter", contact: "+91-9900123457" },
    currentAdmission: { isAdmitted: true, ward: "GENERAL_A", bedNumber: "A-12" },
    chronicConditions: ["COPD (GOLD stage 3)", "Chronic kidney disease stage 3", "Former smoker"],
    registeredAt: isoDaysAgo(310, 9, 45),
  },
  {
    id: "patient-4",
    mrn: "MRN-2026-0004",
    name: "Ananya Iyer",
    dob: "2019-07-25",
    gender: "female",
    bloodGroup: "AB+",
    contact: "+91-9741098765",
    email: "s.iyer@example.com",
    allergies: [{ allergen: "None recorded", severity: "mild", reaction: "—" }],
    emergencyContact: { name: "Sridhar Iyer", relation: "Father", contact: "+91-9741098766" },
    currentAdmission: { isAdmitted: false },
    chronicConditions: ["Pediatric asthma"],
    registeredAt: isoDaysAgo(96, 16, 20),
  },
];

const MEDICINES: SeedMedicine[] = [
  {
    id: "med-aug-625",
    sku: "SM-AMX-625",
    brandName: "Augmentin 625 Duo",
    genericName: "Amoxicillin + Clavulanic Acid",
    category: "antibiotic" as MedicineCategory,
    form: "tablet" as MedicineForm,
    strength: "500mg / 125mg",
    unit: "tablet",
    unitPrice: 24.5,
    allocatedStock: 28,
    reorderThreshold: 260,
    economicOrderQuantity: 900,
    safetyStockDays: 5,
    lastRestockedAt: isoDaysAgo(11, 6, 30),
    consumption: { seed: 101_337, baseline: 18, drift: 0.004, jitter: 0.16, surge: { daysAgo: 9, multiplier: 1.75 } },
    regionalAlert: {
      pressureIndex: 12,
      neighbouringFacilities: 3,
      note: "District quota cut at two wholesalers",
    },
    supplier: {
      name: "MedCorp Distributors",
      contractedLeadTimeDays: 7,
      reliabilityIndex: 1.35,
      leadTimeHistory: [7, 9, 11, 8, 10, 13, 9, 12],
    },
    therapeuticAlternatives: ["med-cefuroxime-500", "med-azithro-250"],
    wardStock: [
      { ward: "ICU", quantity: 26, parLevel: 26 },
      { ward: "EMERGENCY", quantity: 28, parLevel: 28 },
      { ward: "GENERAL_A", quantity: 28, parLevel: 32 },
      { ward: "GENERAL_B", quantity: 20, parLevel: 30 },
      { ward: "PEDIATRICS", quantity: 12, parLevel: 20 },
      { ward: "CENTRAL_STORE", quantity: 82, parLevel: 45 },
    ],
    controlledSubstance: false,
  },
  {
    id: "med-mero-1g",
    sku: "SM-MER-1000",
    brandName: "Meropenem 1g Injection",
    genericName: "Meropenem Trihydrate",
    category: "antibiotic",
    form: "injection",
    strength: "1g / 20mL vial",
    unit: "vial",
    unitPrice: 385,
    allocatedStock: 9,
    reorderThreshold: 30,
    economicOrderQuantity: 120,
    safetyStockDays: 7,
    lastRestockedAt: isoDaysAgo(18, 7, 15),
    consumption: { seed: 202_614, baseline: 2.2, drift: 0.012, jitter: 0.22, surge: { daysAgo: 6, multiplier: 1.9 } },
    regionalAlert: {
      pressureIndex: 13,
      neighbouringFacilities: 4,
      note: "Two tertiary centres in the district reporting the same gap",
    },
    supplier: {
      name: "Apex Pharma Logistics",
      contractedLeadTimeDays: 10,
      reliabilityIndex: 1.5,
      leadTimeHistory: [10, 12, 14, 11, 15, 13, 16, 12],
    },
    therapeuticAlternatives: ["med-cefuroxime-500", "med-aug-625"],
    wardStock: [
      { ward: "ICU", quantity: 14, parLevel: 16 },
      { ward: "EMERGENCY", quantity: 10, parLevel: 12 },
      { ward: "GENERAL_A", quantity: 5, parLevel: 9 },
      { ward: "CENTRAL_STORE", quantity: 26, parLevel: 12 },
    ],
    controlledSubstance: false,
  },
  {
    id: "med-insulin-glargine",
    sku: "SM-INS-GLA",
    brandName: "Lantus Insulin Glargine",
    genericName: "Insulin Glargine 100IU/mL",
    category: "antidiabetic",
    form: "injection",
    strength: "100IU/mL pen",
    unit: "pen",
    unitPrice: 742,
    allocatedStock: 10,
    reorderThreshold: 55,
    economicOrderQuantity: 90,
    safetyStockDays: 6,
    lastRestockedAt: isoDaysAgo(9, 8, 0),
    consumption: { seed: 505_902, baseline: 1.9, drift: 0.01, jitter: 0.16, surge: { daysAgo: 12, multiplier: 1.4 } },
    regionalAlert: { pressureIndex: 8, neighbouringFacilities: 2, note: "Cold-chain vehicle shortage in the district" },
    supplier: {
      name: "ColdLink Biologics",
      contractedLeadTimeDays: 6,
      reliabilityIndex: 1.28,
      leadTimeHistory: [6, 8, 9, 7, 11, 8, 10],
    },
    therapeuticAlternatives: [],
    wardStock: [
      { ward: "ICU", quantity: 8, parLevel: 14 },
      { ward: "GENERAL_A", quantity: 6, parLevel: 12 },
      { ward: "GENERAL_B", quantity: 5, parLevel: 10 },
      { ward: "CENTRAL_STORE", quantity: 22, parLevel: 12 },
    ],
    controlledSubstance: false,
  },
  {
    id: "med-nsaline-500",
    sku: "SM-IVF-NS500",
    brandName: "Normal Saline 0.9% 500mL",
    genericName: "Sodium Chloride 0.9% IV",
    category: "iv_fluid",
    form: "iv_fluid",
    strength: "0.9% / 500mL",
    unit: "bottle",
    unitPrice: 42,
    allocatedStock: 90,
    reorderThreshold: 500,
    economicOrderQuantity: 1200,
    safetyStockDays: 4,
    lastRestockedAt: isoDaysAgo(5, 5, 45),
    consumption: { seed: 808_455, baseline: 22, drift: 0.008, jitter: 0.15, surge: { daysAgo: 8, multiplier: 1.35 } },
    regionalAlert: { pressureIndex: 6, neighbouringFacilities: 1, note: "Manufacturer allocation notice issued" },
    supplier: {
      name: "National IV Solutions",
      contractedLeadTimeDays: 4,
      reliabilityIndex: 1.12,
      leadTimeHistory: [4, 4, 5, 4, 6, 4, 5, 4],
    },
    therapeuticAlternatives: [],
    wardStock: [
      { ward: "ICU", quantity: 36, parLevel: 44 },
      { ward: "EMERGENCY", quantity: 32, parLevel: 38 },
      { ward: "GENERAL_A", quantity: 28, parLevel: 34 },
      { ward: "GENERAL_B", quantity: 24, parLevel: 30 },
      { ward: "PEDIATRICS", quantity: 16, parLevel: 22 },
      { ward: "CENTRAL_STORE", quantity: 90, parLevel: 70 },
    ],
    controlledSubstance: false,
  },
  {
    id: "med-salbutamol-inh",
    sku: "SM-RSP-SAL100",
    brandName: "Asthalin Salbutamol 100mcg",
    genericName: "Salbutamol Sulphate",
    category: "respiratory",
    form: "inhaler",
    strength: "100mcg / actuation",
    unit: "inhaler",
    unitPrice: 168,
    allocatedStock: 12,
    reorderThreshold: 70,
    economicOrderQuantity: 150,
    safetyStockDays: 4,
    lastRestockedAt: isoDaysAgo(14, 9, 30),
    consumption: { seed: 303_778, baseline: 6, drift: 0.006, jitter: 0.2 },
    regionalAlert: { pressureIndex: 4, neighbouringFacilities: 1, note: "Seasonal demand above forecast" },
    supplier: {
      name: "MedCorp Distributors",
      contractedLeadTimeDays: 6,
      reliabilityIndex: 1.2,
      leadTimeHistory: [6, 7, 8, 6, 7, 9, 7, 7],
    },
    therapeuticAlternatives: [],
    wardStock: [
      { ward: "EMERGENCY", quantity: 14, parLevel: 18 },
      { ward: "GENERAL_A", quantity: 12, parLevel: 16 },
      { ward: "GENERAL_B", quantity: 10, parLevel: 14 },
      { ward: "PEDIATRICS", quantity: 8, parLevel: 12 },
      { ward: "CENTRAL_STORE", quantity: 26, parLevel: 18 },
    ],
    controlledSubstance: false,
  },
  {
    id: "med-ondansetron-4",
    sku: "SM-GAS-OND4",
    brandName: "Emeset Ondansetron 4mg",
    genericName: "Ondansetron Hydrochloride",
    category: "gastro",
    form: "injection",
    strength: "4mg / 2mL ampoule",
    unit: "ampoule",
    unitPrice: 22,
    allocatedStock: 40,
    reorderThreshold: 240,
    economicOrderQuantity: 400,
    safetyStockDays: 3,
    lastRestockedAt: isoDaysAgo(7, 6, 10),
    consumption: { seed: 707_221, baseline: 9.5, drift: 0.005, jitter: 0.18 },
    regionalAlert: { pressureIndex: 3, neighbouringFacilities: 0, note: "Within normal district supply" },
    supplier: {
      name: "SteriCare Injectables",
      contractedLeadTimeDays: 5,
      reliabilityIndex: 1.18,
      leadTimeHistory: [5, 6, 7, 5, 6, 8, 6],
    },
    therapeuticAlternatives: [],
    wardStock: [
      { ward: "ICU", quantity: 40, parLevel: 44 },
      { ward: "GENERAL_A", quantity: 32, parLevel: 38 },
      { ward: "CENTRAL_STORE", quantity: 40, parLevel: 34 },
    ],
    controlledSubstance: false,
  },
  {
    id: "med-adrenaline-1",
    sku: "SM-EMR-ADR1",
    brandName: "Adrenaline 1mg/mL",
    genericName: "Epinephrine Injection",
    category: "emergency",
    form: "injection",
    strength: "1mg / 1mL ampoule",
    unit: "ampoule",
    unitPrice: 58,
    allocatedStock: 8,
    reorderThreshold: 60,
    economicOrderQuantity: 120,
    safetyStockDays: 8,
    lastRestockedAt: isoDaysAgo(21, 7, 0),
    consumption: { seed: 909_004, baseline: 2.7, drift: 0.004, jitter: 0.25 },
    regionalAlert: { pressureIndex: 5, neighbouringFacilities: 1, note: "Emergency trolley restock cycle extended" },
    supplier: {
      name: "SteriCare Injectables",
      contractedLeadTimeDays: 5,
      reliabilityIndex: 1.24,
      leadTimeHistory: [5, 6, 8, 6, 7, 7, 9],
    },
    therapeuticAlternatives: [],
    wardStock: [
      { ward: "ICU", quantity: 12, parLevel: 14 },
      { ward: "EMERGENCY", quantity: 10, parLevel: 13 },
      { ward: "CENTRAL_STORE", quantity: 16, parLevel: 12 },
    ],
    controlledSubstance: false,
  },
  {
    id: "med-azithro-250",
    sku: "SM-AMX-AZI250",
    brandName: "Azithral 250",
    genericName: "Azithromycin",
    category: "antibiotic",
    form: "tablet",
    strength: "250mg",
    unit: "tablet",
    unitPrice: 18,
    allocatedStock: 44,
    reorderThreshold: 260,
    economicOrderQuantity: 600,
    safetyStockDays: 4,
    lastRestockedAt: isoDaysAgo(10, 6, 50),
    consumption: { seed: 121_250, baseline: 12, drift: 0.006, jitter: 0.19, surge: { daysAgo: 10, multiplier: 1.3 } },
    regionalAlert: { pressureIndex: 9, neighbouringFacilities: 2, note: "Same molecule constrained upstream" },
    supplier: {
      name: "MedCorp Distributors",
      contractedLeadTimeDays: 7,
      reliabilityIndex: 1.32,
      leadTimeHistory: [7, 8, 10, 7, 9, 12, 8, 11],
    },
    therapeuticAlternatives: ["med-cefuroxime-500"],
    wardStock: [
      { ward: "EMERGENCY", quantity: 48, parLevel: 60 },
      { ward: "GENERAL_A", quantity: 52, parLevel: 64 },
      { ward: "PEDIATRICS", quantity: 30, parLevel: 40 },
      { ward: "CENTRAL_STORE", quantity: 148, parLevel: 96 },
    ],
    controlledSubstance: false,
  },
  {
    id: "med-cefuroxime-500",
    sku: "SM-AMX-CXM500",
    brandName: "Ceftum Cefuroxime 500",
    genericName: "Cefuroxime Axetil",
    category: "antibiotic",
    form: "tablet",
    strength: "500mg",
    unit: "tablet",
    unitPrice: 31,
    allocatedStock: 60,
    reorderThreshold: 300,
    economicOrderQuantity: 700,
    safetyStockDays: 4,
    lastRestockedAt: isoDaysAgo(3, 8, 20),
    consumption: { seed: 333_619, baseline: 24, drift: 0.004, jitter: 0.15 },
    regionalAlert: { pressureIndex: 0, neighbouringFacilities: 0, note: "No constraint reported" },
    supplier: {
      name: "Apex Pharma Logistics",
      contractedLeadTimeDays: 5,
      reliabilityIndex: 1.08,
      leadTimeHistory: [5, 5, 6, 5, 5, 6, 5, 5],
    },
    therapeuticAlternatives: [],
    wardStock: [
      { ward: "EMERGENCY", quantity: 120, parLevel: 110 },
      { ward: "GENERAL_A", quantity: 140, parLevel: 130 },
      { ward: "GENERAL_B", quantity: 110, parLevel: 110 },
      { ward: "PEDIATRICS", quantity: 80, parLevel: 70 },
      { ward: "CENTRAL_STORE", quantity: 520, parLevel: 480 },
    ],
    controlledSubstance: false,
  },
  {
    id: "med-paracetamol-500",
    sku: "SM-ANL-PCM500",
    brandName: "Dolo Paracetamol 500mg",
    genericName: "Paracetamol",
    category: "analgesic",
    form: "tablet",
    strength: "500mg",
    unit: "tablet",
    unitPrice: 1.8,
    allocatedStock: 340,
    reorderThreshold: 1200,
    economicOrderQuantity: 5000,
    safetyStockDays: 3,
    lastRestockedAt: isoDaysAgo(4, 5, 30),
    consumption: { seed: 404_882, baseline: 165, drift: 0.002, jitter: 0.14 },
    regionalAlert: { pressureIndex: 0, neighbouringFacilities: 0, note: "No constraint reported" },
    supplier: {
      name: "National IV Solutions",
      contractedLeadTimeDays: 3,
      reliabilityIndex: 1.02,
      leadTimeHistory: [3, 3, 4, 3, 3, 4, 3],
    },
    therapeuticAlternatives: [],
    wardStock: [
      { ward: "ICU", quantity: 240, parLevel: 260 },
      { ward: "EMERGENCY", quantity: 380, parLevel: 400 },
      { ward: "GENERAL_A", quantity: 520, parLevel: 540 },
      { ward: "GENERAL_B", quantity: 480, parLevel: 500 },
      { ward: "PEDIATRICS", quantity: 200, parLevel: 220 },
      { ward: "CENTRAL_STORE", quantity: 2400, parLevel: 2600 },
    ],
    controlledSubstance: false,
  },
  {
    id: "med-atorvastatin-10",
    sku: "SM-CVD-ATV10",
    brandName: "Atorva 10mg",
    genericName: "Atorvastatin Calcium",
    category: "cardiovascular",
    form: "tablet",
    strength: "10mg",
    unit: "tablet",
    unitPrice: 4.2,
    allocatedStock: 160,
    reorderThreshold: 900,
    economicOrderQuantity: 2400,
    safetyStockDays: 5,
    lastRestockedAt: isoDaysAgo(6, 7, 40),
    consumption: { seed: 606_140, baseline: 58, drift: 0.002, jitter: 0.12 },
    regionalAlert: { pressureIndex: 0, neighbouringFacilities: 0, note: "No constraint reported" },
    supplier: {
      name: "Apex Pharma Logistics",
      contractedLeadTimeDays: 6,
      reliabilityIndex: 1.05,
      leadTimeHistory: [6, 6, 7, 6, 6, 6, 7],
    },
    therapeuticAlternatives: [],
    wardStock: [
      { ward: "GENERAL_A", quantity: 480, parLevel: 460 },
      { ward: "GENERAL_B", quantity: 420, parLevel: 400 },
      { ward: "CENTRAL_STORE", quantity: 1250, parLevel: 1300 },
    ],
    controlledSubstance: false,
  },
  {
    id: "med-amlodipine-5",
    sku: "SM-CVD-AML5",
    brandName: "Amlopres Amlodipine 5mg",
    genericName: "Amlodipine Besylate",
    category: "cardiovascular",
    form: "tablet",
    strength: "5mg",
    unit: "tablet",
    unitPrice: 3.1,
    allocatedStock: 120,
    reorderThreshold: 700,
    economicOrderQuantity: 2000,
    safetyStockDays: 5,
    lastRestockedAt: isoDaysAgo(8, 6, 15),
    consumption: { seed: 111_076, baseline: 74, drift: 0.002, jitter: 0.11 },
    regionalAlert: { pressureIndex: 0, neighbouringFacilities: 0, note: "No constraint reported" },
    supplier: {
      name: "National IV Solutions",
      contractedLeadTimeDays: 4,
      reliabilityIndex: 1.06,
      leadTimeHistory: [4, 4, 5, 4, 4, 4, 5],
    },
    therapeuticAlternatives: [],
    wardStock: [
      { ward: "GENERAL_A", quantity: 560, parLevel: 540 },
      { ward: "GENERAL_B", quantity: 500, parLevel: 480 },
      { ward: "CENTRAL_STORE", quantity: 1420, parLevel: 1450 },
    ],
    controlledSubstance: false,
  },
];

/* ------------------------------------------------------------------ */
/* Operations                                                          */
/* ------------------------------------------------------------------ */

const APPOINTMENTS: Appointment[] = [
  {
    id: "appt-0001",
    patientId: "patient-2",
    doctorId: "staff-doctor-2",
    department: "Internal Medicine & Endocrinology",
    scheduledFor: isoAt(9, 30, 0),
    reason: "Diabetes review — repeat HbA1c and renal panel",
    status: "checked_in",
    acuity: "standard",
    triageNotes: "Reports the last four quarterly panels were uploaded through the portal.",
    queuePosition: 1,
    createdAt: isoDaysAgo(6, 12, 0),
  },
  {
    id: "appt-0002",
    patientId: "patient-3",
    doctorId: "staff-doctor-1",
    department: "Pulmonology & General Medicine",
    scheduledFor: isoAt(10, 15, 0),
    reason: "COPD exacerbation follow-up",
    status: "in_consult",
    acuity: "urgent",
    triageNotes: "Admitted on General Ward A bed A-12. Nebulisation charted twice daily.",
    queuePosition: null,
    createdAt: isoDaysAgo(2, 15, 20),
  },
  {
    id: "appt-0003",
    patientId: "patient-1",
    doctorId: "staff-doctor-1",
    department: "Pulmonology & General Medicine",
    scheduledFor: isoAt(11, 0, 0),
    reason: "Inpatient review — ICU bed ICU-04",
    status: "completed",
    acuity: "critical",
    triageNotes: "Admitted via emergency with hypertensive urgency and lower respiratory infection.",
    queuePosition: null,
    createdAt: isoDaysAgo(2, 20, 5),
  },
  {
    id: "appt-0004",
    patientId: "patient-4",
    doctorId: "staff-doctor-1",
    department: "Pulmonology & General Medicine",
    scheduledFor: isoAt(14, 45, 0),
    reason: "Pediatric asthma — spacer technique review",
    status: "scheduled",
    acuity: "routine",
    triageNotes: "Parent reports two night-time awakenings in the past week.",
    queuePosition: 2,
    createdAt: isoDaysAgo(4, 10, 10),
  },
  {
    id: "appt-0005",
    patientId: "patient-2",
    doctorId: "staff-doctor-2",
    department: "Internal Medicine & Endocrinology",
    scheduledFor: isoAt(15, 30, 1),
    reason: "Insulin titration review",
    status: "scheduled",
    acuity: "routine",
    triageNotes: "No acute complaints.",
    queuePosition: null,
    createdAt: isoDaysAgo(1, 9, 0),
  },
  {
    id: "appt-0006",
    patientId: "patient-4",
    doctorId: "staff-doctor-1",
    department: "Pulmonology & General Medicine",
    scheduledFor: isoAt(16, 0, 1),
    reason: "Spirometry review",
    status: "scheduled",
    acuity: "routine",
    triageNotes: "Spirometry scheduled ahead of the visit.",
    queuePosition: null,
    createdAt: isoDaysAgo(1, 11, 45),
  },
];

/** Total dispensing units for a course: doses per day times the course length. */
function courseQuantity(frequency: FrequencyKey, durationDays: number): number {
  return FREQUENCY_DOSES_PER_DAY[frequency] * durationDays;
}

function prescription(
  id: string,
  medicineId: string,
  drugName: string,
  dosage: string,
  frequency: FrequencyKey,
  durationDays: number,
  route: PrescriptionLine["route"],
  instructions: string,
  extra: Partial<PrescriptionLine> = {},
): PrescriptionLine {
  return {
    id,
    medicineId,
    drugName,
    dosage,
    frequency,
    durationDays,
    quantity: courseQuantity(frequency, durationDays),
    route,
    instructions,
    substituteFor: null,
    dispenseStatus: "dispensed",
    stockAdvisory: null,
    ...extra,
  };
}

const TREATMENTS: Treatment[] = [
  {
    id: "treat-0001",
    patientId: "patient-1",
    doctorId: "staff-doctor-1",
    diagnosis: "Hypertensive urgency with lower respiratory tract infection",
    icd10Code: "I10 / J18.9",
    prescriptions: [
      prescription(
        "rx-0001-1",
        "med-aug-625",
        "Augmentin 625 Duo",
        "625mg",
        "twice_daily",
        5,
        "oral",
        "After food. Complete the full course.",
        {
          dispenseStatus: "substituted",
          substituteFor: "med-cefuroxime-500",
          stockAdvisory:
            "Prescribed against documented penicillin anaphylaxis — swapped to Cefuroxime Axetil 500mg and the allergy flag was confirmed at the bedside.",
        },
      ),
      prescription("rx-0001-2", "med-paracetamol-500", "Dolo Paracetamol 500mg", "500mg", "thrice_daily", 3, "oral", "For fever above 38°C. Maximum 3g in 24 hours."),
      prescription("rx-0001-3", "med-amlodipine-5", "Amlopres Amlodipine 5mg", "5mg", "once_daily", 30, "oral", "Morning dose. Continue after discharge."),
    ],
    linkedReportIds: ["report-0005"],
    notes: "Blood pressure trending down since admission. Continue telemetry for 24 hours.",
    createdAt: isoDaysAgo(2, 21, 10),
  },
  {
    id: "treat-0002",
    patientId: "patient-3",
    doctorId: "staff-doctor-2",
    diagnosis: "Acute exacerbation of chronic obstructive pulmonary disease",
    icd10Code: "J44.1",
    prescriptions: [
      prescription("rx-0002-1", "med-azithro-250", "Azithral 250", "250mg", "once_daily", 5, "oral", "Morning dose for five days."),
      prescription("rx-0002-2", "med-salbutamol-inh", "Asthalin Salbutamol 100mcg", "2 puffs", "sos", 30, "inhaled", "Two puffs via spacer when breathless, up to four times daily.", { quantity: 1 }),
      prescription("rx-0002-3", "med-ondansetron-4", "Emeset Ondansetron 4mg", "4mg", "twice_daily", 2, "iv", "Slow IV push over two minutes if nausea persists."),
    ],
    linkedReportIds: ["report-0006"],
    notes: "Renal function to be rechecked before discharge — eGFR 41 on the admission panel.",
    createdAt: isoDaysAgo(1, 14, 30),
  },
  {
    id: "treat-0003",
    patientId: "patient-2",
    doctorId: "staff-doctor-2",
    diagnosis: "Type 2 Diabetes Mellitus — routine review",
    icd10Code: "E11.9",
    prescriptions: [
      prescription("rx-0003-1", "med-insulin-glargine", "Lantus Insulin Glargine", "18 units", "once_daily", 30, "sc", "Bedtime subcutaneous dose. Rotate injection sites.", { quantity: 3 }),
      prescription("rx-0003-2", "med-atorvastatin-10", "Atorva 10mg", "10mg", "once_daily", 30, "oral", "Night dose."),
    ],
    linkedReportIds: ["report-0004"],
    notes: "HbA1c has fallen for four consecutive panels. Continue the current regimen.",
    createdAt: isoDaysAgo(12, 11, 0),
  },
];

const VITALS: Omit<VitalsRecord, "id">[] = [
  {
    patientId: "patient-1",
    recordedBy: "staff-nurse-1",
    recordedAt: isoAt(6, 40, 0),
    temperatureC: 38.1,
    heartRateBpm: 104,
    systolic: 158,
    diastolic: 96,
    respiratoryRate: 22,
    spo2: 94,
    painScore: 3,
    notes: "Febrile at the start of the shift. Tepid sponging given.",
  },
  {
    patientId: "patient-1",
    recordedBy: "staff-nurse-1",
    recordedAt: isoAt(10, 5, 0),
    temperatureC: 37.6,
    heartRateBpm: 96,
    systolic: 146,
    diastolic: 90,
    respiratoryRate: 20,
    spo2: 96,
    painScore: 2,
    notes: "Temperature settling after the first antipyretic dose.",
  },
  {
    patientId: "patient-1",
    recordedBy: "staff-nurse-1",
    recordedAt: isoAt(6, 30, -1),
    temperatureC: 38.6,
    heartRateBpm: 112,
    systolic: 164,
    diastolic: 102,
    respiratoryRate: 24,
    spo2: 92,
    painScore: 4,
    notes: "Admission vitals. Oxygen 2L via nasal prongs started.",
  },
  {
    patientId: "patient-3",
    recordedBy: "staff-nurse-2",
    recordedAt: isoAt(7, 15, 0),
    temperatureC: 36.9,
    heartRateBpm: 88,
    systolic: 132,
    diastolic: 78,
    respiratoryRate: 19,
    spo2: 91,
    painScore: 1,
    notes: "Baseline SpO2 lower than target; continue overnight oxygen.",
  },
  {
    patientId: "patient-3",
    recordedBy: "staff-nurse-2",
    recordedAt: isoAt(19, 45, -1),
    temperatureC: 37.1,
    heartRateBpm: 92,
    systolic: 138,
    diastolic: 82,
    respiratoryRate: 21,
    spo2: 90,
    painScore: 2,
    notes: "Two nebulisations given during the evening round.",
  },
];

/* ------------------------------------------------------------------ */
/* Laboratory reports                                                  */
/* ------------------------------------------------------------------ */

/**
 * Raw OCR transcripts. These are stored verbatim and then parsed by the real
 * report engine at seed time, so the seeded reports exercise the same code path
 * as a live upload rather than being hand-written extracted fields.
 */
export const SEED_REPORT_TRANSCRIPTS: Record<string, string> = {
  "report-0001": [
    "SMARTMEDIC REFERENCE LABORATORIES",
    "Glycemic, Lipid & Renal Panel",
    "----------------------------------------------------------------",
    "Fasting Blood Sugar (FBS)          168     mg/dL      70 - 99      H",
    "Glycated Hemoglobin (HbA1c)        8.4     %          4.0 - 5.6    H",
    "Serum Creatinine                   1.1     mg/dL      0.7 - 1.3",
    "Hemoglobin (Hb)                    12.6    g/dL       13.5 - 17.5  L",
    "Total Cholesterol                  236     mg/dL      125 - 200    H",
    "LDL Cholesterol                    158     mg/dL      50 - 100     H",
    "HDL Cholesterol                    41      mg/dL      40 - 60",
    "Triglycerides                      214     mg/dL      50 - 150     H",
    "Thyroid Stimulating Hormone (TSH)  3.1     uIU/mL     0.4 - 4.0",
    "----------------------------------------------------------------",
  ].join("\n"),
  "report-0002": [
    "SMARTMEDIC REFERENCE LABORATORIES",
    "Glycemic, Lipid & Renal Panel",
    "----------------------------------------------------------------",
    "Fasting Blood Sugar (FBS)          158     mg/dL      70 - 99      H",
    "Glycated Hemoglobin (HbA1c)        7.8     %          4.0 - 5.6    H",
    "Serum Creatinine                   1.2     mg/dL      0.7 - 1.3",
    "Hemoglobin (Hb)                    12.2    g/dL       13.5 - 17.5  L",
    "Total Cholesterol                  228     mg/dL      125 - 200    H",
    "LDL Cholesterol                    149     mg/dL      50 - 100     H",
    "HDL Cholesterol                    39      mg/dL      40 - 60      L",
    "Triglycerides                      198     mg/dL      50 - 150     H",
    "Thyroid Stimulating Hormone (TSH)  3.6     uIU/mL     0.4 - 4.0",
    "----------------------------------------------------------------",
  ].join("\n"),
  "report-0003": [
    "SMARTMEDIC REFERENCE LABORATORIES",
    "Glycemic, Lipid & Renal Panel",
    "----------------------------------------------------------------",
    "Fasting Blood Sugar (FBS)          152     mg/dL      70 - 99      H",
    "Glycated Hemoglobin (HbA1c)        7.5     %          4.0 - 5.6    H",
    "Serum Creatinine                   1.3     mg/dL      0.7 - 1.3",
    "Hemoglobin (Hb)                    12.0    g/dL       13.5 - 17.5  L",
    "Total Cholesterol                  221     mg/dL      125 - 200    H",
    "LDL Cholesterol                    142     mg/dL      50 - 100     H",
    "HDL Cholesterol                    38      mg/dL      40 - 60      L",
    "Triglycerides                      192     mg/dL      50 - 150     H",
    "Thyroid Stimulating Hormone (TSH)  4.1     uIU/mL     0.4 - 4.0    H",
    "----------------------------------------------------------------",
  ].join("\n"),
  "report-0004": [
    "SMARTMEDIC REFERENCE LABORATORIES",
    "Complete Blood Count, Glycemic & Renal Panel",
    "----------------------------------------------------------------",
    "Fasting Blood Sugar (FBS)          148     mg/dL      70 - 99      H",
    "Glycated Hemoglobin (HbA1c)        7.2     %          4.0 - 5.6    H",
    "Serum Creatinine                   1.4     mg/dL      0.7 - 1.3    H",
    "Estimated GFR (eGFR)               58      mL/min/1.73m2  90 - 120 L",
    "Hemoglobin (Hb)                    11.8    g/dL       13.5 - 17.5  L",
    "Total Leukocyte Count (TLC)        8.9     x10^3/uL   4.0 - 11.0",
    "Platelet Count (PLT)               232     x10^3/uL   150 - 450",
    "Hematocrit (HCT)                   36.4    %          40 - 52      L",
    "Mean Corpuscular Volume (MCV)      86.2    fL         80 - 100",
    "Erythrocyte Sedimentation Rate     28      mm/hr      0 - 20       H",
    "Thyroid Stimulating Hormone (TSH)  4.6     uIU/mL     0.4 - 4.0    H",
    "Total Cholesterol                  214     mg/dL      125 - 200    H",
    "LDL Cholesterol                    138     mg/dL      50 - 100     H",
    "HDL Cholesterol                    38      mg/dL      40 - 60      L",
    "Triglycerides                      186     mg/dL      50 - 150     H",
    "----------------------------------------------------------------",
    "Specimen collected: fasting whole blood and serum separator tube.",
  ].join("\n"),
  "report-0005": [
    "SMARTMEDIC REFERENCE LABORATORIES",
    "Admission Panel",
    "----------------------------------------------------------------",
    "Hemoglobin (Hb)                    14.2    g/dL       13.5 - 17.5",
    "Total Leukocyte Count (TLC)        12.6    x10^3/uL   4.0 - 11.0   H",
    "Platelet Count (PLT)               268     x10^3/uL   150 - 450",
    "Hematocrit (HCT)                   44.5    %          40 - 52",
    "Fasting Blood Sugar (FBS)          96      mg/dL      70 - 99",
    "Serum Creatinine                   1.0     mg/dL      0.7 - 1.3",
    "C-Reactive Protein (CRP)           38      mg/L       0 - 5        H",
    "----------------------------------------------------------------",
  ].join("\n"),
  "report-0006": [
    "SMARTMEDIC REFERENCE LABORATORIES",
    "Renal & Respiratory Admission Panel",
    "----------------------------------------------------------------",
    "Fasting Blood Sugar (FBS)          118     mg/dL      70 - 99      H",
    "Serum Creatinine                   1.9     mg/dL      0.7 - 1.3    H",
    "Blood Urea                         44      mg/dL      7 - 20       H",
    "Estimated GFR (eGFR)               41      mL/min/1.73m2  90 - 120 L",
    "Hemoglobin (Hb)                    13.1    g/dL       13.5 - 17.5  L",
    "Total Leukocyte Count (TLC)        7.8     x10^3/uL   4.0 - 11.0",
    "Platelet Count (PLT)               210     x10^3/uL   150 - 450",
    "C-Reactive Protein (CRP)           24      mg/L       0 - 5        H",
    "----------------------------------------------------------------",
  ].join("\n"),
};

interface SeedReportMeta {
  id: string;
  patientId: string;
  uploadedBy: string;
  uploadedByRole: MedicalReport["uploadedByRole"];
  fileName: string;
  fileMimeType: string;
  fileSizeBytes: number;
  reportCategory: ReportCategory;
  daysAgo: number;
  hour: number;
  doctorNotes: string;
}

const SEED_REPORT_META: SeedReportMeta[] = [
  {
    id: "report-0001",
    patientId: "patient-2",
    uploadedBy: "staff-reception-1",
    uploadedByRole: "receptionist",
    fileName: "priya-sharma-panel-2025-03.pdf",
    fileMimeType: "application/pdf",
    fileSizeBytes: 486_220,
    reportCategory: "blood_panel",
    daysAgo: 560,
    hour: 11,
    doctorNotes: "Baseline quarterly panel captured at the start of the diabetes programme.",
  },
  {
    id: "report-0002",
    patientId: "patient-2",
    uploadedBy: "patient-2",
    uploadedByRole: "patient",
    fileName: "priya-sharma-panel-2025-10.pdf",
    fileMimeType: "application/pdf",
    fileSizeBytes: 471_004,
    reportCategory: "blood_panel",
    daysAgo: 330,
    hour: 9,
    doctorNotes: "Uploaded through the patient portal ahead of the review appointment.",
  },
  {
    id: "report-0003",
    patientId: "patient-2",
    uploadedBy: "patient-2",
    uploadedByRole: "patient",
    fileName: "priya-sharma-panel-2026-03.pdf",
    fileMimeType: "application/pdf",
    fileSizeBytes: 452_889,
    reportCategory: "blood_panel",
    daysAgo: 190,
    hour: 8,
    doctorNotes: "HbA1c continues to fall; creatinine creeping upward, watch the trend.",
  },
  {
    id: "report-0004",
    patientId: "patient-2",
    uploadedBy: "patient-2",
    uploadedByRole: "patient",
    fileName: "priya-sharma-cbc-metabolic.pdf",
    fileMimeType: "application/pdf",
    fileSizeBytes: 612_450,
    reportCategory: "blood_panel",
    daysAgo: 1,
    hour: 10,
    doctorNotes:
      "Latest quarterly panel. Presented to the patient in the simplifier view; renal trend flagged for physician review.",
  },
  {
    id: "report-0005",
    patientId: "patient-1",
    uploadedBy: "staff-nurse-1",
    uploadedByRole: "nurse",
    fileName: "aarav-menon-admission-panel.pdf",
    fileMimeType: "application/pdf",
    fileSizeBytes: 388_120,
    reportCategory: "general",
    daysAgo: 2,
    hour: 21,
    doctorNotes: "Inflammatory markers elevated on admission; repeat CRP before discharge.",
  },
  {
    id: "report-0006",
    patientId: "patient-3",
    uploadedBy: "staff-nurse-2",
    uploadedByRole: "nurse",
    fileName: "mohammed-irfan-renal-respiratory.pdf",
    fileMimeType: "application/pdf",
    fileSizeBytes: 402_770,
    reportCategory: "renal_panel",
    daysAgo: 1,
    hour: 15,
    doctorNotes: "eGFR 41 on admission. Avoid nephrotoxic agents and recheck before discharge.",
  },
];

function buildReports(): MedicalReport[] {
  return SEED_REPORT_META.map((meta) => {
    const rawOcrText = SEED_REPORT_TRANSCRIPTS[meta.id];
    const extractedFields = parseReportText(rawOcrText, meta.id);
    const ocrConfidence = extractedFields.length
      ? Number(
          (extractedFields.reduce((sum, field) => sum + field.confidence, 0) / extractedFields.length).toFixed(2),
        )
      : 0.4;

    return {
      id: meta.id,
      patientId: meta.patientId,
      uploadedBy: meta.uploadedBy,
      uploadedByRole: meta.uploadedByRole,
      fileName: meta.fileName,
      fileMimeType: meta.fileMimeType,
      fileSizeBytes: meta.fileSizeBytes,
      reportCategory: meta.reportCategory,
      reportDate: isoDaysAgo(meta.daysAgo, meta.hour, 0),
      ocrExtractionStatus: "completed",
      ocrConfidence,
      rawOcrText,
      extractedFields,
      medicalDisclaimer: MEDICAL_DISCLAIMER,
      doctorNotes: meta.doctorNotes,
      createdAt: isoDaysAgo(meta.daysAgo, meta.hour, 5),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Bedside administration records                                      */
/* ------------------------------------------------------------------ */

/**
 * Build the eMAR sheet for admitted patients from the prescriptions that are
 * already on file, so the bedside board always agrees with the treatment chart.
 */
function buildAdministrations(treatments: Treatment[], medicines: Medicine[]): DatabaseState["administrations"] {
  const priceById = new Map(medicines.map((medicine) => [medicine.id, medicine]));
  const administrations: DatabaseState["administrations"] = [];
  let counter = 1;

  for (const treatment of treatments) {
    const patient = PATIENTS.find((item) => item.id === treatment.patientId);
    if (!patient?.currentAdmission.isAdmitted) continue;

    const ward = patient.currentAdmission.ward ?? "GENERAL_A";
    const nurseId = ward === "ICU" ? "staff-nurse-1" : "staff-nurse-2";
    const nurseName = STAFF.find((member) => member.id === nurseId)?.fullName ?? "Nurse on duty";

    for (const line of treatment.prescriptions) {
      const medicine = priceById.get(line.medicineId);
      if (!medicine) continue;
      // On-demand medication is charted against actual need, not a fixed round.
      if (line.frequency === "sos") continue;

      const dosesPerDay = FREQUENCY_DOSES_PER_DAY[line.frequency];
      const roundHours = Array.from({ length: dosesPerDay }, (_, index) =>
        Math.round(6 + (index * 24) / dosesPerDay),
      );

      for (const hour of roundHours) {
        for (let dayOffset = -1; dayOffset <= 0; dayOffset++) {
          const scheduledFor = isoAt(hour, 0, dayOffset);
          if (new Date(scheduledFor).getTime() > Date.now()) continue;

          // One realistic variance per course: a dose held for a clinical
          // reason, and one refused by the patient.
          const variance = counter % 11 === 0 ? "held" : counter % 17 === 0 ? "refused" : "given";
          administrations.push({
            id: `emu-${String(counter).padStart(4, "0")}`,
            prescriptionId: line.id,
            patientId: treatment.patientId,
            medicineId: line.medicineId,
            drugName: line.drugName,
            dose: line.dosage,
            route: line.route,
            scheduledFor,
            status: variance,
            administeredAt: variance === "given" ? new Date(new Date(scheduledFor).getTime() + 7 * 60_000).toISOString() : null,
            administeredBy: variance === "given" ? nurseName : null,
            site: line.route === "sc" ? "left anterior thigh" : line.route === "im" ? "right deltoid" : null,
            notes:
              variance === "held"
                ? "Held: systolic pressure 96 mmHg on the pre-dose check."
                : variance === "refused"
                  ? "Patient declined the dose; physician informed."
                  : "",
            vitalsId: null,
          });
          counter++;
        }
      }
    }
  }

  return administrations;
}

/* ------------------------------------------------------------------ */
/* Revenue cycle                                                       */
/* ------------------------------------------------------------------ */

function buildInvoices(): Invoice[] {
  return [
    {
      id: "inv-0001",
      invoiceNumber: "INV-2026-0001",
      patientId: "patient-1",
      cashierId: "staff-cashier-1",
      items: [
        {
          id: "item-0001-1",
          itemType: "consultation",
          description: "Emergency physician consultation",
          quantity: 1,
          unitPrice: 900,
        },
        {
          id: "item-0001-2",
          itemType: "room_charge",
          description: "ICU bed charge (per night)",
          quantity: 2,
          unitPrice: 6500,
        },
        {
          id: "item-0001-3",
          itemType: "medication",
          description: "Ceftum Cefuroxime 500mg (substituted course)",
          quantity: 20,
          unitPrice: 31,
        },
        {
          id: "item-0001-4",
          itemType: "medication",
          description: "Dolo Paracetamol 500mg",
          quantity: 9,
          unitPrice: 1.8,
        },
        {
          id: "item-0001-5",
          itemType: "diagnostic_report",
          description: "Admission panel — CBC, CRP, renal function",
          quantity: 1,
          unitPrice: 1450,
        },
      ],
      taxPct: 5,
      paymentStatus: "partially_paid",
      transactions: [
        {
          id: "txn-0001-1",
          paymentMethod: "insurance_claim",
          amountPaid: 12000,
          reference: "MEDASSURE-CLM-884120",
          processedAt: isoDaysAgo(2, 22, 40),
          processedBy: "staff-cashier-1",
        },
      ],
      notes: "Insurance claim raised for the ICU component. Balance payable at discharge.",
      createdAt: isoDaysAgo(2, 22, 15),
    },
    {
      id: "inv-0002",
      invoiceNumber: "INV-2026-0002",
      patientId: "patient-3",
      cashierId: "staff-cashier-1",
      items: [
        {
          id: "item-0002-1",
          itemType: "consultation",
          description: "Pulmonology consultation",
          quantity: 1,
          unitPrice: 1200,
        },
        {
          id: "item-0002-2",
          itemType: "procedure",
          description: "Nebulisation with bronchodilator (per session)",
          quantity: 4,
          unitPrice: 350,
        },
        {
          id: "item-0002-3",
          itemType: "medication",
          description: "Azithral 250mg",
          quantity: 5,
          unitPrice: 18,
        },
        {
          id: "item-0002-4",
          itemType: "medication",
          description: "Asthalin Salbutamol 100mcg inhaler",
          quantity: 1,
          unitPrice: 168,
        },
        {
          id: "item-0002-5",
          itemType: "room_charge",
          description: "General Ward A bed charge (per night)",
          quantity: 1,
          unitPrice: 2200,
        },
      ],
      taxPct: 5,
      paymentStatus: "unpaid",
      transactions: [],
      notes: "Awaiting cashless pre-authorisation from the employer panel.",
      createdAt: isoDaysAgo(1, 16, 5),
    },
    {
      id: "inv-0003",
      invoiceNumber: "INV-2026-0003",
      patientId: "patient-2",
      cashierId: "staff-cashier-1",
      items: [
        {
          id: "item-0003-1",
          itemType: "consultation",
          description: "Endocrinology review consultation",
          quantity: 1,
          unitPrice: 1000,
        },
        {
          id: "item-0003-2",
          itemType: "diagnostic_report",
          description: "CBC, HbA1c and renal panel",
          quantity: 1,
          unitPrice: 1650,
        },
        {
          id: "item-0003-3",
          itemType: "medication",
          description: "Lantus Insulin Glargine 100IU/mL pen",
          quantity: 3,
          unitPrice: 742,
        },
        {
          id: "item-0003-4",
          itemType: "medication",
          description: "Atorva 10mg",
          quantity: 30,
          unitPrice: 4.2,
        },
      ],
      taxPct: 5,
      paymentStatus: "unpaid",
      transactions: [],
      notes: "Patient requested to settle by UPI on the next visit.",
      createdAt: isoDaysAgo(1, 11, 20),
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Governance                                                          */
/* ------------------------------------------------------------------ */

function buildAuditLog(): AuditEntry[] {
  return [
    {
      id: "audit-0001",
      at: isoDaysAgo(2, 20, 5),
      actorId: "staff-reception-1",
      actorName: "Kavya Nair",
      actorRole: "receptionist",
      action: "patient.check_in",
      target: "MRN-2026-0001",
      detail: "Emergency check-in triaged as critical and routed directly to ICU.",
    },
    {
      id: "audit-0002",
      at: isoDaysAgo(2, 21, 10),
      actorId: "staff-doctor-1",
      actorName: "Dr. Ramesh Sharma",
      actorRole: "doctor",
      action: "prescription.substitute",
      target: "MRN-2026-0001",
      detail: "Amoxicillin + Clavulanic Acid withheld on the recorded penicillin anaphylaxis; Cefuroxime Axetil substituted.",
    },
    {
      id: "audit-0003",
      at: isoDaysAgo(1, 14, 30),
      actorId: "staff-doctor-2",
      actorName: "Dr. Nandita Rao",
      actorRole: "doctor",
      action: "treatment.create",
      target: "MRN-2026-0003",
      detail: "COPD exacerbation treatment charted with four days of nebulisation.",
    },
    {
      id: "audit-0004",
      at: isoDaysAgo(1, 15, 5),
      actorId: "staff-nurse-2",
      actorName: "Joseph Thomas",
      actorRole: "nurse",
      action: "report.upload",
      target: "MRN-2026-0003",
      detail: "Renal and respiratory admission panel uploaded; extraction completed with 97% matched confidence.",
    },
    {
      id: "audit-0005",
      at: isoDaysAgo(1, 10, 5),
      actorId: "patient-2",
      actorName: "Priya Sharma",
      actorRole: "patient",
      action: "report.upload",
      target: "MRN-2026-0002",
      detail: "Quarterly panel uploaded through the patient portal and simplified for review.",
    },
    {
      id: "audit-0006",
      at: isoDaysAgo(0, 6, 30),
      actorId: "staff-admin-1",
      actorName: "Meera Krishnan",
      actorRole: "admin",
      action: "shortage.review",
      target: "Formulary",
      detail: "Morning shortage review opened from the control room; two molecules at critical risk.",
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Assembly                                                            */
/* ------------------------------------------------------------------ */

/** Turn a seed medicine into a complete inventory record. */
export function hydrateMedicine(seed: SeedMedicine): Medicine {
  const { consumption, wardStock, ...rest } = seed;
  return {
    ...rest,
    wardStock: wardStock.map((holding) => ({ ...holding })),
    currentStock: sumWardStock(wardStock),
    consumptionHistory: buildConsumption(consumption),
  };
}

export function createSeedMedicines(): Medicine[] {
  return MEDICINES.map(hydrateMedicine);
}

export function createSeedPatients(): Patient[] {
  return PATIENTS.map((patient) => ({
    ...patient,
    allergies: patient.allergies.map((allergy: Allergy) => ({ ...allergy })),
    emergencyContact: { ...patient.emergencyContact },
    currentAdmission: { ...patient.currentAdmission },
    chronicConditions: [...patient.chronicConditions],
  }));
}

export function createSeedTreatments(): Treatment[] {
  return TREATMENTS.map((treatment) => ({
    ...treatment,
    prescriptions: treatment.prescriptions.map((line) => ({ ...line })),
    linkedReportIds: [...treatment.linkedReportIds],
  }));
}

export function createSeedVitals(): VitalsRecord[] {
  return VITALS.map((record, index) => ({
    ...record,
    id: `vitals-${String(index + 1).padStart(4, "0")}`,
  }));
}

/** Build the complete seeded database. Called once per browser session. */
export function createSeedDatabase(): DatabaseState {
  const medicines = createSeedMedicines();
  const treatments = createSeedTreatments();
  const administrations = buildAdministrations(treatments, medicines);

  return {
    hospitals: HOSPITALS.map((h) => ({ ...h })),
    staff: STAFF.map((member) => ({ ...member })),
    patients: createSeedPatients(),
    medicines,
    appointments: APPOINTMENTS.map((appointment) => ({ ...appointment })),
    treatments,
    administrations,
    vitals: createSeedVitals(),
    invoices: buildInvoices(),
    reports: buildReports(),
    // Starts empty: live proposals are generated by the shortage engine, and
    // this collection becomes the decision ledger once a proposal is actioned.
    transferProposals: [],
    alerts: [],
    auditLog: buildAuditLog(),
    counters: {
      hospital: HOSPITALS.length,
      patient: PATIENTS.length,
      appointment: APPOINTMENTS.length,
      treatment: TREATMENTS.length,
      invoice: 3,
      report: SEED_REPORT_META.length,
      transfer: 0,
      alert: 0,
      audit: 6,
      vitals: VITALS.length,
      administration: administrations.length,
    },
  };
}

/** Default session: the shortage control room, as the admin sees it on boot. */
export function createInitialAppState(): AppState {
  return {
    db: createSeedDatabase(),
    session: { role: "admin", hospitalId: "hosp-kmc-mgl", staffId: "staff-admin-1", patientId: "patient-2" },
    activeView: "admin.control-room",
  };
}

/** Reference to the formulary used by seed tooling and tests. */
export const SEED_MEDICINE_IDS = MEDICINES.map((medicine) => medicine.id);

/** Seed profiles, exposed so tooling can re-derive consumption ledgers. */
export const SEED_CONSUMPTION_PROFILES: Record<string, ConsumptionProfile> = Object.fromEntries(
  MEDICINES.map((medicine) => [medicine.id, medicine.consumption]),
);
