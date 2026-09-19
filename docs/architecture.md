# Architecture

SmartMedic is a three-tier system: a React single-page application, a serverless TypeScript API, and
PostgreSQL with Supabase Auth. The forecasting, extraction and billing mathematics live in pure
modules that **both** the browser and the API import, so a rule cannot mean one thing on screen and
another in the database.

## Topology

```text
                    [ React 18 SPA — Vite, Tailwind ]
                                  │
                  Supabase access token + JSON over /api
                                  │
                                  ▼
                 [ Vercel serverless function: api/[...path] ]
                                  │
        ┌─────────────────────────┼─────────────────────────┐
        ▼                         ▼                         ▼
  [ Authentication ]      [ Domain services ]       [ Persistence ]
  Verify token with       Role checks, dispensing,  Repository interface
  Supabase Auth;          ward transfers, billing    ├─ supabase.ts  → Postgres
  resolve profiles row;   recomputation, patient     └─ memory.ts    → seeded dataset
  reject unprovisioned    scoping, audit ledger            (local development)
  users
        │                         │                         │
        └─────────────────────────┼─────────────────────────┘
                                  ▼
                    [ PostgreSQL on Supabase ]
                    RLS enabled, no permissive policy
```

## Layers

### Presentation (`src/`)

- `App.tsx` gates the application: credential check → record load → role portal. Nothing that renders
  clinical data is mounted before the API has returned a profile.
- `store/SessionProvider.tsx` owns the credential: Supabase session, token refresh, demo identity.
- `store/AppStore.tsx` owns the record: it boots from `GET /api/bootstrap`, applies mutations
  optimistically through `store/reducer.ts`, then reconciles with the rows the API committed.
- `ui/` holds the design system: tokens, primitives, a hand-drawn icon set, the navigation model and
  the shell. `charts/` holds hand-written SVG charts; there is no charting dependency.
- `engine/` is pure and shared with the server: shortage scoring, report extraction, billing.

### API (`api/`)

One catch-all serverless function dispatches to an explicit route table.

- `routes.ts` — matching, the response envelope, and error mapping.
- `auth.ts` — verifies the bearer token with Supabase (not merely decoding it) and resolves it to a
  `profiles` row. A valid user with no profile is rejected: a credential is not a role.
- `services.ts` — the rules that must not be forgeable. Stock is dispensed against the row read from
  the database, a ward transfer is re-applied server-side, invoice status is recomputed from the
  transaction ledger, `administeredBy` comes from the session rather than the payload, and a patient
  snapshot is filtered to that patient's own record before it is sent.
- `registry.ts` — the single declaration of how the domain model maps onto SQL, including which
  nested arrays are child tables and which are JSONB.
- `repo/` — the `Repository` interface with two implementations: Postgres via Supabase, and the
  in-memory seeded dataset used for local development.
- `config.ts` — environment resolution, and the rail that refuses to serve in production when the
  database is not configured.

### Data (`supabase/migrations/`)

PostgreSQL, with the schema and its rationale in [`database-schema.md`](database-schema.md). Row level
security is enabled on every table with no permissive policy, because the browser never queries the
tables: it calls the API.

## Subsystems

### 1. Hospital operations

Triage registration, appointment scheduling, CPOE prescribing with allergy and stock guards, bedside
eMAR administration with pre-dose vitals, ward-level holdings against par levels, itemised invoicing
and POS collection, and reconciliation. One encounter can be followed end to end by switching roles.

### 2. Shortage intelligence

A dynamic triangulated metric over the whole formulary: EWMA consumption velocity, dynamic supplier
lead time, regional pressure and shelf-buffer depletion, with stranded ward stock excluded from
effective cover so that an inter-ward transfer is a real risk-reduction action. Live proposals are
derived on read; decisions are stored. The formulation is in
[`shortage-detection.md`](shortage-detection.md).

### 3. Report simplifier

Browser-side ingestion, simulated OCR, a biomarker dictionary, reference-range scoring,
non-diagnostic plain-language explanations, longitudinal trends against each biomarker's own band, and
an exportable disclaimered summary. The extracted fields and transcript are persisted; the original
document is not. The pipeline is in [`report-simplifier.md`](report-simplifier.md).

## Security posture

- **Credentials** are held by Supabase Auth. Passwords never reach this application.
- **Authorisation** is enforced twice: the navigation model gives a role no route it cannot use, and
  the API re-checks the role on every write. The matrix is in [`user-roles.md`](user-roles.md).
- **Patient scoping** happens on the server, so a patient login cannot read another patient's results,
  the formulary position, or the audit ledger.
- **The audit ledger** is written by the server with the authenticated identity, and is append-only.
- **Secrets** are split: the service role key exists only in the API environment and must never carry
  a `VITE_` prefix, because Vite inlines those into the browser bundle.
- **Headers** are set in `vercel.json` (`X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy`).

## Deliberate omissions

Called out so they are not mistaken for oversights:

| Omitted | Why, and what it would take |
|---|---|
| Background job scheduler | Scoring runs on read and after writes, which is sufficient at this data volume. A hourly/daily batch would be the next step if history were archived. |
| Queue for OCR | Extraction is simulated in the browser; there is no asynchronous work to queue. |
| Object storage for report documents | The prototype persists parsed values only. Adding signed-URL storage is a schema-external decision about retention. |
| Rate limiting | Needed before public use; see the hardening checklist in [`deployment.md`](deployment.md). |
| Refresh-token rotation on the API | Supabase handles session refresh in the browser; the API only verifies. |
