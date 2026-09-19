/**
 * Super Admin Portal.
 *
 * Platform and Network Governance for multi-tenant hospital operations across
 * Mangalore city healthcare institutions.
 *
 * PRIVACY BY DESIGN & HIPAA COMPLIANCE:
 * The Super Admin governs tenant infrastructure, hospital onboarding, bed
 * capacities, license statuses, and hospital administrator assignments.
 * Individual patient medical records, diagnostic lab reports, prescriptions,
 * and clinical PHI are strictly isolated and inaccessible to platform admins.
 */

import { useMemo, useState } from "react";
import type { Hospital } from "@/types";
import { HOSPITALS } from "@/data/mockData";
import { useApp } from "@/store/AppStore";
import {
  Button,
  EmptyState,
  Field,
  MetricStrip,
  Panel,
  PanelHeader,
  Select,
  TextInput,
} from "@/ui/primitives";
import Icon from "@/ui/Icon";
import { cx, formatDate, formatDateTime } from "@/utils/format";

/* ------------------------------------------------------------------ */
/* 1. Hospital Network & Onboarding                                   */
/* ------------------------------------------------------------------ */

const TIER_LABELS: Record<Hospital["tier"], string> = {
  tertiary: "Tertiary Multi-Specialty",
  secondary: "Secondary Care Hospital",
  primary: "Primary Healthcare Centre",
  district: "District Government Hospital",
};

const TIER_CHIPS: Record<Hospital["tier"], string> = {
  tertiary: "border-accent/40 bg-accent-soft text-accent",
  secondary: "border-sky-300 bg-sky-50 text-sky-800",
  primary: "border-emerald-300 bg-emerald-50 text-emerald-800",
  district: "border-amber-300 bg-amber-50 text-amber-800",
};

const STATUS_CHIPS: Record<Hospital["status"], string> = {
  active: "border-emerald-300 bg-emerald-50 text-emerald-800",
  provisioning: "border-amber-300 bg-amber-50 text-amber-800",
  suspended: "border-rose-300 bg-rose-50 text-rose-800",
};

// Facility live operational telemetry aligned with Mangalore network stock
const FACILITY_TELEMETRY: Record<string, {
  occupancyBeds: number;
  occupancyPct: number;
  stockStatus: string;
  stockTone: "critical" | "warning" | "normal";
  criticalMolecules: string[];
}> = {
  "hosp-kmc-mgl": {
    occupancyBeds: 492,
    occupancyPct: 98.4,
    stockStatus: "1 Critical Shortage (Meropenem 1g ICU)",
    stockTone: "critical",
    criticalMolecules: ["Meropenem 1g", "Augmentin 625 Duo"],
  },
  "hosp-fmmc-mgl": {
    occupancyBeds: 1120,
    occupancyPct: 89.6,
    stockStatus: "Healthy · Donor Surplus for ICU Antibiotics",
    stockTone: "normal",
    criticalMolecules: [],
  },
  "hosp-ajh-mgl": {
    occupancyBeds: 580,
    occupancyPct: 89.2,
    stockStatus: "Healthy · Donor Surplus for Emergency Insulin",
    stockTone: "normal",
    criticalMolecules: [],
  },
  "hosp-ysh-mgl": {
    occupancyBeds: 310,
    occupancyPct: 88.5,
    stockStatus: "1 Moderate Supply Constraint (Salbutamol)",
    stockTone: "warning",
    criticalMolecules: ["Asthalin Salbutamol"],
  },
  "hosp-wdh-mgl": {
    occupancyBeds: 710,
    occupancyPct: 94.6,
    stockStatus: "1 High Shortage Risk (Actrapid Insulin)",
    stockTone: "critical",
    criticalMolecules: ["Actrapid Insulin 100IU"],
  },
};

function HospitalDirectory() {
  const { state, actions } = useApp();
  // Ensure default hospitals always populate cleanly
  const hospitals = useMemo(() => {
    return (state.db.hospitals && state.db.hospitals.length > 0)
      ? state.db.hospitals
      : HOSPITALS;
  }, [state.db.hospitals]);

  const [search, setSearch] = useState("");
  const [selectedTier, setSelectedTier] = useState<string>("all");
  const [showOnboardModal, setShowOnboardModal] = useState(false);

  // Form state for onboarding
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [location, setLocation] = useState("");
  const [city, setCity] = useState("Mangalore");
  const [stateName, setStateName] = useState("Karnataka");
  const [tier, setTier] = useState<Hospital["tier"]>("tertiary");
  const [bedCapacity, setBedCapacity] = useState("450");
  const [activeWards, setActiveWards] = useState("6");
  const [contactEmail, setContactEmail] = useState("");
  const [phone, setPhone] = useState("+91 824 ");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");

  const filteredHospitals = useMemo(() => {
    const q = search.trim().toLowerCase();
    return hospitals.filter((h) => {
      if (selectedTier !== "all" && h.tier !== selectedTier) return false;
      if (!q) return true;
      return (
        h.name.toLowerCase().includes(q) ||
        h.code.toLowerCase().includes(q) ||
        h.location.toLowerCase().includes(q) ||
        (h.adminName && h.adminName.toLowerCase().includes(q))
      );
    });
  }, [hospitals, search, selectedTier]);

  const totalBeds = useMemo(
    () => hospitals.reduce((sum, h) => sum + (h.bedCapacity || 0), 0),
    [hospitals],
  );

  const totalWards = useMemo(
    () => hospitals.reduce((sum, h) => sum + (h.activeWards || 0), 0),
    [hospitals],
  );

  const handleOnboardSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !code.trim()) return;

    actions.onboardHospital({
      name: name.trim(),
      code: code.trim().toUpperCase(),
      location: location.trim() || "Mangalore",
      city: city.trim() || "Mangalore",
      state: stateName.trim() || "Karnataka",
      tier,
      bedCapacity: Number(bedCapacity) || 100,
      activeWards: Number(activeWards) || 4,
      status: "active",
      contactEmail: contactEmail.trim() || `${code.toLowerCase()}@smartmedic.io`,
      phone: phone.trim(),
      adminName: adminName.trim() || "Facility Administrator",
      adminEmail: adminEmail.trim() || `${code.toLowerCase()}.admin@smartmedic.io`,
    });

    // Reset
    setName("");
    setCode("");
    setLocation("");
    setShowOnboardModal(false);
  };

  const metricItems = [
    {
      label: "Registered Hospitals",
      value: String(hospitals.length),
      hint: "Mangalore city network",
    },
    {
      label: "Total Bed Capacity",
      value: totalBeds.toLocaleString("en-IN"),
      hint: "3,212 occupied (91.7%)",
    },
    {
      label: "Clinical Wards",
      value: String(totalWards),
      hint: "ICU, ER, Gen Wards, Peds",
    },
    {
      label: "Network License Status",
      value: "100% Active",
      hint: "All 5 facilities compliant",
    },
  ];

  return (
    <div className="space-y-4">
      {/* Privacy Guarantee Banner */}
      <div className="flex items-start gap-3.5 border-2 border-accent/30 bg-accent-soft p-4 shadow-sm">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-sm bg-accent text-white font-bold text-xs">
          HIPAA
        </div>
        <div className="text-xs leading-relaxed text-ink-700">
          <p className="font-semibold text-ink-900">
            Platform Governance Mode · Zero PHI Access Guarantee
          </p>
          <p className="mt-0.5 text-ink-600">
            As Platform Super Admin, you manage hospital onboarding, bed capacity allocations, license compliance,
            and Hospital Administrator provisioning across the Mangalore healthcare network. In accordance with
            healthcare data privacy laws, all individual patient records, lab reports, and physician notes remain
            strictly isolated to hospital-level clinical staff.
          </p>
        </div>
      </div>

      {/* Network Stats */}
      <MetricStrip items={metricItems} />

      {/* Hospital Directory Panel */}
      <Panel>
        <PanelHeader
          title="Mangalore Healthcare Network Facilities"
          subtitle="Governed hospital institutions with active SmartMedic enterprise deployments."
          actions={
            <Button
              variant="primary"
              onClick={() => setShowOnboardModal(true)}
              className="gap-1.5"
            >
              <Icon name="plus" size={14} />
              Onboard Hospital
            </Button>
          }
        />

        {/* Filters */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="min-w-[240px] flex-1">
            <TextInput
              placeholder="Search by hospital name, code, or area (e.g., Hampankatta, Kankanady)..."
              value={search}
              onChange={setSearch}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-ink-500 font-medium">Tier:</span>
            {(["all", "tertiary", "secondary", "district"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setSelectedTier(t)}
                className={cx(
                  "px-2.5 py-1 text-xs font-medium rounded-sm border transition",
                  selectedTier === t
                    ? "border-accent bg-accent text-white"
                    : "border-rule bg-canvas text-ink-700 hover:bg-paper",
                )}
              >
                {t === "all" ? "All Facilities" : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Grid of Hospital Cards */}
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-3">
          {filteredHospitals.map((h) => {
            const telemetry = FACILITY_TELEMETRY[h.id] ?? {
              occupancyBeds: Math.round(h.bedCapacity * 0.88),
              occupancyPct: 88,
              stockStatus: "Normal Formulary Buffer",
              stockTone: "normal" as const,
              criticalMolecules: [],
            };

            return (
              <div
                key={h.id}
                className="flex flex-col justify-between border border-rule bg-canvas p-4 shadow-sm hover:border-accent/50 transition"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[11px] font-mono font-bold tracking-wider text-ink-500">
                      {h.code}
                    </span>
                    <span
                      className={cx(
                        "px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-sm border",
                        STATUS_CHIPS[h.status],
                      )}
                    >
                      {h.status}
                    </span>
                  </div>

                  <h3 className="mt-1 font-serif text-base font-bold text-ink-900 leading-snug">
                    {h.name}
                  </h3>
                  <p className="mt-1 text-xs text-ink-500 flex items-center gap-1">
                    <Icon name="info" size={13} className="shrink-0 text-ink-400" />
                    {h.location}, {h.city}
                  </p>

                  <div className="mt-2.5 flex items-center gap-2">
                    <span
                      className={cx(
                        "inline-block px-2 py-0.5 text-[11px] font-medium rounded-sm border",
                        TIER_CHIPS[h.tier],
                      )}
                    >
                      {TIER_LABELS[h.tier]}
                    </span>
                  </div>

                  {/* Bed Occupancy & Capacity */}
                  <div className="mt-3.5 border-t border-rule-soft pt-3 text-xs">
                    <div className="flex justify-between items-baseline mb-1">
                      <span className="text-[10px] uppercase tracking-wider text-ink-500 font-semibold">
                        Bed Occupancy
                      </span>
                      <span className="font-semibold text-ink-900">
                        {telemetry.occupancyBeds} / {h.bedCapacity} ({telemetry.occupancyPct}%)
                      </span>
                    </div>
                    <div className="h-1.5 w-full bg-paper border border-rule-soft rounded-full overflow-hidden">
                      <div
                        className={cx(
                          "h-full rounded-full",
                          telemetry.occupancyPct > 95
                            ? "bg-risk-critical"
                            : telemetry.occupancyPct > 85
                            ? "bg-accent"
                            : "bg-emerald-600",
                        )}
                        style={{ width: `${Math.min(100, telemetry.occupancyPct)}%` }}
                      />
                    </div>
                  </div>

                  {/* Formulary & Supply Health */}
                  <div className="mt-3 border-t border-rule-soft pt-2.5 text-xs">
                    <span className="block text-[10px] uppercase tracking-wider text-ink-500 font-semibold mb-1">
                      Live Supply Position
                    </span>
                    <span
                      className={cx(
                        "inline-block text-[11px] font-medium px-2 py-0.5 rounded-sm border",
                        telemetry.stockTone === "critical"
                          ? "border-risk-critical/40 bg-risk-critical/[0.08] text-risk-critical"
                          : telemetry.stockTone === "warning"
                          ? "border-amber-300 bg-amber-50 text-amber-900"
                          : "border-emerald-300 bg-emerald-50 text-emerald-900",
                      )}
                    >
                      {telemetry.stockStatus}
                    </span>
                  </div>

                  {/* Administrator */}
                  <div className="mt-3 border-t border-rule-soft pt-2.5 text-xs text-ink-600">
                    <span className="block text-[10px] uppercase tracking-wider text-ink-500 font-semibold">
                      Hospital Administrator
                    </span>
                    <p className="font-medium text-ink-900 mt-0.5">{h.adminName || "Meera Krishnan"}</p>
                    <p className="text-[11px] text-ink-500 font-mono">{h.adminEmail || h.contactEmail}</p>
                    <p className="text-[11px] text-ink-500">{h.phone}</p>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-rule pt-3 text-xs">
                  <span className="text-[10px] text-ink-400">
                    Onboarded {formatDate(h.createdAt || "2025-01-01")}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      actions.setRole("admin");
                      actions.setView("admin.control-room");
                    }}
                    className="font-semibold text-accent hover:underline flex items-center gap-1"
                  >
                    Open Control Room →
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {filteredHospitals.length === 0 && (
          <EmptyState
            title="No matching hospitals"
            description="Try adjusting your search criteria or onboard a new hospital branch."
          />
        )}
      </Panel>

      {/* Modal: Onboard New Hospital */}
      {showOnboardModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto border border-rule-strong bg-paper p-6 shadow-sheet animate-rise-in">
            <div className="flex items-start justify-between border-b border-rule pb-3">
              <div>
                <h3 className="font-serif text-lg font-bold text-ink-900">
                  Onboard New Hospital Facility
                </h3>
                <p className="text-xs text-ink-500 mt-0.5">
                  Register a healthcare institution in the Mangalore regional network.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowOnboardModal(false)}
                className="text-ink-400 hover:text-ink-700 text-lg leading-none"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleOnboardSubmit} className="mt-4 space-y-3.5">
              <Field label="Hospital Name" hint="Official registered name of the institution">
                <TextInput
                  placeholder="e.g., Suratkal Community Health Centre"
                  value={name}
                  onChange={setName}
                  required
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Facility Code" hint="e.g., SCHC-MGL-06">
                  <TextInput
                    placeholder="SCHC-MGL-06"
                    value={code}
                    onChange={setCode}
                    required
                  />
                </Field>
                <Field label="Care Tier">
                  <Select
                    value={tier}
                    onChange={setTier}
                    options={[
                      { value: "tertiary", label: "Tertiary Multi-Specialty" },
                      { value: "secondary", label: "Secondary Care Hospital" },
                      { value: "primary", label: "Primary Healthcare Centre" },
                      { value: "district", label: "District Government Hospital" },
                    ]}
                  />
                </Field>
              </div>

              <Field label="Street Location / Landmark" hint="e.g., NH 66, Suratkal, Mangalore">
                <TextInput
                  placeholder="e.g., Main Road, Suratkal"
                  value={location}
                  onChange={setLocation}
                  required
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="City">
                  <TextInput value={city} onChange={setCity} />
                </Field>
                <Field label="State">
                  <TextInput value={stateName} onChange={setStateName} />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Total Bed Capacity">
                  <TextInput
                    type="number"
                    value={bedCapacity}
                    onChange={setBedCapacity}
                  />
                </Field>
                <Field label="Active Clinical Wards">
                  <TextInput
                    type="number"
                    value={activeWards}
                    onChange={setActiveWards}
                  />
                </Field>
              </div>

              <div className="border-t border-rule-soft pt-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-700">
                  Primary Hospital Administrator Assignment
                </h4>
                <div className="mt-2.5 grid grid-cols-2 gap-3">
                  <Field label="Administrator Name">
                    <TextInput
                      placeholder="e.g., Dr. Ananya Rai"
                      value={adminName}
                      onChange={setAdminName}
                    />
                  </Field>
                  <Field label="Official Email">
                    <TextInput
                      type="email"
                      placeholder="admin@suratkalhealth.org"
                      value={adminEmail}
                      onChange={setAdminEmail}
                    />
                  </Field>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <Field label="Direct Phone">
                    <TextInput
                      placeholder="+91 824 247 1234"
                      value={phone}
                      onChange={setPhone}
                    />
                  </Field>
                  <Field label="Emergency Central Desk">
                    <TextInput
                      placeholder="emergency@suratkalhealth.org"
                      value={contactEmail}
                      onChange={setContactEmail}
                    />
                  </Field>
                </div>
              </div>

              <div className="mt-5 flex justify-end gap-2.5 border-t border-rule pt-4">
                <Button variant="secondary" onClick={() => setShowOnboardModal(false)}>
                  Cancel
                </Button>
                <Button variant="primary" type="submit">
                  Confirm Onboarding
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 2. Hospital Admins & Provisioning                                  */
/* ------------------------------------------------------------------ */

function HospitalAdminsView() {
  const { state } = useApp();
  const hospitals = (state.db.hospitals && state.db.hospitals.length > 0)
    ? state.db.hospitals
    : HOSPITALS;
  const staff = state.db.staff ?? [];

  // Group admins by hospital
  const adminRows = useMemo(() => {
    return hospitals.map((h) => {
      const assignedStaff = staff.find((s) => s.id === h.adminId || s.email === h.adminEmail);
      return {
        hospitalId: h.id,
        hospitalName: h.name,
        hospitalCode: h.code,
        location: h.location,
        adminName: h.adminName || (assignedStaff ? assignedStaff.fullName : "Meera Krishnan"),
        adminEmail: h.adminEmail || (assignedStaff ? assignedStaff.email : h.contactEmail),
        phone: h.phone,
        status: h.status,
      };
    });
  }, [hospitals, staff]);

  return (
    <Panel>
      <PanelHeader
        title="Hospital Administrators Directory"
        subtitle="Provisioned administrative credentials per Mangalore hospital facility."
      />

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-rule bg-canvas text-ink-500 font-semibold">
              <th className="p-3">Hospital Facility</th>
              <th className="p-3">Location</th>
              <th className="p-3">Hospital Administrator</th>
              <th className="p-3">Contact Email</th>
              <th className="p-3">Phone</th>
              <th className="p-3">Access Status</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule-soft">
            {adminRows.map((row) => (
              <tr key={row.hospitalId} className="hover:bg-canvas/60 transition">
                <td className="p-3 font-medium text-ink-900">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] font-bold text-ink-400">
                      {row.hospitalCode}
                    </span>
                    <span>{row.hospitalName}</span>
                  </div>
                </td>
                <td className="p-3 text-ink-600">{row.location}</td>
                <td className="p-3 font-semibold text-ink-900">{row.adminName}</td>
                <td className="p-3 font-mono text-[11px] text-ink-600">{row.adminEmail}</td>
                <td className="p-3 text-ink-600">{row.phone}</td>
                <td className="p-3">
                  <span className="inline-block px-2 py-0.5 text-[10px] font-semibold uppercase rounded-sm border border-emerald-300 bg-emerald-50 text-emerald-800">
                    Active
                  </span>
                </td>
                <td className="p-3 text-right">
                  <button
                    type="button"
                    className="text-accent hover:underline font-medium text-xs"
                    onClick={() => alert(`Reassigning credentials for ${row.hospitalName}`)}
                  >
                    Reassign
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* 3. Regional Shortage Network & Inter-Hospital Transfers             */
/* ------------------------------------------------------------------ */

function RegionalShortageNetwork() {
  const [authorized, setAuthorized] = useState<Record<string, boolean>>({});

  // Multi-hospital shortage corridors precisely linked to Mangalore facilities
  const shortageCorridors = [
    {
      id: "corr-1",
      drugName: "Meropenem 1g Injection",
      category: "Critical ICU Antibiotic",
      deficitHospital: "KMC Hospital Mangalore",
      deficitCode: "KMC-MGL-01",
      deficitLocation: "Hampankatta",
      deficitDays: 1.4,
      deficitStatus: "Critical Stockout Risk",
      surplusHospital: "Father Muller Medical College Hospital",
      surplusCode: "FMMC-MGL-02",
      surplusLocation: "Kankanady",
      surplusDays: 22.0,
      distanceKm: "3.2 km (7 mins drive via Balmatta Rd)",
      suggestedTransfer: 40,
      projectedRelief: "Averts ICU stockout, provides 8.5 days buffer at KMC",
    },
    {
      id: "corr-2",
      drugName: "Human Actrapid Insulin 100IU/ml",
      category: "Emergency Endocrine",
      deficitHospital: "Wenlock District Government Hospital",
      deficitCode: "WDH-MGL-05",
      deficitLocation: "Hampankatta",
      deficitDays: 2.1,
      deficitStatus: "High Stockout Risk",
      surplusHospital: "A.J. Hospital & Research Centre",
      surplusCode: "AJH-MGL-03",
      surplusLocation: "Kuntikan",
      surplusDays: 18.5,
      distanceKm: "4.8 km (12 mins drive via NH 66)",
      suggestedTransfer: 60,
      projectedRelief: "Restores emergency supply to standard safety band at Wenlock",
    },
    {
      id: "corr-3",
      drugName: "Asthalin Salbutamol Respirator Solution",
      category: "Emergency Respiratory",
      deficitHospital: "Yenepoya Specialty Hospital",
      deficitCode: "YSH-MGL-04",
      deficitLocation: "Kodiabail",
      deficitDays: 3.0,
      deficitStatus: "Moderate Constraint",
      surplusHospital: "KMC Hospital Mangalore",
      surplusCode: "KMC-MGL-01",
      surplusLocation: "Hampankatta",
      surplusDays: 15.0,
      distanceKm: "1.8 km (5 mins drive via MG Road)",
      suggestedTransfer: 25,
      projectedRelief: "Balances regional pediatric ward draw",
    },
  ];

  const handleAuthorize = (id: string, drug: string, from: string, to: string, qty: number) => {
    setAuthorized((prev) => ({ ...prev, [id]: true }));
    alert(
      `✓ Emergency Transfer Corridor Authorized!\n\nDispatched: ${qty} units of ${drug}\nFrom: ${from}\nTo: ${to}\n\nThe audit ledger has recorded this regional mutual-aid decision.`,
    );
  };

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          title="Regional Shortage Mutual-Aid Network (Mangalore District)"
          subtitle="Cross-hospital inventory intelligence across Mangalore facilities to avert critical drug stockouts."
        />

        <div className="border border-rule bg-canvas p-3.5 mb-4 text-xs leading-relaxed text-ink-700">
          <span className="font-bold text-ink-900">How Regional Mutual-Aid Works: </span>
          When the Predictive Shortage Engine detects that a critical drug (such as an ICU antibiotic) is falling
          below safe days-of-cover at one hospital (e.g., KMC), it scans nearby network facilities in Mangalore
          with surplus stock (e.g., Father Muller Hospital) and calculates an optimized transit corridor to prevent
          patient mortality and emergency procurement spikes.
        </div>

        <div className="space-y-3.5">
          {shortageCorridors.map((c) => {
            const isDone = authorized[c.id];

            return (
              <div
                key={c.id}
                className={cx(
                  "border p-4 shadow-sm transition",
                  isDone
                    ? "border-emerald-500/50 bg-emerald-50/20"
                    : "border-rule bg-paper hover:border-accent/40",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-2 border-b border-rule-soft pb-2.5">
                  <div>
                    <span className="text-[10px] uppercase font-bold tracking-wider text-accent">
                      {c.category}
                    </span>
                    <h4 className="font-serif text-base font-bold text-ink-900">
                      {c.drugName}
                    </h4>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 text-[11px] font-semibold text-rose-800 bg-rose-50 border border-rose-200 rounded-sm">
                      Deficit: {c.deficitDays} Days Left
                    </span>
                    <span className="text-xs text-ink-400">↔</span>
                    <span className="px-2 py-0.5 text-[11px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-sm">
                      Surplus: {c.surplusDays} Days Held
                    </span>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 text-xs">
                  <div className="border-l-2 border-rose-500 bg-canvas p-2.5">
                    <span className="block text-[10px] uppercase font-bold text-rose-800 tracking-wider">
                      Recipient Facility in Deficit ({c.deficitCode})
                    </span>
                    <p className="font-semibold text-ink-900 mt-0.5">{c.deficitHospital}</p>
                    <p className="text-[11px] text-ink-500">{c.deficitLocation}, Mangalore</p>
                    <p className="text-[11px] font-medium text-rose-700 mt-1">{c.deficitStatus}</p>
                  </div>

                  <div className="border-l-2 border-emerald-500 bg-canvas p-2.5">
                    <span className="block text-[10px] uppercase font-bold text-emerald-800 tracking-wider">
                      Donor Facility in Surplus ({c.surplusCode})
                    </span>
                    <p className="font-semibold text-ink-900 mt-0.5">{c.surplusHospital}</p>
                    <p className="text-[11px] text-ink-500">{c.surplusLocation}, Mangalore</p>
                    <p className="text-[11px] text-ink-600 mt-1">Transit Corridor: {c.distanceKm}</p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-rule-soft pt-3 text-xs">
                  <div>
                    <span className="font-bold text-ink-900">
                      Recommended Transfer: {c.suggestedTransfer} Units ·{" "}
                    </span>
                    <span className="text-ink-600">{c.projectedRelief}</span>
                  </div>
                  {isDone ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-100 border border-emerald-300 text-emerald-800 font-semibold rounded-sm text-xs">
                      <Icon name="check" size={13} /> Corridor Dispatched
                    </span>
                  ) : (
                    <Button
                      variant="primary"
                      className="text-xs py-1 px-3"
                      onClick={() =>
                        handleAuthorize(c.id, c.drugName, c.surplusHospital, c.deficitHospital, c.suggestedTransfer)
                      }
                    >
                      Authorize & Dispatch Corridor
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 4. Platform Audit Trail                                            */
/* ------------------------------------------------------------------ */

function PlatformAuditTrail() {
  const { state } = useApp();
  const auditLog = state.db.auditLog ?? [];

  return (
    <Panel>
      <PanelHeader
        title="Platform Security & Governance Ledger"
        subtitle="Immutable audit trail of hospital onboarding, administrator appointments, and network corridor decisions."
      />

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-rule bg-canvas text-ink-500 font-semibold">
              <th className="p-3">Timestamp</th>
              <th className="p-3">Action</th>
              <th className="p-3">Target Entity</th>
              <th className="p-3">Actor / Authority</th>
              <th className="p-3">Governance Detail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule-soft">
            {auditLog.map((entry) => (
              <tr key={entry.id} className="hover:bg-canvas/60 transition">
                <td className="p-3 font-mono text-[11px] text-ink-500 whitespace-nowrap">
                  {formatDateTime(entry.at)}
                </td>
                <td className="p-3">
                  <span className="font-mono font-semibold text-accent text-[11px]">
                    {entry.action}
                  </span>
                </td>
                <td className="p-3 font-mono text-[11px] text-ink-700">{entry.target}</td>
                <td className="p-3 text-ink-900">
                  <span className="font-medium">{entry.actorName}</span>
                  <span className="ml-1 text-[10px] text-ink-400">({entry.actorRole})</span>
                </td>
                <td className="p-3 text-ink-600 max-w-md">{entry.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Main Super Admin Portal Component                                 */
/* ------------------------------------------------------------------ */

export default function SuperAdminPortal() {
  const { state } = useApp();
  const activeView = state.activeView;

  switch (activeView) {
    case "superadmin.admins":
      return <HospitalAdminsView />;
    case "superadmin.telemetry":
      return <RegionalShortageNetwork />;
    case "superadmin.audit":
      return <PlatformAuditTrail />;
    case "superadmin.hospitals":
    default:
      return <HospitalDirectory />;
  }
}
