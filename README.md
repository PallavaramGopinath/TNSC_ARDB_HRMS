# TNSC ARDB — HR & Payroll

The HR and Payroll application for the Tamil Nadu Co-operative State Agriculture & Rural Development Bank. It is a port of the HR and Payroll modules of **TNCU_GAMS** (Blazor / .NET 10) to:

- **React** (Vite, TypeScript, Tailwind)
- **Express** (TypeScript, MVC)
- **PostgreSQL** (Kysely)

The EPF Trust module will plug into the extension points described below.

- The functional spec extracted from TNCU, and the ARDB decisions that differ from it, are in [docs/tncu-gams-extraction.md](docs/tncu-gams-extraction.md).
- The database baseline is [database/schema.sql](database/schema.sql), with seed data in [database/seed.sql](database/seed.sql).

## Layout

```
backend/src
  config/        env (zod-validated), db (Kysely + pg), logger (pino)
  middleware/    requestContext, auth (JWT), authorize (role / HeadOffice / module M·C), validate (zod), errorHandler
  models/        db.types (Kysely tables), enums, auth types, zod request schemas per module
  controllers/   thin HTTP adapters per module (auth, core, hr, payroll)
  services/      business rules per module; all writes go through lib/dbContext.withAudit
  lib/           money (exact TNCU rounding), makerChecker, settings, dates, errors
  modules/       registry + hr / payroll / epf module descriptors
  routes/        index + per-module routers
  server.ts      entry point
frontend/src
  components/    layout (AppShell, Sidebar rail + panel, TopBar), ui (Button, Field, DataTable, Modal…)
  pages/         auth, hr, payroll, epf (placeholder), Dashboard, fallbacks
  modules/       per-module route registries (hr, payroll, epf)
  services/      axios client with refresh, plus auth / menu / hr / payroll APIs
  App.tsx        routes and auth guards
database/
  schema.sql     schemas core, auth, audit, hr, payroll, epf
  seed.sql       place categories, HO branch, FY, rule settings, leave types, components, rates, menu, admin
  migrations/    0002_drop_party_master.sql (KYC fields onto employees) and later files (see migrations/README.md)
docs/            reference material (e.g. the TNCU extraction)
specs/           feature specs in Markdown, NNN-short-title.md (see specs/README.md)
```

## First-time setup

1. **Prerequisites:** Node 22 and PostgreSQL 14 or later. Node from Homebrew is keg-only, so add it to your PATH:

   ```bash
   echo 'export PATH="/opt/homebrew/opt/node@22/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
   ```

2. **Create the database** as the postgres superuser:

   ```bash
   psql -h localhost -U postgres -c "CREATE ROLE ardb LOGIN PASSWORD 'choose-a-password';" -c "CREATE DATABASE tnsc_ardb_hrms OWNER ardb;"
   ```

3. **Configure:** copy the env template and set `DATABASE_URL` and a random `JWT_SECRET`:

   ```bash
   cp backend/.env.example backend/.env
   ```

4. **Install, migrate and seed:**

   ```bash
   npm install
   ```

   ```bash
   npm run db:migrate && npm run db:seed
   ```

5. **Run:** the API listens on :4000 and the web app on :5173 (it proxies `/api`).

   ```bash
   npm run dev
   ```

6. **Sign in** as `admin` with the initial password from `database/seed.sql`. You must change it on first login.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API (tsx watch) and web (Vite) together |
| `npm run build` | Type-check and build both workspaces |
| `npm test` | Backend unit tests, including TNCU parity values for rounding, segments, gratuity and increments |
| `npm run db:migrate` | Apply the baseline (if the DB is empty), then pending `database/migrations/*.sql` |
| `npm run db:seed` | Re-run the idempotent seed (menu, settings, masters) |
| `npm run db:codegen -w backend` | Generate Kysely types for every table from the live DB |

## Conventions carried over from TNCU

**Data**
- Money is stored as `numeric`. The API returns it as a string, and arithmetic uses `decimal.js` through `lib/money.ts`.
- `RoundRupee` rounds half-up to the whole rupee. Loan interest uses banker's rounding to paise.
- Enums are stored as `varchar` with a `CHECK` constraint.
- Business dates are `date` values exchanged as `'YYYY-MM-DD'`. The business date is today in Asia/Kolkata; there is no day-begin or day-end.

**Audit**
- Every write runs in `withAudit(actor, trx => …)`. It sets `app.user_*`, and the `audit.log_row_change()` trigger records the column-level diff.
- Explicit security and approval events go to `audit.activity_logs`.

**Maker-checker**
- The guards are in `lib/makerChecker.ts`: the maker cannot approve their own entry unless Admin, nobody may reject their own entry, and only the maker or Admin may withdraw.

**Access**
- Users receive module grants (`auth.user_modules`), which become the JWT claim `mods:{menuId: M|C|MC}`.
- Roles are derived from the grants. HR and Payroll are Head-Office modules.

**Rule values**
- Increment cycle, PF %, leave-credit constants, caps and similar values live in `core.app_settings` (effective-dated). Read them with `getSetting()`.

## Adding a module (the EPF Trust path)

1. **Database:** create `database/migrations/000N_epf_*.sql` with tables in the `epf` schema, and attach `trg_audit`. Payroll already writes `payroll.pf_contribution_events` when bills are paid; the EPF module consumes those rows and sets `consumed_at`.
2. **Backend:** implement `backend/src/modules/epf.module.ts` (routes, controllers, services under `*/epf/`), then add `epf` to `MODULES_ENABLED`.
3. **Menu:** set `is_active = true` on menu main `12000040` and add its subs and forms in `database/seed.sql`. Grant the module to users.
4. **Frontend:** add pages under `frontend/src/pages/epf/` and register them in `frontend/src/modules/epf.tsx`. The sidebar picks them up from the server menu.
