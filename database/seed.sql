-- =============================================================================
-- TNSC ARDB — baseline seed. Run after schema.sql. Safe to re-run (upserts).
-- =============================================================================
SET app.user_name = 'seed';

-- -----------------------------------------------------------------------------
-- Place categories (ARDB D8: editable defaults, more may be added in Admin)
-- -----------------------------------------------------------------------------
INSERT INTO core.place_categories (id, code, name, description, display_order, created_by) OVERRIDING SYSTEM VALUE VALUES
  (1, 'GCC',  'Greater Chennai Corporation', 'Greater Chennai Corporation limits', 1, 'seed'),
  (2, 'OC',   'Other Corporation',           'Other municipal corporations',      2, 'seed'),
  (3, 'ODHQ', 'Other District Headquarters', 'District headquarters towns',       3, 'seed'),
  (4, 'OP',   'Other Places',                'All other places',                  4, 'seed')
ON CONFLICT (code) DO NOTHING;
SELECT setval(pg_get_serial_sequence('core.place_categories','id'), (SELECT max(id) FROM core.place_categories));

-- -----------------------------------------------------------------------------
-- Head Office + current financial year
-- -----------------------------------------------------------------------------
INSERT INTO core.branches (code, name, type, district, place_id, created_by)
VALUES ('HO', 'Head Office', 'HO', 'Chennai', 1, 'seed')
ON CONFLICT (code) DO NOTHING;

INSERT INTO core.financial_years (year_code, short_code, start_date, end_date, is_current, created_by)
VALUES ('2026-2027', '26-27', DATE '2026-04-01', DATE '2027-03-31', true, 'seed')
ON CONFLICT (year_code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Rule settings (ARDB D9) — values ported from TNCU hard-coded constants
-- -----------------------------------------------------------------------------
INSERT INTO core.app_settings (module, key, value, description, created_by) VALUES
  ('core',    'core.timezone',                     '"Asia/Kolkata"',  'Business date timezone (no day cycle)', 'seed'),
  ('core',    'core.organisation',                 '{"name":"Tamil Nadu Co-operative State Agriculture and Rural Development Bank Ltd.","short":"TNSC ARDB","address":"Chennai"}', 'Letterhead', 'seed'),
  ('hr',      'hr.employee_code_prefix',           '"EMP"',           'Employee code prefix; number zero-padded (see hr.employee_code_pad)', 'seed'),
  ('hr',      'hr.employee_code_pad',              '3',               'Zero-padding width of the employee number', 'seed'),
  ('hr',      'hr.min_age_at_joining',             '18',              'Minimum age on date of joining', 'seed'),
  ('hr',      'hr.increment.cycle_months',         '[1,4,7,10]',      'Quarterly increment cycle months', 'seed'),
  ('hr',      'hr.increment.percent',              '3',               'Regular increment % of present basic', 'seed'),
  ('hr',      'hr.increment.round_up_to',          '10',              'Increment rounded up to next multiple (paise dropped first)', 'seed'),
  ('hr',      'hr.increment.default_sanctioned_by','"Managing Director"', 'Default sanctioning authority', 'seed'),
  ('hr',      'hr.leave.rule_version',             '"TNLR-1933/v1"',  'Leave credit rule version', 'seed'),
  ('hr',      'hr.leave.el.max_accumulation',      '240',             'EL accumulation cap', 'seed'),
  ('hr',      'hr.leave.el.suspense_threshold',    '225',             'EL above this goes to suspense', 'seed'),
  ('hr',      'hr.leave.el.advance_days',          '15',              'Half-yearly advance EL for permanent 5+ yrs', 'seed'),
  ('hr',      'hr.leave.el.advance_min_years',     '5',               'Years of service for advance EL', 'seed'),
  ('hr',      'hr.leave.el.days_per_two_months',   '2.5',             'EL earned per 2 completed months (others)', 'seed'),
  ('hr',      'hr.leave.el.lop_divisor',           '{"permanent":10,"permanent_cap":15,"others":20,"others_cap":8}', 'EL reduction for LOP days', 'seed'),
  ('hr',      'hr.leave.el.credit_dates',          '["01-01","07-01"]', 'EL credit dates (MM-DD)', 'seed'),
  ('hr',      'hr.leave.cl.annual_days',           '12',              'CL reset on 1 January', 'seed'),
  ('hr',      'hr.leave.ml.slabs',                 '[{"over_years":3,"days":60,"inclusive":false},{"over_years":5,"days":90,"inclusive":true},{"over_years":9,"days":180,"inclusive":true},{"over_years":12,"days":270,"inclusive":true},{"over_years":15,"days":360,"inclusive":true},{"over_years":20,"days":540,"inclusive":false}]', 'ML entitlement by service', 'seed'),
  ('hr',      'hr.suspension_review_days',         '90',              'Highlight suspensions not reviewed within N days', 'seed'),
  ('payroll', 'payroll.default_pf_percent',        '12',              'Default PF % (no wage ceiling; employer = employee)', 'seed'),
  ('payroll', 'payroll.pf_wage_ceiling',           '0',               '0 = no ceiling (TNCU parity)', 'seed'),
  ('payroll', 'payroll.employer_pf_equals_employee','true',           'Employer PF line mirrors employee PF', 'seed'),
  ('payroll', 'payroll.min_net_percent_of_gross',  '25',              'Net-pay floor % of (gross − employer PF)', 'seed'),
  ('payroll', 'payroll.gratuity.ceiling',          '2000000',         'Gratuity ceiling (0 = uncapped)', 'seed'),
  ('payroll', 'payroll.gratuity.min_years',        '5',               'Qualifying service (waived for DEATH/MEDICAL)', 'seed'),
  ('payroll', 'payroll.encashment.max_days',       '240',             'Retirement leave encashment cap', 'seed'),
  ('payroll', 'payroll.sls.allowed_days',          '[15,30]',         'Surrender leave salary day options', 'seed'),
  ('payroll', 'payroll.neft.sender_name',          '"TNSC ARDB"',     'NEFT file sender name', 'seed'),
  ('payroll', 'payroll.hra_cca.basis',             '"PLACE"',         'HRA/CCA rate looked up by PLACE (branch place category) or DESIGNATION; change via Rule Settings', 'seed')
ON CONFLICT (key, effective_from) DO NOTHING;

-- -----------------------------------------------------------------------------
-- HR leave types (TNCU HrSeeder)
-- -----------------------------------------------------------------------------
INSERT INTO hr.employee_leave_types (leave_name, leave_code, annual_quota, carry_forward, encashment_allowed, pay_cut_factor, cuts_special_pay_and_da, affects_leave_balance)
SELECT * FROM (VALUES
  ('Casual Leave',  'CL',  12::numeric, false, false, 0::numeric,   false, true),
  ('Earned Leave',  'EL',  30,          true,  true,  0,            false, true),
  ('Medical Leave', 'ML',  15,          false, false, 0.5,          false, true),
  ('Loss of Pay',   'LOP', 0,           false, false, 1,            true,  false)
) v(leave_name, leave_code, annual_quota, carry_forward, encashment_allowed, pay_cut_factor, cuts_sp, affects)
WHERE NOT EXISTS (SELECT 1 FROM hr.employee_leave_types t WHERE t.leave_code = v.leave_code);

-- -----------------------------------------------------------------------------
-- Payroll components (TNCU PayrollComponentCodes; EPF/SUNDRY/LOAN dropped — D7, D10)
-- -----------------------------------------------------------------------------
INSERT INTO payroll.payroll_components (component_name, component_code, component_type, is_da_applicable, is_surrender_leave_applicable, display_order, created_by)
SELECT v.* , 'seed' FROM (VALUES
  ('Basic Pay',                    'BASIC',       1::smallint, true,  true,  10),
  ('Personal Pay',                 'PP',          1, false, true,  20),
  ('Grade Pay',                    'GP',          1, true,  true,  30),
  ('Special Pay',                  'SP',          1, true,  true,  40),
  ('Dearness Allowance',           'DA',          1, false, true,  50),
  ('House Rent Allowance',         'HRA',         1, false, true,  60),
  ('City Compensatory Allowance',  'CCA',         1, false, true,  70),
  ('Medical Allowance',            'MA',          1, false, false, 80),
  ('Employer PF Contribution',     'EMPLOYER_PF', 1, false, false, 90),
  ('Bonus',                        'BONUS',       1, false, false, 100),
  ('Ex-Gratia',                    'EX_GRATIA',   1, false, false, 110),
  ('Surrender Leave Salary',       'SLS',         1, false, false, 120),
  ('Gratuity',                     'GRATUITY',    1, false, false, 130),
  ('Provident Fund',               'PF',          2, false, false, 200),
  ('Additional (Voluntary) PF',    'ADL PF',      2, false, false, 210),
  ('Income Tax',                   'IT',          2, false, false, 220)
) v(n, c, t, da, sls, o)
WHERE NOT EXISTS (SELECT 1 FROM payroll.payroll_components p WHERE upper(p.component_code) = upper(v.c));

-- -----------------------------------------------------------------------------
-- Rates (TNCU HrSeeder: DA 0%, PF 12%, HRA/CCA 0% per place, from FY start)
-- -----------------------------------------------------------------------------
INSERT INTO payroll.payroll_da_rates (effective_from, da_percentage, created_by)
SELECT DATE '2026-04-01', 0, 'seed' WHERE NOT EXISTS (SELECT 1 FROM payroll.payroll_da_rates);

INSERT INTO payroll.payroll_pf_deduction_rates (effective_from, pf_deduction_percentage, created_by)
SELECT DATE '2026-04-01', 12, 'seed' WHERE NOT EXISTS (SELECT 1 FROM payroll.payroll_pf_deduction_rates);

INSERT INTO payroll.payroll_hra_cca_rates (place_id, effective_from, created_by)
SELECT p.id, DATE '2026-04-01', 'seed' FROM core.place_categories p
WHERE NOT EXISTS (SELECT 1 FROM payroll.payroll_hra_cca_rates r WHERE r.place_id = p.id);

INSERT INTO payroll.payroll_settings (financial_year_id, effective_from, created_by)
SELECT fy.id, fy.start_date, 'seed' FROM core.financial_years fy
WHERE fy.is_current AND NOT EXISTS (SELECT 1 FROM payroll.payroll_settings s WHERE s.financial_year_id = fy.id);

-- -----------------------------------------------------------------------------
-- Menu tree (declarative; upsert)
-- main ids: module ids. sub ids: <main-prefix><nn>. form ids: <sub id><nn>.
-- -----------------------------------------------------------------------------
INSERT INTO core.menu_mains (id, module_key, title, icon, branch_code, required_role, display_order, is_active) VALUES
  (10000000, 'home',    'Home',          'home',      'ALL', NULL,             0,  true),
  (11000000, 'admin',   'Administration','settings',  'ALL', 'Admin',          90, true),
  (12000010, 'hr',      'HR',            'users',     'HO',  'Admin,HR',       10, true),
  (12000020, 'payroll', 'Payroll',       'wallet',    'HO',  'Admin,Payroll',  20, true),
  (12000040, 'epf',     'EPF Trust',     'piggy-bank','HO',  'Admin,EPF',      30, false),  -- reserved
  (13000000, 'self',    'Self Service',  'user',      'ALL', 'Employee',       80, true)
ON CONFLICT (id) DO UPDATE SET module_key = EXCLUDED.module_key, title = EXCLUDED.title, icon = EXCLUDED.icon,
  branch_code = EXCLUDED.branch_code, required_role = EXCLUDED.required_role, display_order = EXCLUDED.display_order;

-- Branches moved from Administration to HR › Masters (form 12010104).
DELETE FROM core.menu_subs WHERE id = 110002;

INSERT INTO core.menu_subs (id, main_id, title, route, icon, branch_code, display_order) VALUES
  -- Home
  (100001, 10000000, 'Dashboard',            '/',                       'layout-dashboard', 'ALL', 1),
  -- Admin
  (110001, 11000000, 'Users & Access',       '/admin/users',            'shield',   'ALL', 1),
  (110003, 11000000, 'Place Categories',     '/admin/place-categories', 'map-pin',  'ALL', 3),
  (110004, 11000000, 'Financial Years',      '/admin/financial-years',  'calendar', 'ALL', 4),
  (110005, 11000000, 'Rule Settings',        '/admin/settings',         'sliders',  'ALL', 5),
  -- HR groups
  (120101, 12000010, 'Masters',              NULL, 'database',  'HO', 1),
  (120102, 12000010, 'Employees',            NULL, 'id-card',   'HO', 2),
  (120103, 12000010, 'Leave & Attendance',   NULL, 'calendar-check', 'HO', 3),
  (120104, 12000010, 'Service Events',       NULL, 'trending-up', 'HO', 4),
  (120105, 12000010, 'Disciplinary',         NULL, 'gavel',     'HO', 5),
  (120106, 12000010, 'Reports',              '/hr/reports', 'file-text', 'HO', 6),
  -- Payroll groups
  (120201, 12000020, 'Payroll Processing',   NULL, 'play-circle', 'HO', 1),
  (120202, 12000020, 'Payroll Masters',      NULL, 'database',  'HO', 2),
  (120203, 12000020, 'Arrears & Encashment', NULL, 'coins',     'HO', 3),
  (120204, 12000020, 'Reports',              NULL, 'file-text', 'HO', 4),
  -- EPF (reserved)
  (120401, 12000040, 'EPF Ledger',           '/epf',          'book', 'HO', 1),
  -- Self service
  (130001, 13000000, 'My Payslips',          '/my/payslips',  'receipt', 'ALL', 1)
ON CONFLICT (id) DO UPDATE SET main_id = EXCLUDED.main_id, title = EXCLUDED.title, route = EXCLUDED.route,
  icon = EXCLUDED.icon, branch_code = EXCLUDED.branch_code, display_order = EXCLUDED.display_order;

INSERT INTO core.menu_forms (id, sub_id, title, route, branch_code, display_order) VALUES
  -- HR › Masters
  (12010101, 120101, 'Designations',        '/hr/designations',            'HO', 1),
  (12010102, 120101, 'Bank Masters',        '/hr/bank-masters',            'HO', 2),
  (12010103, 120101, 'Leave Types',         '/hr/leave-types',             'HO', 3),
  (12010104, 120101, 'Branches',            '/hr/branches',                'HO', 4),
  -- HR › Employees
  (12010201, 120102, 'Employees',           '/hr/employees',               'HO', 1),
  (12010202, 120102, 'Service History',     '/hr/service-history',         'HO', 2),
  -- HR › Leave & Attendance
  (12010301, 120103, 'Attendance',          '/hr/attendance',              'HO', 1),
  (12010302, 120103, 'Leave Applications',  '/hr/leave-applications',      'HO', 2),
  (12010303, 120103, 'Leave Balances',      '/hr/leave-balances',          'HO', 3),
  (12010304, 120103, 'Opening Balances',    '/hr/leave-balances/onboarding','HO', 4),
  (12010305, 120103, 'Leave Credit Runs',   '/hr/leave-credit-runs',       'HO', 5),
  -- HR › Service Events
  (12010401, 120104, 'Increments',          '/hr/increments',              'HO', 1),
  (12010402, 120104, 'Transfers',           '/hr/transfers',               'HO', 2),
  (12010403, 120104, 'Promotions',          '/hr/promotions',              'HO', 3),
  (12010404, 120104, 'Promotion Panels',    '/hr/promotion-panels',        'HO', 4),
  (12010405, 120104, 'Retirements',         '/hr/retirements',             'HO', 5),
  -- HR › Disciplinary
  (12010501, 120105, 'Disciplinary Cases',  '/hr/disciplinary-cases',      'HO', 1),
  (12010502, 120105, 'Case Stages',         '/hr/disciplinary-case-stages','HO', 2),
  (12010503, 120105, 'Suspensions',         '/hr/suspensions',             'HO', 3),
  (12010504, 120105, 'Penalty Orders',      '/hr/penalty-orders',          'HO', 4),
  -- Payroll › Processing
  (12020101, 120201, 'Payroll Periods',     '/payroll/periods',            'HO', 1),
  (12020102, 120201, 'Payroll Preparation', '/payroll/preparation',        'HO', 2),
  (12020103, 120201, 'Withheld Bills',      '/payroll/withheld',           'HO', 3),
  (12020104, 120201, 'Mark Paid / NEFT',    '/payroll/payments',           'HO', 4),
  -- Payroll › Masters
  (12020201, 120202, 'Components',          '/payroll/components',         'HO', 1),
  (12020202, 120202, 'Component Assignments','/payroll/components/assignments','HO', 2),
  (12020203, 120202, 'DA Rates',            '/payroll/rates/da',           'HO', 3),
  (12020204, 120202, 'PF Rates',            '/payroll/rates/pf',           'HO', 4),
  (12020205, 120202, 'HRA / CCA Rates',     '/payroll/rates/hra-cca',      'HO', 5),
  (12020206, 120202, 'Payroll Settings',    '/payroll/settings',           'HO', 6),
  -- Payroll › Arrears & Encashment
  (12020301, 120203, 'DA Arrears',          '/payroll/da-arrears',         'HO', 1),
  (12020302, 120203, 'Surrender Leave Salary','/payroll/surrender-leave-salary','HO', 2),
  (12020303, 120203, 'Retirement Leave Encashment','/payroll/retirement-leave-encashment','HO', 3),
  -- Payroll › Reports
  (12020401, 120204, 'Payroll Reports',     '/payroll/reports',            'HO', 1),
  (12020402, 120204, 'Payslips',            '/payroll/payslips',           'HO', 2)
ON CONFLICT (id) DO UPDATE SET sub_id = EXCLUDED.sub_id, title = EXCLUDED.title, route = EXCLUDED.route,
  branch_code = EXCLUDED.branch_code, display_order = EXCLUDED.display_order;

-- -----------------------------------------------------------------------------
-- Bootstrap administrator. Password must be changed on first login.
-- Username: admin   Initial password: ChangeMe@2026   (see README)
-- bcrypt via pgcrypto ($2a$) — verified by bcryptjs in the API.
-- -----------------------------------------------------------------------------
INSERT INTO auth.users (username, email, full_name, password_hash, is_admin, branch_id, can_view_all_branches, must_change_password, created_by)
SELECT 'admin', NULL, 'System Administrator', crypt('ChangeMe@2026', gen_salt('bf', 10)), true,
       (SELECT id FROM core.branches WHERE code = 'HO'), true, true, 'seed'
WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE lower(username) = 'admin');
