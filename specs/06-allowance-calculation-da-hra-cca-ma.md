# Requirement: Allowance calculation (DA, HRA, CCA, MA)

**Status:** Implemented (masters, HRA method, calculation engine, preview). Payroll Preparation: spec 08.
**Area:** Payroll → monthly salary calculation ("Prepare") and Payroll → Masters
**Date:** 25-Nov-2026

## 1. Background

Payroll Preparation is not built yet. The rules in the repo (`docs/tncu-gams-extraction.md` §3.3) are TNCU's, and differ from those of the Tamil Nadu Co-operative State Agriculture and Rural Development Bank (TNCSARDB). This document states the TNCSARDB rules.

**Sources**

| Ref | Source |
|---|---|
| R | The requirement given for this document |
| S | `Wage-revision-document.pdf`: Memorandum of Settlement under Section 12(3), Industrial Disputes Act 1947, No. C4/23857/2024, dated 28.08.2024 |

- The settlement takes effect from **01.01.2022** and is in force till **31.12.2026 or till the next settlement** (S 2, 26, 27).
- It covers all employees **except the General Managers and the Managing Director** (S, page 1).
- The PDF is a scan. Its text was read by OCR, so verify the amounts quoted here against the original.

## 2. Summary

| Allowance | Formula | Depends on |
|---|---|---|
| Basic Pay | BASIC + PP + GP | Employee |
| DA | Basic Pay × DA rate %, rounded to Re. 1 | DA rate for the period |
| HRA | Fixed amount | Designation and place category |
| CCA | 5% or 3% of Basic Pay, with a minimum and maximum | Place category |
| MA | Rs. 1000 | None: same for all employees |

Place category means the place category of the employee's branch (`core.branches.place_id` → `core.place_categories`). "Greater Chennai Corporation" is the category with code `GCC`.

## 3. Basic Pay

```
Basic Pay = BASIC + PP + GP
```

- These are `component_code` values in `payroll.payroll_components`: Basic Pay, Personal Pay and Grade Pay.
- A component the employee does not have counts as 0.
- Special Pay (`SP`) is **not** part of Basic Pay here.
- The same Basic Pay is used for DA and CCA.

## 4. Dearness Allowance (DA)

### 4.1 How the DA rate is arrived at

```
DA rate % = points × 0.07%
```

- Points come from the All India Average Working Class Consumer Price Index (base 1960 = 100). The Government of Tamil Nadu arrives at them and issues a G.O. The bank calculates the rate from the G.O.
- The rate is revised quarterly; quarters end in March, June, September and December (S 3). It can rise or fall.
- **What a point means:** clause 3 of the settlement pays 0.07% for every rise of **4 index points** above 6352. "Points" in the formula must therefore be the number of 4-point slabs:

```
points = (CPI − 6352) / 4
```

  Cross-check with clause 2: the new DA of 30.38% is 434 × 0.07%, and 434 slabs are 1,736 index points (CPI 8088). Multiplying 1,736 by 0.07% would wrongly give 121.52%.
- The system does **not** compute the rate. An authorised user enters the resulting percentage in Payroll → Masters → DA Rates.

### 4.2 Calculation

```
DA = roundRupee(Basic Pay × da_percentage / 100)
```

- `da_percentage` is the row of `payroll.payroll_da_rates` in force on the **period end date**: `effective_from` ≤ date, and `effective_to` blank or ≥ date.
- **Rounding:** to the nearest Re. 1. Paise of 50 and above round up, and below 50 round down. This is the existing `roundRupee()` in `backend/src/lib/money.ts`. (R said "51 and above"; changed to 50 and above by decision, see §9.)
- If no rate is in force, payroll validation must report it. DA must not silently become 0.

## 5. House Rent Allowance (HRA)

HRA is a **fixed monthly amount** by designation and place category. It is not a percentage of Basic Pay.

| Designation | Greater Chennai Corporation (Rs.) | Other place categories (Rs.) | Source |
|---|---:|---:|---|
| Deputy General Manager | 5000 | 5000 | R, S 7 |
| Manager | 4000 | 3500 | R, S 7 |
| Assistant Manager (AM) | 4000 | 3500 | R, S 7 |
| Superintendent | 4000 | 3500 | R, S 7 |
| DO | 4000 | 3500 | S 7 (added) |
| AO | 4000 | 3500 | S 7 (added) |
| ADO | 4000 | 3500 | S 7 (added) |
| Assistant | 3000 | 2500 | R, S 7 |
| Driver | 3000 | 2500 | R, S 7 |
| Office Assistant | 3000 | 2500 | S 7 (added) |
| Selection Grade Office Assistant | 3000 | 2500 | R |
| Special Grade Office Assistant | 3000 | 2500 | R |

Rules:

- **Deputy General Manager** gets 5000 in every place. In the settlement table the 5000 is printed centred across both columns.
- Other place categories are all active categories except `GCC`: Other Corporation (`OC`), Other District Headquarters (`ODHQ`), Other Places (`OP`), and any added later.
- The amount is matched by `designation_id`, not by comparing the designation text.
- **No amount for the designation, or no place category on the branch:** the employee is listed in pre-payroll validation and finalisation is blocked (same as spec 01 §4.3). HRA must not silently become 0, and a blank place category must not be treated as "other". The exception is a Deputy General Manager, whose HRA does not depend on place.

## 6. City Compensatory Allowance (CCA)

| Place category | Rate on Basic Pay | Minimum per month (Rs.) | Maximum per month (Rs.) |
|---|---:|---:|---:|
| Greater Chennai Corporation (`GCC`) | 5% | 1000 | 1500 |
| All other categories (`OC`, `ODHQ`, `OP`, any added later) | 3% | 800 | 1000 |

```
CCA = clamp(roundRupee(Basic Pay × rate / 100), minimum, maximum)
```

- CCA does not depend on designation.
- **Difference from the settlement:** clause 8(ii) gives the 3% rate to "Other Corporations" only. By decision, the 3% rate applies to every category other than `GCC` (see §9).
- A branch with no place category is reported in validation, as for HRA.
- R and S state no rounding for CCA. Rounding to Re. 1, as for DA, is assumed (§10 Q1).

## 7. Medical Allowance (MA)

```
MA = Rs. 1000 per month
```

Same for all employees and all place categories (R, S 9).

## 8. Worked examples

The DA rate of 30.38% is used for illustration only. Basic Pay is BASIC + PP + GP. Pay figures are illustrative.

| # | Designation, place | Basic Pay | DA before rounding | DA | HRA | CCA before limits | CCA | MA | Total of the four |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | Deputy General Manager, GCC | 51160 | 15542.41 | 15542 | 5000 | 2558.00 | 1500 (maximum) | 1000 | 23042 |
| 2 | Deputy General Manager, ODHQ | 51160 | 15542.41 | 15542 | 5000 | 1534.80 | 1000 (maximum) | 1000 | 22542 |
| 3 | Superintendent, OC | 29230 | 8880.07 | 8880 | 3500 | 876.90 | 877 (within limits) | 1000 | 14257 |
| 4 | Assistant, GCC | 22500 | 6835.50 | 6836 | 3000 | 1125.00 | 1125 (within limits) | 1000 | 11961 |
| 5 | Office Assistant, GCC | 14630 | 4444.59 | 4445 | 3000 | 731.50 | 1000 (minimum) | 1000 | 9445 |
| 6 | Office Assistant, OP | 14630 | 4444.59 | 4445 | 2500 | 438.90 | 800 (minimum) | 1000 | 8745 |

Example 4 has exactly 50 paise in DA, which rounds up.

## 9. Decisions made

| # | Question | Decision |
|---|---|---|
| D1 | DA rounding: R says 51 paise and above; the existing helper uses 50 | 50 paise and above rounds up (existing helper) |
| D2 | CCA outside Chennai: R covers all other places; S 8(ii) covers Other Corporations only | All other place categories get 3% |
| D3 | HRA designations in S 7 but not in R | Added: DO, AO, ADO, Office Assistant |

## 10. Open questions

1. **CCA rounding:** confirm CCA is rounded to Re. 1 (§6).
2. **Loss of pay and unpaid leave:** R gives full-month rules only. The existing reference rules are: DA is prorated for leave types that cut DA, HRA and CCA are not reduced, and MA is a fixed amount. Are these correct for TNCSARDB?
3. **DA base under loss of pay:** is DA calculated on full Basic Pay and then prorated (existing rule), or on the Basic Pay actually paid? Personal Pay now counts for DA but is prorated with Basic and Grade Pay, not with DA.
4. **Transfer or promotion within the month:** the existing rule splits HRA and CCA by days. Confirm the split applies to the fixed HRA amounts and to the CCA minimum and maximum.
5. **Special Pay:** confirm it is excluded from DA and CCA. The current reference rules include it.
6. **PF and voluntary PF:** the reference PF wage is Basic + GP + SP + DA, and voluntary PF uses the old pay base. Should these follow the new Basic Pay (with PP, without SP)? This document does not change them.
7. **"Pay Band" and "Basic Pay":** S 3 applies the 0.07% to the "Pay Band". Confirm this means BASIC + PP + GP.
8. **General Managers and the Managing Director** are outside the settlement. Which rules apply if they are paid through this system?
9. **Designation names:** confirm the full names of DO, AO and ADO. Confirm HRA for pay-band categories not named in S 7: Manager (Accounts), Editor, A.E, and the selection grades of ADO, A.E, Superintendent, Assistant and Driver.
10. **DA points:** confirm the G.O. states 4-point slabs, so that the 0.07% is applied as in §4.1.
11. **After 31.12.2026:** confirm the same amounts continue until a new settlement.

## 11. System before this work compared with this requirement

| Item | Current state | Gap |
|---|---|---|
| Basic Pay | Reference rule: `payBase = Basic + GP + SP`, with PP excluded (`docs/tncu-gams-extraction.md` §3.3) | Must become Basic + PP + GP |
| `is_da_applicable` flags | `database/seed.sql`: BASIC and GP true, **PP false, SP true** | PP should be true and SP false if the flags drive DA or DA arrears |
| DA rate | `payroll.payroll_da_rates.da_percentage numeric(8,2)`, effective-dated; `rateOn(date)` in `effectiveRateService.ts` | None. Two decimals are enough for multiples of 0.07. The seeded rate is 0%, so the actual rate must be entered |
| Rounding, limits | `roundRupee()` and `clamp()` in `backend/src/lib/money.ts` | None |
| HRA | `payroll.payroll_hra_cca_rates`: a percentage per place **or** per designation, never both | Cannot hold a fixed amount per designation **and** place |
| CCA | Same table, PLACE rows: percentage, minimum and maximum | Fits without schema change; rates must be entered |
| HRA/CCA basis | One setting, `payroll.hra_cca.basis`, drives both (spec 01, D13) | HRA needs designation and place; CCA needs place only |
| MA | Component `MA` is seeded; the amount comes from each employee's assignment | No organisation-wide Rs. 1000 amount |
| Calculator | Not built | To be built |

## 12. Design (as built: §15)

### 12.1 HRA
- New effective-dated table, for example `payroll.payroll_hra_amounts`: `designation_id`, `gcc_amount`, `other_amount`, `effective_from`, `effective_to`, `remarks`, `is_active` and audit columns. One active row per designation at a time, with overlaps rejected as in migration 0003.
- The Deputy General Manager row holds 5000 in both columns.
- A master screen to list, add and revise the amounts by effective date. Revising keeps the old row for history and arrears.

### 12.2 CCA
- Keep `payroll.payroll_hra_cca_rates` with PLACE rows and enter the rates in §6. Enter 3%, 800 and 1000 on each of `OC`, `ODHQ` and `OP`.
- CCA always uses the PLACE lookup, whatever the HRA method is. The HRA percentage on these rows is not used for TNCSARDB.
- A place category added later needs its own row; until then it is reported as missing.
- This changes spec 01's rule that one basis drives both allowances, so spec 01 must be updated when this is built.

### 12.3 MA
- One effective-dated setting, for example `payroll.medical_allowance.amount` = 1000 in `core.app_settings`.

### 12.4 Calculator
- Reuse `roundRupee`, `clamp`, `keyAsOn` and `keyDaySegments`, and follow the pattern of `hraCcaRateResolver.ts`.
- Use the designation, branch and rates valid for the pay period, not those on the day payroll is run.
- Store the applied DA rate, HRA row and CCA row with the pay line so past payslips stay reproducible.

## 13. Acceptance criteria

- [ ] Basic Pay is the sum of BASIC, PP and GP. Changing SP does not change DA or CCA.
- [ ] DA uses the rate in force on the period end date and is rounded to Re. 1 (6835.49 → 6835; 6835.50 → 6836; 6835.51 → 6836).
- [ ] A revised DA rate does not change earlier periods.
- [ ] HRA matches §5 for every designation in both place groups.
- [ ] A Deputy General Manager gets Rs. 5000 HRA in all place categories.
- [ ] CCA in GCC is never below 1000 or above 1500; elsewhere it is never below 800 or above 1000 (full month).
- [ ] CCA boundaries hold:

| Place | Basic Pay | CCA |
|---|---:|---:|
| GCC | 20000 | 1000 |
| GCC | 30000 | 1500 |
| GCC | 30010 | 1500 |
| Other | 26660 | 800 |
| Other | 26700 | 801 |
| Other | 33330 | 1000 |
| Other | 33400 | 1000 |

- [ ] MA is Rs. 1000 for every employee for a full month.
- [ ] A missing DA rate, HRA amount, CCA rate or place category is reported and blocks finalisation; no allowance silently becomes 0.
- [ ] All worked examples in §8 give the stated results.

## 14. Out of scope

- Other settlement items: pay scales and fitment, increments, Selection Grade and Special Grade pay, key custodian, hill station, laundry, conveyance and education benefits, loans and advances.
- Arrears from 01.01.2022.
- PF, voluntary PF, income tax, gratuity and leave encashment rules.

## 15. Implementation notes (25-Nov-2026)

| # | Decision | Answer |
|---|---|---|
| D4 | Scope | Masters, engine and a read-only preview. Nothing is saved to pay bills |
| D5 | The spec 01 basis switch | Becomes the **HRA method** (same setting key `payroll.hra_cca.basis`) with a third value `FIXED_AMOUNT`. It decides HRA only; CCA always goes by place |
| D6 | Loss of pay (§10 Q2, Q3) | Full-month amounts only until confirmed; to be added with Preparation |
| D7 | Transfer or promotion in the month (§10 Q4) | HRA, and the CCA amount, minimum and maximum, are split by days and rounded per part. Parts on the same terms are added before rounding |
| D8 | Changing the HRA method while a run is prepared (26-Nov-2026) | Allowed until the run is approved. The prepared run keeps the old HRA until it is prepared again, and Approve refuses it until then. Blocked while a run is approved and not locked |

| Item | As built |
|---|---|
| HRA amounts | `payroll.payroll_hra_amounts` (migration `0006_hra_amounts.sql`), screen Payroll › Masters › HRA Amounts. Whole rupees. **Not seeded**: enter the §5 amounts on the screen |
| Deputy General Manager | Not hard-coded. When both amounts are equal, the place category is not needed |
| CCA | PLACE rows of `payroll_hra_cca_rates`. 0006 enters the §6 rates on rows still exactly as seeded and not yet used in a finalised payroll; anything a user changed is left alone |
| MA | Setting `payroll.medical_allowance.amount`, seeded as 1000 (run `npm run db:seed`). No screen to change it yet |
| DA flags | `is_da_applicable`: PP true, SP false (0006 and seed) |
| Zero rates | A missing rate is an ERROR with a blank amount. A rate of 0 that was entered (or the seeded 0% DA) is paid as 0 with a WARNING |
| Basic Pay source | FIXED `BASIC`, `PP`, `GP` assignments in force on the period end date; `BASIC` falls back to `employees.basic_salary` |
| Preview | Payroll › Processing › Allowance Preview; `GET /api/payroll/periods/:id/allowances` |
| Code | Backend `services/payroll/allowanceRules.ts`, `hraCcaRateResolver.ts`, `hraAmountService.ts`, `allowancePreviewService.ts`; frontend `pages/payroll/HraAmounts.tsx`, `AllowancePreview.tsx` |

**To start using it:** enter the DA rate and the HRA amounts (checked against the original settlement), then choose "Fixed amount by designation and place" in Administration › Rule Settings. If the month is already prepared, prepare it again (D8). `payroll_hra_cca_rates` needs no change for this method: its PLACE rows carry CCA only, and its DESIGNATION rows are not used.

**Done with Payroll Preparation (spec 08):** ERROR issues block approval; the applied rows are stored on the pay line; loss of pay, part-month joiners and leavers, and assignments changed within the month (§10 Q2, Q3, Q6 and Q8 are answered in spec 08 §14). Increments within the month are still to do. PP and GP are entered on Payroll › Masters › Component Assignments; without an assignment they show as 0.
