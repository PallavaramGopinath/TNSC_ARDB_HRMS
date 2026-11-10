# Daily Attendance — monthly grid and CSV import

**Status:** Implemented

| Item | Detail |
|---|---|
| Module | HR → Leave & Attendance → Attendance (`/hr/attendance`) |
| Primary table | `hr.employee_attendances` (UNIQUE `employee_id, attendance_date`) |
| Related tables | `hr.employees`, `core.branches`, `core.financial_years`, `payroll.payroll_periods` |
| Date | 10-Nov-2026 |

## Context
TNCU records attendance daily: one row per employee per date, with status PRESENT, ABSENT, LEAVE, HOLIDAY or HALF_DAY, and imports a CSV of `code,date,status` (see `docs/tncu-gams-extraction.md` §2.8). The table and the menu entry already existed, but there was no API or screen.

## Requirements
- HR marks attendance for one branch and one month at a time, in a grid of employees × days.
- Payroll users can view it but not change it.
- HR can bulk-load attendance from the TNCU CSV format.
- Rules, enforced on the server and mirrored in the grid:
  1. No marks before the employee's date of joining or after their date of leaving.
  2. No future dates, except HOLIDAY (so holidays can be planned ahead).
  3. No changes, including clearing a mark, on dates covered by an **APPROVED** or **LOCKED** SALARY payroll period of the branch.
  4. A save or an import is all or nothing: if any entry is invalid, nothing is written.

## Design

### Backend
| Method | Path | Roles | Body / query | Returns |
|---|---|---|---|---|
| GET | `/api/hr/attendances` | Admin, HR, Payroll | `branchId, year, month` | `{ branch, year, month, today, days[], lockedReason, employees[], records }` |
| PUT | `/api/hr/attendances` | Admin, HR | `{ branchId, entries: [{ employeeId, date, status \| null, remarks? }] }` (≤ 3,000) | `{ saved, cleared }` |
| POST | `/api/hr/attendances/import` | Admin, HR | `{ rows: [{ line, code, date, status }], dryRun }` (≤ 5,000) | `{ total, valid, imported, errors: [{ line, code, date, message }] }` |

- **Employees in the grid:** those posted to the branch who served during the month, plus anyone with marks in that branch for the month (for example, employees transferred out mid-month).
- **Statuses:** P / A / L / H / HD and the full names are accepted, in any case.
- **Import dates:** YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY or DD.MM.YYYY.
- **Saving:** writes upsert on `(employee_id, attendance_date)` and set `financial_year_id` from the financial year that covers the date. A `null` status deletes the row.
- **Branch:** imported rows use the employee's current branch for `branch_id` and for the lock check.
- **Errors:** an invalid save returns 400 `ATTENDANCE_INVALID` with `details.errors[{ employeeId, date, message }]`, so the grid can outline the failing cells.
- **Code:**
  - rules: `services/hr/attendanceRules.ts`
  - service: `services/hr/attendanceService.ts`
  - schemas: `models/hr/attendance.schema.ts`

### Frontend
- **Page:** `pages/hr/Attendance.tsx`.
  - Pick the branch and the month (with ‹ › to step months).
  - Choose a brush: Present, Absent, Leave, Half day, Holiday, or Clear.
  - "Fill blanks as Present" marks every blank, non-Sunday day up to today.
  - Save / Discard; unsaved edits are guarded when you change branch or month and when you leave the page.
- **Grid:** `components/hr/AttendanceGrid.tsx`.
  - Click or drag across cells to paint them. Click a date header to paint the whole column. A per-row button fills that employee's blanks.
  - Sundays are shaded, days outside service are hatched, and locked days show a lock.
  - Edited cells are outlined, and cells the server rejects are outlined in red with the reason as a tooltip.
  - Per-employee totals and an "Unmarked" count on the right; a present count per day at the bottom.
- **Import:** `components/hr/AttendanceImport.tsx`.
  - The CSV is parsed in the browser (`lib/csv.ts`) and checked on the server with a dry run, which lists errors by line.
  - "Import" is enabled only when every row is valid.
  - A template can be downloaded.

### Database
No change. Edits are audited by the generic `trg_audit` trigger.

## Acceptance criteria
- [x] HR can mark, change and clear days for a branch and month, and the marks persist after reload.
- [x] Days before joining or after leaving cannot be marked; future days accept only Holiday.
- [x] Days inside an approved or locked salary period are read-only in the grid and rejected by the API.
- [x] Payroll users see the grid without the brush, Save or Import controls; the API rejects their writes (403).
- [x] A CSV with any invalid row imports nothing and lists each problem with its line number.
- [x] Unit tests: `tests/attendanceRules.test.ts`, `tests/attendance.schema.test.ts`.

## Open questions
- Should weekly-off days other than Sunday (for example, second and fourth Saturdays) be configurable and excluded from "Fill blanks"?
- Should the payroll-period attendance (`payroll.payroll_period_attendances`) be pre-filled from these daily marks?
