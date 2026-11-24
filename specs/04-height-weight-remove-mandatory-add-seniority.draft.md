# Requirement: Make height and weight optional; add employee seniority for payroll print order

**Status:** Draft. No code is changed by this document. It is the requirement to review before development starts.

## 1. Background

Two changes to the **New employee** form and the employee data:

1. **Height (cm)** and **Weight (kg)** are shown with a required marker (`*`) and block saving when empty ("Height is required", "Weight is required"). They should be optional.
2. Payroll is printed employee by employee, but there is no way to control the print order. Add a **Seniority** integer on the employee, next to the designation, so payroll prints in seniority order.

## 2. Current state (from the repo)

| Area | File | What it does today |
|---|---|---|
| Employee form | `frontend/src/pages/hr/EmployeeForm.tsx` (~lines 23, 142–143) | Height and Weight use `req('Height')` / `req('Weight')` and show `*`. |
| Employee validation | `backend/src/models/hr/employee.schema.ts` (lines 31–32) | `height` and `weight` are required numbers (height 50–250 cm, weight 20–250 kg). |
| Employee table | `database/schema.sql` (lines 396–397) | `height numeric(4,1) NOT NULL`, `weight numeric(5,1) NOT NULL`. No seniority column. |
| Designation seniority | `database/schema.sql` (~line 359), `backend/src/services/hr/designationService.ts` (line 17) | Designations already have `seniority_order integer 1–999`, sorted nulls last. This is a **designation-level** value, not an employee-level one. |
| Migrations | `database/migrations/` (latest `0004_employee_grades.sql`) | Schema changes go in numbered migration files. |
| Payroll print | Not located by search | Confirm where the payroll print query or screen lives before implementing the sort (see Q3). |

## 3. Scope

### In scope
- Remove the mandatory rule from **Height (cm)** and **Weight (kg)** in the form, the validation schema and the database.
- Keep the range checks when a value is entered (height 50–250, weight 20–250).
- Add a nullable integer **seniority** column to the employees table.
- Add a **Seniority** field to the employee form (Service or Personal tab, to be confirmed).
- Use seniority as the first sort key when payroll is printed.

### Out of scope
- Changing payroll calculations.
- Changing the designation's own `seniority_order` (it stays as it is).
- Back-filling existing employees with a seniority value.

## 4. Functional requirements

### 4.1 Height and weight are optional

| Field | Before | After |
|---|---|---|
| Height (cm) | Required, `*`, error "Height is required" | Optional, no `*`. Range 50–250 still applies if filled. |
| Weight (kg) | Required, `*`, error "Weight is required" | Optional, no `*`. Range 20–250 still applies if filled. |

- Blank is stored as `NULL`. Existing rows keep their values.
- The database columns `height` and `weight` change from `NOT NULL` to nullable.

### 4.2 Employee seniority

| Field | Type | Rule |
|---|---|---|
| Seniority | integer | Optional. 1–999. `1` is the most senior, matching the designation convention. Stored in `employees.seniority_order` (name to match the designation column). |

- Blank is stored as `NULL`.
- Two employees may share a seniority number. Ties are broken by employee code.

### 4.3 Payroll print order

Payroll prints in this order:

1. Designation `seniority_order` ascending, nulls last.
2. Employee `seniority_order` ascending, nulls last.
3. Employee code ascending.

## 5. Database change (new migration)

New file `database/migrations/0005_employee_seniority_and_optional_body.sql`:

```sql
alter table employees alter column height drop not null;
alter table employees alter column weight drop not null;
alter table employees add column seniority_order integer
  check (seniority_order between 1 and 999);
```

Also update `database/schema.sql` to match. Column names above are proposed; check them against the real table name before running.

## 6. Open questions

- **Q1. Employee seniority or designation seniority?** The request says the seniority integer goes "in the employees table among the designation". This draft takes that to mean an **employee-level** value, used as a tie-breaker inside each designation. If the intent is only the designation's existing seniority, no new column is needed and step 4.3 uses the existing field.
- **Q2. Where does the Seniority field sit on the form?** Proposed: the **Service** tab, next to designation.
- **Q3. Which screen prints payroll?** The search did not find the print code. Confirm the file before implementation so the sort can be applied in the right place.
- **Q4. Should height and weight be stored as `NULL` or as `0`?** Proposed: `NULL`, so blank means "not recorded".

## 7. Verification

1. Open **New employee**. Leave Height and Weight blank. Save succeeds. Both values are stored as `NULL`.
2. Enter height `20` (out of range). Save is blocked with the range message.
3. Enter Seniority `1` and `999`. Both save. Enter `0` or `1000`. Save is blocked.
4. Edit an existing employee. Height and weight keep their values.
5. Run payroll print for a period with three employees: two in one designation with seniority 2 and 1, and one in a designation with seniority 1. Print order follows section 4.3.
6. Run the backend schema tests and the migration on a copy of the database.
