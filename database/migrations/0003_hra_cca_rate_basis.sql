-- =============================================================================
-- 0003 — HRA & CCA rates: configurable calculation basis (specs/01-hra-cca-rates-calculation-basis.md)
--
-- A rate row is keyed either by place category (PLACE basis, TNCU parity) or by designation
-- (DESIGNATION basis, TNSC ARDB). The active basis is the effective-dated app setting
-- `payroll.hra_cca.basis` (seed.sql); rows of the other basis are kept for history.
-- Existing rows become PLACE rows through the column default.
-- =============================================================================

-- Trusted extension (PG13+): the database owner can create it.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE payroll.payroll_hra_cca_rates
    ADD COLUMN rate_basis      varchar(20) NOT NULL DEFAULT 'PLACE',
    ADD COLUMN designation_id  integer REFERENCES hr.employee_designations(id),
    ADD COLUMN remarks         varchar(500),
    ALTER COLUMN place_id DROP NOT NULL;

ALTER TABLE payroll.payroll_hra_cca_rates
    ADD CONSTRAINT ck_hra_cca_rate_basis CHECK (rate_basis IN ('PLACE', 'DESIGNATION')),
    ADD CONSTRAINT ck_hra_cca_key_matches_basis CHECK (
            (rate_basis = 'PLACE'       AND place_id IS NOT NULL AND designation_id IS NULL)
         OR (rate_basis = 'DESIGNATION' AND designation_id IS NOT NULL AND place_id IS NULL)),
    ADD CONSTRAINT ck_hra_cca_range CHECK (effective_to IS NULL OR effective_to >= effective_from),
    ADD CONSTRAINT ck_hra_cca_percent CHECK (
            hra_percentage BETWEEN 0 AND 100 AND cca_percentage BETWEEN 0 AND 100),
    -- maximum 0 = no cap (TNCU)
    ADD CONSTRAINT ck_hra_cca_amounts CHECK (
            hra_minimum_amount >= 0 AND hra_maximum_amount >= 0
        AND cca_minimum_amount >= 0 AND cca_maximum_amount >= 0
        AND (hra_maximum_amount = 0 OR hra_maximum_amount >= hra_minimum_amount)
        AND (cca_maximum_amount = 0 OR cca_maximum_amount >= cca_minimum_amount)),
    -- No two active rows for the same key may overlap in time (the service checks first for a friendly message)
    ADD CONSTRAINT ex_hra_cca_place_overlap EXCLUDE USING gist (
            place_id WITH =, daterange(effective_from, effective_to, '[]') WITH &&)
        WHERE (is_active AND rate_basis = 'PLACE'),
    ADD CONSTRAINT ex_hra_cca_designation_overlap EXCLUDE USING gist (
            designation_id WITH =, daterange(effective_from, effective_to, '[]') WITH &&)
        WHERE (is_active AND rate_basis = 'DESIGNATION');

CREATE INDEX ix_hra_cca_designation_from
    ON payroll.payroll_hra_cca_rates (designation_id, effective_from DESC)
    WHERE rate_basis = 'DESIGNATION';
CREATE INDEX ix_hra_cca_basis ON payroll.payroll_hra_cca_rates (rate_basis);
