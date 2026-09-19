/**
 * Doctor portal.
 *
 * Three modules: the outpatient queue, the CPOE console, and the report
 * simplifier. The CPOE console is the interesting one: it cross-checks the
 * patient's recorded allergies and the live days-of-cover for every molecule
 * the doctor reaches for, and turns a shortage into a substitution suggestion
 * rather than a blocked prescription.
 */

import { useMemo, useState } from "react";
import type { FrequencyKey, Medicine, PrescriptionLine, Treatment } from "@/types";
import { FREQUENCY_DOSES_PER_DAY, FREQUENCY_LABELS } from "@/types";
import { useApp } from "@/store/AppStore";
import { therapeuticAlternatives } from "@/engine/shortageEngine";
import { formatDays } from "@/engine/shortageEngine";
import ReportSimplifier from "@/components/ReportSimplifier";
import Sparkline from "@/charts/Sparkline";
import LineChart from "@/charts/LineChart";
import { APPOINTMENT_STATUS_TOKENS, RISK_TOKENS, SEVERITY_TOKENS, BIOMARKER_STATUS_TOKENS } from "@/ui/theme";
import {
  Button,
  Chip,
  DataTable,
  EmptyState,
  Field,
  Panel,
  PanelHeader,
  Select,
  StatTile,
  TextArea,
  TextInput,
} from "@/ui/primitives";
import Icon from "@/ui/Icon";
import { ageFromDob, cx, formatDate, formatDateTime } from "@/utils/format";
import { summariseFields, MEDICAL_DISCLAIMER } from "@/engine/reportEngine";

/* ------------------------------------------------------------------ */
/* Allergy cross-reactivity                                            */
/* ------------------------------------------------------------------ */

/**
 * Drug-class map for allergy cross-checks. A recorded "Penicillin" allergy must
 * catch Augmentin even though the brand name never says penicillin, which is
 * exactly the substitution that matters in this seeded scenario.
 */
const ALLERGEN_CLASS_MAP: Record<string, string[]> = {
  penicillin: ["penicillin", "amoxicillin", "ampicillin", "clavulanic", "piperacillin", "augmentin", "amoxil"],
  "sulfa drugs": ["sulfamethoxazole", "trimethoprim", "sulfadiazine", "cotrimoxazole"],
  ibuprofen: ["ibuprofen", "nsaid", "diclofenac", "naproxen"],
  aspirin: ["aspirin", "acetylsalicylic", "nsaid"],
};

export interface AllergyConflict {
  allergen: string;
  severity: "mild" | "moderate" | "severe";
  reaction: string;
  viaClass: string;
}

/** Find recorded allergies that this molecule would clash with. */
function findAllergyConflicts(medicine: Medicine, allergens: string[]): AllergyConflict[] {
  const conflicts: AllergyConflict[] = [];
  const haystack = `${medicine.brandName} ${medicine.genericName}`.toLowerCase();

  for (const allergen of allergens) {
    const key = allergen.trim().toLowerCase();
    const classTerms = ALLERGEN_CLASS_MAP[key] ?? [key];

    const matched = classTerms.find((term) => haystack.includes(term));
    if (!matched) continue;

    conflicts.push({
      allergen,
      severity: "severe",
      reaction: "",
      viaClass: matched,
    });
  }

  return conflicts;
}

/* ------------------------------------------------------------------ */
/* 1. Outpatient queue                                                 */
/* ------------------------------------------------------------------ */

function OutpatientQueue() {
  const { state, derived, actions } = useApp();
  const staffId = state.session.staffId;
  const [scope, setScope] = useState<"mine" | "all">("mine");

  const queue = useMemo(() => {
    const today = derived.todaysQueue();
    const filtered = scope === "mine" ? today.filter((item) => item.doctorId === staffId) : today;
    return filtered.slice().sort((a, b) => {
      const rank = { critical: 0, urgent: 1, standard: 2, routine: 3 };
      return rank[a.acuity] - rank[b.acuity] || new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime();
    });
  }, [derived, scope, staffId]);

  const active = queue.filter((item) => item.status !== "completed" && item.status !== "cancelled");

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile label="In today's list" value={queue.length} hint="Scheduled consultations for today" />
        <StatTile label="Awaiting review" value={active.length} tone={active.length > 0 ? "accent" : "default"} />
        <StatTile
          label="Critical acuity"
          value={queue.filter((item) => item.acuity === "critical").length}
          tone="danger"
        />
        <StatTile
          label="Inpatients under care"
          value={state.db.patients.filter((patient) => patient.currentAdmission.isAdmitted).length}
          hint="Admitted across the hospital"
        />
      </div>

      <Panel>
        <PanelHeader
          title="Consultation queue"
          subtitle="Ordered by triage acuity, then scheduled time. Select a patient to load their chart into the CPOE console."
          icon={<Icon name="queue" size={18} />}
          actions={
            <div className="w-40">
              <Select
                value={scope}
                onChange={setScope}
                options={[
                  { value: "mine", label: "My list" },
                  { value: "all", label: "All clinicians" },
                ]}
              />
            </div>
          }
        />

        {queue.length === 0 ? (
          <EmptyState title="No consultations scheduled today" description="Switch to 'All clinicians' to see the whole hospital list." />
        ) : (
          <ul className="space-y-3">
            {queue.map((appointment) => {
              const patient = derived.patientsById.get(appointment.patientId);
              const report = patient ? derived.reportsFor(patient.id)[0] : undefined;
              const reportSummary = report ? summariseFields(report.extractedFields) : null;
              const token = APPOINTMENT_STATUS_TOKENS[appointment.status];

              return (
                <li key={appointment.id} className="rounded-xl border border-rule bg-paper p-4">
                  <div className="flex flex-wrap items-start gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-ink-900">{patient?.name ?? "Unknown patient"}</h3>
                        <span className="font-mono text-[10px] text-ink-400">{patient?.mrn}</span>
                        <Chip token={token} />
                        <span className="sm-chip border-rule-strong bg-paper text-ink-700">{appointment.acuity}</span>
                      </div>
                      <p className="mt-1 text-xs text-ink-700">{appointment.reason}</p>
                      <p className="mt-1 text-[11px] text-ink-400">
                        {formatDateTime(appointment.scheduledFor)} · {appointment.department} ·{" "}
                        {patient ? `${ageFromDob(patient.dob)}y ${patient.gender} · ${patient.bloodGroup}` : ""}
                      </p>
                      {appointment.triageNotes ? (
                        <p className="mt-2 rounded-lg border border-rule bg-paper p-2 text-[11px] leading-relaxed text-ink-500">
                          <span className="font-semibold text-ink-700">Triage: </span>
                          {appointment.triageNotes}
                        </p>
                      ) : null}
                      {patient && patient.allergies.length > 0 && patient.allergies[0].allergen !== "None recorded" ? (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className="text-[10px] uppercase tracking-wider text-ink-400">Allergies</span>
                          {patient.allergies.map((allergy) => (
                            <Chip key={allergy.allergen} token={SEVERITY_TOKENS[allergy.severity]}>
                              {allergy.allergen}
                            </Chip>
                          ))}
                        </div>
                      ) : null}
                      {reportSummary ? (
                        <p className="mt-2 text-[11px] text-ink-500">
                          <span className="font-semibold text-ink-700">Latest panel:</span>{" "}
                          {formatDate(report!.reportDate)} · {reportSummary.outOfRange} of {reportSummary.total} values
                          outside range
                          {reportSummary.critical > 0 ? ` · ${reportSummary.critical} markedly abnormal` : ""}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 flex-col gap-2">
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => {
                          actions.setActivePatient(appointment.patientId);
                          actions.setAppointmentStatus(appointment.id, "in_consult");
                          actions.setView("doctor.prescribe");
                        }}
                      >
                        <Icon name="prescribe" size={13} />
                        Open CPOE
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          actions.setActivePatient(appointment.patientId);
                          actions.setView("doctor.reports");
                        }}
                      >
                        <Icon name="report" size={13} />
                        Reports
                      </Button>
                      {appointment.status !== "completed" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => actions.setAppointmentStatus(appointment.id, "completed")}
                        >
                          Mark complete
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 2. CPOE console                                                     */
/* ------------------------------------------------------------------ */

interface DraftLine {
  draftId: string;
  medicineId: string;
  dosage: string;
  frequency: FrequencyKey;
  durationDays: number;
  route: PrescriptionLine["route"];
  instructions: string;
  substituteFor: string | null;
}

/**
 * Dispensing units for a course. Solid oral doses scale with the frequency and
 * the course length; inhaled and as-required items are dispensed as a single
 * container rather than as counted doses.
 */
function computeQuantity(medicine: Medicine | undefined, frequency: FrequencyKey, durationDays: number): number {
  if (!medicine) return 0;
  if (medicine.form === "inhaler" || frequency === "sos" || frequency === "stat") return 1;
  return FREQUENCY_DOSES_PER_DAY[frequency] * Math.max(1, durationDays);
}

function CpoeConsole() {
  const { state, derived, actions } = useApp();
  const patient = derived.patientsById.get(state.session.patientId) ?? null;
  const doctor = derived.staffById.get(state.session.staffId);

  const [diagnosis, setDiagnosis] = useState("");
  const [icd10, setIcd10] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    treatment: Treatment;
    before: { medicineId: string; drugName: string; sps: number; dir: number }[];
  } | null>(null);

  const formulary = useMemo(
    () => state.db.medicines.slice().sort((a, b) => a.brandName.localeCompare(b.brandName)),
    [state.db.medicines],
  );

  const patientAllergens = useMemo(
    () =>
      (patient?.allergies ?? [])
        .map((allergy) => allergy.allergen)
        .filter((allergen) => allergen.toLowerCase() !== "none recorded"),
    [patient],
  );

  const addLine = () => {
    const first = formulary[0];
    if (!first) return;
    setLines((current) => [
      ...current,
      {
        draftId: `draft-${Date.now()}-${current.length}`,
        medicineId: first.id,
        dosage: first.strength,
        frequency: "twice_daily",
        durationDays: 5,
        route: "oral",
        instructions: "",
        substituteFor: null,
      },
    ]);
  };

  const updateLine = (draftId: string, patch: Partial<DraftLine>) => {
    setLines((current) =>
      current.map((line) => {
        if (line.draftId !== draftId) return line;
        const merged = { ...line, ...patch };
        // Keep the dosage hint and the route aligned with the chosen molecule.
        if (patch.medicineId) {
          const medicine = formulary.find((item) => item.id === patch.medicineId);
          merged.dosage = medicine?.strength ?? line.dosage;
          merged.route =
            medicine?.form === "inhaler"
              ? "inhaled"
              : medicine?.form === "injection"
                ? "iv"
                : medicine?.form === "iv_fluid"
                  ? "iv"
                  : "oral";
        }
        return merged;
      }),
    );
  };

  const removeLine = (draftId: string) => setLines((current) => current.filter((line) => line.draftId !== draftId));

  const submit = () => {
    if (!patient) {
      setError("Select a patient before prescribing.");
      return;
    }
    if (!diagnosis.trim()) {
      setError("A working diagnosis is required for the treatment record.");
      return;
    }
    if (lines.length === 0) {
      setError("Add at least one medication line.");
      return;
    }

    const before = lines.map((line) => {
      const assessment = derived.assessmentById.get(line.medicineId);
      const medicine = derived.medicinesById.get(line.medicineId);
      return {
        medicineId: line.medicineId,
        drugName: medicine?.brandName ?? "—",
        sps: assessment?.sps ?? 0,
        dir: assessment?.dir ?? 0,
      };
    });

    const treatment = actions.prescribe({
      patientId: patient.id,
      doctorId: doctor?.id ?? state.session.staffId,
      diagnosis,
      icd10Code: icd10,
      notes,
      linkedReportIds: derived.reportsFor(patient.id).slice(0, 1).map((report) => report.id),
      prescriptions: lines.map((line) => {
        const medicine = derived.medicinesById.get(line.medicineId);
        const assessment = derived.assessmentById.get(line.medicineId);
        const advisory =
          assessment && assessment.tier !== "normal"
            ? `Cover was ${formatDays(assessment.dir)} days against a ${assessment.dynamicLeadTimeDays.toFixed(1)}-day lead time when prescribed.`
            : null;
        return {
          medicineId: line.medicineId,
          drugName: medicine?.brandName ?? "Unknown",
          dosage: line.dosage,
          frequency: line.frequency,
          durationDays: line.durationDays,
          quantity: computeQuantity(medicine, line.frequency, line.durationDays),
          route: line.route,
          instructions: line.instructions,
          substituteFor: line.substituteFor,
          stockAdvisory: advisory,
        };
      }),
    });

    setResult({ treatment, before });
    setError(null);
    setLines([]);
    setDiagnosis("");
    setIcd10("");
    setNotes("");
  };

  const recentReports = patient ? derived.reportsFor(patient.id).slice(0, 1) : [];

  return (
    <div className="space-y-6">
      {/* Patient banner. */}
      <Panel>
        <PanelHeader
          title="Patient under care"
          subtitle="Allergies and stock guards are evaluated against this record."
          icon={<Icon name="user" size={18} />}
          actions={
            <span className="text-[11px] text-ink-500">{doctor?.fullName ?? "Clinician"}</span>
          }
        />
        {!patient ? (
          <EmptyState title="No patient selected" description="Choose a patient from the top bar or open one from the queue." />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-ink-900">{patient.name}</h3>
                <p className="mt-0.5 text-xs text-ink-500">
                  {patient.mrn} · {ageFromDob(patient.dob)}y {patient.gender} · {patient.bloodGroup} ·{" "}
                  {patient.contact}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {patient.currentAdmission.isAdmitted ? (
                  <span className="sm-chip border-accent/45 bg-accent-soft text-accent">
                    Admitted · {patient.currentAdmission.ward} {patient.currentAdmission.bedNumber}
                  </span>
                ) : (
                  <span className="sm-chip border-rule-strong bg-paper text-ink-700">Outpatient</span>
                )}
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-lg border border-rule bg-paper p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                  Recorded allergies
                </p>
                {patientAllergens.length === 0 ? (
                  <p className="mt-1.5 text-xs text-ink-500">No known drug allergies recorded.</p>
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    {patient.allergies.map((allergy) => (
                      <li key={allergy.allergen} className="flex items-start justify-between gap-2">
                        <span className="text-xs text-ink-900">{allergy.allergen}</span>
                        <Chip token={SEVERITY_TOKENS[allergy.severity]} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-lg border border-rule bg-paper p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                  Chronic conditions
                </p>
                <ul className="mt-2 space-y-1">
                  {patient.chronicConditions.map((condition) => (
                    <li key={condition} className="text-xs text-ink-700">
                      {condition}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-lg border border-rule bg-paper p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                  Latest simplified panel
                </p>
                {recentReports.length === 0 ? (
                  <p className="mt-1.5 text-xs text-ink-500">No laboratory report on file.</p>
                ) : (
                  (() => {
                    const report = recentReports[0];
                    const summary = summariseFields(report.extractedFields);
                    return (
                      <div className="mt-2">
                        <p className="text-xs text-ink-700">{summary.headline}</p>
                        <ul className="mt-2 space-y-1">
                          {report.extractedFields
                            .filter((field) => field.status === "elevated" || field.status === "low" || field.status.startsWith("critical"))
                            .slice(0, 4)
                            .map((field) => (
                              <li key={field.id} className="flex items-center justify-between gap-2 text-[11px]">
                                <span className="truncate text-ink-500">{field.testName}</span>
                                <span className="shrink-0 tabular-nums text-ink-900">
                                  {field.value} {field.unit}
                                </span>
                              </li>
                            ))}
                        </ul>
                        <p className="mt-2 text-[10px] text-ink-400">{formatDate(report.reportDate)}</p>
                      </div>
                    );
                  })()
                )}
              </div>
            </div>
          </div>
        )}
      </Panel>

      {/* Prescription builder. */}
      <Panel>
        <PanelHeader
          title="Computerised prescription entry"
          subtitle="Every line is checked against live days-of-cover and the patient's allergy record before it is charted."
          icon={<Icon name="prescribe" size={18} />}
          actions={
            <Button size="sm" variant="secondary" onClick={addLine}>
              <Icon name="plus" size={13} />
              Add medication
            </Button>
          }
        />

        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="Working diagnosis" hint="Recorded on the treatment and the audit trail.">
            <TextInput value={diagnosis} onChange={setDiagnosis} placeholder="e.g. Acute exacerbation of COPD" />
          </Field>
          <Field label="ICD-10 code" hint="Optional but recommended for the clinical record.">
            <TextInput value={icd10} onChange={setIcd10} placeholder="e.g. J44.1" />
          </Field>
        </div>

        <div className="mt-4">
          <Field label="Clinical notes">
            <TextArea value={notes} onChange={setNotes} rows={2} placeholder="Follow-up plan, monitoring instructions, or a note for the nursing team." />
          </Field>
        </div>

        <div className="mt-5 space-y-3">
          {lines.length === 0 ? (
            <EmptyState
              title="No medication lines yet"
              description="Add a medication to see the live stock guard and any therapeutic alternatives."
              action={
                <Button variant="primary" size="sm" onClick={addLine}>
                  <Icon name="plus" size={13} />
                  Add the first medication
                </Button>
              }
            />
          ) : null}

          {lines.map((line) => {
            const medicine = derived.medicinesById.get(line.medicineId);
            const assessment = derived.assessmentById.get(line.medicineId);
            const conflicts = medicine ? findAllergyConflicts(medicine, patientAllergens) : [];
            const alternatives = medicine ? therapeuticAlternatives(medicine, state.db.medicines, derived.assessments) : [];
            const flagging = Boolean(assessment && (assessment.tier === "critical" || assessment.tier === "high"));
            const criticalCover = Boolean(assessment && assessment.dir < 3);
            const outOfStock = Boolean(assessment && assessment.availableStock <= 0);

            return (
              <article
                key={line.draftId}
                className={cx(
                  "rounded-xl border p-4",
                  conflicts.length > 0
                    ? "border-risk-critical/45 bg-risk-critical/[0.05]"
                    : criticalCover
                      ? "border-risk-high/45 bg-risk-high/[0.05]"
                      : "border-rule bg-paper",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <Field label="Medication">
                      <Select
                        value={line.medicineId}
                        onChange={(value) => updateLine(line.draftId, { medicineId: value })}
                        options={formulary.map((item) => ({
                          value: item.id,
                          label: `${item.brandName} — ${item.strength} (${item.form.replace(/_/g, " ")})`,
                        }))}
                      />
                    </Field>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => removeLine(line.draftId)} title="Remove line">
                    <Icon name="close" size={14} />
                  </Button>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-4">
                  <Field label="Dose">
                    <TextInput value={line.dosage} onChange={(value) => updateLine(line.draftId, { dosage: value })} />
                  </Field>
                  <Field label="Frequency">
                    <Select
                      value={line.frequency}
                      onChange={(value) => updateLine(line.draftId, { frequency: value as FrequencyKey })}
                      options={(Object.keys(FREQUENCY_LABELS) as FrequencyKey[]).map((key) => ({
                        value: key,
                        label: FREQUENCY_LABELS[key],
                      }))}
                    />
                  </Field>
                  <Field label="Duration (days)">
                    <TextInput
                      type="number"
                      min={1}
                      max={90}
                      value={line.durationDays}
                      onChange={(value) => updateLine(line.draftId, { durationDays: Math.max(1, Number(value) || 1) })}
                    />
                  </Field>
                  <Field label="Route">
                    <Select
                      value={line.route}
                      onChange={(value) => updateLine(line.draftId, { route: value as PrescriptionLine["route"] })}
                      options={[
                        { value: "oral", label: "Oral" },
                        { value: "iv", label: "Intravenous" },
                        { value: "im", label: "Intramuscular" },
                        { value: "sc", label: "Subcutaneous" },
                        { value: "inhaled", label: "Inhaled" },
                        { value: "topical", label: "Topical" },
                      ]}
                    />
                  </Field>
                </div>

                <div className="mt-3">
                  <Field label="Administration instruction">
                    <TextInput
                      value={line.instructions}
                      onChange={(value) => updateLine(line.draftId, { instructions: value })}
                      placeholder="e.g. After food, complete the full course"
                    />
                  </Field>
                </div>

                {/* Allergy guard. */}
                {conflicts.length > 0 ? (
                  <div className="mt-3 rounded-lg border border-risk-critical/45 bg-risk-critical/[0.08] p-3">
                    <p className="flex items-center gap-2 text-xs font-semibold text-risk-critical">
                      <Icon name="alert" size={14} />
                      Allergy conflict
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-risk-critical/90">
                      {patient?.name} has a{" "}
                      {patient?.allergies.find((item) => item.allergen === conflicts[0].allergen)?.severity} recorded
                      allergy to <strong>{conflicts[0].allergen}</strong>, and this molecule shares the{" "}
                      {conflicts[0].viaClass} class. Consider a therapeutic equivalent from a different class.
                    </p>
                  </div>
                ) : null}

                {/* Stock guard. */}
                {medicine && assessment ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] text-ink-500">Live Stock Guard</span>
                        <Chip token={RISK_TOKENS[assessment.tier]} />
                        {outOfStock ? (
                          <span className="sm-chip border-risk-critical/45 bg-risk-critical/[0.12] text-risk-critical">Out of Stock</span>
                        ) : criticalCover ? (
                          <span className="sm-chip border-risk-high/45 bg-risk-high/[0.12] text-risk-high">
                            Under 3 days stock left
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-ink-500">
                        <span>
                          Stock Left:{" "}
                          <span className={cx("font-semibold tabular-nums", flagging ? "text-risk-high" : "text-ink-900")}>
                            {formatDays(assessment.dir)} days
                          </span>
                        </span>
                        <span>
                          Available: <span className="tabular-nums text-ink-900">{assessment.availableStock}</span>{" "}
                          {medicine.unit}
                        </span>
                        <span>
                          Risk Score: <span className="tabular-nums text-ink-900">{assessment.sps}/100</span>
                        </span>
                        <span>
                          This Rx: <span className="tabular-nums text-ink-900">{computeQuantity(medicine, line.frequency, line.durationDays)}</span>{" "}
                          {medicine.unit}
                        </span>
                      </div>
                      {!criticalCover && !flagging ? (
                        <p className="mt-2 text-[11px] text-risk-normal">
                          Hospital stock is healthy for this course; safe to prescribe.
                        </p>
                      ) : (
                        <p className="mt-2 text-[11px] leading-relaxed text-risk-high">
                          This prescription consumes{" "}
                          {(
                            (computeQuantity(medicine, line.frequency, line.durationDays) /
                              Math.max(assessment.availableStock, 1)) *
                            100
                          ).toFixed(1)}
                          % of remaining hospital stock. {assessment.recommendation}
                        </p>
                      )}
                    </div>
                    <div className="w-28 shrink-0">
                      <Sparkline
                        values={assessment.burnSeries}
                        stroke={RISK_TOKENS[assessment.tier].hex}
                        height={32}
                        ariaLabel={`${medicine.brandName} burn rate`}
                      />
                    </div>
                  </div>
                ) : null}

                {/* Alternatives. */}
                {medicine && alternatives.length > 0 && (flagging || conflicts.length > 0) ? (
                  <div className="mt-3 rounded-lg border border-accent/35 bg-accent-soft p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-accent/90">
                      In-stock therapeutic equivalents
                    </p>
                    <ul className="mt-2 space-y-2">
                      {alternatives.map((entry) => (
                        <li key={entry.medicine.id} className="flex flex-wrap items-center justify-between gap-2">
                          <span className="min-w-0">
                            <span className="block text-xs text-ink-900">
                              {entry.medicine.brandName}{" "}
                              <span className="text-ink-400">· {entry.medicine.genericName}</span>
                            </span>
                            <span className="block text-[10px] text-ink-500">
                              {formatDays(entry.assessment.dir)} days stock left · Risk Score {entry.assessment.sps}/100 ·{" "}
                              {entry.assessment.availableStock} {entry.medicine.unit} available
                            </span>
                          </span>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              updateLine(line.draftId, {
                                medicineId: entry.medicine.id,
                                substituteFor: medicine.id,
                              })
                            }
                          >
                            Substitute
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {line.substituteFor ? (
                  <p className="mt-2 text-[11px] text-risk-normal">
                    Substitution recorded:{" "}
                    {derived.medicinesById.get(line.substituteFor)?.brandName ?? line.substituteFor} was replaced for
                    this patient.
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>

        {error ? (
          <p className="mt-4 rounded-lg border border-risk-critical/45 bg-risk-critical/[0.08] p-3 text-xs text-risk-critical">{error}</p>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-xl text-[11px] leading-relaxed text-ink-400">
            Charting a prescription dispenses the course immediately and re-runs the shortage forecast, so the supply
            board and the nurse's eMAR sheet both move the moment this is signed.
          </p>
          <Button variant="primary" onClick={submit} disabled={!patient || lines.length === 0}>
            <Icon name="check" size={14} />
            Sign and dispense
          </Button>
        </div>
      </Panel>

      {/* Result and forecast impact. */}
      {result ? (
        <Panel>
          <PanelHeader
            title="Prescription charted"
            subtitle={`${result.treatment.id} · ${result.treatment.prescriptions.length} line(s) · recorded against ${patient?.name ?? "the patient"}.`}
            icon={<Icon name="check" size={18} />}
          />
          <DataTable head={["Medication", "Dose", "Frequency", "Course", "Dispensed", "SPS before", "SPS now"]}>
            {result.treatment.prescriptions.map((line) => {
              const before = result.before.find((item) => item.medicineId === line.medicineId);
              const now = derived.assessmentById.get(line.medicineId);
              return (
                <tr key={line.id}>
                  <td className="sm-td font-medium text-ink-900">{line.drugName}</td>
                  <td className="sm-td text-ink-500">{line.dosage}</td>
                  <td className="sm-td text-ink-500">{FREQUENCY_LABELS[line.frequency]}</td>
                  <td className="sm-td text-ink-500">{line.durationDays} day(s)</td>
                  <td className="sm-td tabular-nums text-ink-900">{line.quantity}</td>
                  <td className="sm-td tabular-nums text-ink-500">{before?.sps ?? "—"}</td>
                  <td className="sm-td tabular-nums">
                    <span style={{ color: now ? RISK_TOKENS[now.tier].hex : undefined }}>{now?.sps ?? "—"}</span>
                  </td>
                </tr>
              );
            })}
          </DataTable>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-400">
            The shortage engine was re-scored the instant the course was dispensed. {result.before.length} molecule(s)
            were affected; open the control room as an admin to see the updated forecast.
          </p>
        </Panel>
      ) : null}

      {/* Recent prescriptions for this patient. */}
      {patient ? (
        <Panel>
          <PanelHeader title="Treatment history" subtitle="Charted courses for this patient." icon={<Icon name="emar" size={18} />} />
          {derived.treatmentsFor(patient.id).length === 0 ? (
            <EmptyState title="No treatments recorded" description="Charted prescriptions appear here with their dispensed quantities." />
          ) : (
            <ul className="space-y-3">
              {derived.treatmentsFor(patient.id).map((treatment) => (
                <li key={treatment.id} className="rounded-lg border border-rule bg-paper p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-ink-900">{treatment.diagnosis}</p>
                    <span className="font-mono text-[10px] text-ink-400">
                      {treatment.icd10Code} · {formatDate(treatment.createdAt)}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-ink-500">
                    {treatment.prescriptions.map((line) => `${line.drugName} (${line.quantity})`).join(" · ")}
                  </p>
                  {treatment.notes ? <p className="mt-1 text-[11px] text-ink-400">{treatment.notes}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 3. Report simplifier view                                           */
/* ------------------------------------------------------------------ */

function DoctorReports() {
  const { state, derived } = useApp();
  const patient = derived.patientsById.get(state.session.patientId) ?? null;

  const trends = patient ? derived.trendsFor(patient.id).filter((trend) => trend.history.length >= 2) : [];

  return (
    <div className="space-y-6">
      {!patient ? (
        <Panel>
          <EmptyState title="No patient selected" description="Pick a patient from the top bar to review their reports." />
        </Panel>
      ) : (
        <>
          <ReportSimplifier patientId={patient.id} patient={patient} canUpload canAnnotate />

          {trends.length > 0 ? (
            <Panel>
              <PanelHeader
                title="Cross-panel comparison"
                subtitle="Out-of-range biomarkers for this patient plotted together on a shared axis to expose competing trends."
                icon={<Icon name="trends" size={18} />}
              />
              <LineChart
                height={280}
                series={trends.slice(0, 4).map((trend, index) => ({
                  key: trend.normalizedKey,
                  label: `${trend.testName} (${trend.unit})`,
                  color: ["#14416b", "#a1590f", "#5a3a7a", "#1c6b3c"][index % 4],
                  points: trend.history.map((point) => ({
                    label: formatDate(point.date),
                    value: point.value,
                  })),
                }))}
                valueFormat={(value) => value.toFixed(1)}
                ariaLabel="Cross-panel biomarker comparison"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                {trends.slice(0, 4).map((trend) => (
                  <Chip key={trend.normalizedKey} token={BIOMARKER_STATUS_TOKENS[trend.status]}>
                    {trend.testName}
                  </Chip>
                ))}
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-ink-400">
                Values are plotted on a shared axis for shape comparison only; each biomarker has its own reference
                range. {MEDICAL_DISCLAIMER}
              </p>
            </Panel>
          ) : null}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export default function DoctorPortal() {
  const { state } = useApp();

  switch (state.activeView) {
    case "doctor.prescribe":
      return <CpoeConsole />;
    case "doctor.reports":
      return <DoctorReports />;
    case "doctor.queue":
    default:
      return <OutpatientQueue />;
  }
}
