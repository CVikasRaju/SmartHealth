/**
 * Nurse portal.
 *
 * Three modules: the bedside eMAR round, the vitals and notes sheet, and
 * ward-level stock visibility. The round is the one that matters clinically —
 * a dose is only marked given with a pre-administration observation attached,
 * which is why the vitals form and the administration outcome are captured in
 * the same action.
 */

import { useMemo, useState } from "react";
import type { AdministrationStatus, MedicationAdministration, VitalsRecord, WardId } from "@/types";
import { ALL_WARDS, WARD_LABELS } from "@/types";
import { useApp } from "@/store/AppStore";
import { ADMINISTRATION_STATUS_TOKENS, RISK_TOKENS, SEVERITY_TOKENS } from "@/ui/theme";
import { formatDays, WARD_AT_RISK_DAYS } from "@/engine/shortageEngine";
import {
  Button,
  Chip,
  DataTable,
  EmptyState,
  Field,
  Modal,
  Panel,
  PanelHeader,
  ProgressBar,
  Select,
  StatTile,
  TextArea,
  TextInput,
} from "@/ui/primitives";
import Sparkline from "@/charts/Sparkline";
import Icon from "@/ui/Icon";
import { ageFromDob, cx, formatDateTime, formatNumber, formatTime } from "@/utils/format";

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

/** Default ward for the acting nurse: their inpatient's ward, else the ICU. */
function useDefaultWard(): [WardId, (ward: WardId) => void] {
  const { state, derived } = useApp();
  const patient = derived.patientsById.get(state.session.patientId);
  const initial = patient?.currentAdmission.isAdmitted ? (patient.currentAdmission.ward ?? "ICU") : "ICU";
  return useState<WardId>(initial);
}

const EMPTY_VITALS = {
  temperatureC: 37,
  heartRateBpm: 80,
  systolic: 120,
  diastolic: 78,
  respiratoryRate: 18,
  spo2: 97,
  painScore: 0,
  notes: "",
};

function isOverdue(record: MedicationAdministration): boolean {
  return (
    new Date(record.scheduledFor).getTime() < Date.now() &&
    record.status !== "given" &&
    record.status !== "refused"
  );
}

/* ------------------------------------------------------------------ */
/* 1. eMAR round                                                       */
/* ------------------------------------------------------------------ */

function EmarRound() {
  const { derived, actions } = useApp();
  const [ward, setWard] = useDefaultWard();
  const [target, setTarget] = useState<MedicationAdministration | null>(null);

  const [outcome, setOutcome] = useState<AdministrationStatus>("given");
  const [site, setSite] = useState("");
  const [note, setNote] = useState("");
  const [captureVitals, setCaptureVitals] = useState(true);
  const [draft, setDraft] = useState(EMPTY_VITALS);

  const records = derived.emarFor(ward);

  const grouped = useMemo(() => {
    const map = new Map<string, MedicationAdministration[]>();
    for (const record of records) {
      const list = map.get(record.patientId) ?? [];
      list.push(record);
      map.set(record.patientId, list);
    }
    return Array.from(map.entries()).map(([patientId, list]) => ({
      patientId,
      patient: derived.patientsById.get(patientId) ?? null,
      records: list,
    }));
  }, [records, derived.patientsById]);

  const stats = useMemo(
    () => ({
      due: records.length,
      given: records.filter((item) => item.status === "given").length,
      outstanding: records.filter((item) => item.status !== "given" && item.status !== "refused").length,
      variances: records.filter((item) => item.status === "held" || item.status === "refused").length,
      overdue: records.filter(isOverdue).length,
    }),
    [records],
  );

  const openSheet = (record: MedicationAdministration) => {
    setTarget(record);
    setOutcome("given");
    setSite(record.route === "sc" ? "left anterior thigh" : record.route === "im" ? "right deltoid" : "");
    setNote(record.notes);
    setCaptureVitals(true);
    setDraft(EMPTY_VITALS);
  };

  const commit = () => {
    if (!target) return;

    let vitalsId: string | null = null;
    if (captureVitals) {
      const vitals = actions.recordVitals({
        patientId: target.patientId,
        temperatureC: draft.temperatureC,
        heartRateBpm: draft.heartRateBpm,
        systolic: draft.systolic,
        diastolic: draft.diastolic,
        respiratoryRate: draft.respiratoryRate,
        spo2: draft.spo2,
        painScore: draft.painScore,
        notes: draft.notes || "Pre-administration observation.",
      });
      vitalsId = vitals.id;
    }

    actions.administer({
      id: target.id,
      status: outcome,
      vitalsId,
      notes: note,
    });

    setTarget(null);
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile label="Doses charted" value={stats.due} hint="Across the current shift window" />
        <StatTile label="Administered" value={stats.given} tone="success" />
        <StatTile label="Outstanding" value={stats.outstanding} tone={stats.outstanding > 0 ? "warning" : "default"} />
        <StatTile
          label="Variances"
          value={stats.variances}
          tone={stats.variances > 0 ? "danger" : "default"}
          hint="Held or refused"
        />
        <StatTile label="Overdue" value={stats.overdue} tone={stats.overdue > 0 ? "danger" : "success"} />
      </div>

      <Panel>
        <PanelHeader
          title="Medication administration record"
          subtitle="Select a dose to chart the outcome and attach the pre-administration observation."
          icon={<Icon name="emar" size={18} />}
          actions={
            <div className="w-56">
              <Select
                value={ward}
                onChange={setWard}
                options={ALL_WARDS.filter((item) => item !== "CENTRAL_STORE").map((item) => ({
                  value: item,
                  label: WARD_LABELS[item],
                }))}
              />
            </div>
          }
        />

        {grouped.length === 0 ? (
          <EmptyState
            title={`No charted medication for ${WARD_LABELS[ward]}`}
            description="Prescriptions written for patients admitted to this ward appear here automatically."
          />
        ) : (
          <div className="space-y-5">
            {grouped.map((group) => (
              <div key={group.patientId}>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-ink-900">{group.patient?.name ?? "Unknown patient"}</h3>
                  <span className="font-mono text-[10px] text-ink-400">{group.patient?.mrn}</span>
                  <span className="sm-chip border-rule-strong bg-paper text-ink-700">
                    {group.patient ? `${ageFromDob(group.patient.dob)}y` : ""} · {group.patient?.currentAdmission.bedNumber}
                  </span>
                  {group.patient &&
                  group.patient.allergies.length > 0 &&
                  group.patient.allergies[0].allergen !== "None recorded" ? (
                    <span className="flex flex-wrap gap-1">
                      {group.patient.allergies.map((allergy) => (
                        <Chip key={allergy.allergen} token={SEVERITY_TOKENS[allergy.severity]}>
                          {allergy.allergen}
                        </Chip>
                      ))}
                    </span>
                  ) : null}
                </div>

                <DataTable head={["Scheduled", "Medication", "Dose", "Route", "Status", "Charted by", "Action"]}>
                  {group.records.map((record) => {
                    const token = ADMINISTRATION_STATUS_TOKENS[record.status];
                    const overdue = isOverdue(record);
                    return (
                      <tr key={record.id} className={overdue ? "bg-risk-critical/[0.05]" : undefined}>
                        <td className="sm-td whitespace-nowrap text-ink-700">
                          {formatTime(record.scheduledFor)}
                          {overdue ? <span className="ml-2 text-[10px] font-semibold text-risk-critical">OVERDUE</span> : null}
                        </td>
                        <td className="sm-td font-medium text-ink-900">{record.drugName}</td>
                        <td className="sm-td text-ink-500">{record.dose}</td>
                        <td className="sm-td uppercase text-ink-500">{record.route}</td>
                        <td className="sm-td">
                          <Chip token={token} />
                        </td>
                        <td className="sm-td text-ink-500">
                          {record.administeredBy ?? "—"}
                          {record.notes ? (
                            <span className="mt-0.5 block max-w-[16rem] truncate text-[10px] text-ink-400">
                              {record.notes}
                            </span>
                          ) : null}
                        </td>
                        <td className="sm-td">
                          <Button size="sm" variant={overdue ? "primary" : "secondary"} onClick={() => openSheet(record)}>
                            Chart
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </DataTable>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Modal
        open={target !== null}
        onClose={() => setTarget(null)}
        title="Chart administration"
        subtitle={
          target
            ? `${target.drugName} ${target.dose} · ${target.route.toUpperCase()} · scheduled ${formatDateTime(target.scheduledFor)}`
            : undefined
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={commit}>
              <Icon name="check" size={14} />
              Save to eMAR
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Outcome">
              <Select
                value={outcome}
                onChange={setOutcome}
                options={(Object.keys(ADMINISTRATION_STATUS_TOKENS) as AdministrationStatus[]).map((key) => ({
                  value: key,
                  label: ADMINISTRATION_STATUS_TOKENS[key].label,
                }))}
              />
            </Field>
            <Field label="Administration site" hint="Recorded for injections and subcutaneous doses.">
              <TextInput value={site} onChange={setSite} placeholder="e.g. right deltoid" />
            </Field>
          </div>

          <Field label="Bedside note">
            <TextArea
              value={note}
              onChange={setNote}
              rows={2}
              placeholder="Reason for holding, patient response, or a note for the next shift."
            />
          </Field>

          <div className="rounded-lg border border-rule bg-paper p-3">
            <label className="flex items-center gap-2.5">
              <input
                type="checkbox"
                checked={captureVitals}
                onChange={(event) => setCaptureVitals(event.target.checked)}
                className="h-4 w-4 rounded border-rule-strong bg-surface accent-accent"
              />
              <span className="text-xs font-medium text-ink-900">
                Capture a pre-administration observation with this dose
              </span>
            </label>

            {captureVitals ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-4">
                <Field label="Temp (°C)">
                  <TextInput
                    type="number"
                    step={0.1}
                    value={draft.temperatureC}
                    onChange={(value) => setDraft({ ...draft, temperatureC: Number(value) })}
                  />
                </Field>
                <Field label="Heart rate">
                  <TextInput
                    type="number"
                    value={draft.heartRateBpm}
                    onChange={(value) => setDraft({ ...draft, heartRateBpm: Number(value) })}
                  />
                </Field>
                <Field label="Systolic">
                  <TextInput
                    type="number"
                    value={draft.systolic}
                    onChange={(value) => setDraft({ ...draft, systolic: Number(value) })}
                  />
                </Field>
                <Field label="Diastolic">
                  <TextInput
                    type="number"
                    value={draft.diastolic}
                    onChange={(value) => setDraft({ ...draft, diastolic: Number(value) })}
                  />
                </Field>
                <Field label="Resp. rate">
                  <TextInput
                    type="number"
                    value={draft.respiratoryRate}
                    onChange={(value) => setDraft({ ...draft, respiratoryRate: Number(value) })}
                  />
                </Field>
                <Field label="SpO₂ (%)">
                  <TextInput
                    type="number"
                    value={draft.spo2}
                    onChange={(value) => setDraft({ ...draft, spo2: Number(value) })}
                  />
                </Field>
                <Field label="Pain score (0-10)">
                  <TextInput
                    type="number"
                    min={0}
                    max={10}
                    value={draft.painScore}
                    onChange={(value) => setDraft({ ...draft, painScore: Number(value) })}
                  />
                </Field>
                <Field label="Observation note">
                  <TextInput
                    value={draft.notes}
                    onChange={(value) => setDraft({ ...draft, notes: value })}
                    placeholder="Optional"
                  />
                </Field>
              </div>
            ) : null}
          </div>

          <p className="text-[11px] leading-relaxed text-ink-400">
            Recording a dose appends an immutable eMAR entry with the acting nurse, the timestamp and any attached
            observation. The audit ledger cannot be edited from any portal.
          </p>
        </div>
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 2. Vitals & notes                                                   */
/* ------------------------------------------------------------------ */

function VitalsSheet() {
  const { state, derived, actions } = useApp();
  const patient = derived.patientsById.get(state.session.patientId) ?? null;
  const [draft, setDraft] = useState(EMPTY_VITALS);
  const [saved, setSaved] = useState<string | null>(null);

  const history = useMemo(
    () =>
      state.db.vitals
        .filter((record) => record.patientId === patient?.id)
        .slice()
        .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()),
    [state.db.vitals, patient?.id],
  );

  const save = () => {
    if (!patient) return;
    const record: VitalsRecord = actions.recordVitals({
      patientId: patient.id,
      ...draft,
      notes: draft.notes || "Routine observation round.",
    });
    setSaved(record.id);
    setDraft(EMPTY_VITALS);
  };

  if (!patient) {
    return (
      <Panel>
        <EmptyState title="No patient selected" description="Choose a patient from the top bar to record observations." />
      </Panel>
    );
  }

  const latest = history[history.length - 1];

  return (
    <div className="space-y-6">
      <Panel>
        <PanelHeader
          title={`${patient.name} · ${patient.mrn}`}
          subtitle={
            patient.currentAdmission.isAdmitted
              ? `Admitted to ${WARD_LABELS[patient.currentAdmission.ward ?? "GENERAL_A"]} bed ${patient.currentAdmission.bedNumber}`
              : "Outpatient"
          }
          icon={<Icon name="vitals" size={18} />}
          actions={
            <span className="text-[11px] text-ink-500">
              {history.length} recorded observation{history.length === 1 ? "" : "s"}
            </span>
          }
        />

        <div className="grid gap-3 sm:grid-cols-4">
          <StatTile
            label="Latest temperature"
            value={latest ? `${latest.temperatureC}°C` : "—"}
            tone={latest && latest.temperatureC >= 37.8 ? "warning" : "default"}
          />
          <StatTile
            label="Latest blood pressure"
            value={latest ? `${latest.systolic}/${latest.diastolic}` : "—"}
            tone={latest && latest.systolic >= 160 ? "danger" : "default"}
            hint="mmHg"
          />
          <StatTile
            label="Latest SpO₂"
            value={latest ? `${latest.spo2}%` : "—"}
            tone={latest && latest.spo2 < 93 ? "warning" : "success"}
          />
          <StatTile label="Heart rate" value={latest ? `${latest.heartRateBpm} bpm` : "—"} />
        </div>

        {history.length >= 2 ? (
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <div className="rounded-lg border border-rule bg-paper p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                Heart rate and temperature
              </p>
              <div className="mt-2 space-y-2">
                <Sparkline
                  values={history.map((record) => record.heartRateBpm)}
                  stroke="#a4232b"
                  height={36}
                  className="w-full"
                  ariaLabel="Heart rate trend"
                />
                <Sparkline
                  values={history.map((record) => record.temperatureC)}
                  stroke="#a1590f"
                  height={36}
                  className="w-full"
                  ariaLabel="Temperature trend"
                />
              </div>
              <p className="mt-2 text-[10px] text-ink-400">Crimson: heart rate · ochre: temperature</p>
            </div>

            <div className="rounded-lg border border-rule bg-paper p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                Oxygen saturation
              </p>
              <Sparkline
                values={history.map((record) => record.spo2)}
                stroke="#14416b"
                height={36}
                className="mt-2 w-full"
                ariaLabel="Oxygen saturation trend"
              />
              <p className="mt-2 text-[10px] text-ink-400">
                Target range for this patient is above 93% on room air or with the prescribed oxygen therapy.
              </p>
            </div>
          </div>
        ) : null}
      </Panel>

      <Panel>
        <PanelHeader
          title="Record an observation"
          subtitle="Observations are timestamped with the acting nurse and appended to the patient record."
          icon={<Icon name="plus" size={18} />}
        />
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Temperature (°C)">
            <TextInput
              type="number"
              step={0.1}
              value={draft.temperatureC}
              onChange={(value) => setDraft({ ...draft, temperatureC: Number(value) })}
            />
          </Field>
          <Field label="Heart rate (bpm)">
            <TextInput
              type="number"
              value={draft.heartRateBpm}
              onChange={(value) => setDraft({ ...draft, heartRateBpm: Number(value) })}
            />
          </Field>
          <Field label="Systolic (mmHg)">
            <TextInput
              type="number"
              value={draft.systolic}
              onChange={(value) => setDraft({ ...draft, systolic: Number(value) })}
            />
          </Field>
          <Field label="Diastolic (mmHg)">
            <TextInput
              type="number"
              value={draft.diastolic}
              onChange={(value) => setDraft({ ...draft, diastolic: Number(value) })}
            />
          </Field>
          <Field label="Respiratory rate">
            <TextInput
              type="number"
              value={draft.respiratoryRate}
              onChange={(value) => setDraft({ ...draft, respiratoryRate: Number(value) })}
            />
          </Field>
          <Field label="SpO₂ (%)">
            <TextInput
              type="number"
              value={draft.spo2}
              onChange={(value) => setDraft({ ...draft, spo2: Number(value) })}
            />
          </Field>
          <Field label="Pain score (0-10)">
            <TextInput
              type="number"
              min={0}
              max={10}
              value={draft.painScore}
              onChange={(value) => setDraft({ ...draft, painScore: Number(value) })}
            />
          </Field>
          <Field label="Shift note">
            <TextInput
              value={draft.notes}
              onChange={(value) => setDraft({ ...draft, notes: value })}
              placeholder="e.g. settled after nebulisation"
            />
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] text-ink-400">
            Blood pressure and oxygen saturation outside the expected band are surfaced to the treating physician in the
            audit trail.
          </p>
          <div className="flex items-center gap-3">
            {saved ? <span className="text-[11px] text-risk-normal">Observation saved as {saved}.</span> : null}
            <Button variant="primary" onClick={save}>
              <Icon name="check" size={14} />
              Save observation
            </Button>
          </div>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Observation history" subtitle="Newest first." icon={<Icon name="analytics" size={18} />} />
        {history.length === 0 ? (
          <EmptyState title="No observations recorded" description="Record the first bedside observation above." />
        ) : (
          <DataTable head={["Recorded", "Temp", "HR", "BP", "RR", "SpO₂", "Pain", "Note"]}>
            {history
              .slice()
              .reverse()
              .map((record) => (
                <tr key={record.id}>
                  <td className="sm-td whitespace-nowrap text-ink-500">{formatDateTime(record.recordedAt)}</td>
                  <td className={cx("sm-td tabular-nums", record.temperatureC >= 37.8 ? "text-risk-high" : "")}>
                    {record.temperatureC}°
                  </td>
                  <td className="sm-td tabular-nums">{record.heartRateBpm}</td>
                  <td className={cx("sm-td tabular-nums", record.systolic >= 160 ? "text-risk-critical" : "")}>
                    {record.systolic}/{record.diastolic}
                  </td>
                  <td className="sm-td tabular-nums">{record.respiratoryRate}</td>
                  <td className={cx("sm-td tabular-nums", record.spo2 < 93 ? "text-risk-high" : "")}>
                    {record.spo2}%
                  </td>
                  <td className="sm-td tabular-nums">{record.painScore}</td>
                  <td className="sm-td max-w-[20rem] text-ink-500">{record.notes}</td>
                </tr>
              ))}
          </DataTable>
        )}
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 3. Ward stock                                                       */
/* ------------------------------------------------------------------ */

function WardStockView() {
  const { derived, state } = useApp();
  const [ward, setWard] = useDefaultWard();

  const rows = useMemo(
    () =>
      state.db.medicines
        .map((medicine) => {
          const holding = medicine.wardStock.find((item) => item.ward === ward);
          if (!holding) return null;
          const assessment = derived.assessmentById.get(medicine.id);
          const coverage = assessment?.coverageByWard.find((item) => item.ward === ward);
          return { medicine, holding, assessment, coverage };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null)
        .sort((a, b) => (a.coverage?.coverDays ?? 99) - (b.coverage?.coverDays ?? 99)),
    [state.db.medicines, ward, derived.assessmentById],
  );

  const atRisk = rows.filter((row) => row.coverage?.atRisk);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Molecules held" value={rows.length} hint={WARD_LABELS[ward]} />
        <StatTile label="Below 3 days cover" value={atRisk.length} tone={atRisk.length > 0 ? "danger" : "success"} />
        <StatTile
          label="Stranded above par"
          value={rows.reduce((sum, row) => sum + Math.max(0, row.holding.quantity - row.holding.parLevel), 0)}
          hint="Releasable by an inter-ward transfer"
        />
      </div>

      <Panel>
        <PanelHeader
          title="Ward holdings"
          subtitle={`On-hand quantity against this ward's own par level, with the ward's share of expected demand apportioned by par.`}
          icon={<Icon name="stock" size={18} />}
          actions={
            <div className="w-56">
              <Select
                value={ward}
                onChange={setWard}
                options={ALL_WARDS.map((item) => ({ value: item, label: WARD_LABELS[item] }))}
              />
            </div>
          }
        />

        {rows.length === 0 ? (
          <EmptyState title={`No stock held at ${WARD_LABELS[ward]}`} description="Pick another ward to inspect its holdings." />
        ) : (
          <DataTable head={["Molecule", "On hand", "Par level", "Expected draw", "Cover", "Facility SPS", "Status"]}>
            {rows.map((row) => {
              const token = row.assessment ? RISK_TOKENS[row.assessment.tier] : RISK_TOKENS.normal;
              const belowPar = row.holding.quantity < row.holding.parLevel;
              return (
                <tr key={row.medicine.id}>
                  <td className="sm-td">
                    <span className="font-medium text-ink-900">{row.medicine.brandName}</span>
                    <span className="ml-2 text-[10px] text-ink-400">{row.medicine.genericName}</span>
                  </td>
                  <td className={cx("sm-td tabular-nums", belowPar ? "text-risk-high" : "text-ink-900")}>
                    {row.holding.quantity} {row.medicine.unit}
                  </td>
                  <td className="sm-td tabular-nums text-ink-500">{row.holding.parLevel}</td>
                  <td className="sm-td tabular-nums text-ink-500">
                    {row.coverage ? formatNumber(row.coverage.expectedDailyDemand, 2) : "—"}
                  </td>
                  <td className="sm-td">
                    <div className="flex items-center gap-2">
                      <span
                        className={cx(
                          "w-12 shrink-0 text-xs font-semibold tabular-nums",
                          row.coverage?.atRisk ? "text-risk-critical" : "text-ink-900",
                        )}
                      >
                        {formatDays(row.coverage?.coverDays ?? 0)}d
                      </span>
                      <ProgressBar
                        value={Math.min(row.coverage?.coverDays ?? 0, WARD_AT_RISK_DAYS * 2)}
                        max={WARD_AT_RISK_DAYS * 2}
                        color={row.coverage?.atRisk ? RISK_TOKENS.critical.hex : RISK_TOKENS.normal.hex}
                        height={4}
                        className="w-20"
                      />
                    </div>
                  </td>
                  <td className="sm-td tabular-nums" style={{ color: token.hex }}>
                    {row.assessment?.sps ?? "—"}
                  </td>
                  <td className="sm-td">
                    {belowPar ? (
                      <span className="sm-chip border-risk-high/45 bg-risk-high/[0.12] text-risk-high">Below par</span>
                    ) : row.holding.quantity > row.holding.parLevel ? (
                      <span className="sm-chip border-accent/45 bg-accent-soft text-accent">
                        +{row.holding.quantity - row.holding.parLevel} above par
                      </span>
                    ) : (
                      <span className="sm-chip border-risk-normal/45 bg-risk-normal/[0.08] text-risk-normal">At par</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}

        <p className="mt-4 text-[11px] leading-relaxed text-ink-400">
          Ward par levels are the quantity this ward wants on hand before a transfer makes sense. Stock held above par is
          counted as stranded by the shortage engine and cannot serve another ward without an inter-ward transfer, which
          is proposed and approved from the admin control room.
        </p>
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export default function NursePortal() {
  const { state } = useApp();

  switch (state.activeView) {
    case "nurse.vitals":
      return <VitalsSheet />;
    case "nurse.stock":
      return <WardStockView />;
    case "nurse.emar":
    default:
      return <EmarRound />;
  }
}
