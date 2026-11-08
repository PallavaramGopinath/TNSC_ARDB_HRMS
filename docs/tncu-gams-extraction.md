# TNCU_GAMS → TNSC ARDB HRMS: Extracted Specification

Source: `/Users/manojg/Documents/BLAZOR_TNCU_GAMS-master` (Blazor / .NET 10 / EF Core / PostgreSQL), scanned 2026-11-06.
Target: React (Vite + TS + Tailwind) · Express (TS, MVC) · PostgreSQL (Kysely).

This document is the functional reference for the port. Where TNSC ARDB differs from TNCU, the
difference is called out as **ARDB decision**.

---

## 0. ARDB decisions (agreed 2026-11-06)

| # | Decision |
|---|----------|
| D1 | **No accounting.** No vouchers, ledgers, GL posting, establishment ledgers, or day-begin/day-end. Every `ledger_id` / `voucher_id` column in TNCU is dropped. |
| D2 | **HO + branches stay as in TNCU.** HR and Payroll are Head-Office modules that work on org-wide data. Payroll periods are opened at HO and cover every branch. |
| D3 | **Maker-checker approval is kept** wherever TNCU has it. The checker must be a different user from the maker; only Admin may approve their own entry, and nobody may reject their own. |
| D4 | **Business date** is today's date in Asia/Kolkata. There is no day calendar. |
| D5 | **Database layout:** separate PostgreSQL schemas `core`, `auth`, `audit`, `hr`, `payroll`, `epf`. Data access is Kysely; money arithmetic uses decimal.js. |
| D6 | **EPF Trust is reserved.** The `epf` schema starts empty, and TNCU's `employee_provident_funds` table is not ported. Payroll emits `payroll.pf_contribution_events` rows that the EPF module will consume. |
| D7 | **Staff class EMPLOYEE only.** TNCU's GOVT/FS fixed-pay path, the FS EPF branch and the `party_types` table are dropped. |
| D8 | **Place categories are user-defined** through CRUD. TNCU's four categories (GCC, OC, ODHQ, OP) are seeded as editable defaults. |
| D9 | **Hard-coded rule values move into `core.app_settings`:** increment cycle, PF rate defaults, leave-credit constants, caps and similar. |
| D10 | **Loans and sundry-debtor recovery are out of scope**, because they depend on TNCU's Loans and Accounts modules. Component type 3 (LoanDeductions) is kept, and amounts come from the monthly period-deduction upload. |
| D12 | **No Party (KYC) Master** (decided 2026-11-06, migration 0002). The KYC and bank fields (name, Tamil name, gender, contact, address, PAN, Aadhaar, bank, bank branch, account no., IFSC) live on `hr.employees`. The employee code is generated per employee as `hr.employee_code_prefix` followed by a number zero-padded to `hr.employee_code_pad` digits (EMP001). Auto-creating a self-service login on create is deferred to the My Payslips step. |
| D13 | **HRA/CCA calculation basis is configurable** (decided 2026-11-07, migration 0003, [spec 01](../specs/01-hra-cca-rates-calculation-basis.md)). Setting `payroll.hra_cca.basis` chooses PLACE (TNCU: branch's place category) or DESIGNATION (TNSC ARDB). One basis drives both HRA and CCA. Rates of the inactive basis are kept read-only. |
| D11 | **Paying without accounts:** an APPROVED bill becomes PAID through "Mark Paid" (in bulk or per bill), and an NEFT file is exported. Lock & Roll still requires every approved, non-withheld bill to be PAID. |

---

## 1. Cross-cutting

### 1.1 Auth and RBAC (TNCU: ASP.NET Identity + JWT)
- **Login:** username and password plus an SVG captcha. Passwords need at least 8 characters, a digit and an uppercase letter.
- **Tokens:** HS256 JWT valid for 60 minutes, with a rotating refresh token (64 random bytes, base64, stored in the DB).
- **Endpoints:** `/api/auth/captcha`, `login`, `refresh`, `logout`, `forgot-password`, `reset-password`, `change-password`.
- **Claims:** `sub`, `name`, `fullName`, `branchId`, `branchType` (HO or other), `allBranches`, `employeeId`, `mustChangePassword`, roles, and one `mod:{menuId}` claim per assigned module with value M, C or MC.
- **Roles are derived** from `user_modules(user_id, menu_id, is_maker, is_checker)`:
  - Maker on any module gives the Maker role; Checker on any module gives the Checker role.
  - The HR module adds the HR role and the Payroll module adds the Payroll role.
  - A linked employee adds the Employee role.
  - Admin is assigned explicitly.
- **Policy `HeadOffice`:** the user is Admin, or has `branchType = HO`. Every HR and Payroll route requires it, except party masters, place categories, my-photo and my-payslips.
- **Read and write access:**
  - HR reads: Admin, HR or Payroll. HR writes: Admin or HR.
  - Payroll reads: Admin, HR or Payroll. Payroll writes: Admin or Payroll.

### 1.2 Menu
- The menu is a three-level tree, `menu_mains → menu_subs → menu_forms`. A sub with a NULL form name is a group.
- Every node has `branch_code` (HO, BRANCH or ALL), `display_order` and `is_active`. Mains also have `required_role`.
- The tree is seeded declaratively (upserted at startup). Visibility is filtered by `branchType` and the `mod:` claims; Admin sees everything.
- Module IDs: HR = 12000010, Payroll = 12000020. ARDB reserves EPF Trust = 12000040.

### 1.3 Audit
- Every insert, update and delete is logged. Inserts and deletes keep the full row; updates keep only the columns that changed. Sensitive columns (password hashes and the like) are masked.
- The log records the user, IP, user agent, route and a per-request correlation id.
- Categories: DATA_CHANGE, SECURITY, APPROVAL, ACCESS.
- Approval events (SUBMITTED, APPROVED, REJECTED, WITHDRAWN) are written explicitly by the services.
- There is no soft delete. `is_active` is used instead.
- There are no row-version columns. Approval steps that need a lock use `SELECT … FOR UPDATE`.

### 1.4 Conventions
- **Naming:** snake_case tables and columns; identity integer PKs (bigint for high-volume tables).
- **Enums** are stored as varchar strings.
- **Money:** `numeric(14,2)` or `(16,2)`. Rates: `numeric(8,2)`. Percentages: `numeric(5,2)`.
- **Dates:** business dates use `date`; timestamps use `timestamptz` in UTC.
- **Rounding (`RoundRupee`):** round half-up to the whole rupee, `floor + (frac >= 0.50 ? 1 : 0)`.
- **Financial years:** stored in a `financial_years` table (year_code, short_code such as "26-27", start, end, is_closed, is_current), with only one current at a time. Leave logic assumes April–March.
- **Document numbering:** `{PREFIX}/{BRANCH}/{FY}/{MM}/{seq:D7}`, generated from a sequence table with `INSERT … ON CONFLICT` then `FOR UPDATE`.
- **Files** are stored under a single root outside the web folder, as a GUID plus the validated extension. Downloads always require authentication.

---

## 2. HR module

### 2.1 Masters
- **place_categories:** code varchar(4) (unique), name, description. TNCU's PK is a smallint (D8).
- **bank_masters:**
  - bank_name ≤150 characters, unique on lower(trim(name)).
  - ifsc_for_bank: exactly 4 letters, unique. It cannot change while any party's IFSC uses it.
  - A bank is deactivated rather than deleted while anyone references it.
- **party_masters (KYC): dropped in ARDB (D12).** Its fields moved onto the employee. TNCU's original:
  - Columns: party_code (unique), party_name, Tamil name, gender (M/F/O), mobile, email, address, city, district, state (default Tamil Nadu), pincode, PAN, Aadhaar, bank_master_id, bank_branch, account_number, IFSC.
  - **Party code** is the prefix (setting `hr.employee_code_prefix`, default EMP) followed by the next number, zero-padded to 3 digits.
  - **IFSC** is optional, but needs a bank chosen first. It must match `^[A-Z]{4}0[A-Z0-9]{6}$` and start with the chosen bank's prefix.
- **employee_designations:** name (not unique), grade, pay_level, seniority_order (1–999, where 1 is most senior), is_active.
- **employee_leave_types:** leave_code (unique, uppercase), name, annual_quota (0–365), carry_forward, encashment_allowed, pay_cut_factor (0–1), cuts_special_pay_and_da, affects_leave_balance.
  - Seed: CL 12 (pay cut 0) · EL 30 (carry forward, encashment, pay cut 0) · ML 15 (pay cut 0.5) · LOP 0 (pay cut 1, cuts SP and DA, does not debit the balance).
- **branches:** code (unique), name, type (HO or BRANCH), address, district, pincode, phone, email, place_id, is_active.

### 2.2 Employee
- **Links and identity:**
  - TNCU: each employee links one-to-one to a party, and `employee_code` is the party code. **ARDB (D12):** there is no party; the code is generated on the employee.
  - The designation and branch must exist and be active.
  - Active means `date_of_leaving IS NULL`.
- **Field blocks:**
  - **Appointment:** order no and date, probation_months (0–60), sponsored_by, remarks.
  - **Probation:** extension months (0–24, and no more than 60 together with the base probation), extension order, test passed and test date, remarks, reason for delayed confirmation.
  - **Confirmation:** order no and date, confirmed-against designation, remarks.
  - **Special appointment:** category (COMPASSIONATE_GROUND, SPORTS_QUOTA, EX_SERVICEMEN, DIFFERENTLY_ABLED, OTHER), G.O. no and date, deceased employee (or free-text deceased details), relationship.
- **Rules:**
  - The employee must be at least 18 on the date of joining (setting `hr.min_age_at_joining`).
  - Increment month must be 1–12.
  - Date of leaving cannot be before joining or after the business date.
  - Date of retirement is entered by hand and cannot be before joining.
  - Confirmation date cannot be before joining; confirmation order details require a confirmation date.
  - Order dates cannot be in the future.
  - Deceased details are allowed only for compassionate appointments. A linked deceased must have an active DEATH retirement.
- **Changing the date of leaving** is refused while an active retirement exists, or while payroll exists for a period after the new date.
- **On create:** an APPOINTMENT service-history row is written and a self-service login is auto-provisioned.
- **List:** filters for branch, designation, active and search `q` (code, name, party code or EPF number); page size 1–200, default 20, ordered by code.

### 2.3 Service history
Append-only. Columns: effective_date, branch, designation, basic_pay, and service_event (APPOINTMENT, PROMOTION, TRANSFER, INCREMENT, DEMOTION, RETIREMENT, LEAVE, INCREMENT_WITHHELD). LEAVE rows also carry leave_type, from, to and days.

### 2.4 Increments (`IncrementService`, `IncrementCycleRules`)
- **Cycles and amount:**
  - Cycle months are 1, 4, 7 and 10 (setting `hr.increment.cycle_months`). The cycle key is yyyymm.
  - Amount = 3% of the current basic (`hr.increment.percent`), with the paise dropped and the result rounded **up** to the next ₹10 (`hr.increment.round_up_to`).
- **Eligibility:** active employees whose increment_month equals the cycle month and whose basic is greater than 0. Employees still under an earlier stop are carried into later cycles.
- **Stops (WITHHELD):**
  - Recording a stop needs a reason. It may carry a withheld-up-to date, a cumulative-effect flag and a disciplinary case no.
  - A stop stays in force until an approved REGULAR increment, or until its withheld-up-to date has passed.
- **Batch submission:** only for the cycle in the business date's month. The effective date must fall inside the cycle month, and any date after the 1st needs a reason.
- **Special kinds** (HIGHER_QUALIFICATION, STAGNATION, ADVANCE, SPECIAL) are stored with cycle 0 and need a rule reference and at least 1 increment.
- **Uniqueness:** UNIQUE(employee_id, increment_cycle) WHERE status <> 'REJECTED' AND kind IN ('REGULAR','WITHHELD').
- **Status flow:** PENDING → APPROVED or REJECTED. A maker withdrawal sets REJECTED ("Withdrawn by maker").
- **Approval:**
  - Re-checks that old_basic still equals the current basic.
  - A non-withheld increment needs an order no and date; sanctioned_by defaults to "Managing Director".
  - Updates employees.basic_salary and the BASIC assignment, and writes service history.

### 2.5 Transfers
- From branch = the current posting: the destination of a pending transfer, otherwise the employee's branch. It must differ from the destination.
- Date order: transfer ≤ relieving ≤ joining, and joining ≤ business date. Sessions are FN or AN.
- Relieving writes a TRANSFER history row. Joining moves `employees.branch_id`, and the transfer is final after that.
- The stage (Initiated, Relieved, Joined) is derived from the dates.

### 2.6 Promotions and panels
- **Promotion types:** REGULAR, SELECTION_GRADE, SPECIAL, REVERSION, ADHOC, OFFICIATING.
- **Basis:** DPC, SENIORITY, MERIT, COURT_ORDER, GOVERNMENT_ORDER, ADHOC.
- **Promotion rules:**
  - The from- and to-designation must differ; increment = to_basic − from_basic.
  - A fixation order needs a fixation option (DATE_OF_PROMOTION or NEXT_INCREMENT) and a fixation rule; the next increment date must be after the promotion date.
- **Promotion status flow:** PENDING_APPROVAL → APPROVED, or CANCELLED. Approval re-checks the employee's designation and basic, then updates both.
- **Panels:**
  - One panel per (year, designation). Ranks are unique and start at 1; each employee appears once.
  - DRAFT → APPROVED. Approval needs an order no, order date and valid-up-to.

### 2.7 Retirement and separation
- **Modes:** SUPERANNUATION, VOLUNTARY_RETIREMENT, MEDICAL, RESIGNATION, DEATH, TERMINATION, OTHER. OTHER requires remarks (CHECK constraint).
- The date cannot be before joining or after the business date. Only one active retirement per employee (partial unique index).
- **Payroll impact:**
  - Approved, locked or paid payroll for any period after the retirement date blocks it.
  - DRAFT payroll, attendance and deductions in open later periods are deleted, with a warning.
- **In one transaction:** write the RETIREMENT history row, write the retirement row, and set date_of_leaving.

### 2.8 Leave
- **Applications:**
  - total_days defaults to to − from + 1.
  - Status flow: PENDING → APPROVED, REJECTED or CANCELLED. Rejection requires remarks.
  - Approval debits availed (except for LOP), stamps balance before and after, and writes LEAVE history.
- **Balances:** one row per (employee, leave type, FY). Closing = opening + earned − availed. If no balance exists yet, the opening is either the quota or the previous closing (rollover).
- **Opening-balance onboarding:** once per FY for the whole organisation; it can be cancelled with a reason.
- **Leave credit engine (TNLR-1933/v1, staff class EMPLOYEE only):**
  - **EL, on 1 Jan and 1 Jul:**
    - Permanent staff with 5 or more years get 15 days in advance; everyone else gets 2.5 days per 2 completed months.
    - LOP cuts the credit: LOP ÷ 10 (max 15) for permanent 5+ year staff, LOP ÷ 20 (max 8) for everyone else.
    - Cap 240. Above 225 the credit is held in suspense; a credit that would cross 240 is clipped to it.
  - **CL, on 1 Jan:** reset to 12, pro-rated for joiners. Contract and daily-wage staff get an even-rounded count.
  - **ML, monthly:** credited by service-length steps, the difference between steps added: more than 3 years = 60 days, 5+ = 90, 9+ = 180, 12+ = 270, 15+ = 360, more than 20 = 540.
  - GOVT_EMPLOYEE staff and anyone with no joining date are NOT_ELIGIBLE. Runs are idempotent: UNIQUE(run_kind, period_key, employee_id).
- **Attendance:** daily, UNIQUE(employee_id, date). Status is PRESENT, ABSENT, LEAVE, HOLIDAY or HALF_DAY. CSV import columns are `code,date,status`.

### 2.9 Disciplinary
- **Cases:** unique case_no; charge type MINOR or MAJOR. Stage dates must be monotonic (incident ≤ memo ≤ served ≤ explanation ≤ report ≤ final order).
- **Suspensions:** only one in force per employee; subsistence 0–100%.
- **Penalty orders:** the case must be APPROVED.
  - Minor penalties: CENSURE, WITHHOLDING_OF_INCREMENT, WITHHOLDING_OF_PROMOTION, RECOVERY.
  - Major penalties: REDUCTION_TO_LOWER_STAGE, REDUCTION_IN_RANK, COMPULSORY_RETIREMENT, REMOVAL, DISMISSAL.
- **Stages:** CHARGE_MEMO … APPEAL_DECIDED, OTHER.
- **Status flow:** PENDING → APPROVED. Editing an approved record sends it back to PENDING. Only PENDING records can be deleted.

---

## 3. Payroll module

### 3.1 Masters
- **components:**
  - Columns: code (unique), name, type (1 Earnings, 2 Deductions, 3 LoanDeductions), is_da_applicable, is_surrender_leave_applicable, is_income_tax_applicable, display_order, min/max.
  - Recognised codes: BASIC, PP, GP, SP, DA, HRA, CCA, MA, PF, EMPLOYER_PF, `ADL PF` (VPF), BONUS, EX_GRATIA, SLS, GRATUITY, IT.
- **component_assignments:** employee, component, assigned_type (FIXED or PERCENTAGE), amount, percentage, min, max, effective_from, effective_to, is_active. Overlapping active assignments are rejected.
- **Rate tables:**
  - **DA and PF rates:** effective-dated. Adding a rate deactivates the previous one and sets its effective_to to the new start − 1 day.
  - **HRA/CCA:** one row per place: hra%, min and max, cca%, min and max. **ARDB (D13):** alternatively one row per designation, following the `payroll.hra_cca.basis` setting.
- **settings:** min_net_percent_of_gross (25) and gratuity_ceiling (2,000,000).

### 3.2 Period workflow
- **Periods:** payroll_type is SALARY, DA_ARREARS, SLS, BONUS, EX_GRATIA, SALARY_ARREARS, GRATUITY or LEAVE_ENCASHMENT. UNIQUE(branch, FY, month, type).
- **Statuses:** OPEN → PROCESSED → APPROVED → LOCKED, with PROCESSED → OPEN as a reject. There is no reverse once approved.
- **Prepare** runs only on an OPEN or PROCESSED period with working_days set and no approved rows. In increment months it is also blocked until every due employee has an approved increment or stop. Then:
  1. Delete the period's payroll rows.
  2. Compute every serving employee.
  3. Re-post leave debits idempotently (period_leave_postings).
  4. Set the period to PROCESSED.
- **Approve:** the maker cannot approve their own run unless Admin. Rows go DRAFT → APPROVED.
- **Withhold:** possible until the period is locked; withheld bills are paid later.
- **Lock & Roll:** requires APPROVED; blocked while any approved, non-withheld bill is unpaid. It then opens the next SALARY month.

### 3.3 Calculator (`PayrollCalculator.cs`, ported exactly)
D is the number of calendar days in the period. `RoundRupee` rounds half-up.

1. **Basic, GP and SP:** taken from the latest APPROVED, non-WITHHELD increment on or before the period's end date, otherwise from the FIXED assignment. Basic finally falls back to employees.basic_salary. A mid-month change is blended: `RoundRupee((old*daysBefore + new*daysOnAfter)/D)`. `payBase = Basic + GP + SP` (PP is excluded).
2. **Leave proration:**
   - `basicGrpUnpaid = clamp(Σ days × pay_cut_factor, 0, D)`.
   - `spDaUnpaid` is the same sum, counting only leave types that cut SP and DA.
   - `Pro(full, u) = u > 0 ? RoundRupee(full*(D-u)/D) : full`.
   - Basic, PP and GP are prorated by basicGrpUnpaid; SP by spDaUnpaid.
   - `payable_days = D − basicGrpUnpaid`.
3. **DA:** `Pro(RoundRupee(payBase*da%/100), spDaUnpaid)`. The rate is the latest active rate in effect on the period's end date, falling back to `period.da_rate`.
4. **HRA and CCA:** the month is split into per-branch day segments using transfer joining dates. Each segment pays
   `Clamp(RoundRupee(payBase*pct/100*days/D), RoundRupee(min*days/D), RoundRupee(max*days/D))`, where max 0 means no cap. CCA is paid only when its percentage is non-zero. Neither is LOP-prorated.
5. **MA and other earnings:** FIXED amount, or `RoundRupee(payBase*pct/100)`.
6. **PF:** `RoundRupee((basicPaid+gpPaid+spPaid+daPaid)*pf%/100)`, with no ceiling. EMPLOYER_PF is a single line where allowance = deduction = PF.
7. **VPF (`ADL PF`):** read on payBase.
8. **Other deductions:** the period-uploaded amount, otherwise the assigned amount (any percentage type is ignored).
9. **Manual overrides:** the component's lines are scaled to the target. The last line takes the remainder.
10. **Net floor:** `RoundRupee((gross − employerPf)*minNet%/100)`. ARDB has no loans to trim, so a net below the floor raises a warning.
11. **Totals:** gross = Σ allowances; net = gross − Σ deductions.

**Other pay types:**
- **DA arrears:** `RoundRupee(Σ DA-applicable allowances × rate/100)` per paid month; PF on the arrear only if the employee had PF that month; plus employer PF.
- **SLS (surrender leave salary):** `RoundRupee(Σ lines × days/30)` with days of 15 or 30; debits EL; amounts are prefilled from the last drawn salary.
- **Leave encashment at retirement:** days = min(EL, 240); amount = `RoundRupee(total × days/30)`.
- **Gratuity:** `RoundRupee((Basic+DA) × 15/26 × years)`, capped at the ceiling. Requires 5 or more years, waived for DEATH or MEDICAL; a remainder of 6 months or more counts as a year. Test: 82,560 × 15/26 × 31 = **1,476,554**.

### 3.4 Reports (later step)
- Payroll Statement.
- Deduction Report.
- Agency Remittance.
- Pay Bill, with a draft "FOR APPROVAL" copy.
- Payslip (EMPLOYER_PF hidden).
- NEFT file: 13 columns.
- Preparation grid: Basic, PP, GP, SP, PAY, DA, HRA, CCA, MA, EmployerPf, Other, Gross, PF, VPF, Other, TotalDed, Net, LopDays.

### 3.5 EPF hook (ARDB)
- On Mark Paid, write `payroll.pf_contribution_events` rows: employee, period, employee PF, VPF, employer PF, wages, paid_on. `consumed_at` is set by the EPF Trust module.
- The full PF ledger, interest calculator and withdrawals will be designed once the EPF spec arrives.

---

## 4. Parity test values (from `TNCU.Business.Tests`)
- RoundRupee: 10.49 → 10; 10.50 → 11.
- Branch-day segments for June 2026 (30 days), HO → Trichy, joining on 19 June: HO 18 days, Trichy 12 days. July 2026, Dindigul → Madurai on 3 July and back on 8 July: Dindigul 2, Madurai 5, Dindigul 24.
- SLS: 1,48,360 × 187.5 ÷ 30 = 927,250.
- Gratuity: 82,560 × 15/26 × 31 = 1,476,554.
- Increment (`CeilTo10`, paise dropped first): basic 25,000 → 750 stays **750**; basic 25,350 → 760.50 → 760 stays **760**; basic 25,400 → 762 → **770**.
