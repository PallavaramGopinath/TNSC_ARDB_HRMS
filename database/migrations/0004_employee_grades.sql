-- =============================================================================
-- 0004 — Grades master (specs/03-grade-master.md)
--
-- hr.employee_designations.grade stays free text holding a grade code (no foreign key), so existing
-- values and the GAMS import keep working. Codes are compared trimmed and case-insensitively.
--
-- Existing designation grades are copied in as active grades, one per normalised code, keeping the
-- most used spelling. Designations are not changed. Review what will be copied before running:
--
--   SELECT lower(btrim(grade)) AS code, array_agg(DISTINCT grade) AS spellings, count(*) AS designations
--   FROM hr.employee_designations WHERE btrim(grade) <> '' GROUP BY 1 ORDER BY 1;
-- =============================================================================

CREATE TABLE hr.employee_grades (
    id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    grade_code     varchar(50) NOT NULL CHECK (btrim(grade_code) <> ''),
    description    varchar(150),
    display_order  integer CHECK (display_order BETWEEN 1 AND 999),
    is_active      boolean NOT NULL DEFAULT true,
    created_by     text NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_by     text,
    updated_at     timestamptz
);
CREATE UNIQUE INDEX ux_employee_grades_code ON hr.employee_grades (lower(btrim(grade_code)));

CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON hr.employee_grades
    FOR EACH ROW EXECUTE FUNCTION audit.log_row_change();

DO $$
DECLARE v_copied integer;
BEGIN
    INSERT INTO hr.employee_grades (grade_code, created_by)
    SELECT DISTINCT ON (lower(code)) code, 'migration-0004'
    FROM (
        SELECT btrim(grade) AS code, count(*) AS uses
        FROM hr.employee_designations
        WHERE btrim(grade) <> ''
        GROUP BY btrim(grade)
    ) s
    ORDER BY lower(code), uses DESC, code;
    GET DIAGNOSTICS v_copied = ROW_COUNT;
    RAISE NOTICE '0004: copied % grade(s) from designations', v_copied;
END $$;
