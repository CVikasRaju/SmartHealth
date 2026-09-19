/**
 * Receptionist portal.
 *
 * Three modules: patient registration, the appointment desk with triage
 * check-in, and outside report intake. Registration is the entry point for the
 * whole encounter, so it is the only place a new medical record number is
 * minted.
 */

import { useMemo, useState } from "react";
import type { Acuity, Allergy, Gender, ReportCategory } from "@/types";
import { REPORT_CATEGORY_LABELS } from "@/types";
import { useApp } from "@/store/AppStore";
import { ACUITY_TOKENS, APPOINTMENT_STATUS_TOKENS, SEVERITY_TOKENS } from "@/ui/theme";
import {
  Button,
  Chip,
  DataTable,
  EmptyState,
  Field,
  Modal,
  Panel,
  PanelHeader,
  Select,
  StatTile,
  TextArea,
  TextInput,
} from "@/ui/primitives";
import ReportSimplifier from "@/components/ReportSimplifier";
import Icon from "@/ui/Icon";
import { ageFromDob, cx, formatDateTime, formatTime, isSameDay } from "@/utils/format";

/* ------------------------------------------------------------------ */
/* 1. Patient registration                                             */
/* ------------------------------------------------------------------ */

interface RegistrationDraft {
  name: string;
  dob: string;
  gender: Gender;
  bloodGroup: string;
  contact: string;
  email: string;
  emergencyName: string;
  emergencyRelation: string;
  emergencyContact: string;
  conditions: string;
}

const EMPTY_DRAFT: RegistrationDraft = {
  name: "",
  dob: "",
  gender: "female",
  bloodGroup: "O+",
  contact: "",
  email: "",
  emergencyName: "",
  emergencyRelation: "Spouse",
  emergencyContact: "",
  conditions: "",
};

const BLOOD_GROUPS = ["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"];

function RegistrationDesk() {
  const { derived, actions } = useApp();
  const [draft, setDraft] = useState<RegistrationDraft>(EMPTY_DRAFT);
  const [allergies, setAllergies] = useState<Allergy[]>([]);
  const [allergen, setAllergen] = useState("");
  const [severity, setSeverity] = useState<Allergy["severity"]>("moderate");
  const [reaction, setReaction] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [registered, setRegistered] = useState<{ name: string; mrn: string; id: string } | null>(null);

  const register = () => {
    if (!draft.name.trim()) return setError("Patient name is required.");
    if (!draft.dob) return setError("Date of birth is required to calculate age and dosing safety.");
    if (draft.contact.trim().length < 8) return setError("A reachable contact number is required.");
    if (draft.emergencyContact.trim().length < 8)
      return setError("An emergency contact number is required for admitted patients.");

    const patient = actions.registerPatient({
      name: draft.name,
      dob: draft.dob,
      gender: draft.gender,
      bloodGroup: draft.bloodGroup,
      contact: draft.contact,
      email: draft.email,
      allergies: allergies.length > 0 ? allergies : [{ allergen: "None recorded", severity: "mild", reaction: "—" }],
      emergencyContact: {
        name: draft.emergencyName.trim() || "Not provided",
        relation: draft.emergencyRelation.trim() || "Not stated",
        contact: draft.emergencyContact,
      },
      chronicConditions: draft.conditions
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    });

    setRegistered({ name: patient.name, mrn: patient.mrn, id: patient.id });
    actions.setActivePatient(patient.id);
    setDraft(EMPTY_DRAFT);
    setAllergies([]);
    setError(null);
  };

  return (
    <div className="space-y-6">
      {registered ? (
        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-risk-normal/[0.12] text-risk-normal">
                <Icon name="check" size={20} />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink-900">Registration complete</p>
                <p className="mt-0.5 text-xs text-ink-500">
                  {registered.name} was issued medical record number{" "}
                  <span className="font-mono text-ink-900">{registered.mrn}</span> and set as the active patient.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  actions.setActivePatient(registered.id);
                  actions.setView("reception.schedule");
                }}
              >
                <Icon name="calendar" size={13} />
                Book an appointment
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRegistered(null)}>
                Register another
              </Button>
            </div>
          </div>
        </Panel>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Panel>
          <PanelHeader
            title="Register a new patient"
            subtitle="Captures the demographics, contact details, allergy record and chronic conditions that every downstream module reads."
            icon={<Icon name="register" size={18} />}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name" className="sm:col-span-2">
              <TextInput value={draft.name} onChange={(value) => setDraft({ ...draft, name: value })} placeholder="e.g. Ananya Iyer" />
            </Field>
            <Field label="Date of birth">
              <input
                type="date"
                className="sm-input"
                value={draft.dob}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(event) => setDraft({ ...draft, dob: event.target.value })}
              />
            </Field>
            <Field label="Gender">
              <Select
                value={draft.gender}
                onChange={(value) => setDraft({ ...draft, gender: value as Gender })}
                options={[
                  { value: "female", label: "Female" },
                  { value: "male", label: "Male" },
                  { value: "other", label: "Other" },
                ]}
              />
            </Field>
            <Field label="Blood group">
              <Select
                value={draft.bloodGroup}
                onChange={(value) => setDraft({ ...draft, bloodGroup: value })}
                options={BLOOD_GROUPS.map((group) => ({ value: group, label: group }))}
              />
            </Field>
            <Field label="Contact number">
              <TextInput value={draft.contact} onChange={(value) => setDraft({ ...draft, contact: value })} placeholder="+91-XXXXXXXXXX" />
            </Field>
            <Field label="Email" hint="Optional; used to send simplified reports to the patient portal.">
              <TextInput value={draft.email} onChange={(value) => setDraft({ ...draft, email: value })} placeholder="name@example.com" />
            </Field>
            <Field label="Chronic conditions" hint="Comma separated.">
              <TextInput
                value={draft.conditions}
                onChange={(value) => setDraft({ ...draft, conditions: value })}
                placeholder="e.g. Type 2 Diabetes Mellitus, Hypertension"
              />
            </Field>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Field label="Emergency contact name">
              <TextInput value={draft.emergencyName} onChange={(value) => setDraft({ ...draft, emergencyName: value })} />
            </Field>
            <Field label="Relationship">
              <TextInput value={draft.emergencyRelation} onChange={(value) => setDraft({ ...draft, emergencyRelation: value })} />
            </Field>
            <Field label="Emergency contact number">
              <TextInput value={draft.emergencyContact} onChange={(value) => setDraft({ ...draft, emergencyContact: value })} />
            </Field>
          </div>

          {error ? (
            <p className="mt-4 rounded-lg border border-risk-critical/45 bg-risk-critical/[0.08] p-3 text-xs text-risk-critical">{error}</p>
          ) : null}

          <div className="mt-5 flex justify-end">
            <Button variant="primary" onClick={register}>
              <Icon name="check" size={14} />
              Issue medical record number
            </Button>
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="Allergy record"
            subtitle="Severe allergies are surfaced in the prescribing console before a drug is chosen."
            icon={<Icon name="alert" size={18} />}
          />
          <div className="space-y-3">
            <Field label="Allergen">
              <TextInput value={allergen} onChange={setAllergen} placeholder="e.g. Penicillin" />
            </Field>
            <Field label="Severity">
              <Select
                value={severity}
                onChange={(value) => setSeverity(value as Allergy["severity"])}
                options={[
                  { value: "mild", label: "Mild" },
                  { value: "moderate", label: "Moderate" },
                  { value: "severe", label: "Severe" },
                ]}
              />
            </Field>
            <Field label="Observed reaction">
              <TextArea value={reaction} onChange={setReaction} rows={2} placeholder="e.g. Anaphylaxis, airway swelling" />
            </Field>
            <Button
              variant="secondary"
              fullWidth
              disabled={!allergen.trim()}
              onClick={() => {
                setAllergies((current) => [...current, { allergen: allergen.trim(), severity, reaction: reaction.trim() || "—" }]);
                setAllergen("");
                setReaction("");
              }}
            >
              <Icon name="plus" size={13} />
              Add to allergy record
            </Button>

            {allergies.length === 0 ? (
              <p className="rounded-lg border border-dashed border-rule p-3 text-center text-[11px] text-ink-400">
                No allergies added. “None recorded” is stored if the chart is left empty.
              </p>
            ) : (
              <ul className="space-y-2">
                {allergies.map((item, index) => (
                  <li key={`${item.allergen}-${index}`} className="flex items-start justify-between gap-2 rounded-lg border border-rule bg-paper p-2.5">
                    <span className="min-w-0">
                      <span className="block text-xs text-ink-900">{item.allergen}</span>
                      <span className="block text-[10px] text-ink-400">{item.reaction}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <Chip token={SEVERITY_TOKENS[item.severity]} />
                      <button
                        type="button"
                        className="text-ink-400 hover:text-risk-critical"
                        onClick={() => setAllergies((current) => current.filter((_, position) => position !== index))}
                      >
                        <Icon name="close" size={13} />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>
      </div>

      <Panel>
        <PanelHeader title="Registered patients" subtitle="Most recent first." icon={<Icon name="user" size={18} />} />
        <DataTable head={["MRN", "Name", "Age / sex", "Blood", "Contact", "Allergies", "Admission", "Active"]}>
          {derived.patientsById.size > 0
            ? Array.from(derived.patientsById.values()).map((patient) => (
                <tr key={patient.id}>
                  <td className="sm-td font-mono text-[11px] text-ink-500">{patient.mrn}</td>
                  <td className="sm-td font-medium text-ink-900">{patient.name}</td>
                  <td className="sm-td text-ink-500">
                    {ageFromDob(patient.dob)}y · {patient.gender}
                  </td>
                  <td className="sm-td text-ink-500">{patient.bloodGroup}</td>
                  <td className="sm-td text-ink-500">{patient.contact}</td>
                  <td className="sm-td">
                    <span className="flex flex-wrap gap-1">
                      {patient.allergies.map((allergy) => (
                        <Chip key={allergy.allergen} token={SEVERITY_TOKENS[allergy.severity]}>
                          {allergy.allergen}
                        </Chip>
                      ))}
                    </span>
                  </td>
                  <td className="sm-td text-ink-500">
                    {patient.currentAdmission.isAdmitted
                      ? `${patient.currentAdmission.ward} ${patient.currentAdmission.bedNumber}`
                      : "Outpatient"}
                  </td>
                  <td className="sm-td">
                    <Button size="sm" variant="ghost" onClick={() => actions.setActivePatient(patient.id)}>
                      Set active
                    </Button>
                  </td>
                </tr>
              ))
            : null}
        </DataTable>
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 2. Appointment desk and triage                                      */
/* ------------------------------------------------------------------ */

function AppointmentDesk() {
  const { state, derived, actions } = useApp();
  const [triageTarget, setTriageTarget] = useState<string | null>(null);
  const [acuity, setAcuity] = useState<Acuity>("standard");
  const [notes, setNotes] = useState("");
  const [doctorId, setDoctorId] = useState(state.session.staffId);

  const [booking, setBooking] = useState({
    patientId: state.session.patientId,
    doctorId: derived.doctors[0]?.id ?? "",
    when: `${new Date().toISOString().slice(0, 10)}T10:00`,
    reason: "",
  });

  const todays = derived.todaysQueue();
  const upcoming = useMemo(
    () =>
      state.db.appointments
        .filter((appointment) => new Date(appointment.scheduledFor).getTime() > Date.now())
        .filter((appointment) => !isSameDay(new Date(appointment.scheduledFor), new Date()))
        .slice()
        .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime()),
    [state.db.appointments],
  );

  const openTriage = (appointmentId: string, currentAcuity: Acuity, currentNotes: string, currentDoctor: string) => {
    setTriageTarget(appointmentId);
    setAcuity(currentAcuity);
    setNotes(currentNotes);
    setDoctorId(currentDoctor);
  };

  const commitCheckIn = () => {
    if (!triageTarget) return;
    const queuePosition = todays.filter((item) => item.status === "checked_in").length + 1;
    actions.triageAppointment({ id: triageTarget, acuity, notes, doctorId });
    actions.setAppointmentStatus(triageTarget, "checked_in", queuePosition);
    setTriageTarget(null);
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile label="Today's list" value={todays.length} />
        <StatTile
          label="Checked in"
          value={todays.filter((item) => item.status === "checked_in" || item.status === "in_consult").length}
          tone="accent"
        />
        <StatTile
          label="Awaiting check-in"
          value={todays.filter((item) => item.status === "scheduled").length}
          tone={todays.filter((item) => item.status === "scheduled").length > 0 ? "warning" : "default"}
        />
        <StatTile label="Later appointments" value={upcoming.length} />
      </div>

      <Panel>
        <PanelHeader
          title="Today's appointment desk"
          subtitle="Check a patient in to assign their triage acuity and place them in the clinician's queue."
          icon={<Icon name="calendar" size={18} />}
        />
        {todays.length === 0 ? (
          <EmptyState title="Nothing scheduled today" description="Book an appointment below to start the day's list." />
        ) : (
          <DataTable head={["Time", "Patient", "Clinician", "Reason", "Acuity", "Status", "Queue", "Action"]}>
            {todays.map((appointment) => {
              const patient = derived.patientsById.get(appointment.patientId);
              const doctor = derived.staffById.get(appointment.doctorId);
              const editable = appointment.status === "scheduled" || appointment.status === "checked_in";
              return (
                <tr key={appointment.id}>
                  <td className="sm-td whitespace-nowrap tabular-nums text-ink-700">
                    {formatTime(appointment.scheduledFor)}
                  </td>
                  <td className="sm-td">
                    <span className="font-medium text-ink-900">{patient?.name ?? "—"}</span>
                    <span className="mt-0.5 block font-mono text-[10px] text-ink-400">{patient?.mrn}</span>
                  </td>
                  <td className="sm-td text-ink-500">{doctor?.fullName ?? "—"}</td>
                  <td className="sm-td max-w-[18rem] text-ink-700">{appointment.reason}</td>
                  <td className="sm-td">
                    <Chip token={ACUITY_TOKENS[appointment.acuity]} />
                  </td>
                  <td className="sm-td">
                    <Chip token={APPOINTMENT_STATUS_TOKENS[appointment.status]} />
                  </td>
                  <td className="sm-td tabular-nums text-ink-500">
                    {appointment.queuePosition ?? "—"}
                  </td>
                  <td className="sm-td">
                    <div className="flex flex-wrap gap-1.5">
                      {editable ? (
                        <Button
                          size="sm"
                          variant={appointment.status === "scheduled" ? "primary" : "secondary"}
                          onClick={() =>
                            openTriage(appointment.id, appointment.acuity, appointment.triageNotes, appointment.doctorId)
                          }
                        >
                          {appointment.status === "scheduled" ? "Check in" : "Update triage"}
                        </Button>
                      ) : null}
                      {appointment.status === "checked_in" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => actions.setAppointmentStatus(appointment.id, "in_consult", null)}
                        >
                          Call in
                        </Button>
                      ) : null}
                      {appointment.status === "in_consult" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => actions.setAppointmentStatus(appointment.id, "completed", null)}
                        >
                          Complete
                        </Button>
                      ) : null}
                      {appointment.status === "scheduled" ? (
                        <Button size="sm" variant="ghost" onClick={() => actions.setAppointmentStatus(appointment.id, "cancelled", null)}>
                          Cancel
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader
            title="Book an appointment"
            subtitle="Availability is created on demand in this prototype; every booking is appended to the audit trail."
            icon={<Icon name="plus" size={18} />}
          />
          <div className="space-y-3">
            <Field label="Patient">
              <Select
                value={booking.patientId}
                onChange={(value) => setBooking({ ...booking, patientId: value })}
                options={Array.from(derived.patientsById.values()).map((patient) => ({
                  value: patient.id,
                  label: `${patient.name} · ${patient.mrn}`,
                }))}
              />
            </Field>
            <Field label="Clinician">
              <Select
                value={booking.doctorId}
                onChange={(value) => setBooking({ ...booking, doctorId: value })}
                options={derived.doctors.map((doctor) => ({
                  value: doctor.id,
                  label: `${doctor.fullName} · ${doctor.department}`,
                }))}
              />
            </Field>
            <Field label="Date and time">
              <input
                type="datetime-local"
                className="sm-input"
                value={booking.when}
                onChange={(event) => setBooking({ ...booking, when: event.target.value })}
              />
            </Field>
            <Field label="Reason for visit">
              <TextInput
                value={booking.reason}
                onChange={(value) => setBooking({ ...booking, reason: value })}
                placeholder="e.g. Post-discharge review"
              />
            </Field>
            <Button
              variant="primary"
              fullWidth
              disabled={!booking.reason.trim() || !booking.doctorId}
              onClick={() => {
                actions.scheduleAppointment({
                  patientId: booking.patientId,
                  doctorId: booking.doctorId,
                  scheduledFor: new Date(booking.when).toISOString(),
                  reason: booking.reason,
                  acuity: "routine",
                  triageNotes: "Booked at the front desk; acuity to be set at check-in.",
                });
                actions.setActivePatient(booking.patientId);
                setBooking({ ...booking, reason: "" });
              }}
            >
              <Icon name="calendar" size={14} />
              Schedule appointment
            </Button>
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="Upcoming appointments"
            subtitle="Scheduled beyond today."
            icon={<Icon name="calendar" size={18} />}
          />
          {upcoming.length === 0 ? (
            <EmptyState title="No future appointments" description="Bookings made here appear in this list immediately." />
          ) : (
            <ul className="space-y-2">
              {upcoming.map((appointment) => {
                const patient = derived.patientsById.get(appointment.patientId);
                const doctor = derived.staffById.get(appointment.doctorId);
                return (
                  <li key={appointment.id} className="rounded-lg border border-rule bg-paper p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-ink-900">{patient?.name ?? "—"}</p>
                      <span className="text-[11px] text-ink-500">{formatDateTime(appointment.scheduledFor)}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-ink-500">
                      {appointment.reason} · {doctor?.fullName ?? "—"}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <Chip token={APPOINTMENT_STATUS_TOKENS[appointment.status]} />
                      <Chip token={ACUITY_TOKENS[appointment.acuity]} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <Modal
        open={triageTarget !== null}
        onClose={() => setTriageTarget(null)}
        title="Triage and check in"
        subtitle="Acuity drives the ordering of the clinician's queue and is visible to the whole care team."
        footer={
          <>
            <Button variant="ghost" onClick={() => setTriageTarget(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={commitCheckIn}>
              <Icon name="check" size={14} />
              Confirm check-in
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Triage acuity">
            <Select
              value={acuity}
              onChange={(value) => setAcuity(value as Acuity)}
              options={[
                { value: "critical", label: "Critical — immediate review" },
                { value: "urgent", label: "Urgent — same hour" },
                { value: "standard", label: "Standard — scheduled slot" },
                { value: "routine", label: "Routine — stable review" },
              ]}
            />
          </Field>

          <Field label="Assign clinician">
            <Select
              value={doctorId}
              onChange={setDoctorId}
              options={derived.doctors.map((doctor) => ({
                value: doctor.id,
                label: `${doctor.fullName} · ${doctor.department}`,
              }))}
            />
          </Field>

          <Field label="Presenting complaint and observations at the desk">
            <TextArea
              value={notes}
              onChange={setNotes}
              rows={3}
              placeholder="Vitals taken at reception, presenting complaint, escort details."
            />
          </Field>

          <div className={cx("rounded-lg border p-3", acuity === "critical" ? "border-risk-critical/45 bg-risk-critical/[0.08]" : "border-rule bg-paper")}>
            <p className="text-[11px] leading-relaxed text-ink-700">
              {acuity === "critical"
                ? "Critical acuity routes the patient straight to the top of the queue and flags the case on the clinician's list."
                : "Check-in records the acuity, places the patient in the queue and stamps the audit trail."}
            </p>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 3. Report intake                                                    */
/* ------------------------------------------------------------------ */

function ReportIntake() {
  const { state, derived, actions } = useApp();
  const patient = derived.patientsById.get(state.session.patientId) ?? null;
  const [category, setCategory] = useState<ReportCategory>("blood_panel");

  return (
    <div className="space-y-6">
      <Panel>
        <PanelHeader
          title="Outside report intake"
          subtitle="Front desk staff upload scanned or printed reports brought in by the patient so the treating team sees them on the same chart."
          icon={<Icon name="report" size={18} />}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Patient">
            <Select
              value={state.session.patientId}
              onChange={(value) => actions.setActivePatient(value)}
              options={Array.from(derived.patientsById.values()).map((item) => ({
                value: item.id,
                label: `${item.name} · ${item.mrn}`,
              }))}
            />
          </Field>
          <Field label="Suggested panel category" hint="Preselected in the uploader below.">
            <Select
              value={category}
              onChange={(value) => setCategory(value as ReportCategory)}
              options={(Object.keys(REPORT_CATEGORY_LABELS) as ReportCategory[]).map((key) => ({
                value: key,
                label: REPORT_CATEGORY_LABELS[key],
              }))}
            />
          </Field>
          <div className="flex items-end">
            <p className="text-[11px] leading-relaxed text-ink-400">
              Reception staff may upload and read a simplified report but cannot annotate it; physician notes are
              restricted to the clinical roles.
            </p>
          </div>
        </div>
      </Panel>

      {patient ? (
        <ReportSimplifier patientId={patient.id} patient={patient} canUpload canAnnotate={false} />
      ) : (
        <Panel>
          <EmptyState title="Select a patient" description="Choose the patient the report belongs to before uploading." />
        </Panel>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export default function ReceptionPortal() {
  const { state } = useApp();

  switch (state.activeView) {
    case "reception.register":
      return <RegistrationDesk />;
    case "reception.reports":
      return <ReportIntake />;
    case "reception.schedule":
    default:
      return <AppointmentDesk />;
  }
}
