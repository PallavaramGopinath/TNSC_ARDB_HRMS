# Spec: HRA & CCA Rates — Configurable Calculation Basis (Place / Designation)

| Item | Detail |
|---|---|
| Module | Payroll → Masters → HRA & CCA Rates; Admin → Organisation Settings |
| Primary table | `payroll.payroll_hra_cca_rates` |
| Related tables | `employees` (`branch_id`, `designation_id`), branches, places, designations, organisations |
| Triggering requirement | Tamil Nadu Cooperative State Agriculture and Rural Development Bank (TNCSARDB) fixes HRA/CCA % by **designation**, not by place |
| Status | Implemented (masters, basis setting, resolver); payroll-run wiring pending the calculator |
| Date | 07-Nov-2026 |

> **Note on assumptions:** this spec was drafted without access to the actual DDL. Column names other than `place_id`, `designation_id` and `branch_id` are assumed and marked *(assumed)*. See **§12 Implementation notes** for how it maps onto the real schema.

---

## 1. Background

Today `payroll.payroll_hra_cca_rates` stores HRA % and CCA % per `place_id`. During payroll, an employee's rate is looked up from the place of their posting (branch → place).

TNCSARDB does not follow place-wise rates. It fixes the HRA and CCA percentages **by designation** (`employees.designation_id`). The current model cannot express this.

## 2. Recommendation

**Yes, offer an organisation-level option.** Each organisation chooses one **HRA/CCA Calculation Basis** in the Admin menu:

| Option | Code | Rate is looked up by | Typical users |
|---|---|---|---|
| Place of posting (Branch) | `PLACE` | `employees.branch_id` → branch's `place_id` | Most cooperative banks / govt-pattern orgs (default) |
| Designation | `DESIGNATION` | `employees.designation_id` | TNCSARDB |

Reasons:

1. **No impact on existing organisations.** Default is `PLACE`, so current behaviour is unchanged.
2. **One rate table, one calculation engine.** The basis only changes which key is used for the lookup.
3. **Extensible.** A combined basis (`PLACE_DESIGNATION`, i.e. rate per place *and* designation) can be added later without redesign (see §10).

### 2.1 Why keep `place_id`, not `branch_id`, for the PLACE option

HRA/CCA classifications (city class A/B/C, etc.) attach to the **place**, and many branches share one place. Keeping the rate on `place_id` avoids duplicating rates per branch. The employee's branch is used only to find the place. The UI label shows "Place of posting (Branch)" so users understand the link.

## 3. Data model changes

### 3.1 Organisation setting

Add the basis to the organisation's payroll settings. If a payroll settings table already exists, add the column there; otherwise add it to the organisations table.

```sql
-- Option A: existing payroll settings table (preferred if present)
ALTER TABLE payroll.payroll_settings            -- (assumed name)
    ADD COLUMN hra_cca_basis VARCHAR(20) NOT NULL DEFAULT 'PLACE',
    ADD CONSTRAINT chk_hra_cca_basis
        CHECK (hra_cca_basis IN ('PLACE', 'DESIGNATION'));
```

The change history of this setting must be kept (who, when, old → new) in the audit log (§8).

### 3.2 `payroll.payroll_hra_cca_rates`

1. Add `designation_id` (nullable, FK to designations).
2. Make `place_id` nullable.
3. Add `rate_basis` on each row, so every row says which key it uses and old rows remain valid if the organisation later switches basis.
4. Enforce **exactly one key per row, matching its basis**.

```sql
ALTER TABLE payroll.payroll_hra_cca_rates
    ADD COLUMN rate_basis      VARCHAR(20) NOT NULL DEFAULT 'PLACE',
    ADD COLUMN designation_id  INTEGER NULL
        REFERENCES designations(designation_id),          -- (assumed PK/table name)
    ALTER COLUMN place_id DROP NOT NULL;

ALTER TABLE payroll.payroll_hra_cca_rates
    ADD CONSTRAINT chk_hra_cca_rate_basis
        CHECK (rate_basis IN ('PLACE', 'DESIGNATION')),
    ADD CONSTRAINT chk_hra_cca_key_matches_basis
        CHECK (
            (rate_basis = 'PLACE'       AND place_id IS NOT NULL AND designation_id IS NULL)
         OR (rate_basis = 'DESIGNATION' AND designation_id IS NOT NULL AND place_id IS NULL)
        ),
    ADD CONSTRAINT chk_hra_cca_percent_range
        CHECK (hra_percent BETWEEN 0 AND 100 AND cca_percent BETWEEN 0 AND 100); -- (assumed cols)

-- No two rates for the same key may start on the same date
CREATE UNIQUE INDEX ux_hra_cca_place_eff
    ON payroll.payroll_hra_cca_rates (organisation_id, place_id, effective_from)
    WHERE rate_basis = 'PLACE' AND is_active;
CREATE UNIQUE INDEX ux_hra_cca_desig_eff
    ON payroll.payroll_hra_cca_rates (organisation_id, designation_id, effective_from)
    WHERE rate_basis = 'DESIGNATION' AND is_active;

-- Lookup performance
CREATE INDEX ix_hra_cca_lookup_desig
    ON payroll.payroll_hra_cca_rates (organisation_id, designation_id, effective_from DESC)
    WHERE rate_basis = 'DESIGNATION';
```

**Overlapping periods:** two active rows for the same key must not have overlapping `effective_from`–`effective_to` ranges. Enforce this in the service layer. Optionally, also use a PostgreSQL exclusion constraint on `daterange(effective_from, effective_to, '[]')` with `btree_gist`.

### 3.3 Resulting table shape *(assumed columns marked)*

| Column | Type | Notes |
|---|---|---|
| `id` | serial / bigint | PK *(assumed)* |
| `organisation_id` | int | *(assumed)* |
| `rate_basis` | varchar(20) | **new**, `PLACE` \| `DESIGNATION` |
| `place_id` | int, **nullable** | required when basis = PLACE |
| `designation_id` | int, nullable | **new**, required when basis = DESIGNATION |
| `hra_percent` | numeric(5,2) | *(assumed)* |
| `cca_percent` | numeric(5,2) | *(assumed)* |
| `effective_from` | date | *(assumed)* |
| `effective_to` | date, nullable | null = open-ended *(assumed)* |
| `remarks` | text, nullable | **new (optional)**, e.g. G.O./circular reference |
| `is_active` | boolean | *(assumed)* |
| `created_by/at`, `updated_by/at` | audit | *(assumed)* |

### 3.4 Migration

1. Back-fill `rate_basis = 'PLACE'` for all existing rows (handled by the column default).
2. Set `hra_cca_basis = 'PLACE'` for all existing organisations.
3. For TNCSARDB: switch the basis to `DESIGNATION` and enter designation-wise rates through the new UI or a one-time seed script.
4. Write a reversible down-migration. It drops the new constraints, indexes and columns, and is only allowed if no `DESIGNATION` rows exist.

## 4. Calculation logic

### 4.1 Rate resolution

For each employee *E* in payroll period *P* (period end date `d`):

```
basis = organisation(E).hra_cca_basis

if basis == 'PLACE':
    key = place_id of E's branch as on d
    row = rates WHERE org = E.org AND rate_basis = 'PLACE'
                  AND place_id = key
else:  -- DESIGNATION
    key = E.designation_id as on d
    row = rates WHERE org = E.org AND rate_basis = 'DESIGNATION'
                  AND designation_id = key

row = row AND is_active
          AND effective_from <= d
          AND (effective_to IS NULL OR effective_to >= d)
      ORDER BY effective_from DESC LIMIT 1

HRA = round(HRA_base(E, P) × row.hra_percent / 100)
CCA = round(CCA_base(E, P) × row.cca_percent / 100)
```

* `HRA_base` / `CCA_base`: unchanged from current logic (e.g. Basic, or Basic + DA as configured). This spec changes only **which rate is chosen**, not the wage base or rounding rule.
* Implement as one function/service, e.g. `HraCcaRateResolver.Resolve(employeeId, periodEndDate)`, which returns `{ rateId, basis, key, hraPercent, ccaPercent }` or a "not found" result. Every caller (payroll run, salary preview, arrears, payslip) uses this function.
* Store `hra_cca_rate_id` (or the resolved percentages) on the payroll line, so past payslips stay reproducible after rates change.

### 4.2 Mid-period changes

| Event | Rule |
|---|---|
| Transfer to another branch/place (PLACE basis) | Follow existing proration rules for transfers. If none exist, use the posting as on the period end date. |
| Promotion / designation change (DESIGNATION basis) | Same principle: if the system prorates pay on promotion, prorate HRA/CCA by days in each designation; otherwise use the designation as on the period end date. |
| Rate revision with effective date inside the period | Prorate by days if the existing engine supports it; otherwise apply the rate valid on the period end date. Arrears for back-dated revisions go through the existing arrears process. |

### 4.3 Rate not found

* HRA and CCA are **not** silently set to 0.
* The employee appears in the **pre-payroll validation report** as: "No HRA/CCA rate for Designation *Assistant* as on 30-Nov-2026".
* Payroll **finalisation is blocked** until a rate is added, or an authorised user marks the employee "HRA/CCA not applicable" (e.g. quarters provided). If such a flag already exists, reuse it.

### 4.4 Switching basis

* Allowed only when **no payroll run is open (unfinalised)** for the organisation.
* Takes effect from the **next payroll period** to be processed. Finalised periods are never recalculated.
* Rates of the old basis are **retained** (history, arrears and audit), but are ignored by the resolver while the other basis is active.
* Before saving, the system shows a coverage check: "Under DESIGNATION basis, 3 of 18 designations with active employees have no current rate." The admin may still save, but payroll validation (§4.3) will flag those employees.

## 5. UI

### 5.1 Admin → Organisation Settings → Payroll → "HRA & CCA Calculation Basis"

```
┌─ HRA & CCA Calculation Basis ───────────────────────────────────┐
│  How should HRA and CCA percentages be determined?              │
│                                                                 │
│  (•) Place of posting (Branch)                                  │
│      Rate is taken from the place of the employee's branch.     │
│  ( ) Designation                                                │
│      Rate is taken from the employee's designation.             │
│                                                                 │
│  Applies from payroll period:  [ Dec 2026 ▼ ] (read-only, next) │
│  Rates configured:  Place – 42   |   Designation – 0            │
│                                                                 │
│  Last changed: 12-Apr-2025 by admin01                           │
│                                              [ Cancel ] [Save]  │
└─────────────────────────────────────────────────────────────────┘
```

**On Save (when basis changes):** show a confirmation dialog with:

* the effective payroll period,
* the coverage result (keys with employees but no current rate), with a link to "Configure rates",
* the note: "Existing rates of the previous basis will be kept but not used."

**Blocked state:** if a payroll run is open, the radio buttons are disabled with the message: "Finalise or cancel the open payroll for Nov 2026 before changing the basis."

**Permission:** `ORG_SETTINGS_EDIT` (Org Admin only).

### 5.2 Payroll → Masters → HRA & CCA Rates

The screen adapts to the organisation's active basis.

```
HRA & CCA Rates
┌──────────────────────────────────────────────────────────────────────────┐
│ ⓘ Rates are applied by DESIGNATION for this organisation. [Change basis] │
└──────────────────────────────────────────────────────────────────────────┘
Designation [ All ▼ ]   Status [ Current ▼ ]   As on [ 30-11-2026 📅 ]
[ Search… ]                       [ ⚠ Missing rates (3) ] [ Export ] [ + Add Rate ]

┌───────────────┬───────┬───────┬────────────┬────────────┬─────────┬──────────┐
│ Designation   │ HRA % │ CCA % │ Eff. From  │ Eff. To    │ Status  │ Actions  │
├───────────────┼───────┼───────┼────────────┼────────────┼─────────┼──────────┤
│ General Mgr   │ 10.00 │  4.00 │ 01-04-2026 │ —          │ Current │ ✎ ⟳ ⦸   │
│ Asst. Manager │  8.00 │  3.00 │ 01-04-2026 │ —          │ Current │ ✎ ⟳ ⦸   │
│ Asst. Manager │  7.50 │  3.00 │ 01-04-2024 │ 31-03-2026 │ Expired │ 👁        │
└───────────────┴───────┴───────┴────────────┴────────────┴─────────┴──────────┘
                                                      ◀ 1 2 3 ▶   25 / page
```

**Basis-driven behaviour**

| Element | PLACE basis | DESIGNATION basis |
|---|---|---|
| Banner text | "…applied by PLACE OF POSTING…" | "…applied by DESIGNATION…" |
| First column / filter / form field | Place | Designation |
| Dropdown source | Places of the organisation | Active designations of the organisation |
| Rows listed | `rate_basis = 'PLACE'` | `rate_basis = 'DESIGNATION'` |

A small toggle, **"Show rates of inactive basis"** (read-only), lets users view the history of the other basis. Those rows can be viewed but not edited.

**Status values** (computed against the "As on" date): `Current`, `Future`, `Expired`, `Inactive`.

**Actions**

| Icon | Action | Rule |
|---|---|---|
| ✎ | Edit | Allowed only if the rate has **not been used in any finalised payroll**. Otherwise only `remarks` is editable, and the user is told to use Revise. |
| ⟳ | Revise | Opens the form pre-filled with a new effective-from date. On save, the previous row's `effective_to` is set to new `effective_from − 1` in the same transaction. |
| ⦸ | Deactivate | Soft delete (`is_active = false`); blocked if used in a finalised payroll. |
| 👁 | View | For expired rows, and for rows of the inactive basis. |

### 5.3 Add / Edit / Revise form (side drawer)

```
┌─ Add HRA & CCA Rate ─────────────────────────┐
│ Basis            Designation (read-only)     │
│ Designation *    [ Select designation   ▼ ]  │
│ HRA % *          [   8.00 ]                  │
│ CCA % *          [   3.00 ]                  │
│ Effective From * [ 01-04-2026 📅 ]           │
│ Effective To     [            📅 ]  (blank = till revised) │
│ Remarks          [ G.O. / Circular No. …   ]  │
│                                              │
│ Employees affected now: 46                   │
│                          [ Cancel ] [ Save ] │
└──────────────────────────────────────────────┘
```

**Validation**

| Field | Rule | Message |
|---|---|---|
| Place / Designation | Required; must be active and belong to the organisation | "Select a designation." |
| HRA %, CCA % | Required; 0.00–100.00; max 2 decimals | "Enter a value between 0 and 100." |
| Effective From | Required; must not fall in a finalised payroll period (unless the user has `PAYROLL_BACKDATE` permission, in which case show an "arrears will be needed" warning) | "This date is in a finalised period (Oct 2026)." |
| Effective To | ≥ Effective From | "End date must be on or after start date." |
| Overlap | No overlap with another active row for the same key | "Overlaps with rate effective 01-04-2024 to 31-03-2026 for Asst. Manager." |

"Employees affected now" shows the count of active employees currently mapped to the selected place or designation.

### 5.4 Missing-rates panel

The **⚠ Missing rates (n)** button opens a list of places or designations (per the active basis) that have active employees but no current rate on the "As on" date. Columns: Name, Active employees, and an "Add rate" action that opens the form pre-filled. This is the same check used by payroll validation (§4.3).

### 5.5 Bulk revision (pay revision / new G.O.)

The **"Revise all"** action (under a ⋯ menu) lets the user:

1. enter a new effective-from date,
2. edit HRA % / CCA % inline for all current rows of the active basis (pre-filled with current values),
3. save. One new row is created per changed key, and the old rows are closed, all in one transaction.

### 5.6 Export / Import (optional, phase 2)

* Export the filtered grid to Excel.
* Import from an Excel template with columns `Place/Designation code, HRA %, CCA %, Effective From, Remarks`. The same validations apply, with a preview of errors before commit.

## 6. API (REST)

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/payroll/settings/hra-cca-basis` | Current basis, effective period, rate counts per basis, whether change is allowed |
| PUT | `/api/payroll/settings/hra-cca-basis` | Change basis `{ basis }`. Returns 409 if a payroll is open. |
| GET | `/api/payroll/settings/hra-cca-basis/coverage?basis=DESIGNATION&asOn=` | Keys with employees but no rate (dry run before switching) |
| GET | `/api/payroll/hra-cca-rates?basis=&placeId=&designationId=&status=&asOn=&page=&size=` | List; `basis` defaults to the active basis |
| GET | `/api/payroll/hra-cca-rates/{id}` | Detail, including `usedInFinalisedPayroll` flag |
| POST | `/api/payroll/hra-cca-rates` | Create. `rate_basis` is set server-side from the org setting; the client cannot override it. |
| PUT | `/api/payroll/hra-cca-rates/{id}` | Edit (restricted per §5.2) |
| POST | `/api/payroll/hra-cca-rates/{id}/revise` | Create a successor row and close the current one |
| POST | `/api/payroll/hra-cca-rates/bulk-revise` | Bulk revision `{ effectiveFrom, items: [{ key, hraPercent, ccaPercent }] }` |
| DELETE | `/api/payroll/hra-cca-rates/{id}` | Soft deactivate |
| GET | `/api/payroll/hra-cca-rates/missing?asOn=` | Missing-rates panel |
| GET | `/api/payroll/hra-cca-rates/resolve?employeeId=&asOn=` | Debug / salary-preview helper, using the same resolver as the payroll run |

Server-side rules:

* `organisation_id` always comes from the logged-in user's context, never from the request body.
* For basis PLACE, the request must carry `placeId` only; for DESIGNATION, `designationId` only. Otherwise the API returns 400.

## 7. Permissions

| Permission | Allows |
|---|---|
| `ORG_SETTINGS_EDIT` | Change calculation basis |
| `HRA_CCA_RATE_VIEW` | View rates screen |
| `HRA_CCA_RATE_EDIT` | Add / edit / revise / deactivate rates |
| `PAYROLL_BACKDATE` | Effective-from date in a finalised period |

## 8. Audit

Write audit-log entries for every basis change and every rate create, edit, revise or deactivate. Each entry records the user, timestamp, and old → new values.

## 9. Test cases

| # | Scenario | Expected |
|---|---|---|
| 1 | Existing org after migration, run payroll | Same HRA/CCA as before (regression) |
| 2 | Org on DESIGNATION; employee designation has a current rate | HRA/CCA from the designation rate |
| 3 | Org on DESIGNATION; no rate for the designation | Listed in validation; finalisation blocked |
| 4 | Two employees, same branch, different designations (DESIGNATION basis) | Different rates |
| 5 | Two employees, same designation, different places (PLACE basis) | Different rates |
| 6 | Switch basis while a payroll is open | 409, UI disabled with message |
| 7 | Switch PLACE → DESIGNATION | Next period uses designation rates; finalised periods unchanged; place rates remain viewable |
| 8 | Add an overlapping rate for the same designation | Rejected with overlap message |
| 9 | Revise a rate | New row created; previous row's `effective_to` = new from − 1 |
| 10 | Edit a rate used in a finalised payroll | Only remarks editable |
| 11 | Insert row with both `place_id` and `designation_id` (direct DB) | Check constraint violation |
| 12 | Promotion mid-month (DESIGNATION basis) | Follows proration rule in §4.2 |
| 13 | Rate effective date inside the period | Follows rule in §4.2 |
| 14 | API create with `placeId` while org basis is DESIGNATION | 400 |
| 15 | Missing-rates panel | Shows only keys with active employees and no current rate |
| 16 | Payslip regenerated after a rate revision | Shows the originally applied rate (stored rate reference) |

## 10. Future extension (not in scope)

Basis `PLACE_DESIGNATION`: rate per place × designation, with fallback to place-only and then designation-only. The schema already supports this by allowing both keys on a row under the new basis value. Only the check constraint, resolver and UI need extending.

## 11. Open questions for the business

1. TNCSARDB: is CCA also designation-based, or only HRA? If they differ, separate bases per allowance may be needed (`hra_basis`, `cca_basis`).
2. Are there minimum/maximum caps (fixed ₹ amounts) for HRA/CCA per designation? If yes, add `hra_min_amount` / `hra_max_amount` columns.
3. Confirm the wage base for HRA/CCA at TNCSARDB (Basic only, or Basic + DA).
4. Confirm proration practice for promotions and transfers within a month.
5. Should the basis change need maker-checker approval?

## 12. Implementation notes (07-Nov-2026)

How the spec was fitted to this codebase:

| Spec | As built |
|---|---|
| `organisation_id`, organisations table | This app serves one organisation, so there is no `organisation_id`. The basis is the effective-dated app setting `payroll.hra_cca.basis` in `core.app_settings` (ARDB D9), seeded as `PLACE`. |
| `payroll.payroll_settings.hra_cca_basis` | Not used: `payroll_settings` is per financial year. A basis change closes the current setting row and adds one from the next payroll period, so history is kept per date. |
| Places | `place_id` references `core.place_categories` (the branch's place category). |
| `hra_percent`, `cca_percent` | Real columns are `hra_percentage`, `cca_percentage`, plus the existing `hra_/cca_minimum_amount` and `hra_/cca_maximum_amount` (max 0 = no cap). The caps apply to both bases, which answers §11 Q2. |
| §3.2 DDL | `database/migrations/0003_hra_cca_rate_basis.sql`. Overlaps are blocked by `btree_gist` exclusion constraints as well as the service check. Migrations are forward-only here, so there is no down-migration. |
| Permissions | Mapped to roles: `ORG_SETTINGS_EDIT` → Admin; `HRA_CCA_RATE_VIEW` → HR, Payroll; `HRA_CCA_RATE_EDIT` → Payroll; `PAYROLL_BACKDATE` → Admin. Admin always passes. |
| "Payroll run open" (§4.4) | A period that is not LOCKED and already has pay bills. An OPEN period with no bills does not block, because Lock & Roll always opens the next month. The change applies from the earliest SALARY period not yet locked. |
| "Used in a finalised payroll" (§5.2) | The rate's date range overlaps an APPROVED or LOCKED period. Replace this with the stored rate reference once pay lines record it. |
| §4.2 mid-period changes | `resolveSegments` splits the month by transfer joining dates (PLACE) or approved promotion effect dates (DESIGNATION), as TNCU splits HRA/CCA into branch-day segments. Each segment uses the rate valid on the period end date. |
| §11 Q1 | One basis drives both HRA and CCA (confirmed). |
| Screens | Payroll › Masters › HRA / CCA Rates (`/payroll/rates/hra-cca`) and Administration › Rule Settings (`/admin/settings`). |

Code: `backend/src/services/payroll/hraCca{Rules,BasisService,RateService,RateResolver}.ts`, routes in `backend/src/routes/payroll.routes.ts`, UI in `frontend/src/pages/payroll/HraCcaRates.tsx` and `frontend/src/pages/admin/RuleSettings.tsx`.

**Still to wire when the payroll calculator (Prepare) is built:**

- call `HraCcaRateResolver.resolveSegments` for HRA/CCA;
- list `found: false` results in pre-payroll validation and block finalisation (§4.3; tests 3, 13);
- store the applied rate id on the pay line (tests 10, 16);
- use promotion proration rules (test 12).

Excel export/import (§5.6) is phase 2.
