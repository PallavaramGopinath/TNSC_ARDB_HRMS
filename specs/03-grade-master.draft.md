# Requirement: Grades master page and grade dropdown in New Designation

## 1. Background

The **New designation** dialog (see screenshot) has a free-text **Grade** box next to **Pay level** and **Seniority**. Users will enter many grades, so typing each one by hand is error-prone and inconsistent (e.g. "G-1" vs "G1" vs "Grade 1").

This change does two things:

1. Gives grades their own **Grades** master page, where the user creates and maintains the list of grades.
2. Replaces the free-text **Grade** box in the New designation dialog with a **dropdown** that is filled from the Grades table.

No code is changed by this document. It is the requirement to review before development starts.

## 2. Current state (from the repo)

| Area | File | What it does today |
|---|---|---|
| Designation screen | `frontend/src/pages/hr/Designations.tsx` | Dialog with Name, **Grade** (text, max 50), Pay level (text), Seniority (1–999), Active. |
| Designation API | `backend/src/controllers/hr/designationController.ts`, `backend/src/services/hr/designationService.ts` | Create/update/list. Stores `grade` as free text. |
| Designation validation | `backend/src/models/hr/designation.schema.ts` | `grade`: optional string, trimmed, max 50. |
| Designation table | `database/schema.sql` (~line 357) | `grade varchar(50)`, `pay_level varchar(50)`, `seniority_order int 1–999`. |
| Employee form | `frontend/src/pages/hr/EmployeeForm.tsx` (~line 176) | Also a free-text Grade box. **Not changed by this requirement** (see Open questions). |

There is no existing Grades table or Grades page.

## 3. Scope

### In scope
- New **Grades** master table in the database.
- New backend CRUD API for grades.
- New **Grades** page (list + add/edit dialog) in the HR menu, next to Designations.
- In the **New / Edit designation** dialog, change the **Grade** field from a text box to a **dropdown** that lists active grades.
- Existing designation records keep their current grade text. See section 6.

### Out of scope (for this change)
- Changing the Grade field on the Employee form (open question Q2).
- Pay level becoming a dropdown (not requested).
- Any change to payroll calculations.

## 4. Functional requirements

### 4.1 Grades master page

- **Route / menu:** HR → **Grades**, placed beside Designations.
- **Grid columns:** Grade code, Description, Display order, Active, Designations using it (count).
- **Add / Edit dialog fields:**

| Field | Type | Rule |
|---|---|---|
| Grade code | text | Required. Max 50 characters. Unique (case-insensitive, trimmed). |
| Description | text | Optional. Max 150 characters. |
| Display order | number | Optional. 1–999. Controls the order in the dropdown. |
| Active | checkbox | Default ticked. Inactive grades are hidden from the designation dropdown but kept on old records. |

- **Create, edit, activate/deactivate** work the same way as the existing Designations screen.
- **Delete:** allowed only when no designation uses the grade. Otherwise the user is told to deactivate instead. (Recommended default; see Q3.)
- Sorting in the grid and in the dropdown: by Display order, then Grade code.

### 4.2 Grades table (database)

New table `grades` (name to be confirmed against existing naming, e.g. `employee_designations`):

```sql
grades (
  id             uuid primary key,        -- match existing id convention
  grade_code     varchar(50) not null,
  description    varchar(150),
  display_order  integer check (display_order between 1 and 999),
  is_active      boolean not null default true,
  created_at, updated_at, created_by, updated_by   -- match other master tables
  unique index on lower(trim(grade_code))
)
```

Seed: none required. The user will enter grades on the new page. (Optional: confirm whether to load the TNCU grade list from the GAMS extraction in `docs/tncu-gams-extraction.md`.)

### 4.3 Backend API

Follow the pattern of `designationController.ts` / `designationService.ts`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/hr/grades` | List grades. Query `?active=true` returns only active rows for the dropdown. |
| POST | `/hr/grades` | Create. Validates section 4.1 rules. Returns 409 on duplicate code. |
| PUT | `/hr/grades/:id` | Update. Same validation. |
| DELETE | `/hr/grades/:id` | Delete only if unused. Otherwise returns 409 with a message to deactivate. |

Validation (zod, same style as `designation.schema.ts`) lives in `backend/src/models/hr/grade.schema.ts`.

### 4.4 Designation dialog: Grade dropdown

- The **Grade** field becomes a **select** (dropdown).
- Options come from `GET /hr/grades?active=true`, sorted by display order.
- The first option is a blank "— Select grade —" entry. Grade is **optional** on designation, as it is today, so blank is allowed.
- **Editing an existing designation** whose grade text is no longer in the list (or is inactive): the dropdown still shows that saved value so nothing is silently lost, marked as "(inactive)". The user can keep it or pick another.
- The dropdown must reflect a grade added on the Grades page without a full page reload (refetch the list when the dialog opens).
- If no active grades exist, the dropdown shows "No grades defined — add them on the Grades page" with a link to that page.
- Backend stores the **grade code** (text) on `designations.grade`. The schema does not change in this step (see Q1).

### 4.5 Unchanged behaviour
- Pay level, Seniority and Active fields on the designation dialog are unchanged.
- Existing designation list, sorting and save behaviour are unchanged apart from the Grade control.

## 5. Acceptance criteria

1. Grades page lists, adds, edits, activates/deactivates grades. Duplicate code (ignoring case and spaces) is rejected with a clear message.
2. A grade with a description, display order and active flag saves and reloads correctly.
3. Delete is blocked for a grade used by a designation and the message says to deactivate.
4. New designation dialog shows Grade as a dropdown listing only active grades, in display order.
5. Choosing a grade and saving stores that grade code on the designation; the list shows it.
6. A grade added on the Grades page appears in the designation dropdown the next time the dialog opens.
7. Editing an old designation whose grade is not in the master still shows its saved grade and saves without error.
8. Grade is still optional: a designation can be saved with no grade.
9. No change to Pay level, Seniority, Active, or to the Employee form.
10. Backend validation and API tests cover create, duplicate, update, delete-blocked, and the active filter.

## 6. Data migration

- Existing `designations.grade` values are free text and may not match any grade code.
- Migration step: list distinct existing `grade` values from `employee_designations` and insert any missing ones into `grades` as active rows (so no existing data disappears from the dropdown). Confirm before running (Q4).
- No existing data is deleted or rewritten.

## 7. Open questions (with the default I will use unless you say otherwise)

| # | Question | Default |
|---|---|---|
| Q1 | Should `designations.grade` become a foreign key to `grades`, or stay as text holding the code? | Stay as text, so old data and the GAMS import keep working. Switch to a foreign key later if needed. |
| Q2 | Should the **Grade** box on the Employee form also become this dropdown? | Not in this change. Raise as a follow-up. |
| Q3 | Can a grade be deleted, or only deactivated? | Delete only when unused; otherwise deactivate. |
| Q4 | Should existing free-text grades be copied into the Grades master during migration? | Yes, copy them in as active grades, after you review the list. |
| Q5 | Should the Grades page also hold a Pay level master for the same dropdown treatment? | Not in this change. |
| Q6 | Should the TNCU grade list be preloaded? | No. Users enter grades themselves. |

## 8. Verification plan (for when code is written)

1. Run database migration on a copy; confirm `grades` table, unique index, and copied grades.
2. Backend: run API tests for section 4.3 and acceptance criteria 1, 3, 10.
3. Frontend: manual check of Grades page (add, edit, deactivate, duplicate, delete-blocked).
4. Frontend: open New designation, confirm dropdown contents, save a designation with a grade, edit an old one (criteria 4–7).
5. Confirm Employee form and Pay level are unchanged (criterion 9).
6. Screenshot before and after the designation dialog for review.

## 9. Files expected to change

- `database/schema.sql` and a new migration file for `grades`
- `database/seed.sql` (only if Q4 is answered yes, via migration)
- `backend/src/models/hr/grade.schema.ts` (new)
- `backend/src/services/hr/gradeService.ts` (new)
- `backend/src/controllers/hr/gradeController.ts` (new) and its route registration
- `backend/src/models/hr/designation.schema.ts` (only if the grade rule changes)
- `frontend/src/pages/hr/Grades.tsx` (new)
- `frontend/src/pages/hr/Designations.tsx` (Grade field becomes a select)
- `frontend/src/services/hr.ts` and `frontend/src/types/api.ts` (grade types and calls)
- Menu/route file for the HR section (add Grades entry)
