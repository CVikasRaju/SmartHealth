/**
 * Patient portal.
 *
 * Three modules: the report simplifier, longitudinal health trends, and
 * appointments & prescriptions. Designed to be reassuring, clear, and easy to
 * navigate for patients without medical jargon.
 */

import { useMemo, useState } from "react";
import { useApp } from "@/store/AppStore";
import {
  BIOMARKER_CATEGORY_LABELS,
  BIOMARKER_DICTIONARY,
  MEDICAL_DISCLAIMER,
  describeTrend,
  isOutOfRange,
} from "@/engine/reportEngine";
import { APPOINTMENT_STATUS_TOKENS, BIOMARKER_STATUS_TOKENS, CHART_PALETTE, SEVERITY_TOKENS } from "@/ui/theme";
import ReportSimplifier from "@/components/ReportSimplifier";
import LineChart from "@/charts/LineChart";
import {
  Button,
  Chip,
  EmptyState,
  Field,
  KeyValue,
  Panel,
  PanelHeader,
  Select,
  TextArea,
  TextInput,
} from "@/ui/primitives";
import Icon from "@/ui/Icon";
import { ageFromDob, cx, formatDate, formatDateTime, formatNumber } from "@/utils/format";
import type { FrequencyKey } from "@/types";

/* ================================================================== */
/* Timing helper for prescriptions                                    */
/* ================================================================== */

interface DoseSchedule {
  timeLabel: string;
  badge: string;
  badgeClass: string;
  instruction: string;
}

function getDoseSchedule(frequency: FrequencyKey, instructions: string): DoseSchedule {
  const lower = instructions.toLowerCase();

  if (lower.includes("bedtime") || lower.includes("night")) {
    return {
      timeLabel: "Night / Bedtime · 09:30 PM",
      badge: "🌙 Night Dose",
      badgeClass: "bg-indigo-50 border-indigo-200 text-indigo-800",
      instruction: "Take before sleeping at night (with or after dinner)",
    };
  }

  if (lower.includes("morning")) {
    return {
      timeLabel: "Morning · 08:30 AM",
      badge: "☀️ Morning Dose",
      badgeClass: "bg-amber-50 border-amber-200 text-amber-800",
      instruction: "Take in the morning, preferably after breakfast",
    };
  }

  switch (frequency) {
    case "once_daily":
      return {
        timeLabel: "Once Daily · 08:30 AM",
        badge: "☀️ Once Daily",
        badgeClass: "bg-emerald-50 border-emerald-200 text-emerald-800",
        instruction: "Take at the same time each day with water after a meal",
      };
    case "twice_daily":
      return {
        timeLabel: "Morning (08:30 AM) & Night (08:30 PM)",
        badge: "☀️🌙 Twice Daily",
        badgeClass: "bg-blue-50 border-blue-200 text-blue-800",
        instruction: "Take approximately 12 hours apart, after breakfast and after dinner",
      };
    case "thrice_daily":
      return {
        timeLabel: "Morning (08:00 AM) · Afternoon (02:00 PM) · Night (09:00 PM)",
        badge: "☀️🌤️🌙 3 Times Daily",
        badgeClass: "bg-purple-50 border-purple-200 text-purple-800",
        instruction: "Take 30 minutes after your main meals",
      };
    case "four_times_daily":
      return {
        timeLabel: "06:00 AM · 12:00 PM · 06:00 PM · 10:00 PM",
        badge: "⏰ 4 Times Daily",
        badgeClass: "bg-rose-50 border-rose-200 text-rose-800",
        instruction: "Space evenly across your waking hours",
      };
    case "sos":
      return {
        timeLabel: "Only when needed / on symptom onset",
        badge: "⚠️ As Needed (SOS)",
        badgeClass: "bg-amber-50 border-amber-200 text-amber-800",
        instruction: "Take only when you feel acute symptoms as advised by doctor",
      };
    case "stat":
      return {
        timeLabel: "Immediate single dose",
        badge: "🚨 Immediate (STAT)",
        badgeClass: "bg-red-50 border-red-200 text-red-800",
        instruction: "Take immediately as administered or prescribed",
      };
  }
}

/* ================================================================== */
/* Patient Contact / Query Hospital Modal                             */
/* ================================================================== */

function PatientQueryModal({
  isOpen,
  onClose,
  patientId,
  defaultSubject = "",
}: {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  defaultSubject?: string;
}) {
  const { actions, derived } = useApp();
  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const doctor = derived.doctors[0];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-rule bg-paper p-6 shadow-2xl animate-rise-in">
        <div className="flex items-start justify-between border-b border-rule pb-3">
          <div>
            <h3 className="text-base font-semibold text-ink-900">Contact Hospital / Ask Your Doctor</h3>
            <p className="text-xs text-ink-500">
              Have a doubt about your dosage, report, or symptoms? Send a message or call directly.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-ink-400 hover:bg-canvas hover:text-ink-900"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        {/* Quick Helpline Strip */}
        <div className="mt-4 rounded-xl border border-accent/20 bg-accent-soft/40 p-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="block text-[10px] font-bold uppercase tracking-wider text-accent">
              24x7 Patient Care Helpline
            </span>
            <span className="text-sm font-semibold text-ink-900">+91 80 4000 5000</span>
          </div>
          <a
            href="tel:+918040005000"
            className="inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-accent-deep"
          >
            <Icon name="bolt" size={13} />
            Call Helpline Now
          </a>
        </div>

        {submitted ? (
          <div className="my-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
            <div className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-full bg-emerald-100 text-emerald-700">
              <Icon name="check" size={20} />
            </div>
            <h4 className="text-sm font-semibold text-emerald-900">Message Sent to Care Team</h4>
            <p className="mt-1 text-xs text-emerald-700">
              Your inquiry has been forwarded to {doctor?.fullName ?? "your treating clinician"}. A nurse or doctor will review and get back to you shortly.
            </p>
            <Button
              size="sm"
              variant="secondary"
              className="mt-4"
              onClick={() => {
                setSubmitted(false);
                setMessage("");
                onClose();
              }}
            >
              Close
            </Button>
          </div>
        ) : (
          <div className="mt-4 space-y-3.5">
            <Field label="Subject / Topic">
              <TextInput
                value={subject}
                onChange={setSubject}
                placeholder="e.g. Clarification regarding Lantus dosage timing"
              />
            </Field>

            <Field label="Your Question or Query">
              <TextArea
                value={message}
                onChange={setMessage}
                rows={4}
                placeholder="Describe what you'd like to clarify about your medicine, lab report, or appointment..."
              />
            </Field>

            <div className="flex justify-end gap-2 pt-2 border-t border-rule">
              <Button size="sm" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={!message.trim()}
                onClick={() => {
                  actions.sendPatientInquiry(
                    patientId,
                    subject.trim() || "Patient inquiry",
                    message.trim(),
                    doctor?.id,
                  );
                  setSubmitted(true);
                }}
              >
                Send Message to Doctor
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ================================================================== */
/* Identity header & Condition Recovery Manager                        */
/* ================================================================== */

function PatientHeader() {
  const { state, derived, actions } = useApp();
  const patient = derived.patientsById.get(state.session.patientId);
  const [managingConditions, setManagingConditions] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [isQueryModalOpen, setIsQueryModalOpen] = useState(false);

  if (!patient) return null;

  const trends = derived.trendsFor(patient.id);
  const reports = derived.reportsFor(patient.id);
  const outOfRange = trends.filter((trend) => isOutOfRange(trend.status));

  const activeConditions = patient.chronicConditions || [];
  const resolvedConditions = patient.resolvedConditions || [];

  return (
    <>
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="font-serif text-xl font-semibold tracking-tight text-ink-900">{patient.name}</h2>
              <button
                type="button"
                onClick={() => setIsQueryModalOpen(true)}
                className="no-print inline-flex items-center gap-1 rounded border border-accent/40 bg-accent-soft px-2.5 py-0.5 text-[11px] font-semibold text-accent hover:bg-accent-soft/80 transition"
              >
                <Icon name="bolt" size={12} />
                Ask Doctor / Helpline
              </button>
            </div>
            <p className="mt-0.5 text-xs text-ink-500">
              {patient.mrn} · born {formatDate(patient.dob)} ({ageFromDob(patient.dob)} years) · {patient.gender} · blood
              group {patient.bloodGroup}
            </p>
            <p className="mt-1 text-[11px] text-ink-400">
              Registered {formatDate(patient.registeredAt)} · {reports.length} report
              {reports.length === 1 ? "" : "s"} on file
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {patient.allergies.map((allergy) => (
              <Chip key={allergy.allergen} token={SEVERITY_TOKENS[allergy.severity]}>
                {allergy.allergen}
              </Chip>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {/* Conditions on Record with Recovery / Resolution Option */}
          <div className="rounded border border-rule bg-paper p-3 shadow-panel">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                Active Conditions ({activeConditions.length})
              </p>
              <button
                type="button"
                onClick={() => setManagingConditions((v) => !v)}
                className="text-[10px] font-semibold text-accent hover:underline"
              >
                {managingConditions ? "Done" : "Manage / Recovered"}
              </button>
            </div>

            <ul className="mt-2 space-y-1.5">
              {activeConditions.length === 0 ? (
                <li className="text-xs text-risk-normal font-medium">No active chronic conditions on record.</li>
              ) : (
                activeConditions.map((condition) => (
                  <li key={condition} className="flex items-center justify-between gap-2 text-xs text-ink-700">
                    <span>{condition}</span>
                    {managingConditions ? (
                      <button
                        type="button"
                        onClick={() => actions.resolvePatientCondition(patient.id, condition, "resolve")}
                        className="rounded border border-risk-normal/40 bg-risk-normal/[0.08] px-1.5 py-0.5 text-[10px] font-semibold text-risk-normal hover:bg-risk-normal/[0.15]"
                      >
                        ✓ Mark Recovered
                      </button>
                    ) : null}
                  </li>
                ))
              )}
            </ul>

            {resolvedConditions.length > 0 ? (
              <div className="mt-3 border-t border-rule-soft pt-2">
                <button
                  type="button"
                  onClick={() => setShowResolved((v) => !v)}
                  className="flex w-full items-center justify-between text-[10px] font-semibold text-ink-400 hover:text-ink-700"
                >
                  <span>Resolved / Past Illnesses ({resolvedConditions.length})</span>
                  <Icon name="chevronDown" size={12} className={cx(showResolved && "rotate-180")} />
                </button>
                {showResolved ? (
                  <ul className="mt-1.5 space-y-1">
                    {resolvedConditions.map((condition) => (
                      <li key={condition} className="flex items-center justify-between text-[11px] text-ink-400">
                        <span className="line-through">{condition}</span>
                        {managingConditions ? (
                          <button
                            type="button"
                            onClick={() => actions.resolvePatientCondition(patient.id, condition, "reactivate")}
                            className="text-[10px] text-accent hover:underline"
                          >
                            Reactivate
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="rounded border border-rule bg-paper p-3 shadow-panel">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
              Values to Review with Doctor
            </p>
            {outOfRange.length === 0 ? (
              <p className="mt-2 text-xs text-risk-normal font-medium">
                Every recognised value currently sits inside its reference range.
              </p>
            ) : (
              <ul className="mt-2 space-y-1">
                {outOfRange.slice(0, 4).map((trend) => (
                  <li key={trend.normalizedKey} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate text-ink-700">{trend.testName}</span>
                    <span className="shrink-0 tabular-nums font-semibold text-risk-high">
                      {formatNumber(trend.latest, trend.latest % 1 === 0 ? 0 : 1)} {trend.unit}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded border border-rule bg-paper p-3 shadow-panel">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">Emergency & Care Contact</p>
            <p className="mt-2 text-xs font-semibold text-ink-900">{patient.emergencyContact.name}</p>
            <p className="text-[11px] text-ink-500">
              {patient.emergencyContact.relation} · {patient.emergencyContact.contact}
            </p>
            <p className="mt-2 text-[11px] text-ink-400">Patient Phone: {patient.contact}</p>
          </div>
        </div>
      </Panel>

      <PatientQueryModal
        isOpen={isQueryModalOpen}
        onClose={() => setIsQueryModalOpen(false)}
        patientId={patient.id}
      />
    </>
  );
}

/* ================================================================== */
/* 1. My reports                                                       */
/* ================================================================== */

function MyReports() {
  const { state, derived } = useApp();
  const patient = derived.patientsById.get(state.session.patientId) ?? null;

  if (!patient) {
    return (
      <Panel>
        <EmptyState title="No patient profile linked" description="This portal is configured for a specific patient record." />
      </Panel>
    );
  }

  return (
    <div className="space-y-6">
      <div className="no-print">
        <PatientHeader />
      </div>

      <div className="no-print">
        <Panel>
          <PanelHeader
            title="How to read this section"
            subtitle="What the simplifier does, in plain terms."
            icon={<Icon name="info" size={18} />}
          />
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              {
                title: "1. Your report is read",
                body:
                  "The uploaded document is scanned and the test names, values, units and collection dates are pulled out automatically.",
              },
              {
                title: "2. Each value is explained",
                body:
                  "Every recognised test is described in everyday language alongside the range normally expected for an adult.",
              },
              {
                title: "3. Nothing is diagnosed",
                body:
                  "The summary explains what a test measures. Only your doctor can interpret what the result means for you.",
              },
            ].map((step) => (
              <div key={step.title} className="rounded-lg border border-rule bg-paper p-3">
                <p className="text-xs font-semibold text-ink-900">{step.title}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-500">{step.body}</p>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <ReportSimplifier patientId={patient.id} patient={patient} canUpload canAnnotate={false} />
    </div>
  );
}

/* ================================================================== */
/* 2. Health trends                                                    */
/* ================================================================== */

function HealthTrends() {
  const { state, derived } = useApp();
  const patient = derived.patientsById.get(state.session.patientId) ?? null;
  const [category, setCategory] = useState<string>("all");
  const [inquirySubject, setInquirySubject] = useState<string>("");
  const [isQueryModalOpen, setIsQueryModalOpen] = useState(false);

  const allTrends = useMemo(() => (patient ? derived.trendsFor(patient.id) : []), [patient, derived]);

  const categories = useMemo(
    () => Array.from(new Set(allTrends.map((trend) => trend.category))),
    [allTrends],
  );

  const trends = useMemo(
    () => (category === "all" ? allTrends : allTrends.filter((trend) => trend.category === category)),
    [allTrends, category],
  );

  const repeated = trends.filter((trend) => trend.history.length >= 2);
  const inRangeCount = allTrends.filter((trend) => !isOutOfRange(trend.status)).length;
  const outOfRangeCount = allTrends.filter((trend) => isOutOfRange(trend.status)).length;

  if (!patient) {
    return (
      <Panel>
        <EmptyState title="No patient profile linked" description="Trends appear once a report is on file." />
      </Panel>
    );
  }

  return (
    <div className="space-y-6">
      <div className="no-print">
        <PatientHeader />
      </div>

      {allTrends.length === 0 ? (
        <Panel>
          <EmptyState
            title="No results to chart yet"
            description="Upload a laboratory report from the My reports section to start building your trend history."
          />
        </Panel>
      ) : (
        <>
          {/* Reassuring & Friendly Top Stat Tiles */}
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-rule bg-paper p-3.5 shadow-sm">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-ink-400">
                Tracked Biomarkers
              </span>
              <span className="text-2xl font-bold text-ink-900">{allTrends.length}</span>
              <p className="mt-1 text-[11px] text-ink-400">Total lab parameters analyzed</p>
            </div>

            <div className="rounded-xl border border-accent/20 bg-accent-soft/40 p-3.5 shadow-sm">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-accent">
                Multi-Visit Trends
              </span>
              <span className="text-2xl font-bold text-accent">{repeated.length}</span>
              <p className="mt-1 text-[11px] text-accent/80">With historical comparison</p>
            </div>

            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3.5 shadow-sm">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-emerald-800">
                In Optimal Range
              </span>
              <span className="text-2xl font-bold text-emerald-700">{inRangeCount}</span>
              <p className="mt-1 text-[11px] text-emerald-700">Sitting within standard boundaries</p>
            </div>

            <div className="rounded-xl border border-orange-200 bg-orange-50/60 p-3.5 shadow-sm">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-orange-800">
                For Doctor Review
              </span>
              <span className="text-2xl font-bold text-orange-700">{outOfRangeCount}</span>
              <p className="mt-1 text-[11px] text-orange-700">Evaluated in personal clinical context</p>
            </div>
          </div>

          <Panel>
            <PanelHeader
              title="How to Understand Your Health Trend Graphs"
              subtitle="The green shaded band represents the typical healthy reference range. Your actual readings are plotted over time."
              icon={<Icon name="trends" size={18} />}
              actions={
                <div className="w-56">
                  <Select
                    value={category}
                    onChange={setCategory}
                    options={[
                      { value: "all", label: "All Body Categories" },
                      ...categories.map((item) => ({
                        value: item,
                        label: BIOMARKER_CATEGORY_LABELS[item] ?? item,
                      })),
                    ]}
                  />
                </div>
              }
            />

            {/* Explanatory Guide Box */}
            <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 text-xs leading-relaxed text-ink-700">
              <div className="flex items-start gap-2">
                <Icon name="info" size={15} className="mt-0.5 text-accent shrink-0" />
                <div>
                  <strong className="font-semibold text-ink-900">How to read these charts:</strong>
                  <div className="mt-1 grid gap-2 sm:grid-cols-3 text-[11px]">
                    <div className="flex items-center gap-1.5">
                      <span className="h-3 w-5 rounded bg-emerald-200 border border-emerald-400/40 inline-block" />
                      <span><strong>Green Zone</strong>: Standard Safe Range</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-accent inline-block" />
                      <span><strong>Solid Line & Dots</strong>: Your Recorded Values</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Icon name="bolt" size={12} className="text-accent" />
                      <span><strong>Question Button</strong>: Ask doctor about any trend</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <ul className="space-y-4">
              {trends.map((trend) => {
                const token = BIOMARKER_STATUS_TOKENS[trend.status];
                const inRange = !isOutOfRange(trend.status);
                const bioDef = BIOMARKER_DICTIONARY.find((b) => b.key === trend.normalizedKey);

                return (
                  <li
                    key={trend.normalizedKey}
                    className={cx(
                      "rounded-xl border p-4 transition shadow-sm",
                      inRange ? "border-rule bg-paper" : "border-orange-200 bg-orange-50/[0.12]",
                    )}
                  >
                    {/* Header Strip */}
                    <div className="flex flex-wrap items-start justify-between gap-3 pb-2 border-b border-rule-soft">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: token.hex }} />
                          <h4 className="text-sm font-semibold text-ink-900">{trend.testName}</h4>
                          <span className={cx("sm-chip rounded text-[10px]", token.chip)}>
                            {token.label}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-ink-500">
                          Target Safe Range: <strong className="font-semibold text-emerald-800">{trend.referenceRange.text} {trend.unit}</strong>
                        </p>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <span className="text-base font-bold tabular-nums text-ink-900">
                            {formatNumber(trend.latest, trend.latest % 1 === 0 ? 0 : 2)}
                          </span>
                          <span className="ml-1 text-xs text-ink-500">{trend.unit}</span>
                          <span className="block text-[10px] text-ink-400">Latest Recorded</span>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setInquirySubject(`Question regarding my ${trend.testName} trend`);
                            setIsQueryModalOpen(true);
                          }}
                          className="no-print inline-flex items-center gap-1 rounded-lg border border-rule bg-canvas px-2.5 py-1 text-[11px] font-medium text-ink-700 hover:border-accent/40 hover:bg-accent-soft hover:text-accent transition"
                        >
                          <Icon name="bolt" size={12} />
                          Ask Doctor
                        </button>
                      </div>
                    </div>

                    {/* Interactive Trend Chart */}
                    <div className="mt-3">
                      <LineChart
                        height={160}
                        series={[
                          {
                            key: trend.normalizedKey,
                            label: trend.testName,
                            color: inRange ? CHART_PALETTE[2] : token.hex,
                            area: true,
                            points: trend.history.map((point) => ({
                              label: formatDate(point.date),
                              value: point.value,
                            })),
                          },
                        ]}
                        band={{
                          min: trend.referenceRange.min,
                          max: trend.referenceRange.max,
                        }}
                        valueFormat={(value) => formatNumber(value, 1)}
                        emptyMessage="A single reading needs a second test before a trendline can be drawn."
                        ariaLabel={`${trend.testName} trend`}
                      />
                    </div>

                    {/* Plain Language Educational Breakdown */}
                    <div className="mt-3 rounded-lg border border-rule-soft bg-canvas/70 p-3 text-xs leading-relaxed text-ink-700 space-y-1.5">
                      <div>
                        <strong className="font-semibold text-ink-900">What this test measures: </strong>
                        <span>{bioDef?.measures ?? "Tracks this specific physiological health indicator."}</span>
                      </div>
                      <div>
                        <strong className="font-semibold text-ink-900">What your trend shows: </strong>
                        <span>
                          {describeTrend(trend)}.{" "}
                          {inRange
                            ? "Your readings have consistently stayed within safe, healthy physiological bounds."
                            : trend.direction === "falling" && trend.latest > trend.referenceRange.max
                              ? "Your levels are gradually dropping toward the healthy target range, which is a positive direction of travel."
                              : "This value sits outside standard adult boundaries; your physician evaluates this in combination with your diet and treatment plan."}
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel>
            <PanelHeader
              title="Your care summary"
              subtitle="A snapshot to take to your next appointment."
              icon={<Icon name="report" size={18} />}
            />
            <KeyValue
              items={[
                { label: "Trends improving or stable", value: String(allTrends.length - outOfRangeCount) },
                {
                  label: "Values outside range",
                  value: String(outOfRangeCount),
                },
                {
                  label: "Longest history",
                  value: (() => {
                    const longest = allTrends.reduce(
                      (best, trend) => (trend.history.length > best.history.length ? trend : best),
                      allTrends[0],
                    );
                    return `${longest.testName} · ${longest.history.length} readings`;
                  })(),
                },
                { label: "Reports contributing", value: String(derived.reportsFor(patient.id).length) },
              ]}
            />
            <p className="mt-4 rounded-lg border border-risk-moderate/50 bg-risk-moderate/[0.08] p-3 text-[11px] leading-relaxed text-risk-moderate">
              {MEDICAL_DISCLAIMER}
            </p>
          </Panel>
        </>
      )}

      <PatientQueryModal
        isOpen={isQueryModalOpen}
        onClose={() => setIsQueryModalOpen(false)}
        patientId={patient.id}
        defaultSubject={inquirySubject}
      />
    </div>
  );
}

/* ================================================================== */
/* 3. Appointments & Prescribed Medications                            */
/* ================================================================== */

function MyAppointments() {
  const { state, derived, actions } = useApp();
  const patient = derived.patientsById.get(state.session.patientId) ?? null;

  const [draft, setDraft] = useState({
    doctorId: derived.doctors[0]?.id ?? "",
    when: `${new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}T10:30`,
    reason: "",
  });
  const [booked, setBooked] = useState<string | null>(null);
  const [isQueryModalOpen, setIsQueryModalOpen] = useState(false);
  const [inquirySubject, setInquirySubject] = useState("");

  if (!patient) {
    return (
      <Panel>
        <EmptyState title="No patient profile linked" description="Appointments appear once a profile is linked." />
      </Panel>
    );
  }

  const appointments = derived.appointmentsFor(patient.id)
    .slice()
    .sort((a, b) => new Date(b.scheduledFor).getTime() - new Date(a.scheduledFor).getTime());

  const upcoming = appointments.filter(
    (appointment) => new Date(appointment.scheduledFor).getTime() >= Date.now() - 86_400_000,
  );
  const past = appointments.filter((appointment) => !upcoming.includes(appointment));

  const treatments = derived.treatmentsFor(patient.id);

  return (
    <div className="space-y-6">
      <div className="no-print">
        <PatientHeader />
      </div>

      {/* ---------------------------------------------------------- */}
      {/* PRESCRIBED MEDICATION (CLEAR DOSAGE & SCHEDULE TIMINGS)    */}
      {/* ---------------------------------------------------------- */}
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-rule pb-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-accent-soft text-accent">
                <Icon name="prescribe" size={16} />
              </span>
              <h3 className="text-base font-semibold text-ink-900">Your Prescribed Medications</h3>
            </div>
            <p className="mt-0.5 text-xs text-ink-500">
              Active medication courses charted by your treating clinician with exact daily timings.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <a
              href="tel:+918040005000"
              className="inline-flex items-center gap-1.5 rounded-lg border border-rule bg-paper px-3 py-1.5 text-xs font-semibold text-ink-700 hover:border-accent/50 hover:text-accent transition shadow-sm"
            >
              <Icon name="bolt" size={13} className="text-accent" />
              Call Pharmacy Helpline (+91 80 4000 5000)
            </a>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                setInquirySubject("Medication dosage clarification");
                setIsQueryModalOpen(true);
              }}
            >
              Ask Doctor About Meds
            </Button>
          </div>
        </div>

        {treatments.length === 0 ? (
          <div className="pt-4">
            <EmptyState title="No prescriptions on record" description="Prescribed medication appears here after a consultation." />
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {treatments.map((treatment) => {
              const doctor = derived.staffById.get(treatment.doctorId);
              return (
                <div key={treatment.id} className="rounded-xl border border-rule bg-paper p-4 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule-soft pb-2.5">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-accent">Diagnosis / Clinical Review</span>
                      <h4 className="text-sm font-semibold text-ink-900">{treatment.diagnosis}</h4>
                    </div>
                    <span className="text-xs text-ink-500">
                      Prescribed on <strong className="font-medium text-ink-700">{formatDate(treatment.createdAt)}</strong> by{" "}
                      <strong className="font-semibold text-ink-800">{doctor?.fullName ?? "Attending Clinician"}</strong>
                    </span>
                  </div>

                  <div className="mt-3.5 space-y-3">
                    {treatment.prescriptions.map((line) => {
                      const schedule = getDoseSchedule(line.frequency, line.instructions);

                      return (
                        <div
                          key={line.id}
                          className="rounded-xl border border-rule bg-canvas/60 p-3.5 transition hover:border-accent/40"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <h5 className="text-sm font-bold text-ink-900">{line.drugName}</h5>
                                <span className="rounded-md border border-rule bg-paper px-2 py-0.5 text-xs font-semibold text-ink-800">
                                  {line.dosage}
                                </span>
                                <span className={cx("rounded-md border px-2 py-0.5 text-[11px] font-semibold", schedule.badgeClass)}>
                                  {schedule.badge}
                                </span>
                              </div>

                              {/* Timing & Instruction Callout */}
                              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-700">
                                <div className="flex items-center gap-1.5 font-semibold text-accent">
                                  <Icon name="calendar" size={13} />
                                  <span>When to take: {schedule.timeLabel}</span>
                                </div>
                                <div className="text-ink-500">
                                  Route: <span className="font-medium uppercase text-ink-700">{line.route}</span>
                                </div>
                              </div>
                            </div>

                            <div className="text-right">
                              <span className="rounded-lg bg-paper px-2.5 py-1 text-xs font-semibold text-ink-800 border border-rule">
                                {line.durationDays}-Day Course · {line.quantity} total unit{line.quantity === 1 ? "" : "s"}
                              </span>
                            </div>
                          </div>

                          {/* Specific Doctor's Directions */}
                          {line.instructions ? (
                            <div className="mt-2.5 rounded-lg border border-accent/20 bg-accent-soft/30 p-2.5 text-xs text-ink-800">
                              <span className="font-semibold text-accent">Physician Instructions: </span>
                              <span>{line.instructions}</span>
                            </div>
                          ) : (
                            <p className="mt-2 text-xs text-ink-500">{schedule.instruction}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {treatment.notes ? (
                    <div className="mt-3 border-t border-rule-soft pt-2 text-xs text-ink-500">
                      <span className="font-semibold text-ink-700">Clinical Consultation Notes: </span>
                      <span>{treatment.notes}</span>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {/* ---------------------------------------------------------- */}
      {/* APPOINTMENTS SECTION                                       */}
      {/* ---------------------------------------------------------- */}
      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Panel>
          <PanelHeader
            title="Upcoming visits"
            subtitle="Check-in status updates as the front desk processes your arrival."
            icon={<Icon name="calendar" size={18} />}
          />
          {upcoming.length === 0 ? (
            <EmptyState title="No upcoming appointments" description="Request a visit using the form beside this panel." />
          ) : (
            <ul className="space-y-2.5">
              {upcoming.map((appointment) => {
                const doctor = derived.staffById.get(appointment.doctorId);
                return (
                  <li key={appointment.id} className="rounded-xl border border-rule bg-paper p-3.5 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-ink-900">{appointment.reason}</p>
                      <Chip token={APPOINTMENT_STATUS_TOKENS[appointment.status]} />
                    </div>
                    <p className="mt-1 text-xs text-ink-500">
                      {formatDateTime(appointment.scheduledFor)} · {doctor?.fullName ?? "—"} ·{" "}
                      {appointment.department}
                    </p>
                    {appointment.triageNotes ? (
                      <p className="mt-1 text-[11px] text-ink-400">{appointment.triageNotes}</p>
                    ) : null}
                    {appointment.queuePosition !== null ? (
                      <div className="mt-2 rounded-lg border border-accent/30 bg-accent-soft p-2 text-xs font-semibold text-accent">
                        🎯 Queue position #{appointment.queuePosition} · Please wait in the outpatient lounge.
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHeader title="Request an appointment" subtitle="Requests are placed as routine visits and confirmed at the front desk." />
          <div className="space-y-3">
            <Field label="Clinician">
              <Select
                value={draft.doctorId}
                onChange={(value) => setDraft({ ...draft, doctorId: value })}
                options={derived.doctors.map((doctor) => ({
                  value: doctor.id,
                  label: `${doctor.fullName} · ${doctor.department}`,
                }))}
              />
            </Field>
            <Field label="Preferred date and time">
              <input
                type="datetime-local"
                className="sm-input"
                value={draft.when}
                onChange={(event) => setDraft({ ...draft, when: event.target.value })}
              />
            </Field>
            <Field label="Reason for the visit">
              <TextInput
                value={draft.reason}
                onChange={(value) => setDraft({ ...draft, reason: value })}
                placeholder="e.g. Discuss my latest blood test"
              />
            </Field>
            <Button
              variant="primary"
              fullWidth
              disabled={!draft.reason.trim()}
              onClick={() => {
                const appointment = actions.scheduleAppointment({
                  patientId: patient.id,
                  doctorId: draft.doctorId,
                  scheduledFor: new Date(draft.when).toISOString(),
                  reason: draft.reason,
                  acuity: "routine",
                  triageNotes: "Requested by the patient through the portal.",
                });
                setBooked(appointment.id);
                setDraft({ ...draft, reason: "" });
              }}
            >
              <Icon name="calendar" size={14} />
              Request appointment
            </Button>
            {booked ? (
              <p className="text-[11px] text-risk-normal">
                Request submitted. The front desk will confirm your slot.
              </p>
            ) : null}
          </div>
        </Panel>
      </div>

      <Panel>
        <PanelHeader title="Visit history" subtitle="Past consultations." icon={<Icon name="queue" size={18} />} />
        {past.length === 0 ? (
          <EmptyState title="No past visits" description="Completed appointments are archived here." />
        ) : (
          <ul className="space-y-2">
            {past.map((appointment) => {
              const doctor = derived.staffById.get(appointment.doctorId);
              return (
                <li key={appointment.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rule bg-paper p-3">
                  <span className="min-w-0">
                    <span className="block text-xs text-ink-900">{appointment.reason}</span>
                    <span className="block text-[11px] text-ink-400">
                      {formatDateTime(appointment.scheduledFor)} · {doctor?.fullName ?? "—"}
                    </span>
                  </span>
                  <Chip token={APPOINTMENT_STATUS_TOKENS[appointment.status]} />
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <p className="rounded-lg border border-risk-moderate/50 bg-risk-moderate/[0.08] p-3 text-[11px] leading-relaxed text-risk-moderate">
        {MEDICAL_DISCLAIMER}
      </p>

      <PatientQueryModal
        isOpen={isQueryModalOpen}
        onClose={() => setIsQueryModalOpen(false)}
        patientId={patient.id}
        defaultSubject={inquirySubject}
      />
    </div>
  );
}

/* ================================================================== */

export default function PatientPortal() {
  const { state } = useApp();

  switch (state.activeView) {
    case "patient.trends":
      return <HealthTrends />;
    case "patient.appointments":
      return <MyAppointments />;
    case "patient.reports":
    default:
      return <MyReports />;
  }
}
