-- RightDrop: حالة الـ Migrations التسعة على قاعدتك (قراءة فقط)
-- READ-ONLY. This file contains one SELECT. It changes nothing.
--
-- الاستخدام: Supabase Dashboard > SQL Editor > New query > الصق الملف كاملاً > Run
-- النتيجة: صف ملخّص لكل Migration (applied / NOT applied / PARTIAL)، ثم تفاصيل كل بند.
-- شغّله قبل تطبيق أي شيء، ثم مرة ثانية بعد كل ملف تطبّقه.

WITH checks (migration, item, ok) AS (
  VALUES
  -- 1: profiles + sign-up trigger -------------------------------------------
  (1, 'table profiles', to_regclass('public.profiles') IS NOT NULL),
  (1, 'function handle_new_user()', to_regprocedure('public.handle_new_user()') IS NOT NULL),
  (1, 'trigger on_auth_user_created on auth.users',
      EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'on_auth_user_created' AND NOT t.tgisinternal
              AND t.tgrelid = to_regclass('auth.users'))),
  -- 2: doctor-patient connection ---------------------------------------------
  (2, 'table doctor_patients', to_regclass('public.doctor_patients') IS NOT NULL),
  (2, 'column profiles.patient_code',
      EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.profiles')
              AND a.attname = 'patient_code' AND NOT a.attisdropped)),
  (2, 'function connect_patient_by_code(text)', to_regprocedure('public.connect_patient_by_code(text)') IS NOT NULL),
  (2, 'trigger set_patient_code_on_create on profiles',
      EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'set_patient_code_on_create' AND NOT t.tgisinternal
              AND t.tgrelid = to_regclass('public.profiles'))),
  -- 3: search_path fix --------------------------------------------------------
  (3, 'handle_new_user() has a fixed search_path',
      EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.handle_new_user()')
              AND p.proconfig IS NOT NULL AND array_to_string(p.proconfig, ',') LIKE '%search_path%')),
  -- 4: prescriptions ----------------------------------------------------------
  (4, 'table prescriptions', to_regclass('public.prescriptions') IS NOT NULL),
  (4, 'trigger set_prescription_updated_at',
      EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'set_prescription_updated_at' AND NOT t.tgisinternal
              AND t.tgrelid = to_regclass('public.prescriptions'))),
  -- 5: dose tracking ----------------------------------------------------------
  (5, 'table prescription_dose_times', to_regclass('public.prescription_dose_times') IS NOT NULL),
  (5, 'table dose_records', to_regclass('public.dose_records') IS NOT NULL),
  (5, 'unique index uniq_dose_record_per_dose', to_regclass('public.uniq_dose_record_per_dose') IS NOT NULL),
  -- 6: storage for bottle photos ---------------------------------------------
  (6, 'private storage bucket medication-scans',
      EXISTS (SELECT 1 FROM storage.buckets b WHERE b.id = 'medication-scans' AND b.public IS NOT TRUE)),
  (6, '3 storage policies (select/insert/delete own scans)',
      (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
        AND policyname IN ('select_own_scans', 'insert_own_scans', 'delete_own_scans')) = 3),
  -- 7: security hardening -----------------------------------------------------
  (7, 'function validate_dose_record()', to_regprocedure('public.validate_dose_record()') IS NOT NULL),
  (7, 'trigger validate_dose_record_before_insert on dose_records',
      EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'validate_dose_record_before_insert' AND NOT t.tgisinternal
              AND t.tgrelid = to_regclass('public.dose_records'))),
  (7, 'signed-in users can NOT insert into doctor_patients directly',
      has_table_privilege('authenticated', to_regclass('public.doctor_patients'), 'INSERT') IS FALSE),
  (7, 'signed-in users can update ONLY full_name and phone in profiles (not role, not patient_code)',
      has_table_privilege('authenticated', to_regclass('public.profiles'), 'UPDATE') IS FALSE
      AND (SELECT count(*) FROM pg_attribute a WHERE a.attrelid = to_regclass('public.profiles')
            AND a.attname IN ('full_name', 'phone') AND NOT a.attisdropped
            AND has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE')) = 2
      AND NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.profiles')
            AND a.attname IN ('role', 'patient_code', 'email', 'id') AND NOT a.attisdropped
            AND has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE'))),
  -- 8: patient assistant ------------------------------------------------------
  (8, 'table patient_reports', to_regclass('public.patient_reports') IS NOT NULL),
  (8, 'table assistant_usage', to_regclass('public.assistant_usage') IS NOT NULL),
  (8, 'RLS enabled on patient_reports and assistant_usage',
      (SELECT count(*) FROM pg_class c WHERE c.oid IN (to_regclass('public.patient_reports'), to_regclass('public.assistant_usage'))
        AND c.relrowsecurity) = 2),
  (8, '3 policies on patient_reports',
      (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'patient_reports'
        AND policyname IN ('select_patient_reports', 'insert_patient_reports', 'delete_patient_reports')) = 3),
  (8, 'function my_doctors()', to_regprocedure('public.my_doctors()') IS NOT NULL),
  (8, 'function assistant_register_request()', to_regprocedure('public.assistant_register_request()') IS NOT NULL),
  (8, 'trigger limit_patient_reports_before_insert',
      EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'limit_patient_reports_before_insert' AND NOT t.tgisinternal
              AND t.tgrelid = to_regclass('public.patient_reports'))),
  -- 9: link code hardening ----------------------------------------------------
  (9, 'table link_code_attempts', to_regclass('public.link_code_attempts') IS NOT NULL),
  (9, 'RLS enabled on link_code_attempts',
      EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = to_regclass('public.link_code_attempts') AND c.relrowsecurity)),
  (9, 'connect_patient_by_code has the attempt limit',
      EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.connect_patient_by_code(text)')
              AND p.prosrc LIKE '%too_many_attempts%')),
  (9, 'generate_patient_code makes long codes',
      EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.generate_patient_code()')
              AND p.prosrc LIKE '%23456789ABCDEFGHJKLMNPQRSTUVWXYZ%')),
  -- 0: things the files 07-09 need before they can be applied -----------------
  (0, 'needed by file 09: extensions.gen_random_bytes() is available',
      to_regprocedure('extensions.gen_random_bytes(integer)') IS NOT NULL),
  (0, 'roles anon and authenticated exist',
      (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated')) = 2),
  (0, 'RLS is enabled on every table in schema public',
      NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
                  AND c.relkind = 'r' AND NOT c.relrowsecurity))
),
names (migration, file_name) AS (
  VALUES
  (0, 'prerequisites / المتطلبات'),
  (1, '20261107011355_create_profiles_with_role'),
  (2, '20261107021314_doctor_patient_connection'),
  (3, '20261107025451_fix_patient_registration_search_path'),
  (4, '20261109005429_create_prescriptions'),
  (5, '20261109010151_create_dose_tracking'),
  (6, '20261110144831_create_medication_scan_storage'),
  (7, '20261110190000_security_hardening  -> deploy/sql/07_security_hardening.sql'),
  (8, '20261110230000_patient_assistant   -> deploy/sql/08_patient_assistant.sql'),
  (9, '20261111010000_link_code_hardening -> deploy/sql/09_link_code_hardening.sql')
),
summary AS (
  SELECT migration, count(*) AS total, count(*) FILTER (WHERE ok) AS passed
  FROM checks GROUP BY migration
)
SELECT section, migration, what, status
FROM (
  SELECT 1 AS part, s.migration AS sort_key, 0 AS item_no,
         'SUMMARY' AS section,
         s.migration,
         n.file_name AS what,
         CASE
           WHEN s.passed = s.total AND s.migration = 0 THEN 'OK'
           WHEN s.migration = 0 THEN 'CHECK THE DETAILS BELOW (' || s.passed || '/' || s.total || ')'
           WHEN s.passed = s.total THEN 'applied / مطبّق'
           WHEN s.passed = 0 THEN 'NOT applied / غير مطبّق'
           ELSE 'PARTIAL / مطبّق جزئياً (' || s.passed || ' of ' || s.total || ')'
         END AS status
  FROM summary s JOIN names n USING (migration)
  UNION ALL
  SELECT 2, c.migration, 0,
         'detail', c.migration, c.item,
         CASE WHEN c.ok THEN 'yes' ELSE 'NO' END
  FROM checks c
) report
ORDER BY part, sort_key, item_no, what;
