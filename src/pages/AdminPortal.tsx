/**
 * Admin portal.
 *
 * Four modules behind one component: the live shortage control room, the
 * scenario sandbox, hospital analytics, and governance. Routing happens on
 * `state.activeView` so the shell's navigation rail stays the single source of
 * truth for what the admin can reach.
 */

import { useMemo, useState } from "react";
import type { RiskTier } from "@/types";
import { WARD_LABELS } from "@/types";
import { useApp } from "@/store/AppStore";
import { simulateScenario } from "@/engine/shortageEngine";
import { PENALTY_PRESETS } from "@/data/scenarios";
import MedicineRiskCard from "@/components/MedicineRiskCard";
import GaugeArc from "@/charts/GaugeArc";
import { BarSeries, Donut } from "@/charts/BarSeries";
import Sparkline from "@/charts/Sparkline";
import { CHART_PALETTE, RISK_TOKENS, APPOINTMENT_STATUS_TOKENS, PAYMENT_STATUS_TOKENS } from "@/ui/theme";
import {
  Button,
  Chip,
  DataTable,
  EmptyState,
  Field,
  KeyValue,
  Panel,
  PanelHeader,
  Select,
  StatTile,
  Tabs,
  TextInput,
} from "@/ui/primitives";
import Icon from "@/ui/Icon";
import { cx, formatCurrency, formatDate, formatDateTime, percent } from "@/utils/format";
import { formatDays } from "@/engine/shortageEngine";

/* ================================================================== */
/* 1. Shortage control room                                            */
/* ================================================================== */

const TIER_FILTERS: { id: RiskTier | "all"; label: string }[] = [
  { id: "all", label: "All molecules" },
  { id: "critical", label: "Critical" },
  { id: "high", label: "High" },
  { id: "moderate", label: "Moderate" },
  { id: "normal", label: "Normal" },
];

function ControlRoom() {
  const { derived, actions } = useApp();
  const [tier, setTier] = useState<RiskTier | "all">("all");
  const [query, setQuery] = useState("");
  const [decidingId, setDecidingId] = useState<string | null>(null);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return derived.assessments.filter((assessment) => {
      if (tier !== "all" && assessment.tier !== tier) return false;
      if (!needle) return true;
      return (
        assessment.brandName.toLowerCase().includes(needle) ||
        assessment.genericName.toLowerCase().includes(needle) ||
        assessment.sku.toLowerCase().includes(needle)
      );
    });
  }, [derived.assessments, tier, query]);

  const { portfolio } = derived;
  const totalStranded = derived.assessments.reduce((sum, item) => sum + item.strandedUnits, 0);
  const potentialDrop = derived.proposals.reduce((sum, item) => sum + item.estimatedSpsDrop, 0);

  return (
    <div className="space-y-6">
      {/* Headline board. */}
      <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
        <Panel className="flex flex-col items-center justify-center gap-3 lg:w-64">
          <GaugeArc
            value={portfolio.peakScore}
            label="Peak SPS"
            color={RISK_TOKENS[portfolio.peakScore >= 85 ? "critical" : portfolio.peakScore >= 60 ? "high" : "moderate"].hex}
            thresholds={[
              { at: 30, label: "moderate" },
              { at: 60, label: "high" },
              { at: 85, label: "critical" },
            ]}
            size={190}
          />
          <p className="text-center text-[11px] leading-relaxed text-slate-400">
            Mean score across the {portfolio.total}-molecule formulary is{" "}
            <span className="font-semibold text-slate-200">{portfolio.meanScore}</span>.
          </p>
        </Panel>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Critical molecules"
            value={portfolio.critical}
            tone={portfolio.critical > 0 ? "danger" : "success"}
            hint="Score at or above 85"
            footer={
              <div className="flex flex-wrap gap-1">
                {derived.assessments
                  .filter((item) => item.tier === "critical")
                  .map((item) => (
                    <span key={item.medicineId} className="text-[10px] text-rose-200">
                      {item.brandName}
                    </span>
                  ))}
              </div>
            }
          />
          <StatTile
            label="High risk"
            value={portfolio.high}
            tone={portfolio.high > 0 ? "warning" : "default"}
            hint="Score 60 to 84"
          />
          <StatTile
            label="Wards under cover"
            value={portfolio.wardsAtRisk}
            tone={portfolio.wardsAtRisk > 0 ? "warning" : "success"}
            hint="Wards below 3 days of their own par demand"
          />
          <StatTile
            label="Stock value at risk"
            value={formatCurrency(portfolio.valueAtRisk, { compact: true })}
            hint="Effective stock in the critical and high bands"
          />
        </div>
      </div>

      {/* Redistribution proposals. */}
      <Panel>
        <PanelHeader
          title="Inter-ward redistribution"
          subtitle="Stock sitting above a ward's own par level cannot serve a ward that is short without a transfer. Approving a proposal releases that stranded stock and re-runs the forecast."
          icon={<Icon name="swap" size={18} />}
          actions={
            <span className="text-[11px] text-slate-400">
              {derived.proposals.length} pending · up to {potentialDrop.toFixed(1)} SPS points recoverable ·{" "}
              {totalStranded.toFixed(0)} units stranded
            </span>
          }
        />

        {derived.proposals.length === 0 ? (
          <EmptyState
            title="No redistribution available"
            description="Either every ward is already at or above par, or the shortfall is facility-wide and only a purchase order can close it."
          />
        ) : (
          <ul className="space-y-2">
            {derived.proposals.slice(0, 6).map((proposal) => (
              <li
                key={proposal.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-white/[0.02] p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-xs font-semibold text-white">
                    {proposal.drugName}
                    <span className="text-[10px] font-normal text-slate-500">
                      {WARD_LABELS[proposal.fromWard]} → {WARD_LABELS[proposal.toWard]}
                    </span>
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{proposal.rationale}</p>
                </div>
                <div className="flex shrink-0 items-center gap-4">
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Move</p>
                    <p className="text-sm font-semibold tabular-nums text-slate-100">{proposal.quantity}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">SPS drop</p>
                    <p className="text-sm font-semibold tabular-nums text-emerald-300">
                      {proposal.estimatedSpsDrop > 0 ? `-${proposal.estimatedSpsDrop}` : "—"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Wards</p>
                    <p className="text-sm font-semibold tabular-nums text-sky-300">
                      {proposal.wardsRecovered > 0 ? `+${proposal.wardsRecovered}` : "—"}
                    </p>
                  </div>
                  {decidingId === proposal.id ? (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="success"
                        onClick={() => {
                          actions.decideTransfer(proposal, "approved");
                          setDecidingId(null);
                        }}
                      >
                        Confirm
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDecidingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Button size="sm" variant="primary" onClick={() => setDecidingId(proposal.id)}>
                        Approve
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => actions.decideTransfer(proposal, "rejected")}>
                        Decline
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* Risk board. */}
      <Panel>
        <PanelHeader
          title="Risk board"
          subtitle="Every molecule scored on the dynamic triangulated metric: EWMA burn rate, lead-time slippage, regional signal and buffer depletion."
          icon={<Icon name="shortage" size={18} />}
          actions={
            <div className="w-48">
              <TextInput value={query} onChange={setQuery} placeholder="Search molecule or SKU" />
            </div>
          }
        />
        <Tabs
          tabs={TIER_FILTERS.map((filter) => ({
            id: filter.id,
            label: filter.label,
            badge:
              filter.id === "all"
                ? derived.assessments.length
                : derived.assessments.filter((item) => item.tier === filter.id).length,
          }))}
          active={tier}
          onChange={setTier}
          className="mb-4 w-fit"
        />

        {rows.length === 0 ? (
          <EmptyState title="No molecules match" description="Clear the search or pick a different risk band." />
        ) : (
          <div className="space-y-3">
            {rows.map((assessment) => {
              const medicine = derived.medicinesById.get(assessment.medicineId);
              if (!medicine) return null;
              return (
                <MedicineRiskCard
                  key={assessment.medicineId}
                  assessment={assessment}
                  medicine={medicine}
                  alternativeLabels={medicine.therapeuticAlternatives
                    .map((id) => derived.medicinesById.get(id)?.genericName)
                    .filter((name): name is string => Boolean(name))}
                  defaultOpen={assessment.tier === "critical"}
                />
              );
            })}
          </div>
        )}
      </Panel>

      {/* Decision ledger. */}
      <Panel>
        <PanelHeader
          title="Redistribution ledger"
          subtitle="Every approved or declined transfer is recorded with its actor and timestamp."
          icon={<Icon name="governance" size={18} />}
        />
        {derived.decisionLedger.length === 0 ? (
          <EmptyState title="No transfers actioned yet" description="Approve a proposal above to start the ledger." />
        ) : (
          <DataTable head={["Molecule", "Route", "Units", "Projected drop", "Decision", "By", "When"]}>
            {derived.decisionLedger.map((entry) => (
              <tr key={entry.id}>
                <td className="sm-td font-medium text-slate-100">{entry.drugName}</td>
                <td className="sm-td text-slate-400">
                  {WARD_LABELS[entry.fromWard]} → {WARD_LABELS[entry.toWard]}
                </td>
                <td className="sm-td tabular-nums">{entry.quantity}</td>
                <td className="sm-td tabular-nums text-emerald-300">-{entry.estimatedSpsDrop}</td>
                <td className="sm-td">
                  <Chip
                    token={
                      entry.status === "approved"
                        ? { label: "Approved", chip: "border-emerald-400/40 bg-emerald-500/10 text-emerald-200", hex: "#34d399", rank: 0 }
                        : { label: "Declined", chip: "border-slate-500/30 bg-slate-500/10 text-slate-400", hex: "#64748b", rank: 1 }
                    }
                  />
                </td>
                <td className="sm-td text-slate-400">{entry.decidedBy ?? "—"}</td>
                <td className="sm-td text-slate-500">{entry.decidedAt ? formatDateTime(entry.decidedAt) : "—"}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
    </div>
  );
}

/* ================================================================== */
/* 2. Scenario sandbox                                                 */
/* ================================================================== */

function ScenarioSandbox() {
  const { state, derived } = useApp();
  const [presetId, setPresetId] = useState(PENALTY_PRESETS[0].id);

  const preset = PENALTY_PRESETS.find((item) => item.id === presetId) ?? PENALTY_PRESETS[0];

  const result = useMemo(
    () =>
      simulateScenario(state.db.medicines, derived.assessments, preset, derived.referenceDate),
    [preset, state.db.medicines, derived.assessments, derived.referenceDate],
  );

  const escalated = result.projections.filter((item) => item.escalated);

  return (
    <div className="space-y-6">
      <Panel>
        <PanelHeader
          title="Disruption sandbox"
          subtitle="Re-runs the full forecast under a hypothetical shock. Live inventory is never modified; the engine clones the formulary, applies the penalties, and reports the delta."
          icon={<Icon name="sandbox" size={18} />}
        />

        <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
          <div className="space-y-3">
            <Field label="Disruption scenario">
              <Select
                value={presetId}
                onChange={setPresetId}
                options={PENALTY_PRESETS.map((item) => ({ value: item.id, label: item.label }))}
              />
            </Field>
            <p className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-[11px] leading-relaxed text-slate-400">
              {preset.description}
            </p>
            <KeyValue
              items={[
                { label: "Demand surge", value: `${preset.demandSurgePct > 0 ? "+" : ""}${preset.demandSurgePct}%` },
                { label: "Lead-time slippage", value: `+${preset.leadTimeSlippageDays} days` },
                { label: "Regional pressure", value: `+${preset.regionalPressureDelta} index` },
                { label: "Stock write-off", value: `${preset.stockWriteOffPct}%` },
              ]}
            />
          </div>

          <div className="space-y-3">
            <div className="rounded-lg border border-accent/25 bg-accent/[0.06] p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-accent/90">Projected outcome</p>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-200">{result.headline}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <StatTile label="Critical" value={result.criticalCount} tone={result.criticalCount > 0 ? "danger" : "success"} />
              <StatTile label="High" value={result.highCount} tone={result.highCount > 0 ? "warning" : "default"} />
              <StatTile label="Band escalations" value={escalated.length} tone={escalated.length > 0 ? "danger" : "success"} />
            </div>
          </div>
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="Before and after"
          subtitle="Baseline forecast against the same formulary under the selected shock, sorted by the worst projected score."
          icon={<Icon name="analytics" size={18} />}
        />
        <DataTable head={["Molecule", "Baseline SPS", "Projected SPS", "Delta", "Cover now", "Cover after", "Band"]}>
          {result.projections.map((projection) => {
            const delta = Number((projection.projectedSps - projection.baselineSps).toFixed(1));
            const token = RISK_TOKENS[projection.projectedTier];
            return (
              <tr key={projection.medicineId} className={projection.escalated ? "bg-rose-500/[0.04]" : undefined}>
                <td className="sm-td font-medium text-slate-100">{projection.drugName}</td>
                <td className="sm-td tabular-nums text-slate-400">{projection.baselineSps}</td>
                <td className="sm-td tabular-nums">
                  <span className="font-semibold" style={{ color: token.hex }}>
                    {projection.projectedSps}
                  </span>
                </td>
                <td className={cx("sm-td tabular-nums", delta > 0 ? "text-rose-300" : "text-slate-500")}>
                  {delta > 0 ? `+${delta}` : delta}
                </td>
                <td className="sm-td tabular-nums text-slate-400">{formatDays(projection.baselineDir)}d</td>
                <td className="sm-td tabular-nums text-slate-200">{formatDays(projection.projectedDir)}d</td>
                <td className="sm-td">
                  <span className="inline-flex items-center gap-1.5">
                    <Chip token={RISK_TOKENS[projection.baselineTier]} />
                    {projection.escalated ? <Icon name="chevronDown" size={12} className="-rotate-90 text-rose-400" /> : null}
                    <Chip token={token} />
                  </span>
                </td>
              </tr>
            );
          })}
        </DataTable>
      </Panel>
    </div>
  );
}

/* ================================================================== */
/* 3. Hospital analytics                                               */
/* ================================================================== */

function HospitalAnalytics() {
  const { state, derived } = useApp();
  const { revenue } = derived;

  const wardAdmissions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const patient of state.db.patients) {
      if (!patient.currentAdmission.isAdmitted) continue;
      const ward = patient.currentAdmission.ward ?? "GENERAL_A";
      counts.set(ward, (counts.get(ward) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([ward, count], index) => ({
      key: ward,
      label: WARD_LABELS[ward as keyof typeof WARD_LABELS] ?? ward,
      value: count,
      color: CHART_PALETTE[index % CHART_PALETTE.length],
    }));
  }, [state.db.patients]);

  const acuityMix = useMemo(() => {
    const counts = new Map<string, number>();
    for (const appointment of state.db.appointments) {
      counts.set(appointment.acuity, (counts.get(appointment.acuity) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([acuity, count], index) => ({
      key: acuity,
      label: acuity.charAt(0).toUpperCase() + acuity.slice(1),
      value: count,
      color: CHART_PALETTE[index % CHART_PALETTE.length],
    }));
  }, [state.db.appointments]);

  const departmentLoad = useMemo(() => {
    const counts = new Map<string, number>();
    for (const appointment of state.db.appointments) {
      counts.set(appointment.department, (counts.get(appointment.department) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([department, count]) => ({
        key: department,
        label: department,
        value: count,
        color: CHART_PALETTE[3],
        hint: `${((count / state.db.appointments.length) * 100).toFixed(0)}% of scheduled activity`,
      }));
  }, [state.db.appointments]);

  const categoryValue = useMemo(() => {
    const totals = new Map<string, number>();
    for (const medicine of state.db.medicines) {
      totals.set(
        medicine.category,
        (totals.get(medicine.category) ?? 0) + medicine.currentStock * medicine.unitPrice,
      );
    }
    return Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([category, value], index) => ({
        key: category,
        label: category.replace(/_/g, " "),
        value,
        color: CHART_PALETTE[index % CHART_PALETTE.length],
      }));
  }, [state.db.medicines]);

  const statusMix = useMemo(
    () =>
      (Object.keys(revenue.byStatus) as (keyof typeof revenue.byStatus)[]).map((status) => ({
        key: status,
        label: PAYMENT_STATUS_TOKENS[status].label,
        value: revenue.byStatus[status],
        color: PAYMENT_STATUS_TOKENS[status].hex,
      })),
    [revenue.byStatus],
  );

  const trendSeries = useMemo(
    () =>
      state.db.invoices
        .slice()
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .map((invoice) => derived.invoiceTotals(invoice).grandTotal),
    [state.db.invoices, derived],
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Billed to date" value={formatCurrency(revenue.billed, { compact: true })} hint={`${revenue.invoices} invoices`} />
        <StatTile label="Collected" value={formatCurrency(revenue.collected, { compact: true })} tone="success" />
        <StatTile label="Outstanding" value={formatCurrency(revenue.outstanding, { compact: true })} tone={revenue.outstanding > 0 ? "warning" : "success"} />
        <StatTile
          label="Collected today"
          value={formatCurrency(revenue.collectedToday, { compact: true })}
          tone="accent"
          hint="Cash, card, UPI and insurance receipts since midnight"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Collections by method" subtitle="Reconciled across every recorded transaction." icon={<Icon name="pos" size={18} />} />
          <BarSeries
            items={revenue.byMethod.map((entry, index) => ({
              key: entry.method,
              label: entry.method.replace(/_/g, " "),
              value: entry.amount,
              color: CHART_PALETTE[index % CHART_PALETTE.length],
              hint: `${entry.count} transaction${entry.count === 1 ? "" : "s"}`,
            }))}
            valueFormat={(value) => formatCurrency(value, { compact: true })}
          />
        </Panel>

        <Panel>
          <PanelHeader title="Settlement status" subtitle={`${revenue.invoices} invoices on file.`} icon={<Icon name="invoice" size={18} />} />
          <Donut segments={statusMix} centerLabel="invoices" centerValue={String(revenue.invoices)} />
        </Panel>

        <Panel>
          <PanelHeader title="Inpatient distribution" subtitle="Admitted patients by ward, excluding day cases." icon={<Icon name="bed" size={18} />} />
          {wardAdmissions.length === 0 ? (
            <EmptyState title="No inpatients" description="Ward occupancy appears here as patients are admitted." />
          ) : (
            <Donut segments={wardAdmissions} centerLabel="admitted" centerValue={String(wardAdmissions.reduce((sum, item) => sum + item.value, 0))} />
          )}
        </Panel>

        <Panel>
          <PanelHeader title="Triage acuity mix" subtitle="How the day's appointments were categorised at the front desk." icon={<Icon name="queue" size={18} />} />
          <BarSeries
            items={acuityMix}
            valueFormat={(value) => `${value} visit${value === 1 ? "" : "s"}`}
          />
        </Panel>

        <Panel>
          <PanelHeader title="Departmental load" subtitle="Scheduled consultations by department." icon={<Icon name="analytics" size={18} />} />
          <BarSeries items={departmentLoad} valueFormat={(value) => String(value)} />
        </Panel>

        <Panel>
          <PanelHeader
            title="Formulary value by category"
            subtitle="Physical stock valued at dispensing price."
            icon={<Icon name="stock" size={18} />}
            actions={
              <div className="w-24">
                <Sparkline values={trendSeries.length >= 2 ? trendSeries : [0, 0]} stroke="#fbbf24" height={28} />
              </div>
            }
          />
          <BarSeries
            items={categoryValue}
            valueFormat={(value) => formatCurrency(value, { compact: true })}
          />
        </Panel>
      </div>

      <Panel>
        <PanelHeader title="Clinical encounter register" subtitle="Latest appointments with their acuity and owning clinician." icon={<Icon name="calendar" size={18} />} />
        <DataTable head={["Patient", "Department", "Scheduled", "Reason", "Acuity", "Status"]}>
          {state.db.appointments
            .slice()
            .sort((a, b) => new Date(b.scheduledFor).getTime() - new Date(a.scheduledFor).getTime())
            .slice(0, 8)
            .map((appointment) => {
              const patient = derived.patientsById.get(appointment.patientId);
              return (
                <tr key={appointment.id}>
                  <td className="sm-td">
                    <span className="font-medium text-slate-100">{patient?.name ?? "—"}</span>
                    <span className="ml-2 text-[10px] text-slate-500">{patient?.mrn}</span>
                  </td>
                  <td className="sm-td text-slate-400">{appointment.department}</td>
                  <td className="sm-td text-slate-400">{formatDateTime(appointment.scheduledFor)}</td>
                  <td className="sm-td max-w-[16rem] truncate text-slate-300">{appointment.reason}</td>
                  <td className="sm-td">
                    <Chip
                      token={{
                        label: appointment.acuity,
                        chip: "border-white/15 bg-white/5 text-slate-200",
                        hex: CHART_PALETTE[0],
                        rank: 0,
                      }}
                    />
                  </td>
                  <td className="sm-td">
                    <Chip token={APPOINTMENT_STATUS_TOKENS[appointment.status]} />
                  </td>
                </tr>
              );
            })}
        </DataTable>
      </Panel>
    </div>
  );
}

/* ================================================================== */
/* 4. Governance                                                       */
/* ================================================================== */

const PERMISSION_MATRIX: { capability: string; roles: Record<string, boolean> }[] = [
  { capability: "Manage users and system configuration", roles: { admin: true, doctor: false, nurse: false, receptionist: false, cashier: false, patient: false } },
  { capability: "View shortage intelligence", roles: { admin: true, doctor: true, nurse: false, receptionist: false, cashier: false, patient: false } },
  { capability: "Prescribe treatments (CPOE)", roles: { admin: true, doctor: true, nurse: false, receptionist: false, cashier: false, patient: false } },
  { capability: "Bedside administration and vitals", roles: { admin: true, doctor: true, nurse: true, receptionist: false, cashier: false, patient: false } },
  { capability: "Register patients and schedule", roles: { admin: true, doctor: false, nurse: false, receptionist: true, cashier: false, patient: false } },
  { capability: "Invoicing and POS collection", roles: { admin: true, doctor: false, nurse: false, receptionist: false, cashier: true, patient: false } },
  { capability: "Upload and read simplified reports", roles: { admin: true, doctor: true, nurse: true, receptionist: true, cashier: false, patient: true } },
];

/** One line describing what a staff member is actually carrying today. */
function describeWorkload(
  _staffId: string,
  role: string,
  counts: { appointments: number; doses: number; invoices: number; audit: number; checkInsToday: number },
): string {
  switch (role) {
    case "doctor":
      return `${counts.appointments} appointment${counts.appointments === 1 ? "" : "s"} booked`;
    case "nurse":
      return `${counts.doses} dose${counts.doses === 1 ? "" : "s"} charted this shift`;
    case "cashier":
      return `${counts.invoices} invoice${counts.invoices === 1 ? "" : "s"} raised`;
    case "receptionist":
      return `${counts.checkInsToday} active check-in${counts.checkInsToday === 1 ? "" : "s"}`;
    case "admin":
      return `${counts.audit} logged action${counts.audit === 1 ? "" : "s"}`;
    default:
      return "—";
  }
}

function Governance() {
  const { state, derived } = useApp();

  const alertLedger = useMemo(
    () => state.db.alerts.slice().sort((a, b) => b.sps - a.sps),
    [state.db.alerts],
  );

  return (
    <div className="space-y-6">
      <Panel>
        <PanelHeader
          title="Immutable action trail"
          subtitle="Every clinical, supply and financial mutation is appended by the reducer, so the ledger cannot drift from the data."
          icon={<Icon name="lock" size={18} />}
          actions={<span className="text-[11px] text-slate-400">{state.db.auditLog.length} entries</span>}
        />
        <DataTable head={["When", "Actor", "Role", "Action", "Target", "Detail"]}>
          {state.db.auditLog.slice(0, 12).map((entry) => (
            <tr key={entry.id}>
              <td className="sm-td whitespace-nowrap text-slate-400">{formatDateTime(entry.at)}</td>
              <td className="sm-td text-slate-200">{entry.actorName}</td>
              <td className="sm-td">
                <span className="sm-chip border-white/15 bg-white/5 text-slate-300">{entry.actorRole}</span>
              </td>
              <td className="sm-td font-mono text-[11px] text-accent">{entry.action}</td>
              <td className="sm-td text-slate-400">{entry.target}</td>
              <td className="sm-td max-w-[24rem] text-slate-300">{entry.detail}</td>
            </tr>
          ))}
        </DataTable>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader
            title="Recognised alert ledger"
            subtitle="Alerts acknowledged by a clinician, retained for audit."
            icon={<Icon name="bell" size={18} />}
          />
          {alertLedger.length === 0 ? (
            <EmptyState title="No alerts acknowledged yet" description="Acknowledge a critical or high alert from the bell menu." />
          ) : (
            <ul className="space-y-2">
              {alertLedger.map((alert) => (
                <li key={alert.id} className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/[0.02] p-3">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: RISK_TOKENS[alert.tier].hex }} />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-100">{alert.drugName}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">{alert.message}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHeader
            title="Role-based access control"
            subtitle="Capabilities as enforced by the navigation rail for this prototype."
            icon={<Icon name="shield" size={18} />}
          />
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="sm-th">Capability</th>
                  {["admin", "doctor", "nurse", "receptionist", "cashier", "patient"].map((role) => (
                    <th key={role} className="sm-th text-center">
                      {role.slice(0, 6)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {PERMISSION_MATRIX.map((row) => (
                  <tr key={row.capability}>
                    <td className="sm-td text-slate-300">{row.capability}</td>
                    {["admin", "doctor", "nurse", "receptionist", "cashier", "patient"].map((role) => (
                      <td key={role} className="sm-td text-center">
                        {row.roles[role] ? (
                          <span className="text-emerald-400">●</span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <Panel>
        <PanelHeader
          title="Staff directory"
          subtitle="Roster, departments and shift patterns."
          icon={<Icon name="user" size={18} />}
        />
        <DataTable head={["Employee", "Name", "Role", "Department", "Shift", "Contact", "Active work"]}>
          {state.db.staff.map((member) => {
            const workload = describeWorkload(member.id, member.role, {
              appointments: state.db.appointments.filter((item) => item.doctorId === member.id).length,
              doses: state.db.administrations.filter((item) => item.administeredBy === member.fullName).length,
              invoices: state.db.invoices.filter((item) => item.cashierId === member.id).length,
              audit: state.db.auditLog.filter((item) => item.actorId === member.id).length,
              checkInsToday: state.db.appointments.filter(
                (item) => item.status === "checked_in" || item.status === "in_consult",
              ).length,
            });
            return (
              <tr key={member.id}>
                <td className="sm-td font-mono text-[11px] text-slate-400">{member.employeeId}</td>
                <td className="sm-td font-medium text-slate-100">{member.fullName}</td>
                <td className="sm-td">
                  <span className="sm-chip border-white/15 bg-white/5 text-slate-300">{member.role}</span>
                </td>
                <td className="sm-td text-slate-400">{member.department}</td>
                <td className="sm-td text-slate-400">
                  {member.shift} · from {String(member.shiftStartHour).padStart(2, "0")}:00
                </td>
                <td className="sm-td text-slate-400">{member.contactNumber}</td>
                <td className="sm-td text-slate-400">{workload}</td>
              </tr>
            );
          })}
        </DataTable>
      </Panel>

      <Panel>
        <PanelHeader
          title="Formulary ledger"
          subtitle={`${state.db.medicines.length} molecules · ${formatCurrency(
            state.db.medicines.reduce((sum, medicine) => sum + medicine.currentStock * medicine.unitPrice, 0),
          )} at dispensing price · ${percent(
            (state.db.medicines.reduce((sum, item) => sum + item.allocatedStock, 0) /
              Math.max(
                1,
                state.db.medicines.reduce((sum, item) => sum + item.currentStock, 0),
              )) *
              100,
            1,
          )} soft reserved`}
          icon={<Icon name="stock" size={18} />}
        />
        <DataTable head={["SKU", "Brand", "Generic", "Form", "On hand", "Reserved", "Ward split", "Cover"]}>
          {derived.assessments.map((assessment) => {
            const medicine = derived.medicinesById.get(assessment.medicineId);
            if (!medicine) return null;
            return (
              <tr key={assessment.medicineId}>
                <td className="sm-td font-mono text-[11px] text-slate-500">{medicine.sku}</td>
                <td className="sm-td font-medium text-slate-100">{medicine.brandName}</td>
                <td className="sm-td text-slate-400">{medicine.genericName}</td>
                <td className="sm-td text-slate-400">{medicine.form.replace(/_/g, " ")}</td>
                <td className="sm-td tabular-nums">
                  {medicine.currentStock} {medicine.unit}
                </td>
                <td className="sm-td tabular-nums text-slate-400">{medicine.allocatedStock}</td>
                <td className="sm-td text-[11px] text-slate-400">
                  {medicine.wardStock.map((holding) => `${holding.ward}:${holding.quantity}`).join(" · ")}
                </td>
                <td className="sm-td tabular-nums">
                  <span style={{ color: RISK_TOKENS[assessment.tier].hex }}>{formatDays(assessment.dir)}d</span>
                </td>
              </tr>
            );
          })}
        </DataTable>
      </Panel>

      <Panel>
        <PanelHeader title="Seed data provenance" subtitle="What this prototype is and is not." icon={<Icon name="info" size={18} />} />
        <KeyValue
          items={[
            { label: "Data source", value: "Deterministic seeded in-memory dataset" },
            { label: "Persistence", value: "Browser localStorage, reseeded each calendar day" },
            { label: "Molecules", value: String(state.db.medicines.length) },
            { label: "Patients", value: String(state.db.patients.length) },
            { label: "Reports parsed", value: String(state.db.reports.length) },
            { label: "Prescriptions", value: String(state.db.treatments.length) },
            { label: "eMAR entries", value: String(state.db.administrations.length) },
            { label: "Invoices", value: String(state.db.invoices.length) },
            { label: "Audit entries", value: String(state.db.auditLog.length) },
            { label: "Seed generated", value: formatDate(new Date().toISOString()) },
          ]}
        />
      </Panel>
    </div>
  );
}

/* ================================================================== */

export default function AdminPortal() {
  const { state } = useApp();

  switch (state.activeView) {
    case "admin.sandbox":
      return <ScenarioSandbox />;
    case "admin.analytics":
      return <HospitalAnalytics />;
    case "admin.governance":
      return <Governance />;
    case "admin.control-room":
    default:
      return <ControlRoom />;
  }
}
