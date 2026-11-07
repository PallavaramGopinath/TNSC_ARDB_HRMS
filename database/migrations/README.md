# Migrations

`../schema.sql` is the **baseline** (version `0001_baseline`). Every later change goes in a new file
here, never into `schema.sql` after it has been applied anywhere:

    0002_<short_description>.sql
    0003_<short_description>.sql

Rules
- Forward-only and transactional. `npm run db:migrate` runs each file inside one transaction and
  records it in `core.schema_migrations`.
- A new module (e.g. EPF Trust) adds its tables in the `epf` schema in its own migration, and attaches
  the audit trigger: `CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON epf.<t>
  FOR EACH ROW EXECUTE FUNCTION audit.log_row_change();`
- Menu changes go in `../seed.sql` (it upserts) so the tree stays declarative.
