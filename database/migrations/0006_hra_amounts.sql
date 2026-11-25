-- =============================================================================
-- 0006 — Fixed HRA amounts, CCA rates, DA flags
--        (specs/06-allowance-calculation-da-hra-cca-ma.md)
--
-- HRA under the FIXED_AMOUNT method is a monthly amount per designation: one for the Greater Chennai
-- Corporation place category (code GCC), one for every other category. Amounts are entered on the HRA
-- Amounts screen: designations are user data, so nothing is copied in here.
-- =============================================================================

CREATE TABLE payroll.payroll_hra_amounts (
    id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    designation_id  integer NOT NULL REFERENCES hr.employee_designations(id),
    gcc_amount      numeric(14,2) NOT NULL CHECK (gcc_amount >= 0),
    other_amount    numeric(14,2) NOT NULL CHECK (other_amount >= 0),
    effective_from  date NOT NULL,
    effective_to    date,
    remarks         varchar(500),
    is_active       boolean NOT NULL DEFAULT true,
    created_by      text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_by      text,
    updated_at      timestamptz,
    CONSTRAINT ck_hra_amounts_range CHECK (effective_to IS NULL OR effective_to >= effective_from),
    -- No two active rows for a designation may overlap in time (the service checks first for a friendly message)
    CONSTRAINT ex_hra_amounts_overlap EXCLUDE USING gist (
            designation_id WITH =, daterange(effective_from, effective_to, '[]') WITH &&)
        WHERE (is_active)
);
CREATE INDEX ix_hra_amounts_designation_from ON payroll.payroll_hra_amounts (designation_id, effective_from DESC);

CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON payroll.payroll_hra_amounts
    FOR EACH ROW EXECUTE FUNCTION audit.log_row_change();

-- Basic Pay for DA is BASIC + PP + GP (spec 06 §3): Personal Pay counts, Special Pay does not.
UPDATE payroll.payroll_components SET is_da_applicable = true  WHERE upper(component_code) = 'PP' AND NOT is_da_applicable;
UPDATE payroll.payroll_components SET is_da_applicable = false WHERE upper(component_code) = 'SP' AND is_da_applicable;

-- CCA (spec 06 §6): only rows still exactly as seeded; anything a user entered or changed is left alone.
UPDATE payroll.payroll_hra_cca_rates r
SET cca_percentage     = CASE WHEN p.code = 'GCC' THEN 5    ELSE 3    END,
    cca_minimum_amount = CASE WHEN p.code = 'GCC' THEN 1000 ELSE 800  END,
    cca_maximum_amount = CASE WHEN p.code = 'GCC' THEN 1500 ELSE 1000 END,
    remarks    = 'Settlement dated 28.08.2024, clause 8',
    updated_by = 'migration-0006',
    updated_at = now()
FROM core.place_categories p
WHERE p.id = r.place_id AND p.code IN ('GCC', 'OC', 'ODHQ', 'OP')
  AND r.rate_basis = 'PLACE' AND r.is_active AND r.created_by = 'seed' AND r.updated_by IS NULL AND r.effective_to IS NULL
  AND r.hra_percentage = 0 AND r.hra_minimum_amount = 0 AND r.hra_maximum_amount = 0
  AND r.cca_percentage = 0 AND r.cca_minimum_amount = 0 AND r.cca_maximum_amount = 0
  -- never change what a finalised payroll was paid on
  AND NOT EXISTS (
      SELECT 1 FROM payroll.payroll_periods pp
      WHERE pp.is_active AND pp.payroll_status IN ('APPROVED', 'LOCKED') AND pp.to_date >= r.effective_from);
