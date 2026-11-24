# New employee page modifications

**Status:** Implemented (PR #4). See section 4 for the decisions made.
**Area:** HR → Employees (list table, New employee form and Edit employee form)

## 1. Request

> Add employee code in the employees table and add a text box to add employee code as first item.
> No code change.

The screenshot showed the **New employee** page, Personal tab. The first field was **Employee name***, followed by Name in Tamil, Gender, Date of birth, Marital status, Blood group, Height (cm) and Weight (kg). The subtitle read "The employee code is generated on save".

"No code change" applied to the drafting of this document. The change was approved and built afterwards.

## 2. State before this change

| Area | File | What it did |
|---|---|---|
| Employees table | `frontend/src/pages/hr/Employees.tsx` | **Code** was already the first column, showing `employee_code`. Columns after it: Name, Designation, Branch, Joined, Retires, Left, Basic, Status. |
| New employee form | `frontend/src/pages/hr/EmployeeForm.tsx` | Subtitle said the code is generated on save. No code field was shown. |
| Code generation | `backend/src/services/hr/employeeService.ts` (`nextEmployeeCode`) | Always generated on create as `{hr.employee_code_prefix}{n padded to hr.employee_code_pad}` (default `EMP001`), under an advisory lock. |
| Code storage | `hr.employees.employee_code` | `varchar(20)`, NOT NULL, unique (`uq_employees_code`, migration 0002). |

## 3. Requirements

### 3.1 Employees table
- The **Code** column is the **first** column. No change was needed.
- Search on `employee_code` and the default sort by code are unchanged.

### 3.2 New employee form
- **Employee code** is the **first field** on the Personal tab, before Employee name, with the placeholder "Blank = generated".
- Blank: the system generates the next code on save.
- Filled: the typed value is saved as the code, with outer spaces trimmed and leading zeros kept. No prefix is added (`0001` is saved as `0001`).
- The subtitle reads "Leave the code blank to generate it on save".

### 3.3 Edit employee form
- The code is shown in the page title (`Edit EMP001 · name`) and in an editable **Employee code** field holding the current code.
- Unchanged: always accepted, including a generated code such as `EMP001`.
- Blank: the current code is kept.
- Changed: the new code must pass the validation in 3.4.

### 3.4 Validation
| Rule | Message |
|---|---|
| A typed or changed code has digits only | Form: "Employee code must be digits only". API: "Employee code must be digits only (max 20)" |
| At most 20 characters | The form stops input at 20; the API rejects longer values |
| Not used by another employee | "Employee code already exists" |

The digits rule does not apply to an unchanged code, so it is checked against the saved code in the service rather than in the input schema. If two users save the same typed code at the same moment, the unique constraint rejects the second one with a general 409 error.

## 4. Decisions

- **Q1. Manual or generated code?** The text box accepts a manual code and falls back to generation when blank.
- **Q2. Allowed characters:** digits only, stored exactly as typed. No prefix is added.
- **Q3. Maximum length:** 20 characters, matching the column.
- **Q4. Edit mode:** editable after save, with the uniqueness check.
- **Q5. Codes outside the `prefix + number` pattern:** allowed; this follows from Q2. Generation counts only codes that match the prefix, so typed codes do not affect the next generated number while the prefix contains letters.

## 5. Implementation

| Area | File | What it does |
|---|---|---|
| Form | `frontend/src/pages/hr/EmployeeForm.tsx` | Field, subtitle and the digits check before saving |
| Input schema | `backend/src/models/hr/employee.schema.ts` | `employeeCode`: optional, trimmed, blank → null, max 20 |
| Rule | `backend/src/services/hr/employeeRules.ts` (`employeeCodeError`) | Digits only, unless blank or unchanged |
| Service | `backend/src/services/hr/employeeService.ts` (`checkCode`, `create`, `update`) | Applies the rule and the uniqueness check |
| Tests | `backend/tests/employeeCode.test.ts`, `backend/tests/employeeCode.api.test.ts` | The API tests run only with `TEST_DATABASE_URL` set |

No database migration was needed.

## 6. Known effects

- Attendance import matches rows by employee code. After a code is changed, import sheets must use the new one.
- If `hr.employee_code_prefix` has no letters (for example, it is blank), typed codes can match the generator's pattern, change the next number, and make generation fail when the typed number is too large.

## 7. Out of scope
- Changing the code generation algorithm, prefix or padding settings.
- Renumbering existing employees.
- Any change to the seniority or height/weight work in `specs/04-height-weight-remove-mandatory-add-seniority.md`.

## 8. Verification

1. Open **Employees**: the Code column is first, and sorting and search on code still work.
2. Open **New employee** with the code box blank, save, and confirm an `EMP` code is generated.
3. Type a unique code such as `0001`, save, and confirm it appears unchanged in the table.
4. Type a code that already exists: "Employee code already exists" is shown and nothing is saved.
5. Type a code with letters, such as `EMP9`: "Employee code must be digits only" is shown and nothing is saved.
6. Edit an employee with a generated code, change only another field, and confirm it saves with the code unchanged.
7. Change an employee's code to an unused one and confirm the title and table show it; change it to a used one and confirm it is rejected.

Steps 2 to 7 were checked in a browser against a throwaway database, and the API tests cover the same save and reject rules. After step 7 the new code was confirmed on the employee's profile, not in the title or table. In step 1 only the column order was checked; sorting and search code did not change.
