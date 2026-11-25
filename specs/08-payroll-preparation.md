# Requirement: Payroll Preparation

**Status:** Implemented, without increments, leave posting, prints and Mark Paid. See section 18.
**Area:** Payroll → Payroll Processing → Payroll Preparation (`/payroll/preparation`)
**Date:** 25-Nov-2026

## How to read this document

| Part | Sections | Content |
|---|---|---|
| A | 1 – 11 | Payroll preparation **as developed in BLAZOR_TNCU_GAMS-master** |
| B | 12 | Points noticed in the Blazor code, to decide before copying |
| C | 13 – 18 | What changes for SLDB Payroll, decisions, acceptance criteria, build notes |

Part A describes Blazor as it is. Where an SLDB decision differs, the SLDB rule is in sections 13, 14 and 18. The questions of section 14 are answered there.

---

# Part A — As developed in BLAZOR_TNCU_GAMS-master

## 1. Request and sources

> Please draft downloadable markdown file for preparation of payroll as developed in the application BLAZOR_TNCU_GAMS-master. No code change.

The screenshot shows the SLDB page as a placeholder: "Being ported from TNCU_GAMS. The menu entry, permissions and API route group exist; the screen lands in a later step."

Source read: `BLAZOR_TNCU_GAMS-master`, commit `508d28d` of 04-Nov-2026.

| Purpose | File |
|---|---|
| Screen | `TNCU.Web.Client/Pages/Payroll/PayrollPreparation.razor` |
| Calculation | `TNCU.Business/Payroll/PayrollCalculator.cs` |
| Period status, working days, lock | `TNCU.Business/Payroll/PayrollPeriodService.cs` |
| Monthly attendance | `TNCU.Business/Payroll/PayrollPeriodAttendanceService.cs` |
| Agency deductions | `TNCU.Business/Payroll/PayrollPeriodDeductionService.cs` |
| Manual deduction overrides | `TNCU.Business/Payroll/PayrollManualDeductionService.cs` |
| Upload status panel | `TNCU.Business/Payroll/PayrollReadinessService.cs` |
| Approval | `TNCU.Business/Payroll/PayrollApprovalService.cs` |
| Grid, withhold | `TNCU.Business/Payroll/PayrollQueryService.cs` |
| Loan demand and recovery | `TNCU.Business/Loans/LoanDemandService.cs`, `LoanRecoveryDemand.cs` |
| API | `TNCU.Web/Controllers/Payroll/*Controller.cs` |

## 2. Purpose and access

One monthly **SALARY** run is calculated for **all serving employees of Head Office and every branch together**. The run is reviewed, approved by another user and frozen. Payment and accounting come later, on another page.

| Action | Admin | Payroll | HR |
|---|:---:|:---:|:---:|
| Open the page, see the run and upload status, print | Yes | Yes | Yes |
| Working days, attendance, agency deductions, edit deductions, withhold | Yes | Yes | No |
| Prepare, Approve, Reject, Lock & Open Next | Yes | Yes | No |

- Head Office users only. Others see "The Payroll module is available to Head Office users only."
- **Maker and checker:** the user who prepared the run cannot approve it, unless Admin. The maker is the user who **last** prepared it, because Prepare rebuilds every pay bill.

## 3. Workflow

```
 1  Page opens the active SALARY period
 2  Save Working Days (required)
 3  Enter or upload Monthly Attendance
 4  Enter or upload Agency Deductions
 5  Prepare Payroll ................ period OPEN → PROCESSED, bills DRAFT
 6  Review: grid, payslips, Pay Bill for approval
       change inputs, edit deductions, withhold → Re-prepare
 7  Approve Run (another user) ..... period PROCESSED → APPROVED, bills APPROVED
    or Reject ...................... period PROCESSED → OPEN
 8  Pay (Employee Transactions page)  bills APPROVED → PAID
 9  Lock & Open Next ............... period APPROVED → LOCKED, next month OPEN
```

### 3.1 Period status

| Status | Meaning | Inputs and Prepare | Withhold | Next |
|---|---|:---:|:---:|---|
| OPEN | Month opened | Allowed | Allowed, if bills exist | Prepare → PROCESSED |
| PROCESSED | Pay bills calculated | Allowed (re-prepare) | Allowed | Approve → APPROVED, or Reject → OPEN |
| APPROVED | Frozen | No | Allowed until the bill is paid | Lock → LOCKED |
| LOCKED | Closed | No | No | — |

"Inputs" are working days, attendance, agency deductions and edited deductions.

The page also shows a hint:

| Status | Hint |
|---|---|
| OPEN | Enter attendance, then Prepare to compute DRAFT payroll. |
| PROCESSED | Prepared. A different user can Approve (freeze) or Reject back to OPEN. |
| APPROVED | Frozen. Lock & Open Next to close this month and open the following one. |
| LOCKED | Locked. This run is closed. |

### 3.2 Pay bill status

| Status | Set by |
|---|---|
| DRAFT | Prepare |
| APPROVED | Approve Run |
| PAID | Payment, on the Employee Transactions page |

A pay bill also has a **Withheld** mark with a reason. It is separate from the status.

### 3.3 Which period opens

1. The earliest SALARY period that is not LOCKED.
2. If none, the month after the latest LOCKED one is created automatically as OPEN, under Head Office, for the calendar month, with DA rate 0.
3. If there is no SALARY period at all: "No SALARY payroll period exists yet. Seed the first month manually before preparation can begin."

A financial year covering the month and a Head Office branch must exist. HR cannot run this step, so HR sees the latest period by date.

## 4. Screen

### 4.1 Top of the page

| Item | Behaviour |
|---|---|
| Year, Month | Choose another run. SALARY is chosen first if the month has several periods |
| Period | Shown only when the month has more than one period: type, branch and status |
| Branch view | All branches, or one branch. Filters the grid only; the run is always for all branches |
| Refresh | Reloads the list of periods |
| Run banner | Year-month and type · owner branch · from and to dates · status |

### 4.2 Upload status panel

| Part | Shows |
|---|---|
| Attendance | Not uploaded, Partial or Uploaded; "x of y employees", number verified, first upload date |
| Agencies | One row per agency: name and code, Uploaded or Pending, uploaded / eligible employees, amount that **will be deducted** and the number of employees, first upload date |
| Overall | "Upload attendance before preparing." / "Ready — but check the ₹0 agencies below." / "Ready to prepare." |

- An agency is a Deductions component assigned as a **fixed amount** to at least one serving employee in the month, other than PF, ADL PF, EPF, EMPLOYER_PF, SUNDRY and LOAN.
- "Will deduct" is the uploaded amount or, if there is none, the assigned amount. A pending agency is therefore still deducted at its assigned amount.
- An agency that will deduct nothing is marked "₹0 — nothing".
- The panel is for information. It does not stop Prepare (section 12, point 2).

### 4.3 Working days

- Shows Total Days (calendar days of the month) and an entry for Working Days, from 0 to Total Days.
- Required before Prepare. It is printed on the payslip for employees without an attendance entry. It **does not affect pay**, which always uses calendar days.

### 4.4 Buttons

| Button | Enabled when |
|---|---|
| Save Working Days, Attendance, Agency Deductions | OPEN or PROCESSED |
| Prepare Payroll (**Re-prepare Payroll** once bills exist) | OPEN or PROCESSED |
| Approve Run | PROCESSED, and there are DRAFT bills |
| Reject | PROCESSED |
| Lock & Open Next | APPROVED |
| Print Pay Bill (for approval), Print all payslips | Bills exist |

Every button is disabled while an action is running. The result of Prepare is shown as "Computed n payroll(s), n line(s), n skipped, n warning(s)", with the messages in a list that can be opened.

### 4.5 Category summary

One line per employee category (ICM employees, Government Officers, Foreign Service Officers), for all branches: **Paid**, **Pending** (approved, not withheld, not paid) and **Withheld**. Paid and Pending show the number of bills and the net amount.

### 4.6 Grid

One row per employee, ordered by branch name, then employee code. 20 rows per page (10, 20, 50 or 100). Sorting, filtering and Excel export are available.

| Column | Content | Hidden when zero for all |
|---|---|:---:|
| Branch, Code, Employee, Category | | |
| LOP | Calendar days − pay days | |
| Pay Days | Payable days | |
| Basic | | |
| PP, GP, SP | Each in its own column | Yes |
| PAY | Basic + GP + SP, as paid | |
| DA, HRA, CCA, MA | | |
| Emp PF (Cr) | Employer PF, as an earning | Yes |
| Other | All other earnings | |
| Gross | Includes employer PF | |
| PF | | |
| VPF, EPF, Emp PF (Dr) | | Yes |
| Other Ded | All other deductions | |
| Sundry | | Yes |
| Loan | | |
| Total Ded, Net, Status | | |
| Withhold | Tick box | |
| Reason | Text, when withheld | |
| Edit | Opens Edit deductions (section 5.3) | |
| Payslip | Opens the employee's payslip PDF | |

- Grid footer: totals of Gross, PF, Sundry (if shown), Loan, Total Ded and Net. Below the grid: number of employees, and totals of Gross, Deductions and Net for the branch view.
- Row colours, the first that applies:

| Colour | Meaning |
|---|---|
| Amber | Withheld |
| Green | Approved |
| Blue | Paid |
| Red | Draft with net pay below the minimum (section 7.13) |

### 4.7 Printing

| Print | Detail |
|---|---|
| Print Pay Bill (for approval) | The Pay Bill, including draft bills, stamped "FOR APPROVAL — pending Approve Run". Placed before management before Approve Run |
| Print all payslips | One PDF, all employees, one per page |
| Payslip | One employee. Any bill not yet approved or paid carries a DRAFT watermark |

## 5. Dialogs

### 5.1 Monthly Attendance

- One row per serving employee, in employee code order: Branch, Code, Employee, **HQ**, **Camp**, one column **per leave type**, Remarks.
- The leave columns come from the Leave Types master. A new leave type appears without any program change. Hovering over a heading shows its rule.
- All entries are whole days, 0 or more. Present days are not entered. An employee with no entry is paid in full.
- HQ and Camp are recorded only; they do not affect pay or leave.
- There is a filter by code, name or branch.

**Save**
- A row with nothing entered is not saved. Clearing a saved row deletes it.
- If saved rows will be replaced or deleted, the user must confirm first, with the numbers shown.
- A saved row stores the calendar days and working days of the month.

**Upload (.xlsx or .csv, up to 5 MB)**

| Step | Behaviour |
|---|---|
| Download .xlsx / .csv | Template with the serving employees. Columns: `EmployeeCode, EmployeeName, HQ, Camp, <leave codes>` |
| View | Reads and checks the file without saving. Each row shows New or Overwrite, and Valid or the error |
| Upload | Saves the valid rows. Asks to confirm if saved rows will be overwritten |

- `EmployeeName` is ignored. An unknown column heading rejects the whole file.
- A row with a blank or unknown code, or a value that is not a number, is reported and left out. The valid rows are still saved.
- A blank cell counts as 0. The upload replaces the leave days already saved for that employee. Remarks are kept.

### 5.2 Agency Deductions

- One row per employee and agency: Branch, Code, Employee, Component, **Default** (assigned amount), **Amount**, Remarks.
- The amount replaces the assigned amount **for this month only**. Clearing it returns to the assigned amount.

**Upload**, one component at a time
- The template shows the deduction code, name, period and time generated, then `EmployeeCode, EmployeeName, Default, Amount`. Amount is filled with the **previous month's** uploaded amount, or 0.
- Only Amount is read. A template made for another deduction is rejected.
- View shows the previous amount, the new amount, and New, Overwrite, Remove or Skip (0).
- 0 is not stored. It removes the month's entry, so the assigned amount applies again.
- Overwriting or removing saved entries needs confirmation.

### 5.3 Edit deductions (one employee)

For adjustments by management after Prepare.

- Shows Gross (excluding employer PF), the minimum net, net now and **net preview**, which updates as amounts are typed.
- Lists each Deductions component on the draft bill, except employer PF: Current, **Override**, Remarks. A blank override means the calculated amount.
- **Bring net to floor** sets the Loan override so that the net equals the minimum. The loan is never below 0.
- **Save & Re-prepare** saves and prepares the **whole run** again.
- Overrides are kept when the run is prepared again.

### 5.4 Withhold

- A withheld bill is prepared and approved with the rest, but left out of the bulk payment and paid separately later.
- Can be set or cleared until the bill is paid or the period is locked. The reason is optional, up to 256 characters.

## 6. Prepare

### 6.1 Checks, in order

| # | Check | Message |
|---|---|---|
| 1 | Period exists | Payroll period not found. |
| 2 | Period is OPEN or PROCESSED | Only OPEN or PROCESSED periods can be (re)prepared (current status: …). |
| 3 | Working days are set | Set the Working Days for this payroll month on the Preparation page before preparing payroll. |
| 4 | In January, April, July and October, every employee due an increment has it approved | n employee(s) are due an increment for MMM yyyy that is not yet approved. Calculate and approve increments before preparing payroll. |
| 5 | No bill of the period is approved or paid | This period already has APPROVED/PAID payroll rows. Recompute is blocked — reverse the approval first. |

For check 4:
- an employee is due if serving, of type EMPLOYEE, with that increment month and a basic salary above 0
- an approved stop in this cycle counts as settled
- an employee whose latest increment record is an approved stop is not due

### 6.2 Steps

All in one database transaction. If any step fails, nothing is changed.

1. Delete the period's draft bills and their lines.
2. Raise this month's loan demand, once per loan and due date.
3. Load the serving employees (no date of leaving) of all branches.
4. Load components, rates, assignments, increments, transfers, attendance, agency deductions, sundry debtors, loans, overrides and the minimum net percentage.
5. For each employee, calculate the lines (section 7) and save the bill as DRAFT. An employee with no lines is skipped and counted.
6. Report, once for the run, any component the calculation needed but which is not set up.
7. Post leave (section 8).
8. Set an OPEN period to PROCESSED, with the time.

### 6.3 Preparing again

| Rebuilt | Kept |
|---|---|
| Pay bills and lines | Attendance |
| Leave postings of the period | Agency deductions |
| Withheld marks and reasons are **lost** (section 12, point 5) | Edited deductions (overrides) |
| | Working days |
| | Loan demand already raised for the month |

## 7. Calculation

**Rounding (RoundRupee):** to Re. 1. Paise of 50 and above round up; below 50 round down.
**D** = calendar days from the period's from date to its to date.
**Order of lines:** as below. A line of 0 is not stored.

### 7.1 Rates used

| Rate | Row used |
|---|---|
| DA %, PF % | Latest **active** row with effective from on or before the period end. If there is none, DA uses the period's own DA rate and PF is 0 |
| HRA and CCA | Latest active row of each place, on or before the period end |
| Assignments | Active rows in force on **any day** of the period |
| Minimum net % | Payroll Settings of the period's financial year; 25 if not set |

### 7.2 Basic, GP, SP and PP

| Component | Source, in order |
|---|---|
| Basic | Latest approved increment effective on or before the period end, not a stop → assigned amount → the employee's basic salary (with a warning) |
| GP, SP | Same increment, if its value is above 0 → assigned amount |
| PP | Assigned amount |

An increment effective within the month is shared by days:

```
amount = RoundRupee((old × days before + new × days from the effective date) / D)
```

Example: Basic 30,000 → 30,900 from 11 June (10 days old, 20 days new) = **30,600**.

```
payBase = Basic + GP + SP        (PP is not included)
```

### 7.3 Unpaid days

The rules are in the Leave Types master:

| Field | Effect |
|---|---|
| Pay cut factor (0 to 1) | Unpaid days for each day of leave |
| Cuts SP and DA | The unpaid days also cut SP and DA |
| Affects leave balance | Days are debited from the balance at Prepare |

```
unpaid for Basic, PP, GP = Σ (days × factor)                          limited to 0 … D
unpaid for SP, DA        = Σ (days × factor), leaves that cut SP and DA only   limited to 0 … D
payable days             = D − unpaid for Basic, PP, GP
paid amount              = RoundRupee(full × (D − unpaid) / D)        only if unpaid > 0
```

Basic, PP and GP use the first figure. SP and DA use the second.

### 7.4 DA

```
DA = RoundRupee(payBase × DA% / 100), then reduced for unpaid days (SP, DA figure)
```

### 7.5 HRA and CCA

The rate follows the place category of the branch worked in. If the employee joined another branch during the month, the month is split by days from the **joining date** of each transfer.

For each part of *n* days:

```
HRA = Clamp(RoundRupee(payBase × HRA% / 100 × n / D),  RoundRupee(min × n / D),  RoundRupee(max × n / D))
CCA = the same with the CCA rate; only if CCA% is not 0
```

- A maximum of 0 means no maximum.
- The parts are added. HRA and CCA are **not** reduced for unpaid days.
- If no part has a rate, the employee gets a warning and no HRA or CCA.
- Before the first transfer, the branch is the one the employee was transferred **from**.

### 7.6 MA and other earnings

- MA: the assigned amount, or `RoundRupee(payBase × % / 100)`.
- Every other assigned Earnings component: the same.
- Neither is reduced for unpaid days.

### 7.7 PF and employer PF

```
PF wages = Basic + GP + SP + DA, as paid
PF       = RoundRupee(PF wages × PF% / 100)
```

- There is no wage ceiling, and no assignment is needed. Every regular employee gets PF.
- Employer PF equals PF. It is one line with the same amount as earning and as deduction, so it raises Gross and Total Deductions and does not change Net.

### 7.8 VPF and EPF

- **VPF (`ADL PF`):** assigned amount, or % of payBase. Not reduced for unpaid days.
- **EPF** (Foreign Service Officers): the assigned amount, or the PF % on PF wages. For fixed-pay officers the base is the assigned Basic + GP + SP + DA. An equal employer line is added.

### 7.9 Other deductions

For every assigned component of type Deductions, except PF, ADL PF, EMPLOYER_PF and EPF: the month's agency amount, otherwise the assigned amount. A percentage is not used here.

### 7.10 Government and Foreign Service Officers

Earnings are the assigned fixed amounts. There is no increment, proration, rate, PF or employer PF.

### 7.11 Sundry debtors and loans

- **Sundry:** the instalment, limited to the balance, for each open debtor account.
- **Loan:** principal demanded and not collected, limited to the outstanding, plus interest according to the loan type:

| Loan type | Interest recovered |
|---|---|
| Simple | None |
| EMI, fixed principal | All accrued and uncollected |
| Deferred | Only after the principal is cleared, over the set number of instalments |

At Prepare these are only deduction lines. The loan and sundry ledgers are updated at payment.

### 7.12 Overrides

The lines of an overridden component are scaled to the override. The last line takes the difference. If the component has no line, one is added.

Example: two lines of 3,333 and 2,000, override 4,000 → **2,500** and **1,500**.

### 7.13 Minimum net pay

```
minimum = RoundRupee((Gross − employer PF) × minimum net % / 100)
```

- If Net is below the minimum, the **loan** lines are reduced, the largest first, until it is met. Principal is reduced before interest.
- A loan overridden by management is not reduced.
- If Net is still below, the bill is kept with the warning "net … below floor … — manual review." Prepare does not stop.

Example: gross excluding employer PF 40,000; other deductions 8,000; loans 18,000 and 9,000. Net is 5,000 and the minimum is 10,000, so the larger loan is reduced by 5,000 to **13,000**.

### 7.14 Totals

```
Gross = Σ earnings (including employer PF)
Total deductions = Σ deductions (including employer PF)
Net = Gross − Total deductions
```

The bill's `working_days` holds the **calendar** days, not the Working Days entered.

### 7.15 Worked example

June, 30 days. Basic 30,000, PP 300, GP 2,400, SP 500. DA 50%, HRA 10% (1,000 to 5,000), CCA 5% (1,000 to 1,500), MA 1,000, PF 12%. VPF 1,000, LIC 1,200, Society 1,000. Leave: 2 days loss of pay (factor 1, cuts SP and DA) and 2 days medical (factor 0.5). Figures are illustrative.

`payBase = 30,000 + 2,400 + 500 = 32,900`. Unpaid days: 3 for Basic, PP and GP; 2 for SP and DA. Payable days 27.

| Item | Working | Amount |
|---|---|---:|
| Basic | 30,000 × 27/30 | 27,000 |
| PP | 300 × 27/30 | 270 |
| GP | 2,400 × 27/30 | 2,160 |
| SP | 500 × 28/30 = 466.67 | 467 |
| DA | 16,450 × 28/30 = 15,353.33 | 15,353 |
| HRA | 10% of 32,900 | 3,290 |
| CCA | 5% of 32,900 = 1,645, maximum | 1,500 |
| MA | | 1,000 |
| Employer PF | | 5,398 |
| **Gross** | | **56,438** |
| PF | 12% of 44,980 = 5,397.60 | 5,398 |
| Employer PF | | 5,398 |
| VPF, LIC, Society | 1,000 + 1,200 + 1,000 | 3,200 |
| **Total deductions** | | **13,996** |
| **Net** | | **42,442** |

The minimum net is 25% of (56,438 − 5,398) = 12,760, so there is no warning.

**Transfer example:** the same payBase, 18 days at a branch with HRA 10% (1,000 to 5,000) and CCA 5% (1,000 to 1,500), then 12 days at a branch with HRA 5% (500 to 1,000) and no CCA.

| Part | HRA before limits | HRA limits | HRA | CCA |
|---|---:|---|---:|---:|
| 18 days | 1,974 | 600 to 3,000 | 1,974 | 987, limited to **900** |
| 12 days | 658 | 200 to 400 | 400 | — |
| Total | | | **2,374** | **900** |

## 8. Leave posting

Done at the end of Prepare, so that preparing again never debits twice:

1. Reverse the period's earlier postings from the leave balances and delete them.
2. For each employee's attendance, debit the days of every leave type marked "affects leave balance" and record the posting.

```
closing = opening + earned − availed
```

## 9. Approve, Reject and Lock

| Action | Rules | Result |
|---|---|---|
| **Approve Run** | Period PROCESSED; draft bills exist; the user is not the maker, unless Admin | Bills APPROVED with the checker's name; period APPROVED. Nothing is posted to accounts |
| **Reject** | Period PROCESSED | Period back to OPEN. The draft bills stay until the next Prepare. No reason is asked |
| **Lock & Open Next** | SALARY period, APPROVED, and no approved bill unpaid, except withheld ones | Period LOCKED; next month's SALARY period opened, or the existing one used |

There is no way to reverse an approved run.

When a **retirement** is recorded, approved or paid payroll for a later month blocks it. Draft bills, attendance and agency deductions of later open months are removed, with a message to prepare again.

## 10. Messages

Prepare: see section 6.1. Others:

| Where | Message |
|---|---|
| Working days | Working days can only be set while the period is OPEN or PROCESSED. |
| Working days | Working days must be between 0 and n. |
| Attendance | Attendance cannot be edited after the period is approved. Reject the run back to OPEN first. |
| Attendance upload | Unknown column header '…'. Expected EmployeeCode, EmployeeName, HQ, Camp, or a leave code from Leave Types. |
| Attendance upload | Row n: employee code is blank. |
| Attendance upload | Row n: '…' is not an active employee; skipped. |
| Attendance upload | Row n: column '…' is not a whole number. |
| Agency deductions | Agency deductions cannot be edited after the period is approved. Reject the run back to OPEN first. |
| Agency upload | Selected component has no eligible employees for this period (needs an active FIXED deduction assignment). |
| Agency upload | This sheet is for deduction '…', but '…' is selected. Pick the matching component or download a fresh template. |
| Agency upload | Row n: '…' is not assigned this deduction; skipped. |
| Agency upload | Row n: amount '…' is not a number. |
| Uploads | No file provided. / Max 5 MB allowed. / Uploaded file is empty. / Unsupported file type. Upload a .xlsx or .csv file. |
| Edit deductions | No prepared payroll row for this employee — click Prepare Payroll first. |
| Edit deductions | Deductions cannot be edited after the period is approved. Reject the run back to OPEN first. |
| Withhold | The payroll period is locked; withhold status can no longer be changed. |
| Withhold | This pay bill is already paid. |
| Approve | Prepare the payroll first — the period must be PROCESSED before it can be approved. |
| Approve | Payroll runs cannot be approved on LOCKED periods. |
| Approve | No DRAFT payroll rows to approve. |
| Approve | Maker cannot approve their own payroll. Admin role required for self-approval. |
| Lock | Only APPROVED periods can be locked. Current status: … |
| Lock | n approved pay bill(s) are still unpaid (…). Pay them on the Employee Transactions page before locking the period. |
| Prepare (warning) | no Basic from increment/assignment; used Employee.BasicSalary. |
| Prepare (warning) | no HRA/CCA rate for place … |
| Prepare (warning) | net … below floor … (…% of gross excl. employer PF) — manual review. |
| Prepare (warning) | Components not configured — skipped: … Create them on the Payroll Components page if those pay items are used. |

Warnings identify the employee by internal id ("Emp 12"), not by code and name.

## 11. API and tables

### 11.1 API

| Method | Path | Use |
|---|---|---|
| POST | `/api/payroll/periods/resolve-active` | Open the active period |
| GET | `/api/payroll/periods`, `/periods/{id}` | List, one |
| PUT | `/api/payroll/periods/{id}/working-days` | Working days |
| POST | `/api/payroll/periods/{id}/transition` | Reject |
| POST | `/api/payroll/periods/{id}/lock-and-roll` | Lock & Open Next |
| GET | `/api/payroll/readiness/{periodId}` | Upload status |
| GET, PUT | `/api/payroll/period-attendance/{periodId}` | Attendance grid, save |
| POST | `/api/payroll/period-attendance/{periodId}/import` | Upload (preview or save) |
| GET | `/api/payroll/period-attendance/{periodId}/template` | Template |
| GET, PUT | `/api/payroll/period-deductions/{periodId}` | Agency grid, save |
| POST | `/api/payroll/period-deductions/{periodId}/import/{componentId}` | Upload |
| GET | `/api/payroll/period-deductions/{periodId}/template/{componentId}` | Template |
| GET, PUT | `/api/payroll/manual-deductions/{periodId}/{employeeId}` | Edit deductions |
| POST | `/api/payroll/payrolls/compute` | Prepare |
| GET | `/api/payroll/payrolls/preparation/{periodId}` | Grid |
| GET | `/api/payroll/payrolls/{id}` | One bill with lines |
| PUT | `/api/payroll/payrolls/{id}/withhold` | Withhold |
| POST | `/api/payroll/payrolls/approve-run` | Approve |
| GET | `/api/payroll/payslips/{employeeId}/{periodId}/print.pdf` | Payslip |
| GET | `/api/payroll/payslips/{periodId}/print-all.pdf` | All payslips |
| GET | `/api/payroll/reports/pay-bill/print.pdf` | Pay Bill |

### 11.2 Tables

| Table | Content | One row per |
|---|---|---|
| `payroll_periods` | Month, type, status, working days | Branch, financial year, month, type |
| `payrolls` | Pay bill totals, status, withheld | Period, employee |
| `payroll_details` | Lines: allowance and deduction amounts | Bill, line |
| `payroll_period_attendances` | HQ, camp, remarks | Period, employee |
| `payroll_period_attendance_leaves` | Days of each leave type | Attendance, leave type |
| `payroll_period_leave_postings` | Days debited | Period, employee, leave type |
| `payroll_period_deductions` | Month's agency amounts | Period, employee, component |
| `payroll_manual_deduction_overrides` | Edited deductions | Period, employee, component |

Deleting a period deletes its attendance, deductions, overrides and leave postings. A period with pay bills cannot be deleted.

---

# Part B — Points noticed in the Blazor code

## 12. To decide before copying

| # | Point in Blazor | Effect | Suggested for SLDB |
|---|---|---|---|
| 1 | **Approval does not check for later changes.** Attendance, deductions and rates can be changed after Prepare, and the old figures can then be approved. | Wrong pay approved | Refuse Approve until prepared again |
| 2 | **Attendance is not enforced.** The page says "Upload attendance before preparing", but Prepare works without it and pays everyone in full. | Loss of pay missed | Ask for confirmation, or require it (Q5) |
| 3 | **Employees who have left are dropped.** Only those with no date of leaving are paid, so someone who left during the month gets no salary if the date is recorded before Prepare. | Final month unpaid | Include leavers, paid to the last day (Q3) |
| 4 | **Joiners are paid the full month.** The date of joining is not read. Someone joining in a later month is also included. | Overpayment | Pay from the date of joining (Q3) |
| 5 | **Withheld marks are lost** when the run is prepared again, because the mark is on the bill that is deleted. | Withheld salary paid | Keep marks across Prepare |
| 6 | **A future DA or PF rate affects the current month.** Adding a rate makes the earlier one inactive at once, and only active rows are read. DA then falls back to the period's own rate (0 on automatically opened periods) and PF to 0, with no warning. | DA and PF missing | Not copied: SLDB reads by date |
| 7 | **Two assignments of one component in a month** (one ending, the next starting). Other earnings and deductions are **both** paid or deducted in full. For Basic, PP, GP, SP and MA one of the two is used, in no fixed order. | Double or wrong amount. SLDB's **Revise** creates this case | Share by days, or use the one in force at month end (Q4) |
| 8 | **0 does not waive an agency deduction.** Entering 0 without remarks removes the entry and the assigned amount is deducted. 0 **with** remarks is stored and does waive it. | Unexpected deduction | Store 0 as a waiver |
| 9 | **Save Deductions stores every row** with an amount, not only the changed ones. The month is then shown as uploaded, and later changes to the assignment do not reach it. | Misleading status | Save changed rows only |
| 10 | **Half days are lost.** Days are whole numbers, and an uploaded 0.5 becomes 0 without an error. | Wrong leave | Reject, or allow half days (Q6) |
| 11 | **Leave days are not checked** against the month or the leave balance. Unpaid days are only limited to the month; the balance can become negative. | Wrong entries accepted | Check on entry |
| 12 | **Uploading a sheet without a leave column clears** the saved days of that leave. | Data lost | Leave columns not in the sheet unchanged |
| 13 | **Leave may be debited twice.** Approving a leave application debits the balance, and Prepare debits the same days again from attendance. | Wrong balances | One source only (Q6) |
| 14 | **Components of type Loan deductions are never deducted** from assignments; the agency list also leaves them out. | Deduction missed. SLDB keeps this type for uploaded amounts (D10) | Treat as agency deductions |
| 15 | **Edit deductions shows type Deductions only.** With LOAN set up as Loan deductions (as in Blazor's upload and tests), the loan is not listed, the preview leaves it out, and Bring net to floor is disabled. | Feature not usable | Not needed: no loans in SLDB |
| 16 | **Minimum and maximum** on components and assignments are not applied. | Limits ignored | Apply, or remove from the screen (Q7) |
| 17 | **Status can be set directly** through the transition API: PROCESSED → APPROVED without approving the bills, and APPROVED → LOCKED without the unpaid check. | Controls bypassed | Not copied: SLDB has no such API |
| 18 | **No reversal** after approval, although two messages say to reverse or reject it. | Error cannot be corrected | Q9 |
| 19 | **Reject** has no reason and no maker or checker rule. | No record | Ask for a reason; apply the SLDB rule |
| 20 | **"Verified" is always 0.** Nothing in the program verifies attendance. | Meaningless figure | Leave out |
| 21 | **A negative net** is kept with only a warning. | Cannot be paid | Block approval (Q8) |
| 22 | **An override remains** after the component is no longer assigned, and then adds the deduction by itself. | Unexpected deduction | Show and allow removal |
| 23 | **An assignment starting or ending within the month** is paid for the full month. | Over- or underpayment | Q4 |
| 24 | **A missing PF rate or HRA/CCA rate** gives 0. | Underpayment | Not copied for HRA and CCA (spec 06); the same suggested for PF |

---

# Part C — For SLDB Payroll

## 13. What changes

### 13.1 Rules already decided

| Item | Blazor | SLDB Payroll | Source |
|---|---|---|---|
| Accounting | Salary voucher on payment | None | D1 |
| Loans, sundry debtors | Recovered in payroll | Left out: demand, recovery and columns Sundry and Loan | D10 |
| Loan deductions (type 3) | Not deducted | Amount from the monthly upload | D10 |
| Staff | Employee, Government, Foreign Service | Employees only. No fixed-pay path, EPF component or category column | D7 |
| Basic Pay for DA and CCA | Basic + GP + SP | **BASIC + PP + GP** | Spec 06 §3 |
| HRA | % of payBase by place | **Fixed amount by designation and place** when that method is chosen | Spec 06 §5 |
| CCA | Place rate | Place rate, on the new Basic Pay | Spec 06 §6 |
| MA | Assignment | One amount for all, from a setting | Spec 06 §7 |
| Transfer in the month | Split by branch | Split by branch **and** designation; parts on equal terms are added before rounding | Spec 06 D7 |
| DA rate | Active row, or the period's rate | Row in force on the period end date | Spec 06 §4 |
| Missing DA, HRA, CCA, MA or place | Warning or 0 | ERROR that blocks finalisation | Spec 06 §5, §13 |
| Payment | Employee Transactions page | **Mark Paid** and NEFT | D11 |
| PF on payment | PF ledger | `payroll.pf_contribution_events` | D6 |
| Status change | API allows it | Only through Prepare, Approve, Reject and Lock | `periodService.ts` |
| Next period's DA rate | 0 | Rate in force at the month end | `periodService.ts` |
| Reject | Anyone with Payroll | Not by the maker | D3 |
| Print order | Branch, code | Designation seniority, employee seniority, code | Spec 04 |
| Audit | Automatic | `withAudit` and an approval event for each step | docs §1.3 |

**Net floor without loans:** nothing can be reduced automatically, so a net below the minimum is only a warning (docs §3.3). Bring net to floor is left out; Edit deductions remains.

### 13.2 Already built, to reuse

| Need | Code |
|---|---|
| Rounding, limits, proration, sharing by days | `backend/src/lib/money.ts` |
| DA, HRA, CCA, MA | `services/payroll/allowanceRules.ts`, `hraCcaRateResolver.ts`; see `allowancePreviewService.ts` |
| Period, working days, lock and next month | `services/payroll/periodService.ts` |
| Rate by date | `rateOn` in `services/payroll/effectiveRateService.ts` |
| Maker-checker | `lib/makerChecker.ts` |
| Finalised period checks | `services/payroll/finalisedPeriods.ts` |
| Print order | `services/payroll/printOrder.ts` |
| Page and dialogs | `DataTable`, `Modal`, `Field`, `Select`, `Badge`; `lib/csv.ts` |

Working Days and Lock & Open Next are already on the Payroll Periods screen.

### 13.3 Not built yet

| Needed | Why |
|---|---|
| Increments | Check 4, and increment within the month. Tables only |
| Transfers, promotions | HRA and CCA split. The calculation reads the tables, but there are no screens |
| Leave applications and balances | Leave posting. Tables only |
| Payroll Settings screen | Minimum net percentage |
| Pay Bill and payslip prints | Printing from this page |
| Mark Paid | Needed before Lock |

The order of work is Q1.

### 13.4 Database

The tables of section 11.2 already exist in SLDB. Differences to settle when building:

| Item | SLDB today |
|---|---|
| `payroll_details` | No columns for the DA, HRA and CCA rows applied. Spec 06 §12.4 asks for them to be stored |
| `payrolls.is_withheld` | On the bill only. To keep it across Prepare, store it separately or carry it over |
| Changes after Prepare (point 1) | Nothing records when inputs last changed |
| `payroll_period_attendance_leaves.days` | Whole number. Half days would need a change |

## 14. Questions and answers

Answered on 25-Nov-2026.

| # | Question | Answer |
|---|---|---|
| Q1 | Is Preparation built first, without increments, transfers and leave balances? | Yes. Assigned pay is used. The increment check and leave posting are added with those modules |
| Q2 | **Loss of pay:** what is reduced, and what is DA worked out on? | As Blazor. Basic, PP and GP by all unpaid days; SP and DA only by leave types that cut them; DA on full pay, then reduced. HRA, CCA, MA and other earnings are not reduced |
| Q3 | **Joiners and leavers** | Every earning, including HRA, CCA and MA, by calendar days of service. Deductions are not shared |
| Q4 | **Assignment changed within the month** | Earnings shared by days; deductions as on the last day of service in the period |
| Q5 | Is attendance required before Prepare? | No. Prepare asks for confirmation, with the number of employees without an entry |
| Q6 | **Source of leave** | Monthly entry, whole days. A fraction is an error. Daily attendance is not read, and no balance is debited |
| Q7 | Do minimum and maximum on assignments apply? | To percentage assignments only |
| Q8 | Net below the minimum, or negative | Below the minimum warns; negative blocks approval |
| Q9 | Can an approved run be reversed? | By Admin, with a reason, while no bill is paid: APPROVED → PROCESSED |
| Q10 | **PF wages** | Basic + PP + GP + DA, as paid. SP does not count. A percentage VPF is on Basic + PP + GP |
| Q11 | **PF assignment** | The PF rate for everyone. An assigned PF amount is ignored, with a warning |
| Q12 | Earnings assigned as a percentage | Of the new Basic Pay (Basic + PP + GP) |
| Q13 | Minimum net % | The setting `payroll.min_net_percent_of_gross`. `payroll.payroll_settings` is not read |
| Q14 | PF ceiling, and employer PF equal to employee PF | Today's settings are followed: `payroll.pf_wage_ceiling` 0 is no ceiling. If `payroll.employer_pf_equals_employee` is turned off the run shows an ERROR, because no other rule is defined |
| Q15 | Category summary | One line: Paid, Pending and Withheld |
| Q16 | May Admin approve a run they prepared? | Yes (D3). Nobody may reject their own |
| Q17 | Agency upload format | .xlsx and .csv, also for attendance |
| Q18 | General Managers and the Managing Director | Paid by the same rules. Their HRA amounts must be entered |

## 15. Acceptance criteria

- [x] The page opens on the earliest SALARY period not locked.
- [x] HR can see the run and change nothing. Users outside Head Office cannot open the page.
- [x] Prepare is refused without working days, and on an APPROVED or LOCKED period.
- [x] Prepare calculates all eligible employees of all branches in one transaction. If it fails, nothing changes.
- [x] Preparing twice with the same inputs gives the same bills. (Debiting leave once: with leave posting.)
- [x] Attendance, agency deductions, edited deductions and withheld marks survive Prepare.
- [x] DA, HRA, CCA and MA equal the Allowance Preview for a month without loss of pay.
- [x] Employer PF raises Gross and Total Deductions equally, and Net is unchanged.
- [x] For every bill, Net = Gross − Total Deductions, and the totals equal the sum of the lines.
- [x] An ERROR for any employee is listed by code and name and blocks approval.
- [x] A warning names the employee by code and name.
- [x] An upload with errors shows them by row. Preview saves nothing. Overwriting needs confirmation.
- [x] An agency with no upload is deducted at the assigned amount, and the panel shows that amount.
- [x] The maker cannot approve or reject the run, except that Admin may approve.
- [x] Approval is refused if inputs changed after the last Prepare.
- [x] After approval, inputs and bills cannot be changed.
- [x] Lock is refused while an approved bill that is not withheld is unpaid.
- [x] Each step is in the audit log with the user and time.

## 16. Out of scope

- Layout of the Pay Bill, payslip and reports, and the NEFT file.
- Mark Paid and payment of withheld bills.
- Increments and their check (§6.1 check 4), leave posting (§8), and what a retirement does to later payroll (§9).
- DA arrears, surrender leave salary, bonus, ex-gratia, gratuity and leave encashment runs.
- Income tax calculation.
- Backlog upload of past payroll.
- The EPF Trust module.

## 17. Related documents

- `docs/tncu-gams-extraction.md` §0 (decisions D1 to D14) and §3
- `specs/01-hra-cca-rates-calculation-basis.md`
- `specs/02-daily-attendance.md`
- `specs/04-height-weight-remove-mandatory-add-seniority.md` (print order)
- `specs/06-allowance-calculation-da-hra-cca-ma.md`
- `specs/07-component-assignments-modifications.md`

## 18. Build notes (25-Nov-2026)

### 18.1 How the Part B points were settled

| Point | As built |
|---|---|
| 1 | Approve works the run out again and refuses if any bill would differ. It catches changes to rates, settings, assignments, postings, service dates, attendance and deductions. The page shows which employees are affected |
| 3, 4 | Q3 |
| 5 | The withheld mark and reason are carried over |
| 7, 23 | Q4. If two rows overlap, the later start is used. A day with no Basic assignment uses the employee record's Basic salary, with a warning; if that is blank too, it is an ERROR |
| 8 | 0 is stored and waives the deduction; blank removes the entry. The template is therefore filled with last month's amount or left **blank**, never 0 |
| 9 | Only changed rows are sent and saved |
| 10, 11 | A fraction, or more leave than days in service, is an error |
| 12 | A leave column not in the sheet is unchanged. The template is filled with the saved days |
| 14 | Loan deductions are handled as agency deductions |
| 18 | Q9 |
| 19 | Reject asks for a reason; the maker cannot reject. The reason shows until the next Prepare |
| 21 | Blocks approval |
| 22 | Not applied, warned about, and can be removed in Edit deductions |
| 24 | A missing PF rate is an ERROR |

Also: an employee with nothing payable still gets a bill, so that the error is seen. A component payroll needs that is missing or inactive is an ERROR. Assignments of DA, HRA, CCA, MA, EMPLOYER_PF, PF, BONUS, EX_GRATIA, SLS and GRATUITY are not paid in a SALARY run, with a warning. An edited PF does not change employer PF. A sheet made for another month shows a notice.

### 18.2 Calculation

N = days of service in the period, D = calendar days.

```
full Basic, PP, GP, SP = day-weighted average of the assignments over the N days
Basic, PP, GP paid     = RoundRupee(full × (N − unpaid) / D)
SP, DA paid            = RoundRupee(full × (N − unpaid for SP, DA) / D)
DA full                = RoundRupee((Basic + PP + GP) × DA% / 100)
MA                     = RoundRupee(MA × N / D)
HRA, CCA               = as spec 06, over the N days, shares of D
LOP                    = N − payable days
```

Section 7.15 under these rules: DA 15,260 · PF and employer PF 5,363 · Gross 56,290 · Deductions 13,926 · **Net 42,364**.

### 18.3 Where it is

| Part | Code |
|---|---|
| Database | `database/migrations/0007_payroll_preparation.sql`: `payrolls.service_days`, `payrolls.issues`, `payroll_details.applied` (rates and rows used), `payroll_periods.returned_by/at`, `return_reason` |
| Calculation | `services/payroll/payrollRules.ts` (pure), `payrollRunService.ts` (loading). The Allowance Preview uses the same run, so it now shares pay and allowances by days |
| Run | `preparationService.ts`, `periodLock.ts`, `periodService.resolveActive` |
| Inputs | `periodAttendanceService.ts`, `periodDeductionService.ts`, `manualDeductionService.ts`, `readinessService.ts` |
| API | Section 11.1, with `POST /periods/{id}/reject` and `POST /periods/{id}/reverse-approval` in place of `/transition`, and no PDFs |
| Screen | `pages/payroll/Preparation.tsx`, `components/payroll/preparation/`, `lib/spreadsheet.ts` (`exceljs`, loaded only when used) |
| Tests | `tests/payrollRules.test.ts`, `tests/preparation.api.test.ts` |

### 18.4 Before a real run

- Enter the DA rate (seeded 0%), the HRA amounts (General Managers and the Managing Director included), and the Basic, PP and GP assignments.
- Lock & Open Next stays refused until Mark Paid exists, unless every approved bill is withheld.
- **Mark Paid** must write `pf_contribution_events.pf_wages` as Basic + PP + GP + DA paid (Q10), not the Basic + GP + SP + DA in that column's comment. The PF line's `applied.wages` holds it.
