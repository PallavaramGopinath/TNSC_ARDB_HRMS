-- =============================================================================
-- 0002 — Remove the Party (KYC) Master (ARDB decision D12)
-- KYC fields move onto hr.employees; the employee code is generated per employee.
-- Safe on the baseline because no employees exist yet; refuses to run otherwise.
-- =============================================================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM hr.employees) THEN
        RAISE EXCEPTION '0002 expects an empty hr.employees table (found rows); migrate KYC data manually first';
    END IF;
END $$;

ALTER TABLE hr.employees
    DROP CONSTRAINT uq_employees_party,
    DROP COLUMN party_id,
    ADD COLUMN employee_name        varchar(200) NOT NULL,
    ADD COLUMN employee_name_tamil  varchar(200),
    ADD COLUMN gender               varchar(1) CHECK (gender IN ('M','F','O')),
    ADD COLUMN mobile               varchar(15),
    ADD COLUMN email                varchar(100),
    ADD COLUMN address              text,
    ADD COLUMN city                 varchar(100),
    ADD COLUMN district             varchar(100),
    ADD COLUMN state                varchar(100) DEFAULT 'Tamil Nadu',
    ADD COLUMN pincode              varchar(10),
    ADD COLUMN pan_number           varchar(10) CHECK (pan_number IS NULL OR pan_number ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
    ADD COLUMN aadhar_number        varchar(12) CHECK (aadhar_number IS NULL OR aadhar_number ~ '^[0-9]{12}$'),
    ADD COLUMN bank_master_id       integer REFERENCES hr.bank_masters(id),
    ADD COLUMN bank_branch          varchar(100),
    ADD COLUMN account_number       varchar(20),
    ADD COLUMN ifsc_code            varchar(11) CHECK (ifsc_code IS NULL OR ifsc_code ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
    ADD CONSTRAINT ck_employees_ifsc_needs_bank CHECK (ifsc_code IS NULL OR bank_master_id IS NOT NULL);

DROP INDEX hr.ux_employees_code;
ALTER TABLE hr.employees
    ALTER COLUMN employee_code SET NOT NULL,
    ADD CONSTRAINT uq_employees_code UNIQUE (employee_code);

CREATE INDEX ix_employees_name ON hr.employees (lower(employee_name));
CREATE INDEX ix_employees_bank ON hr.employees (bank_master_id);

DROP TABLE hr.party_masters;

-- Menu: the Party (KYC) Masters screen is gone.
DELETE FROM core.menu_forms WHERE id = 12010104;
