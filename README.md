# SmartMedic

A working full-stack system that unifies **hospital operations**, **predictive medicine shortage
intelligence**, and a **plain-language medical report simplifier**.

- **Front end** — React 18 + TypeScript single-page application built with Vite, styled with Tailwind.
- **API** — TypeScript serverless functions (`api/`) deployed on Vercel. All clinical, supply and
  financial rules live here, not in the browser.
- **Database** — PostgreSQL on Supabase, with a full relational schema in
  [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql).
- **Authentication** — Supabase Auth (email + password). Every request carries the caller's access
  token, and the API resolves it to a hospital profile that carries the role.

> **Prototype notice.** A demonstration system on synthetic data. It is not connected to any clinical
> system and holds no real patient information.

---

## What is in the box

| Subsystem | What it does |
|---|---|
| **Hospital operations** | Role portals for Admin, Doctor, Nurse, Receptionist, Cashier and Patient: triage registration, scheduling, CPOE prescribing, bedside eMAR administration, ward stock, itemised invoicing and POS collection. |
| **Shortage intelligence** | Scores the whole formulary on a dynamic triangulated metric combining EWMA consumption velocity, dynamic supplier lead time, regional pressure and shelf-buffer depletion, then turns stranded ward stock into approvable inter-ward redistributions and a scenario sandbox. |
| **Report simplifier** | Report ingestion, simulated OCR, biomarker dictionary matching, reference-range scoring, non-diagnostic plain-language explanations, longitudinal trendlines and an exportable disclaimered summary. |

---

## Quick start

### Option A — no credentials at all (recommended first run)

The API falls back to the seeded dataset when Supabase is not configured, so the entire stack runs
locally with nothing to sign up for.

```bash
npm install
npm run dev:stack     # API on :8787 + Vite on :5173, one terminal
```

Open <http://localhost:5173>. The sign-in screen lists the seeded identities; pick any of them and you
are in. No password is checked in this mode, and the API says so on every response.

Two terminals instead of one? `npm run dev:api` and `npm run dev`.

### Option B — against Postgres

```bash
cp .env.example .env         # fill in your Supabase values
npm run seed                 # schema must already be applied; see docs/deployment.md
npm run dev:stack
```

Now the sign-in screen requires a real password, and every change lands in Postgres.

```bash
npm run typecheck            # tsc --noEmit over src, api, server and scripts
npm run build                # typecheck + production bundle
npm run seed:dry-run         # show what the seed would write, change nothing
```

---

## Signing in

`npm run seed` provisions one account per seeded identity. All of them share the password
`SmartMedic@2026` (override with `SEED_DEMO_PASSWORD`), and all of them are confirmed, so no inbox is
involved.

| Role | Email |
|---|---|
| Admin | `meera.krishnan@smartmedic.io` |
| Doctor | `dr.sharma@smartmedic.io`, `dr.rao@smartmedic.io` |
| Nurse | `fatima.sheikh@smartmedic.io`, `joseph.thomas@smartmedic.io` |
| Receptionist | `kavya.nair@smartmedic.io` |
| Cashier | `arjun.deshpande@smartmedic.io` |
| Patient | `priya.sharma@example.com` (and three more) |

**Change or delete these before any real use.** They exist so the prototype can be demonstrated.

Staff accounts can still switch roles from the masthead, which is what makes the end-to-end walkthrough
below possible in one session. A patient account cannot: the switcher is withheld, it sees only its own
record, and the API refuses anything else regardless of what the client asks for.

---

## The demo in eight minutes

**1 · Admin — find the problem.**
Land on the *Shortage control room*. Two molecules open at **Critical**: Augmentin 625 Duo (SPS 98,
**4.2 days of cover** against an 11.4-day dynamic lead time) and Meropenem 1g (SPS 92). Expand a
molecule with *Show evidence* to see the four triangulated signal legs, the EWMA burn curve against
its pre-surge baseline, the stock ledger separating physical, reserved and **stranded** stock, and
the per-ward cover table.

**2 · Admin — fix it without buying anything.**
In *Inter-ward redistribution*, the top proposal moves stock from a ward holding above its par level
into a short one for a projected score drop. Press **Approve**: the ward holdings are rebalanced, the
facility total is untouched, the molecule's risk score falls, and the decision is written to the
redistribution ledger with the actor and timestamp. Proposals that cannot move the score are filtered
out rather than offered as a meaningless action.

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
Sign the prescription and the affected molecules are shown before and after. The dispense is applied
by the API against the stock row it reads from the database, so the figure that lands on screen is
the one Postgres holds.

**6 · Nurse — close the loop at the bedside.**
*eMAR round* shows the charted doses for the ward. Chart an overdue dose, capture the
pre-administration observation with it, and hold or refuse one to record a variance. *Ward stock*
shows the same holdings against each ward's own par level.

**7 · Cashier — bill the encounter.**
*Invoice desk* pulls the unbilled medication straight out of the patient's charted treatment, adds
standard tariff items and derives the totals. *POS checkout* collects by cash, card, UPI or insurance
claim and prints a receipt; part payments are capped at the outstanding balance. *Reconciliation*
shows the day book.

**8 · Patient — read it in plain language.**
Sign in as `priya.sharma@example.com`. Her four quarterly panels are already on file and parsed. Open
the latest: each value has a reference range and an everyday-language explanation, with the mandatory
disclaimer pinned to the viewer and to every export. *Health trends* draws each biomarker against its
own reference band — HbA1c falling across four readings, creatinine rising — and narrates direction of
travel without ever asserting a diagnosis.

*Reset to seeded state* in the sidebar (admins only) restores the opening scenario.

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
5 vitals records, 6 parsed laboratory reports, and an opening audit trail.

Priya Sharma's history is the simplifier showcase: HbA1c falling `8.4 → 7.8 → 7.5 → 7.2`, creatinine
rising `1.1 → 1.2 → 1.3 → 1.4`, across panels dated 18, 11, 6 and 1 months ago.

The same dataset is the seed source for both modes, so a local demo and a deployment show identical
figures.

---

## Architecture

```text
browser (React SPA)
      │  Supabase access token  +  JSON over /api
      ▼
Vercel serverless function  api/[...path].ts
      │  verify token → resolve profile → check role → run the rule
      ▼
Postgres (Supabase)  ·  RLS enabled on every table, no permissive policy
```

Four decisions shape the code:

**The API owns the rules.** A prescription does not send a new stock number; it sends the treatment,
and the API reads the medicine, dispenses through the same `dispenseStock` function the browser uses,
writes the result, and returns the row it committed. A ward transfer is re-applied server-side. An
invoice's status is recomputed from its transaction ledger. Optimistic UI is a latency trick, never a
source of truth.

**Audit entries are written by the server.** The ledger records the identity the API authenticated,
not one the client claimed. The browser keeps an optimistic copy for display and replaces it with the
ledger on the next load.

**The browser never touches Postgres.** It uses the anon key for credentials only. Every table has RLS
enabled with no permissive policy, so an anon-key query returns nothing; the API reads and writes with
the service role.

**Patients are scoped on the server.** A patient login receives its own record, its own reports and
invoices, and the consultant directory — and nothing else. The formulary, supply position, other
patients, and the audit ledger are filtered out before the response is sent.

### Forecasting

The engine implements the formulation in [`docs/shortage-detection.md`](docs/shortage-detection.md):

```
D_t         = α·C_t + (1 − α)·D_{t−1}                    EWMA burn rate, α = 0.35
DIR         = (S_physical − S_allocated − S_stranded)/D_t
LT_dynamic  = LT_contracted · (1 + σ/μ) · R_vendor
SPS         = min(100, max(0, [1 − DIR/(LT_dynamic + SS_days)]·100 + Ψ))
```

**Stranded stock.** Inventory sitting above a ward's own par level is real, but it cannot serve a ward
that is short without a transfer, so it is excluded from effective cover. This is what makes an
inter-ward transfer a genuine risk-reduction action rather than bookkeeping.

**Capped signal legs.** Ψ is assembled from four independently capped legs — demand surge, lead-time
slippage, regional pressure and buffer depletion — so no single signal can dominate a forecast on its
own, and every score is explainable by the evidence shown in its drill-down.

---

## Project structure

```text
smartmedic/
├── api/
│   ├── [...path].ts               # serverless entry point: one catch-all function
│   └── _lib/
│       ├── routes.ts              # route table + response envelope
│       ├── services.ts            # domain rules: dispense, transfer, billing, scoping
│       ├── auth.ts                # token verification → hospital profile
│       ├── registry.ts            # domain model → SQL columns, including child tables
│       ├── http.ts                # request contracts and validation helpers
│       ├── config.ts              # environment, and the production safety rail
│       └── repo/                  # Repository: supabase.ts, memory.ts, index.ts
├── supabase/migrations/           # schema, indexes, row level security
├── scripts/                       # seed.ts, dev-stack.mjs
├── server/dev.ts                  # local API server running the same router
├── src/
│   ├── App.tsx                    # session gate → store → shell → portal router
│   ├── types.ts                   # domain model shared by everything
│   ├── lib/                       # API client, Supabase auth client
│   ├── data/                      # seeded database, scenario presets
│   ├── engine/                    # shortage, report and billing engines (pure)
│   ├── store/                     # session provider, reducer, API-backed store
│   ├── charts/                    # hand-written SVG: line, sparkline, gauge, bars, donut
│   ├── ui/                        # tokens, primitives, icons, navigation, shell
│   ├── components/                # report simplifier, medicine risk drill-down
│   └── pages/                     # login + one portal per role
└── docs/                          # architecture, schema, API and subsystem specifications
```

Each `engine/` module is pure and shared: the API imports the same `dispenseStock`,
`applyWardTransfer` and `derivePaymentStatus` the browser uses, so a rule cannot mean one thing on
screen and another in the database.

---

## Permissions

Role capability is enforced twice over: the navigation model gives a role no route it cannot use, and
the API re-checks the role on every write. The full matrix is documented in
[`docs/user-roles.md`](docs/user-roles.md) and rendered in the app under *Governance & audit*.

| Endpoint | Roles |
|---|---|
| `POST /api/treatments` | doctor, admin |
| `POST /api/invoices`, `POST /api/invoices/:id/payments` | cashier, admin |
| `POST /api/transfers/:id/decision` | admin |
| `PATCH /api/administrations/:id` | nurse, doctor, admin |
| `POST /api/vitals` | nurse, doctor, admin |
| `POST /api/reports` | any authenticated role, patient scoped to self |
| `PATCH /api/reports/:id` | doctor, nurse, admin |
| `GET /api/bootstrap` | any authenticated role, filtered by role |

---

## Deployment

See [`docs/deployment.md`](docs/deployment.md) for the full checklist: creating the Supabase project,
applying the migration, seeding, and wiring the environment variables into Vercel. The short version:

1. Create a Supabase project, run `supabase/migrations/0001_init.sql` in the SQL editor.
2. `cp .env.example .env`, paste the project URL, anon key and service role key; `npm run seed`.
3. Import this repository into Vercel and add the same four variables to the project settings.
4. Deploy. `vercel.json` builds the SPA and mounts `api/[...path].ts` as the API.

---

## Deliberate limitations

- **OCR is simulated.** Text-bearing files (`.txt`, `.csv`) are read directly; PDF and image uploads
  resolve to a synthetic transcript for the selected panel category with realistic confidence scores.
  No recognition service is contacted.
- **Report files are not stored.** The parsed values, units, ranges and the raw transcript are
  persisted; the original document bytes are deliberately discarded.
- **No rate limiting.** `docs/deployment.md` lists it among the hardening steps that a real
  deployment needs.
- **Unit values are illustrative.** Reference ranges describe typical adult values and are not age- or
  sex-adjusted.
- **The service role key is required on the server.** It must never be given a `VITE_` prefix, because
  anything with that prefix is inlined into the browser bundle.

---

## Verification

What was run against this revision:

| Check | Result |
|---|---|
| `npx tsc --noEmit` (strict, `noUnusedLocals`, over `src` + `api` + `server` + `scripts`) | clean |
| `npm run build` | clean |
| 54 API assertions against the repository adapters | all passed |
| 14 reducer reconciliation assertions | all passed |
| All 19 role views rendered through the real shell and store | all rendered, no runtime errors |
| Live HTTP: health, bootstrap, role refusal (403), billing (200), unknown route (404) | as expected |
| Dev stack: SPA served, `/api` proxied, deep links resolve | as expected |

---

## Repository contributors

Commit `d54f0c7` (`patient-portal` readability) in this repository's history was authored by a
second contributor and is kept as-is, unrewritten — it is their work and it is not being
re-attributed. The commit is already published, so the project's history shows two authors. Every
other commit is by the repository owner.

---

## Licence

Unpublished prototype. All code in this repository was written for this project.
