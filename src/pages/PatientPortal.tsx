/**
 * Patient portal.
 *
 * Three modules: the report simplifier, longitudinal health trends, and
 * appointments. Everything here is deliberately non-diagnostic — the trend view
 * shows direction of travel and where a value sits against its reference range,
 * and always defers interpretation to the treating physician.
 */

import { useMemo, useState } from "react";
import { useApp } from "@/store/AppStore";
import { BIOMARKER_CATEGORY_LABELS, MEDICAL_DISCLAIMER, describeTrend, isOutOfRange } from "@/engine/reportEngine";
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
  StatTile,
  TextInput,
} from "@/ui/primitives";
import Icon from "@/ui/Icon";
import { ageFromDob, cx, formatDate, formatDateTime, formatNumber } from "@/utils/format";

/* ================================================================== */
/* Identity header                                                     */
/* ================================================================== */

function PatientHeader() {
  const { state, derived } = useApp();
  const patient = derived.patientsById.get(state.session.patientId);
  if (!patient) return null;

  const trends = derived.trendsFor(patient.id);
  const reports = derived.reportsFor(patient.id);
  const outOfRange = trends.filter((trend) => isOutOfRange(trend.status));

  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-ink-900">{patient.name}</h2>
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
        <div className="rounded-lg border border-rule bg-paper p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">Conditions on record</p>
          <ul className="mt-2 space-y-1">
            {patient.chronicConditions.length === 0 ? (
              <li className="text-xs text-ink-500">None recorded.</li>
            ) : (
              patient.chronicConditions.map((condition) => (
                <li key={condition} className="text-xs text-ink-700">
                  {condition}
                </li>
              ))
            )}
          </ul>
        </div>
        <div className="rounded-lg border border-rule bg-paper p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
            Values worth discussing
          </p>
          {outOfRange.length === 0 ? (
            <p className="mt-2 text-xs text-risk-normal">
              Every recognised value currently sits inside its reference range.
            </p>
          ) : (
            <ul className="mt-2 space-y-1">
              {outOfRange.slice(0, 4).map((trend) => (
                <li key={trend.normalizedKey} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-ink-700">{trend.testName}</span>
                  <span className="shrink-0 tabular-nums text-ink-900">
                    {formatNumber(trend.latest, trend.latest % 1 === 0 ? 0 : 1)} {trend.unit}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-lg border border-rule bg-paper p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">Emergency contact</p>
          <p className="mt-2 text-xs text-ink-700">{patient.emergencyContact.name}</p>
          <p className="text-[11px] text-ink-400">
            {patient.emergencyContact.relation} · {patient.emergencyContact.contact}
          </p>
          <p className="mt-2 text-[11px] text-ink-400">{patient.contact}</p>
        </div>
      </div>
    </Panel>
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
      <PatientHeader />

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
  const improving = repeated.filter(
    (trend) =>
      (trend.referenceRange.min > 0 && trend.latest <= trend.referenceRange.max && trend.direction === "falling") ||
      (trend.latest >= trend.referenceRange.min && trend.latest <= trend.referenceRange.max),
  );

  if (!patient) {
    return (
      <Panel>
        <EmptyState title="No patient profile linked" description="Trends appear once a report is on file." />
      </Panel>
    );
  }

  return (
    <div className="space-y-6">
      <PatientHeader />

      {allTrends.length === 0 ? (
        <Panel>
          <EmptyState
            title="No results to chart yet"
            description="Upload a laboratory report from the My reports section to start building your trend history."
          />
        </Panel>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <StatTile label="Biomarkers tracked" value={allTrends.length} />
            <StatTile label="With repeat readings" value={repeated.length} tone="accent" />
            <StatTile
              label="Currently in range"
              value={allTrends.filter((trend) => !isOutOfRange(trend.status)).length}
              tone="success"
            />
            <StatTile
              label="Outside range"
              value={allTrends.filter((trend) => isOutOfRange(trend.status)).length}
              tone={allTrends.some((trend) => isOutOfRange(trend.status)) ? "warning" : "success"}
              hint="Common and always read with your history"
            />
          </div>

          <Panel>
            <PanelHeader
              title="What your numbers are doing"
              subtitle="Direction of travel only. A rising or falling value is not a diagnosis."
              icon={<Icon name="trends" size={18} />}
              actions={
                <div className="w-52">
                  <Select
                    value={category}
                    onChange={setCategory}
                    options={[
                      { value: "all", label: "All categories" },
                      ...categories.map((item) => ({
                        value: item,
                        label: BIOMARKER_CATEGORY_LABELS[item] ?? item,
                      })),
                    ]}
                  />
                </div>
              }
            />

            <ul className="space-y-2">
              {trends.map((trend) => {
                const token = BIOMARKER_STATUS_TOKENS[trend.status];
                const inRange = !isOutOfRange(trend.status);
                return (
                  <li key={trend.normalizedKey} className="rounded-lg border border-rule bg-paper p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ background: token.hex }} />
                        <span className="text-xs font-semibold text-ink-900">{trend.testName}</span>
                        <Chip token={token} />
                      </span>
                      <span className="flex items-center gap-3 text-xs">
                        {trend.history.length >= 2 ? (
                          <span
                            className={cx(
                              "inline-flex items-center gap-1",
                              trend.direction === "stable"
                                ? "text-ink-500"
                                : trend.direction === "rising"
                                  ? "text-risk-high"
                                  : "text-accent",
                            )}
                          >
                            <Icon
                              name="trends"
                              size={13}
                              className={trend.direction === "falling" ? "-scale-y-100" : undefined}
                            />
                            {trend.direction}
                          </span>
                        ) : (
                          <span className="text-ink-400">first reading</span>
                        )}
                        <span className="font-semibold tabular-nums text-ink-900">
                          {formatNumber(trend.latest, trend.latest % 1 === 0 ? 0 : 2)}
                          <span className="ml-1 text-[10px] font-normal text-ink-500">{trend.unit}</span>
                        </span>
                      </span>
                    </div>

                    <LineChart
                      height={140}
                      series={[
                        {
                          key: trend.normalizedKey,
                          label: trend.testName,
                          color: inRange ? CHART_PALETTE[2] : token.hex,
                          area: true,
                          points: trend.history.map((point) => ({ label: formatDate(point.date), value: point.value })),
                        },
                      ]}
                      band={{
                        min: trend.referenceRange.min,
                        max: trend.referenceRange.max,
                      }}
                      valueFormat={(value) => formatNumber(value, 1)}
                      emptyMessage="A single reading needs a second test before a trend can be drawn."
                      ariaLabel={`${trend.testName} trend`}
                    />
                    <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
                      Reference range {trend.referenceRange.text}. {describeTrend(trend)}
                    </p>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel>
            <PanelHeader title="Your care summary" subtitle="A snapshot to take to your next appointment." icon={<Icon name="report" size={18} />} />
            <KeyValue
              items={[
                { label: "Trends improving or stable", value: String(improving.length) },
                {
                  label: "Values outside range",
                  value: String(allTrends.filter((trend) => isOutOfRange(trend.status)).length),
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
    </div>
  );
}

/* ================================================================== */
/* 3. Appointments                                                     */
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
      <PatientHeader />

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
            <ul className="space-y-2">
              {upcoming.map((appointment) => {
                const doctor = derived.staffById.get(appointment.doctorId);
                return (
                  <li key={appointment.id} className="rounded-lg border border-rule bg-paper p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-ink-900">{appointment.reason}</p>
                      <Chip token={APPOINTMENT_STATUS_TOKENS[appointment.status]} />
                    </div>
                    <p className="mt-1 text-[11px] text-ink-500">
                      {formatDateTime(appointment.scheduledFor)} · {doctor?.fullName ?? "—"} ·{" "}
                      {appointment.department}
                    </p>
                    {appointment.triageNotes ? (
                      <p className="mt-1 text-[11px] text-ink-400">{appointment.triageNotes}</p>
                    ) : null}
                    {appointment.queuePosition !== null ? (
                      <p className="mt-1 text-[11px] text-accent">
                        Queue position {appointment.queuePosition} · please wait in the outpatient lounge.
                      </p>
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
        <PanelHeader title="Prescribed medication" subtitle="Courses charted by your treating clinician." icon={<Icon name="prescribe" size={18} />} />
        {treatments.length === 0 ? (
          <EmptyState title="No prescriptions on record" description="Prescribed medication appears here after a consultation." />
        ) : (
          <ul className="space-y-3">
            {treatments.map((treatment) => {
              const doctor = derived.staffById.get(treatment.doctorId);
              return (
                <li key={treatment.id} className="rounded-lg border border-rule bg-paper p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-ink-900">{treatment.diagnosis}</p>
                    <span className="text-[11px] text-ink-400">
                      {formatDate(treatment.createdAt)} · {doctor?.fullName ?? "—"}
                    </span>
                  </div>
                  <ul className="mt-2 space-y-1.5">
                    {treatment.prescriptions.map((line) => (
                      <li key={line.id} className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                        <span className="text-ink-700">
                          {line.drugName} · {line.dosage} · {line.frequency.replace(/_/g, " ")}
                        </span>
                        <span className="text-ink-400">
                          {line.quantity} {line.durationDays} day course
                          {line.substituteFor ? " · substituted for safety" : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {treatment.prescriptions.some((line) => line.stockAdvisory) ? (
                    <p className="mt-2 text-[10px] leading-relaxed text-ink-400">
                      {treatment.prescriptions.find((line) => line.stockAdvisory)?.stockAdvisory}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

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
