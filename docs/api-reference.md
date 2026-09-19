# API Reference

Base URL: `/api` on the deployed origin. Locally, `npm run dev:api` serves the same surface on
`http://localhost:8787`, and Vite proxies `/api` to it.

The whole surface is one serverless function, `api/[...path].ts`, dispatched by the route table in
`api/_lib/routes.ts`.

## Authentication

Every endpoint except `GET /api/health` requires a Supabase access token:

```
Authorization: Bearer <access token>
```

The token is verified against the Supabase Auth server — not merely decoded — and then resolved to a
`profiles` row, which is what carries the role. A valid Supabase user with no profile is rejected with
`403 no_profile`; holding a credential is not the same as holding a role.

When the API runs without Supabase configuration (local development), authentication is replaced by an
identity header and no password is checked:

```
x-smartmedic-actor: demo-staff-nurse-1
```

This header is ignored in Supabase mode. The API refuses to start in production without either
Supabase credentials or an explicit `SMARTMEDIC_DEMO_MODE=1`.

## Response envelope

```json
{ "success": true, "data": { } }
```

```json
{
  "success": false,
  "error": { "code": "forbidden", "message": "…", "requestId": "…" }
}
```

### Error codes

| HTTP | Code | Meaning |
|--:|---|---|
| 400 | `invalid_body` | a field is missing, or of the wrong type |
| 400 | `unknown_medicine` | a prescription references a formulary id that does not exist |
| 400 | `invalid_amount` | a payment resolved to zero |
| 401 | `missing_token` / `invalid_token` | no bearer token, or one that failed verification |
| 403 | `forbidden` | the authenticated role may not perform this action |
| 403 | `no_profile` / `inactive_profile` | authenticated, but not provisioned or deactivated |
| 404 | `not_found` | no such route, or no such record |
| 405 | `method_not_allowed` | the path exists but not for this verb |
| 409 | `duplicate_id` | the client-generated identifier already exists — the client re-bootstraps |
| 503 | `not_configured` | the deployment is missing environment variables |
| 500 | `internal_error` | unhandled failure; the message is logged server-side |

## Mutation responses

Every mutating endpoint answers with the rows the server actually committed, for the client to merge
into its optimistic state:

```json
{
  "success": true,
  "data": {
    "applied": {
      "collections": { "medicines": [{ "id": "med-aug-625", "currentStock": 136 }] },
      "counters": { "audit": 7, "treatment": 4 }
    }
  }
}
```

Audit rows are not echoed back: the server writes the ledger with the identity it authenticated, and
the client adopts it on the next load.

---

## Reads

### `GET /health`
Public. Reports the mode and the role the caller resolved to, so a misconfigured deployment is
obvious without signing in.

```json
{ "status": "ok", "mode": "supabase", "actorRole": "admin" }
```

### `GET /bootstrap`
Any authenticated role. Returns the caller's profile and the hospital record, **filtered by role**:

```json
{
  "profile": { "id": "…", "fullName": "Meera Krishnan", "role": "admin", "staffId": "staff-admin-1" },
  "db": {
    "staff": [], "patients": [], "medicines": [], "appointments": [], "treatments": [],
    "administrations": [], "vitals": [], "invoices": [], "reports": [],
    "transferProposals": [], "alerts": [], "auditLog": [], "counters": {}
  },
  "mode": "supabase"
}
```

Staff receive the whole hospital record. A `patient` profile receives only its own patient row,
appointments, treatments, administrations, vitals, invoices and reports, plus the consultant
directory with contact details removed. The formulary, supply position, other patients, the alert
list and the audit ledger are omitted entirely, because they are not the patient's to see.

### `GET /demo/profiles`
Demo mode only. Lists the seeded identities so the offline sign-in screen can offer them.

---

## Clinical and front desk

| Method | Path | Roles | Notes |
|---|---|---|---|
| `POST` | `/patients` | admin, receptionist, doctor, nurse | registers a patient; body `{ patient }` |
| `PATCH` | `/patients/:id` | admin, doctor, nurse, receptionist | condition resolve/reactivate: body `{ condition, action }` |
| `POST` | `/appointments` | admin, receptionist, doctor, nurse, patient (self only) | body `{ appointment }` |
| `PATCH` | `/appointments/:id` | admin, receptionist, doctor, nurse | status, queue position, triage or reassignment |
| `POST` | `/treatments` | doctor, admin | consultation plus prescription; **dispenses stock server-side** |
| `PATCH` | `/administrations/:id` | nurse, doctor, admin | body `{ status, vitalsId, notes }`; `administeredBy` comes from the session, never the payload |
| `POST` | `/vitals` | nurse, doctor, admin | body `{ vitals }`; `recordedBy` and `recordedAt` are stamped by the server |

### Dispensing is authoritative

`POST /treatments` does not accept a new stock figure. It reads each prescribed medicine from the
database, applies the same `dispenseStock` the browser uses, writes the result, and returns the row it
committed:

```json
{
  "treatment": {
    "id": "treat-0004",
    "patientId": "patient-1",
    "doctorId": "staff-doctor-1",
    "diagnosis": "Acute bacterial sinusitis",
    "icd10Code": "J01.90",
    "linkedReportIds": [],
    "notes": "",
    "createdAt": "2026-09-19T10:00:00.000Z",
    "prescriptions": [
      { "id": "rx-0004-1", "medicineId": "med-aug-625", "drugName": "Augmentin 625 Duo",
        "dosage": "625mg", "frequency": "twice_daily", "durationDays": 5, "quantity": 20,
        "route": "oral", "instructions": "After food", "substituteFor": null,
        "dispenseStatus": "dispensed", "stockAdvisory": null }
    ]
  }
}
```

Two clinicians prescribing at the same time cannot both subtract from the same stale number, and stock
clamps at zero rather than going negative.

---

## Billing

| Method | Path | Roles | Notes |
|---|---|---|---|
| `POST` | `/invoices` | cashier, admin | body `{ invoice }` with its line items |
| `POST` | `/invoices/:id/payments` | cashier, admin | body `{ paymentMethod, amount, reference }` |

A payment is added to the invoice's transaction ledger and the status is recomputed from that ledger,
so part payments, over-collection and settlement are consistent by construction. Over-collection is
clamped to the outstanding balance; a request that resolves to zero is rejected.

---

## Report simplifier

| Method | Path | Roles | Notes |
|---|---|---|---|
| `POST` | `/reports` | any authenticated role; a patient only for itself | body `{ report }` including the extracted fields |
| `PATCH` | `/reports/:id` | doctor, nurse, admin | `{ doctorNotes }`, or `{ archived, resolvedReason }` |
| `POST` | `/inquiries` | any authenticated role; a patient only for itself | recorded in the audit ledger |

Extraction (simulated OCR, dictionary matching, reference-range scoring, plain-language text) runs in
the browser in `src/engine/reportEngine.ts`; the API stores the result and enforces who may attach it
to whom. Original document bytes are never uploaded.

---

## Shortage intelligence

| Method | Path | Roles | Notes |
|---|---|---|---|
| `POST` | `/transfers/:id/decision` | admin | body `{ proposal, decision }` |
| `POST` | `/alerts/:id/acknowledge` | admin, doctor, nurse | body `{ alert }` |

Live redistribution proposals are derived on read by the engine and are not stored. A decision is
stored, and when it is an approval the API re-applies the ward move itself:

```json
{
  "proposal": {
    "id": "proposal-med-ins-glar-1-CENTRAL_STORE-GENERAL_A",
    "medicineId": "med-ins-glar",
    "drugName": "Lantus Insulin Glargine",
    "fromWard": "CENTRAL_STORE",
    "toWard": "GENERAL_A",
    "quantity": 6,
    "surplusAtSource": 37,
    "deficitAtTarget": 0,
    "rationale": "…",
    "estimatedSpsDrop": 14.1,
    "wardsRecovered": 1,
    "status": "proposed"
  },
  "decision": "approved"
}
```

Only the ward holdings change: the facility total is untouched, which is what makes a redistribution
stock-neutral.

---

## Administration

| Method | Path | Roles | Notes |
|---|---|---|---|
| `POST` | `/demo/reset` | admin | restores the seeded dataset; staff, patients and auth users survive |
| `GET` | `/health` | public | liveness and mode |
