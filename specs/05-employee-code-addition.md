# New employee page modifications

**Status:** Draft requirement. No code changes in this document.
**Area:** HR → Employees (list table and New employee form)

## 1. Request

> Add employee code in the employees table and add a text box to add employee code as first item.
> No code change.

The screenshot shows the **New employee** page, Personal tab. The first field is **Employee name***, followed by Name in Tamil, Gender, Date of birth, Marital status, Blood group, Height (cm) and Weight (kg). The subtitle reads "The employee code is generated on save".

## 2. Current state (from the repo)

| Area | File | What it does today |
|---|---|---|
| Employees table | `frontend/src/pages/hr/Employees.tsx` (line 65) | A **Code** column already exists and shows `employee_code`. Columns after it: Name, Designation, Branch, Joined, Retires, Left, Basic, Status. |
| New employee form | `frontend/src/pages/hr/EmployeeForm.tsx` (lines 121–122) | Subtitle says the code is generated on save. No code field is shown. |
| Code generation | `backend/src/services/hr/employeeService.ts` (lines 147–160, 172–178) | The code is produced on create as `{hr.employee_code_prefix}{n padded to hr.employee_code_pad}` (default `EMP001`). An advisory lock prevents duplicates. |
| Code storage | `database/schema.sql` (`hr.employees.employee_code`) | Stored on the employee row. |

## 3. Requirements

### 3.1 Employees table
- The **Code** column must be the **first** column in the table (it already is in the column list; confirm this in the rendered table).
- Keep the existing search on `employee_code` and the default sort by code.

### 3.2 New employee form
- Add an **Employee code** text box as the **first field** on the Personal tab, above Employee name.
- Blank input: the system generates the next code on save (current behaviour).
- Filled input: the typed value is saved as the code.
- Validation:
  - Trim spaces. Allow letters and digits only (to match the prefix rule), unless the user decides otherwise (see Q2).
  - Must be unique across `hr.employees`. Show "Employee code already exists" on conflict.
  - Maximum length to be decided (see Q3).
- Update the subtitle text to match the new behaviour, for example "Leave the code blank to generate it on save".

### 3.3 Edit mode
- The code is shown in the page title (`Edit EMP001 · name`) and is read-only in edit mode (decision needed, see Q4).

## 4. Open questions

- **Q1. Manual code or generated code?** **Resolved:** the text box accepts a manual code and falls back to generation when blank (option a).
- **Q2. Allowed characters:** letters and digits only, or allow `-` `/` and other symbols?
- **Q3. Maximum length:** what is the longest code allowed?
- **Q4. Edit mode:** should the code stay read-only after the employee is saved, or can it be changed?
- **Q5. Existing codes:** should a manually entered code be allowed to break the `prefix + number` pattern used by the auto-generator (which computes the next number from the max existing code)?

## 5. Out of scope
- Changing the code generation algorithm, prefix or padding settings.
- Renumbering existing employees.
- Any change to the seniority or height/weight work in `specs/04-height-weight-remove-mandatory-add-seniority.md`.

## 6. Verification (once implemented)
1. Open **Employees**: the Code column is first, and sorting and search on code still work.
2. Open **New employee** with the code box blank, save, and confirm an `EMP` code is generated.
3. Open **New employee**, type a unique code, save, and confirm it appears in the table.
4. Type a code that already exists and confirm the error message and that nothing is saved.
5. Open an existing employee and confirm the code is shown as the title and matches the rule chosen in Q4.
