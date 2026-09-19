# SmartMedic

An interactive prototype that unifies **hospital operations**, **predictive medicine shortage
intelligence**, and a **plain-language medical report simplifier** in a single client-side
application.

It runs immediately with **zero backend setup**. All state lives in a seeded in-memory database
persisted to `localStorage`, and every calculation runs in the browser.

> **Prototype notice.** This is a demonstration system built on synthetic data. It is not connected
> to any clinical system and does not process real patient information.

---

## What is in the box

| Subsystem | What it does |
|---|---|
| **Hospital operations** | Role portals for Admin, Doctor, Nurse, Receptionist, Cashier and Patient: triage registration, appointment scheduling, CPOE prescribing, bedside eMAR administration, ward stock, itemised invoicing and POS collection. |
| **Shortage intelligence** | Scores the whole formulary on a dynamic triangulated metric combining EWMA consumption velocity, dynamic supplier lead time, regional pressure and shelf-buffer depletion, then turns stranded ward stock into approvable inter-ward redistributions and a scenario sandbox. |
| **Report simplifier** | Drag-and-drop report ingestion, simulated OCR, biomarker dictionary matching, reference-range scoring, non-diagnostic plain-language explanations, longitudinal trendlines and an exportable disclaimered summary. |

---

## Quick start

```bash
npm install
npm run dev
```

Then open the URL Vite prints (default <http://localhost:5173>).

```bash
npm run typecheck   # tsc --noEmit
npm run build       # typecheck + production bundle
npm run preview     # serve the production bundle
```

There is nothing else to configure: no database, no `.env`, no API keys, no external services.

---

## The demo in five minutes

Use the **role switcher in the top bar** to move between all six portals. Every portal reads the same
seeded database, so an action taken as one role is immediately visible to the others.

**1 · Admin — find the problem.**
Land on the *Shortage control room*. Two molecules open at **Critical**: Augmentin 625 Duo (SPS 98,
**4.2 days of cover** against an 11.4-day dynamic lead time) and Meropenem 1g (SPS 92). Expand a
molecule with *Show evidence* to see the four triangulated signal legs, the EWMA burn curve against
its pre-surge baseline, the stock ledger separating physical, reserved and **stranded** stock, and
the per-ward cover table.

**2 · Admin — fix it without buying anything.**
In *Inter-ward redistribution*, the top proposal moves 6 insulin pens from the central store to
General Ward A for a projected **−14.1 point** drop. Press **Approve** and the score falls from 78 to
63.9 on the spot: ward stock is rebalanced, total facility stock is untouched, and the decision is
written to the redistribution ledger with the actor and timestamp. Proposals that cannot move the
score are filtered out rather than offered as a meaningless action.

**3 · Admin — pressure-test the forecast.**
*Scenario sandbox* re-runs the whole formulary under a demand surge, a distributor default, a
cold-chain write-off or a compound crisis, and shows which molecules escalate a risk band and what
happens to their days of cover. Live inventory is never mutated.

**4 · Receptionist — start an encounter.**
*Patient registration* issues a medical record number and captures the allergy record. Then
*Appointments & triage*: check a patient in, set the acuity, and place them in a clinician's queue.

**5 · Doctor — prescribe under real constraints.**
Open the *CPOE console* with **Aarav Menon** selected. Add Augmentin and the console raises a
**severe allergy conflict**: he has a recorded penicillin anaphylaxis, and the brand name never says
penicillin — the drug-class map catches it and offers in-stock Cefuroxime Axetil instead. On
**Priya Sharma**, Augmentin shows a critical stock guard with live days-of-cover and a sparkline.
Sign the prescription and the affected molecules are shown before and after: the course is dispensed
immediately and the shortage forecast moves while the doctor is still in the room.

**6 · Nurse — close the loop at the bedside.**
*eMAR round* shows the charted doses for the ward. Chart an overdue dose, capture the
pre-administration observation with it, and hold or refuse one to record a variance. *Ward stock*
shows the same holdings against each ward's own par level.

**7 · Cashier — bill the encounter.**
*Invoice desk* pulls the unbilled medication straight out of the patient's charted treatment, adds
standard tariff items and derives the totals. *POS checkout* collects by cash, card, UPI or insurance
claim and prints a receipt; part payments are capped at the outstanding balance.
*Reconciliation* shows the day book.

**8 · Patient — read it in plain language.**
Switch to the **Patient** role (Priya Sharma). Her four quarterly panels are already on file and
parsed. Open the latest: 15 recognised values, each with a reference range and an everyday-language
explanation, with the mandatory disclaimer pinned to the viewer and to every export. *Health trends*
draws each biomarker against its own reference band — HbA1c falling across four readings, creatinine
rising — and narrates direction of travel without ever asserting a diagnosis.

---

## Seeded scenario

A fresh seed produces this formulary. Figures are computed at boot and move as soon as anyone
prescribes, administers or transfers stock.

| Molecule | Risk band | SPS | Days of cover |
|---|---|--:|--:|
| Augmentin 625 Duo | **Critical** | 97.9 | 4.2 |
| Meropenem 1g Injection | **Critical** | 92.1 | 6.8 |
| Normal Saline 0.9% 500mL | High | 78.9 | 3.6 |
| Lantus Insulin Glargine | High | 78.0 | 6.9 |
| Adrenaline 1mg/mL | Moderate | 47.6 | 9.9 |
| Azithral 250 | Moderate | 42.8 | 11.3 |
| Asthalin Salbutamol 100mcg | Moderate | 42.6 | 7.9 |
| Emeset Ondansetron 4mg | Moderate | 39.7 | 7.0 |
| Ceftum Cefuroxime 500 | Normal | — | 33.6 |
| Dolo Paracetamol 500mg | Normal | — | 25.0 |
| Atorva 10mg | Normal | — | 34.2 |
| Amlopres Amlodipine 5mg | Normal | — | 34.4 |

Also seeded: 7 staff across 5 roles, 4 patient records (2 currently admitted), 6 appointments,
3 prescriptions, 14 eMAR entries with realistic variances, 3 invoices in three settlement states,
5 vitals records, **6 parsed laboratory reports**, and an initial audit trail.

Priya Sharma's history is the simplifier showcase: HbA1c falling `8.4 → 7.8 → 7.5 → 7.2`, creatinine
rising `1.1 → 1.2 → 1.3 → 1.4`, across panels dated 18, 11, 6 and 1 months ago.

**Reset demo** in the sidebar restores the opening scenario at any time. The stored snapshot is keyed
to the calendar day, so reopening the prototype tomorrow re-seeds rather than restoring a stale
appointment queue.

---

## How the forecasting works

The engine implements the formulation in [`docs/shortage-detection.md`](docs/shortage-detection.md):

```
D_t         = α·C_t + (1 − α)·D_{t−1}                    EWMA burn rate, α = 0.35
DIR         = (S_physical − S_allocated − S_stranded)/D_t
LT_dynamic  = LT_contracted · (1 + σ/μ) · R_vendor
SPS         = min(100, max(0, [1 − DIR/(LT_dynamic + SS_days)]·100 + Ψ))
```

Two design decisions are worth calling out.

**Stranded stock.** Inventory sitting above a ward's own par level is real, but it cannot serve a
ward that is short without a transfer, so it is excluded from effective cover. This is what makes an
inter-ward transfer a genuine risk-reduction action rather than bookkeeping: releasing stranded stock
raises effective cover without a single extra unit entering the building.

**Capped signal legs.** Ψ is assembled from four independently capped legs — demand surge, lead-time
slippage, regional pressure and buffer depletion — so no single signal can dominate a forecast on its
own, and every score is explainable by the evidence shown in its drill-down.

---

## Project structure

```text
smartmedic/
├── index.html
├── src/
│   ├── App.tsx                    # provider + shell + portal router
│   ├── types.ts                   # domain model shared by everything
│   ├── data/
│   │   ├── mockData.ts            # seeded in-memory database
│   │   └── scenarios.ts           # disruption presets for the sandbox
│   ├── engine/
│   │   ├── shortageEngine.ts      # EWMA, DIR, dynamic lead time, Ψ, SPS, transfers, sandbox
│   │   ├── reportEngine.ts        # biomarker dictionary, OCR simulation, trends
│   │   └── billingEngine.ts       # invoice totals, payment split, reconciliation
│   ├── store/
│   │   ├── reducer.ts             # pure reducer; every mutation writes one audit entry
│   │   └── AppStore.tsx           # provider, derived forecasts, localStorage persistence
│   ├── charts/                    # hand-written SVG: line, sparkline, gauge, bars, donut
│   ├── ui/                        # tokens, primitives, icons, navigation, shell
│   ├── components/                # report simplifier, medicine risk drill-down
│   └── pages/                     # one portal per role
└── docs/                          # architecture, schema, API and subsystem specifications
```

Each `engine/` module is pure: same inputs, same output, no global reads. That is what lets the
scenario sandbox re-forecast a hypothetical without touching live inventory, and what keeps the audit
ledger from drifting away from the data.

---

## Permissions

Role capability is enforced by the **navigation model**, not by hidden buttons: a cashier has no
route for the shortage control room. The full matrix is documented in
[`docs/user-roles.md`](docs/user-roles.md) and is also rendered inside the app under
*Governance & audit*.

---

## Deliberate limitations

- **OCR is simulated.** Text-bearing files (`.txt`, `.csv`) are read directly; PDF and image uploads
  resolve to a synthetic transcript for the selected panel category with realistic confidence
  scores. No recognition service is contacted and no file leaves the browser.
- **No authentication.** Roles are switched from the top bar for demonstration; there is no login,
  JWT, or server-side session.
- **No server.** The documented Node/Express/MongoDB/Redis stack in `docs/` is the production
  target; this prototype is the front end that would sit on top of it.
- **Unit values are illustrative.** Reference ranges describe typical adult values and are not
  age- or sex-adjusted.

---

## Licence

Unpublished prototype. All code in this repository was written for this project.
