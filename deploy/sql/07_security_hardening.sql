-- ============================================================================
-- RightDrop  |  deploy/sql/07_security_hardening.sql
-- يسحب الإدراج المباشر في doctor_patients، يحصر تعديل profiles في الاسم والهاتف، ويضيف فحص الجرعة عند الإدراج.
--
-- نفس محتوى الملف supabase/migrations/20261110190000_security_hardening.sql حرفياً،
-- ومضاف عليه فقط: معاملة واحدة (BEGIN/COMMIT) + فحص قبل التطبيق + فحص بعده.
--
-- الاستخدام: Supabase Dashboard > SQL Editor > New query > الصق الملف كاملاً > Run
--
-- الأمان:
--   * لا يحذف ولا يعيد إنشاء أي جدول موجود، ولا يعدّل أو يحذف أي صف موجود.
--   * كل شيء أو لا شيء: أي خطأ يلغي الملف كاملاً ولا يتغيّر شيء في القاعدة.
--   * آمن لإعادة التشغيل: لو كان مطبّقاً من قبل، النتيجة نفسها.
--   * قبل COMMIT يتأكد أن عدد الصفوف ورموز المرضى الحالية لم تتغيّر، وإلا يلغي كل شيء.
--
-- Same statements as the migration file, wrapped in one transaction with a
-- pre-check and a post-check. Safe to run more than once.
-- ============================================================================

BEGIN;

-- ---- pre-check: the base tables must already exist ---------------------------
DO $rightdrop_guard$
BEGIN
  IF to_regclass('public.profiles') IS NULL OR
     to_regclass('public.doctor_patients') IS NULL OR
     to_regclass('public.prescriptions') IS NULL OR
     to_regclass('public.prescription_dose_times') IS NULL OR
     to_regclass('public.dose_records') IS NULL THEN
    RAISE EXCEPTION 'RightDrop file 07: the base tables (migrations 1-5) are missing in this database. Nothing was changed.';
  END IF;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated')) <> 2 THEN
    RAISE EXCEPTION 'RightDrop file 07: roles anon/authenticated are missing. This is not a Supabase database. Nothing was changed.';
  END IF;
END
$rightdrop_guard$;

-- ---- snapshot of the existing data (dropped automatically at COMMIT) ---------
CREATE TEMP TABLE _rightdrop_before ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM public.profiles)                AS profiles,
  (SELECT count(*) FROM public.doctor_patients)         AS doctor_patients,
  (SELECT count(*) FROM public.prescriptions)           AS prescriptions,
  (SELECT count(*) FROM public.prescription_dose_times) AS prescription_dose_times,
  (SELECT count(*) FROM public.dose_records)            AS dose_records,
  (SELECT COALESCE(md5(string_agg(id::text || ':' || COALESCE(patient_code, '') || ':' || role, ',' ORDER BY id)), '')
     FROM public.profiles)                              AS codes_and_roles;

-- ==================== start of the migration, unchanged ======================
/*
# Stage 7: Security hardening (no new features, no data changes)

## Summary
Closes three gaps found while auditing the existing rules. Every existing
RLS policy is left exactly as it was; this migration only narrows table
GRANTs and adds one validation trigger.

## 1. doctor_patients: connections can only be created through the RPC
- Before: the INSERT policy only checked `auth.uid() = doctor_id`, so ANY
  signed-in account (including a patient account) that knew a patient's id
  could insert a connection row directly, skipping both the Patient ID code
  and the "caller must be a doctor" check in `connect_patient_by_code`.
  Once connected it could read that patient's profile and create
  prescriptions that appear in the patient's app.
- Now: INSERT on `doctor_patients` is revoked from client roles. The
  SECURITY DEFINER function `connect_patient_by_code` (unchanged) remains the
  only way to create a connection. SELECT and DELETE are unchanged.

## 2. profiles: users can only edit their name and phone
- Before: the own-row UPDATE policy allowed changing every column, including
  `role`, `patient_code`, `email` and `id`.
- Now: UPDATE is granted on (`full_name`, `phone`) only, which is all the app
  ever sends. Client INSERT is revoked (profiles are created by the
  `handle_new_user` trigger, which is unaffected).

## 3. dose_records: server-side validation on insert
- New BEFORE INSERT trigger `validate_dose_record`:
  - the scheduled date must fall inside the prescription's start/end dates;
  - the scheduled date cannot be in the future (one day of slack so a
    patient whose local date is ahead of UTC is never blocked);
  - `taken` records always get a `taken_at`; a missing or future value is
    replaced by the server time. `missed` records never carry a `taken_at`.
- Dose records stay immutable (still no UPDATE/DELETE policy).

## Not changed
- All tables, columns, indexes, policies and existing functions.
- No existing rows are modified or deleted.
*/

-- ---------------------------------------------------------------------------
-- 1. doctor_patients: RPC-only creation
-- ---------------------------------------------------------------------------
REVOKE INSERT ON public.doctor_patients FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. profiles: column-level update, no client insert
-- ---------------------------------------------------------------------------
REVOKE INSERT, UPDATE ON public.profiles FROM anon, authenticated;
GRANT UPDATE (full_name, phone) ON public.profiles TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. dose_records: validate on insert
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_dose_record()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
  v_start date;
  v_end date;
BEGIN
  -- Runs with the caller's rights, so RLS on prescriptions still applies.
  SELECT start_date, end_date INTO v_start, v_end
  FROM prescriptions
  WHERE id = NEW.prescription_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'prescription_not_found';
  END IF;

  IF NEW.scheduled_date < v_start OR NEW.scheduled_date > v_end THEN
    RAISE EXCEPTION 'dose_outside_prescription_dates';
  END IF;

  IF NEW.scheduled_date > (now() AT TIME ZONE 'utc')::date + 1 THEN
    RAISE EXCEPTION 'dose_in_future';
  END IF;

  IF NEW.status = 'taken' THEN
    IF NEW.taken_at IS NULL OR NEW.taken_at > now() + interval '5 minutes' THEN
      NEW.taken_at := now();
    END IF;
  ELSE
    NEW.taken_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.validate_dose_record() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_dose_record() TO authenticated;

DROP TRIGGER IF EXISTS validate_dose_record_before_insert ON public.dose_records;
CREATE TRIGGER validate_dose_record_before_insert
  BEFORE INSERT ON public.dose_records
  FOR EACH ROW EXECUTE FUNCTION public.validate_dose_record();
-- ===================== end of the migration, unchanged =======================

-- ---- post-check: existing data must be exactly as it was --------------------
DO $rightdrop_verify$
DECLARE
  b record;
BEGIN
  SELECT * INTO b FROM _rightdrop_before;
  IF b.profiles                <> (SELECT count(*) FROM public.profiles)
     OR b.doctor_patients         <> (SELECT count(*) FROM public.doctor_patients)
     OR b.prescriptions           <> (SELECT count(*) FROM public.prescriptions)
     OR b.prescription_dose_times <> (SELECT count(*) FROM public.prescription_dose_times)
     OR b.dose_records            <> (SELECT count(*) FROM public.dose_records)
     OR b.codes_and_roles <> (SELECT COALESCE(md5(string_agg(id::text || ':' || COALESCE(patient_code, '') || ':' || role, ',' ORDER BY id)), '')
                                FROM public.profiles) THEN
    RAISE EXCEPTION 'RightDrop file 07: existing data changed while this file was running (was someone using the app?). Everything was rolled back. Nothing was changed. Run the file again.';
  END IF;
END
$rightdrop_verify$;

COMMIT;

SELECT 'RightDrop file 07 applied. Now run 00_check_status.sql to confirm.' AS result;
