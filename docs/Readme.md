# SmartMedic — product overview

This folder holds the specifications. For setup, credentials and the deployment checklist, start with
the [root README](../README.md).

## The problem

A hospital runs on three things that are usually three systems: the clinical record, the pharmacy
shelf, and the patient's understanding of their own results. When they are separate, a prescription is
written without knowing that the molecule has four days of cover left, a ward holds stock another ward
needs and neither can see it, and a patient leaves with a lab printout they cannot read.

SmartMedic puts one record underneath all three.

## The three subsystems

**Hospital operations.** Role portals for Admin, Doctor, Nurse, Receptionist, Cashier and Patient.
Registration and triage, scheduling, computerised prescribing with live stock and allergy guards,
bedside eMAR administration with pre-dose observations, ward holdings against par levels, itemised
invoicing, POS collection and reconciliation. Navigation is per role, and the API re-checks every
write, so a cashier has no route to the shortage control room and no way to reach it either.

**Predictive shortage intelligence.** A dynamic triangulated metric over the whole formulary:

- **Consumption velocity** — an EWMA burn rate, so a surge is detected while it is happening rather
  than in a monthly report.
- **Supply slippage** — contracted lead time adjusted by the vendor's observed delivery variance and
  reliability index.
- **Regional pressure** — how many neighbouring facilities are reporting the same molecule as
  constrained.
- **Buffer depletion** — mandatory safety stock expressed in days of cover.

Each leg is independently capped, so no single signal can dominate, and every score is explainable by
the evidence in its drill-down. Inventory sitting above a ward's own par level is *stranded*: it is
real, but it cannot serve a short ward without a transfer, which is why releasing it lowers risk
without buying a single extra unit.

**Medical report simplifier.** Ingestion of a lab report, extraction of each test with its value, unit
and reference range, an everyday-language explanation of what the biomarker measures, longitudinal
trends against each biomarker's own reference band, and an exportable summary carrying a mandatory
non-diagnostic disclaimer. It translates; it never diagnoses.

## Documentation map

| Document | Contents |
|---|---|
| [architecture.md](architecture.md) | System topology, layers, security posture, deliberate omissions |
| [database-schema.md](database-schema.md) | 19 tables, design rules, relationships |
| [api-reference.md](api-reference.md) | Endpoints, roles, request and response shapes, error codes |
| [deployment.md](deployment.md) | Signup and credential checklist, environment variables, troubleshooting |
| [shortage-detection.md](shortage-detection.md) | The forecasting formulation and its parameters |
| [report-simplifier.md](report-simplifier.md) | The extraction and explanation pipeline |
| [user-roles.md](user-roles.md) | The RBAC matrix |

## Status

A working prototype on synthetic data, deployed as described in the root README. It is not connected
to any clinical system and holds no real patient information.
