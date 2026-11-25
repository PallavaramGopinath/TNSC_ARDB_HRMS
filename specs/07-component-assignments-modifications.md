# Requirement: Component Assignments modifications

**Status:** Implemented. See section 10 for the build notes.
**Area:** Payroll → Payroll Masters → Component Assignments (`/payroll/components/assignments`)
**Date:** 25-Nov-2026

## 1. Request

> Component Assignments modifications
>
> In the add assignment component add (earnings / deductions) beside the component name in dropdown list
>
> Please refer the project BLAZOR_TNCU_GAMS-master.
> On selection of employee, the user to allow add all earnings and deductions one-by-one. It is easy to add earnings and deductions.

The screenshot showed the **Add assignment** dialog with the Component list open. It held 25 components, from `BASIC — Basic Pay` to `OTHEARNINGS — Other Earnings`, with nothing to tell an earning from a deduction.

### Decisions made

| # | Question | Decision |
|---|---|---|
| D1 | How is the employee chosen? | A **dropdown list** at the top of the page, in place of the search box |
| D2 | Page layout | The rest is the same as the Blazor page |
| D3 | After saving one component | **Save & add next** keeps the dialog open for the same employee |
| D4 | Components already assigned | **Hidden** from the dropdown, as in Blazor |
| D5 | DA, HRA, CCA and MA, which payroll calculates itself | **Left out** of the dropdown (§4.6) |
| D6 | EMPLOYER_PF, BONUS, EX_GRATIA, SLS and GRATUITY, which are calculated or paid through their own payroll types | **Left out** of the dropdown (§4.6) |
| D7 | Employees who have left | **Kept** in the employee dropdown, marked as left (§4.2) |
| D8 | How PF is assigned | As today: offered, fixed amount only. Settled in spec 08 Q11: payroll uses the PF rate for everyone and ignores the assignment |
| D9 | List of assignments across all employees | Not on this screen. To be provided later as a report |
| D10 | Component with only a future-dated assignment | Stays hidden. Edit its start date, or deactivate it and add it again (§4.5) |

## 2. State before this change (SLDB Payroll)

File: `frontend/src/pages/payroll/ComponentAssignments.tsx`

| Item | What it did |
|---|---|
| Component label | `code — name`, for example `BASIC — Basic Pay`. The type is not shown, although the API returns it (`component_type`). |
| Choosing the employee | Inside the Add dialog, by typing a name or code. |
| After Save | The dialog closes. For the next component, the user must open it and search for the same employee again. |
| Components offered | All active components, including those the employee already has. A duplicate is refused only on Save ("Overlaps with…"). |
| Page list | Assignments of all employees, 50 per page. Filters: Search, Component, Status and As on. There is no Type column. |

## 3. Reference (BLAZOR_TNCU_GAMS-master)

Files: `TNCU.Web.Client/Pages/Payroll/ComponentAssignments.razor`, `TNCU.Business/Payroll/PayrollComponentAssignmentService.cs`

| Item | What it does |
|---|---|
| Employee | Chosen once at the top of the page, shown as `code — name`. |
| Before an employee is chosen | Shows "Pick an employee above to view their component assignments." The **+ Assign Component** button is disabled. |
| Filter | Active / Inactive, with Active as the default. |
| List | The chosen employee's components: Code, Component, **Type**, Assigned, Amount, %, Formula, From, To, Active, Actions. The count is shown below. |
| Component label | `code — name (type)`, for example `BASIC — Basic Pay (Earnings)`. |
| Components offered | Those not already in the employee's list. |
| After Save | The dialog closes and the list reloads. The employee stays chosen. |

## 4. Requirements

### 4.1 Type beside the component name
- Every component in the Add assignment dropdown shows its type in brackets:

| `component_type` | Shown as | Example |
|---|---|---|
| 1 | (Earnings) | `BASIC — Basic Pay (Earnings)` |
| 2 | (Deductions) | `PF — Provident Fund (Deductions)` |
| 3 | (Loan deductions) | `code — name (Loan deductions)` |

- The wording is the same as on the Components page.
- The type comes from the Components master. It is not guessed from the code or name.
- The order is unchanged: display order, then code.
- The Edit, Revise and View dialogs also show the type beside the component name.

### 4.2 Employee dropdown on the page
- A dropdown list labelled **Employee** at the top of the page, with the placeholder "Select employee".
- Each entry reads `code — name`, in employee code order.
- **All** employees must be listed. The employee API returns at most 200 at a time, so the list must be loaded page by page until complete.
- An employee who has left is listed, as today and in Blazor, with "(left dd-mm-yyyy)" after the name, because the last month is still paid. An assignment starting after the leaving date is refused, as today.
- Changing the employee reloads the list. The choice stays after adding, editing, revising or deactivating.

### 4.3 Page, as in Blazor
- Until an employee is chosen:
  - the page shows "Select an employee above to view their component assignments."
  - **Add assignment** is disabled
- Once chosen, the page lists that employee's assignments in component display order: Code, Component, **Type**, Amount or %, Eff. from, Eff. to, Status and Actions. The number of assignments is shown below.
- The **Active / Inactive** filter replaces Status, with Active as the default.
  - Active means not deactivated, so current, future and expired rows are all included.
  - The Status column still shows Current, Future, Expired or Inactive.
- The Search, Component and As on filters are removed.
- Actions are unchanged: Edit, Revise and Deactivate on current and future rows, and View on the rest.
- HR sees the page read-only. Payroll and Admin can make changes, as today.

### 4.4 Adding earnings and deductions one by one
- **Add assignment** opens the dialog with the chosen employee's name and code shown as text. The employee is not asked for again.
- Fields: Component, Type, then Amount, or Percentage with Minimum and Maximum, then Effective from and Effective to.
- Effective from starts as today's date, as in Blazor.
- Buttons:

| Button | What it does |
|---|---|
| Cancel (becomes **Close** after the first save) | Closes. Components already saved stay saved. |
| Save | Saves this component and closes. |
| **Save & add next** | Saves this component and keeps the dialog open for the next one. |

- After **Save & add next**:
  - the employee, Effective from and Effective to are kept
  - the component, amount, percentage, minimum and maximum are cleared, and the type returns to Fixed amount
  - the saved component goes from the dropdown, and the cursor moves to Component
  - the dialog lists what has been added since it opened, for example `BASIC — Basic Pay (Earnings) — ₹20,000.00`, with the number of components still to be added
  - any warning from the server, such as dates covering a finalised period, is shown in the dialog
- Each component is saved on its own. If one is refused, the dialog stays open with the values typed and the message shown. Components saved earlier are not affected.
- When nothing is left to add, the form is replaced by "All components that can be assigned have been assigned to this employee."
- A double click must not save twice. The buttons are disabled while saving.

### 4.5 Components already assigned
- The dropdown leaves out every component for which the employee has an active assignment that has **not ended** (Eff. to blank, today or later).
- This does not depend on the Active / Inactive filter. In Blazor it does: choosing Inactive there makes assigned components appear again. That is not to be copied.
- A component whose assignment was deactivated, or has ended, is offered again.
- To change an assigned component, use Edit or Revise.
- A component whose only assignment starts in the future is also hidden. To start it earlier, edit its start date, or deactivate it and add it again.
- The components in §4.6 are never offered.
- The server's overlap check stays as the final safeguard, for example when two users add the same component together.

### 4.6 Components never offered
- These nine components are **not offered** in the Add assignment dropdown:

| Code | Component | Why |
|---|---|---|
| `DA` | Dearness Allowance | Calculated from the DA rate |
| `HRA` | House Rent Allowance | Calculated from the HRA amounts or rates |
| `CCA` | City Compensatory Allowance | Calculated from the CCA rates |
| `MA` | Medical Allowance | One amount for everyone, from a setting |
| `EMPLOYER_PF` | Employer PF Contribution | Follows the employee's PF |
| `BONUS` | Bonus | Own payroll type |
| `EX_GRATIA` | Ex-Gratia | Own payroll type |
| `SLS` | Surrender Leave Salary | Own payroll type |
| `GRATUITY` | Gratuity | Own payroll type |

- The allowance preview does not read an assigned amount for DA, HRA, CCA or MA.
- They are matched by component code, ignoring upper and lower case and outer spaces.
- They are not counted in the number of components still to be added. With the 25 components in the screenshot, 16 can be assigned.
- An assignment of one of these that already exists is still listed, and can be viewed, edited, revised or deactivated.
- A note under the dropdown reads "DA, HRA, CCA, MA, Employer PF, Bonus, Ex-Gratia, SLS and Gratuity are handled by payroll and are not assigned here."
- Blazor offers every component not already assigned. That is not copied.

### 4.7 Example

```
Employee  [ EMP002 — Banu                     v ]    Filter [ Active v ]   [+ Add assignment]

Code     Component      Type         Amount or %   Eff. from    Eff. to   Status
BASIC    Basic Pay      Earnings      ₹20,000.00   01/04/2026   —         Current
PP       Personal Pay   Earnings         ₹500.00   01/04/2026   —         Current
SOCIETY  Society Loan   Deductions     ₹1,000.00   01/04/2026   —         Current
3 assignments

+-- Add assignment -----------------------------------------+
| Employee   Banu (EMP002)                                  |
| Component  [ GP — Grade Pay (Earnings)                 v ]|
| Type       [ Fixed amount v ]   Amount  [ 2,400.00 ]      |
| Eff. from  [ 01/04/2026 ]       Eff. to [            ]    |
| Added: none yet · 13 remaining                            |
|                    [Cancel]  [Save]  [Save & add next]    |
+-----------------------------------------------------------+
```

Names, amounts and the type of Society Loan are illustrative.

## 5. Kept as in SLDB Payroll, not copied from Blazor

"Same as Blazor" covers the layout and the way of adding. These SLDB rules are stricter and stay:

| Item | Blazor | SLDB Payroll (kept) |
|---|---|---|
| Removing an assignment | Deleted permanently | Deactivated; blocked once used in a finalised payroll |
| Changing the amount from a date | Not available | **Revise** closes the old row and adds a new one |
| Component on edit | Can be changed | Cannot be changed |
| Percentage | Any component | Refused for BASIC, PP, GP and SP, and for deductions other than `ADL PF` |
| Finalised payroll | No check | Amount locked; only the end date can move |
| Formula box | Free text | Not shown; payroll does not use it |
| Audit log | None in this service | Every change is recorded |

## 6. Design

### Frontend
- `frontend/src/pages/payroll/ComponentAssignments.tsx`: the page and the Add dialog. The present `EmployeePicker` is no longer needed.
- Leave out the nine codes of §4.6 in the Add dropdown only. The Components master is not changed.
- `frontend/src/lib/payrollComponents.ts`: the type names (moved from `Components.tsx`, so that both pages use one wording), the label, and the §4.6 codes.
- Reuse the `Select`, `Field`, `Modal`, `DataTable` and `Badge` components.
- Load the chosen employee's assignments once with `employeeId`, status `ALL` and size 200. Use that one result for both the list and the hidden components, so that the filter cannot affect §4.5. If `total` is more than 200, load the remaining pages.

### Backend
- No change expected. The server still accepts the §4.6 components; leaving them out is a rule of the screen.
- `GET /api/payroll/component-assignments` already accepts `employeeId`, and `POST` already adds one component with every rule in §5.
- The employee list is already open to HR and Payroll (`GET /api/hr/employees`).

### Database
- No change.

## 7. Acceptance criteria

- [x] Every component in the dropdown shows (Earnings), (Deductions) or (Loan deductions), matching the Components master.
- [x] The nine components in §4.6 are never in the dropdown. An existing assignment of one of them is still listed.
- [x] With no employee chosen, nothing is listed and Add assignment is disabled.
- [x] The employee dropdown lists every employee, including when there are more than 200.
- [x] An employee who has left is in the dropdown, marked with the leaving date.
- [x] Choosing an employee lists only that employee's assignments, with the Type column and count.
- [x] Several earnings and deductions can be added in one opening of the dialog, choosing the employee only once.
- [x] Save & add next keeps the employee and dates, clears the rest, and removes the saved component from the dropdown.
- [x] A refused entry keeps the typed values and does not affect components saved earlier.
- [x] Closing the dialog midway keeps what was saved.
- [x] An assigned component is not offered, with the filter on Active or on Inactive.
- [x] A deactivated or ended component is offered again, unless it is in §4.6.
- [x] A component with a future-dated assignment is not offered; its start date can be edited.
- [x] PF is offered, and a percentage for it is refused.
- [x] Edit, Revise, Deactivate and View work as before, and the existing backend tests pass.
- [x] HR cannot add or change anything.

## 8. Out of scope

- Adding one component to many employees at once, and upload from Excel.
- Copying assignments from one employee to another.
- A list or report of one component across all employees (D9).
- How PF is calculated or assigned in Payroll Preparation (D8).
- Changes to the Components master, the payroll calculation or the allowance preview.

## 9. To check before release

- **Component types:** is each component marked correctly in the Components master? The new label shows what is stored there. For example, is Society Loan stored as a deduction or a loan deduction?

## 10. Build notes (25-Nov-2026)

- Frontend only: `ComponentAssignments.tsx`, `Components.tsx` (type names moved out) and the new `lib/payrollComponents.ts`.
- Pressing Enter in the Add dialog does **Save & add next**.
- The Active / Inactive filter is labelled **Show**.
- A server warning, such as dates covering a finalised period, is shown under the added component.
- Each criterion in §7 was checked in the running app on a throwaway database with 215 employees.
