# Deployment

Everything in this document marked **you** is a step that has to happen in a browser, because it
creates an account or a secret. Everything else is already in the repository.

- **Database + authentication**: Supabase (PostgreSQL + Auth). The free tier is enough.
- **Hosting**: Vercel. The free tier is enough, and one project serves both the SPA and the API.
- **Local development needs no accounts at all**: the API falls back to the seeded dataset.

---

## 0. The checklist

| # | Task | Where | Who |
|---|---|---|---|
| 1 | Create the Supabase project | <https://supabase.com/dashboard> | you |
| 2 | Apply `supabase/migrations/0001_init.sql` | Supabase → SQL Editor | you |
| 3 | Copy five values into `.env` | your machine | you |
| 4 | Run `npm run seed` | your terminal | either of us |
| 5 | Import the repository into Vercel | <https://vercel.com/new> | you |
| 6 | Add the same five values in Vercel | Vercel → Settings → Environment Variables | you |
| 7 | Deploy and sign in | Vercel | either of us |
| 8 | Replace or delete the demo accounts | Supabase → Authentication → Users | you, before real use |

Hand me the values from steps 1–3 and I will do steps 4 and 7.

---

## 1. Supabase project

1. Sign in at <https://supabase.com/dashboard> and choose **New project**.
2. Name it (for example `smartmedic`), set a database password, and pick the region closest to you.
   Keep that password somewhere safe; this application does not need it, but you cannot recover it
   later.
3. Wait for provisioning to finish — a minute or two.

### Where the credentials live

**Project Settings → API** is the page needed for steps 1 and 6:

| Value on that page | Environment variable | Secret? |
|---|---|---|
| Project URL | `SUPABASE_URL` **and** `VITE_SUPABASE_URL` | public |
| `anon` / `public` key | `SUPABASE_ANON_KEY` **and** `VITE_SUPABASE_ANON_KEY` | public |
| `service_role` key | `SUPABASE_SERVICE_ROLE_KEY` | **secret** |

The URL and anon key are public by design. They identify the project; they do not authorise access to
data, because every table has row level security enabled with no permissive policy, and the browser
never queries the tables directly anyway. The service role key bypasses RLS entirely, so it belongs on
the server only — never in a variable whose name starts with `VITE_`, because Vite inlines those into
the browser bundle.

### Apply the schema

**Supabase → SQL Editor → New query**: open
`supabase/migrations/0001_init.sql`, paste the whole file, and press **Run**. It creates 19 tables with
their indexes and foreign keys, and enables row level security on each one. The script is idempotent,
so re-running is safe.

Prefer the CLI?

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

The project ref is the subdomain of your project URL.

**Verify**: the Table Editor now lists `patients`, `medicines`, `ward_stock`, `medical_reports`,
`audit_log` and the rest — all empty.

---

## 2. Local configuration

```bash
cp .env.example .env
```

Fill in five values:

```env
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

The URL and anon key appear twice on purpose: the `VITE_` pair is compiled into the browser bundle at
build time, while the other pair is read by the API at runtime. `.env` is git-ignored.

Sanity check that writes nothing:

```bash
npm run seed:dry-run
```

---

## 3. Seed the database

```bash
npm run seed
```

That does three things:

1. writes the clinical dataset through the same repository the API uses — staff, patients, medicines
   with per-ward holdings, appointments, prescriptions, eMAR records, vitals, invoices, reports with
   their extracted fields, and the ID counters;
2. creates one Supabase auth user per seeded identity, with the email address confirmed so no inbox is
   involved;
3. links each auth user to a `profiles` row, which is what carries the role.

It prints every account it provisioned. They all use the password `SmartMedic@2026`, overridable with
`SEED_DEMO_PASSWORD`. Re-running is safe: rows are upserted, passwords reset, and records created
during a session pruned.

**Verify**: sign in locally with `npm run dev:stack`, or check that **Authentication → Users** lists 11
accounts and the Table Editor shows rows in `medicines`.

---

## 4. Vercel

1. <https://vercel.com/new> → **Import Git Repository** → choose this repository.
2. Vercel reads `vercel.json`: framework `vite`, build `npm run build`, output `dist`. Leave the
   defaults alone.
3. **Settings → Environment Variables** — add these five for *Production*, *Preview* and *Development*:

   | Name | Value | Notes |
   |---|---|---|
   | `SUPABASE_URL` | project URL | server only |
   | `SUPABASE_ANON_KEY` | anon key | server only |
   | `SUPABASE_SERVICE_ROLE_KEY` | service role key | server only, secret |
   | `VITE_SUPABASE_URL` | project URL | optional, see below |
   | `VITE_SUPABASE_ANON_KEY` | anon key | optional, see below |

   Do **not** set `SMARTMEDIC_DEMO_MODE` on a real deployment: it makes the API serve the seeded
   dataset in memory and accept the demo identity header.

   The two `VITE_` values are optional. They are inlined when the bundle is produced, so a deploy
   built without them would have a sign-in form and nothing to sign in to — which is why the API
   publishes the same publishable settings from `/api/health` and the browser reads them at runtime.
   Set them if you like (the password then never leaves the identity provider's own API), leave them
   out and nothing breaks. Both are public either way.

4. **Deploy.**

Whatever you set now is only read at build time for `VITE_` values, so redeploy after changing them.

### How the API is deployed

The whole API is one serverless function, `api/index.ts`, and `vercel.json` rewrites `/api/*` onto it.
Everything under `api/_lib/` is a supporting module. Four details are load-bearing, and each of them
was a real deployment failure on this project before it was understood:

- **A catch-all filename does not work here.** `api/[...path].ts` is the *Next.js* routing convention.
  In a plain Vite project Vercel does not serve `/api/health` from a bracketed filename, so that layout
  deploys a function that nothing can reach — and every call answers with Vercel's own 404 page.
- **The matched route travels in a query parameter.** Because the platform's behaviour around a
  rewrite is not something to depend on, `/api/(.*)` is rewritten to
  `/api/index?__route=$1` and the handler routes on `__route` (`ROUTE_PARAM` in `api/_lib/http.ts`,
  read from the same name in `vercel.json`). The browser URL is unchanged — a rewrite is not a
  redirect — and both the rewritten and the pass-through shapes resolve identically.
- **Underscored names stay out of the function list.** Vercel ignores files and directories whose
  names begin with `_`, which is why the router and services live in `api/_lib/` without becoming
  endpoints of their own.
- **Relative imports inside `api/` carry an explicit `.js` extension** (`from "./_lib/routes.js"`).
  The package is `"type": "module"`, so Vercel emits ES modules and Node's ESM resolver requires the
  extension. The extensionless form typechecks and bundles fine, then fails *only* once deployed.

`npm run verify:deploy` reproduces that compilation, boots the result over HTTP, checks that the
rewrite and the handler agree on the parameter name, and exercises both request shapes — so any of
these failures shows up locally instead of on the live site.

---

## 5. Verify the deployment

```bash
curl -s https://<your-app>.vercel.app/api/health
# {"success":true,"data":{"status":"ok","mode":"supabase","authenticated":false,"actorRole":null,"auth":{...}}}
```

`mode` must read `supabase`. If it reads `demo`, the server variables did not reach the function. If
this returns a Vercel 404 page rather than JSON, the function itself did not deploy — see the first
two rows of §9.

A second check, which exercises the same path the browser uses after signing in:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<your-app>.vercel.app/api/bootstrap
# 401
```

`401` is the correct answer for an unauthenticated request. Anything else — `200`, or a page of HTML
— means the API is not enforcing authentication and should be investigated before using the site.

Then open the app and sign in as `meera.krishnan@smartmedic.io`. To confirm the write path is live,
approve an inter-ward transfer in the *Shortage control room* and check that `transfer_proposals` and
`audit_log` each gained a row in the Supabase Table Editor.

---

## 6. Environment variables, in full

| Variable | Used by | Required | Purpose |
|---|---|---|---|
| `SUPABASE_URL` | API | yes | Postgres and Auth endpoint |
| `SUPABASE_ANON_KEY` | API | yes | verifies caller access tokens |
| `SUPABASE_SERVICE_ROLE_KEY` | API, seed script | yes | reads and writes the tables |
| `VITE_SUPABASE_URL` | browser | no | Supabase Auth, read from `/api/health` when absent |
| `VITE_SUPABASE_ANON_KEY` | browser | no | Supabase Auth, read from `/api/health` when absent |
| `SMARTMEDIC_DEMO_MODE` | API | no | serve the seeded dataset instead of Postgres |
| `SEED_DEMO_PASSWORD` | seed script | no | password for the provisioned accounts |
| `PORT` | `npm run dev:api` | no | local API port, default `8787` |

### The safety rail

If the API runs in production without the three Supabase variables and without an explicit
`SMARTMEDIC_DEMO_MODE=1`, it refuses to serve: it answers `503 not_configured` and names the missing
variables. A half-configured deployment therefore fails loudly instead of quietly serving seeded data
to the public.

---

## 7. Local development without Supabase

Nothing is required. With no `.env`, the API runs against the seeded dataset in memory, the sign-in
screen lists the seeded identities, and no password is checked. This is the fastest way to review the
application, and it is the mode every verification step in the README was run against.

---

## 8. Before real use

- [ ] Change or delete the seeded accounts (Supabase → Authentication → Users).
- [ ] Rotate the service role key if it has ever been pasted somewhere untrusted.
- [ ] Add rate limiting on the authentication paths and on report uploads. Vercel's WAF or Upstash Rate
      Limit are the usual choices. **Not implemented.**
- [ ] Store uploaded report documents in private object storage with signed URLs, if the original
      documents must be retained. Today only the parsed values and the OCR transcript are persisted.
- [ ] Replace the simulated OCR with a real extraction service, and record its per-field confidence.
- [ ] Enable point-in-time recovery on the Supabase project and actually test a restore.
- [ ] Add a content security policy. `vercel.json` currently sets `X-Frame-Options`,
      `X-Content-Type-Options` and `Referrer-Policy` only.
- [ ] Never set an AI provider key as `VITE_*`. Everything with that prefix is compiled into the
      browser bundle and is readable by anyone. The report simplifier is designed around this: it
      takes a key from the operator at run time, stored in their own browser, and works fully without
      one.
- [ ] Decide on audit retention. The ledger is append-only and nothing prunes it yet.

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Sign-in appears to work, then the app reports it could not reach the API; every `/api/...` call answers 404 | the serverless function is not reachable — the entry point is missing, was renamed to something starting with `_` (which Vercel ignores), or was given a bracketed catch-all filename (which only works in Next.js) | keep `api/index.ts` and its `/api/(.*)` rewrite in `vercel.json`, then redeploy; confirm with `curl .../api/health` |
| `503 not_configured`, or the sign-in page reports a configuration problem | the API has no Supabase variables | add them, redeploy |
| The sign-in page lists demo identities on a real deployment | the API is in demo mode, so the browser follows it | check `curl .../api/health`; remove `SMARTMEDIC_DEMO_MODE` and set the three server variables |
| `/api/health` reports `mode: demo` in production | as above, or `SMARTMEDIC_DEMO_MODE` is set | remove the flag, add the variables |
| `403 no_profile` after a successful sign-in | the auth user has no matching `profiles` row | run `npm run seed` |
| Sign-in works but every screen is empty | the migration was not applied, or the seed did not run | apply the SQL, then `npm run seed` |
| The seed reports it could not read the auth users | the migration has not been applied | apply it, then re-run |
| A write shows *Save failed · retry* in the masthead | the API rejected it, or the connection dropped | hover the banner for the reason; the record reloads automatically |
| `Port 8787 is already in use` | an earlier `dev:api` is still running | stop it, or `PORT=8888 npm run dev:api` |
| The browser cannot reach `/api` locally | only Vite is running | use `npm run dev:stack` |
