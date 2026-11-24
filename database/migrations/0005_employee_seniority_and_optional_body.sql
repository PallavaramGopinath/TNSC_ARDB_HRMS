-- =============================================================================
-- 0005 — Optional height / weight, employee seniority
--        (specs/04-height-weight-remove-mandatory-add-seniority.md)
--
-- seniority_order ranks an employee within the designation: 1 is the most senior, as on
-- hr.employee_designations. Two employees may share a number. NULL = not ranked (prints last).
-- Existing rows keep their height and weight; seniority is not back-filled.
-- =============================================================================

ALTER TABLE hr.employees
    ALTER COLUMN height DROP NOT NULL,
    ALTER COLUMN weight DROP NOT NULL,
    ADD COLUMN seniority_order integer CHECK (seniority_order BETWEEN 1 AND 999);
