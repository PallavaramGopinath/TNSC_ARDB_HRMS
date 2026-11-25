-- =============================================================================
-- 0007 — Payroll Preparation (specs/08-payroll-preparation.md)
-- =============================================================================

-- working_days stays the calendar days of the period; loss of pay = service_days − payable_days.
ALTER TABLE payroll.payrolls
    ADD COLUMN service_days numeric(8,2),
    ADD COLUMN issues       jsonb NOT NULL DEFAULT '[]';   -- [{code, severity, message}] found at Prepare

-- Rates and rate rows a line was paid on (spec 06 §12.4), so that a past bill stays explainable.
ALTER TABLE payroll.payroll_details ADD COLUMN applied jsonb;

-- The last time a run was sent back: Reject (PROCESSED → OPEN) or a reversed approval (APPROVED → PROCESSED).
ALTER TABLE payroll.payroll_periods
    ADD COLUMN returned_by   text,
    ADD COLUMN returned_at   timestamptz,
    ADD COLUMN return_reason varchar(500);
