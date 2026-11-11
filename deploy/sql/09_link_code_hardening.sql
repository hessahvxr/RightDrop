-- ============================================================================
-- RightDrop  |  deploy/sql/09_link_code_hardening.sql
-- رموز طويلة للمرضى الجدد فقط، وحد للمحاولات الخاطئة في ربط الطبيب بالمريض. الرموز الحالية لا تتغيّر.
--
-- نفس محتوى الملف supabase/migrations/20261111010000_link_code_hardening.sql حرفياً،
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
    RAISE EXCEPTION 'RightDrop file 09: the base tables (migrations 1-5) are missing in this database. Nothing was changed.';
  END IF;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated')) <> 2 THEN
    RAISE EXCEPTION 'RightDrop file 09: roles anon/authenticated are missing. This is not a Supabase database. Nothing was changed.';
  END IF;
  IF to_regprocedure('extensions.gen_random_bytes(integer)') IS NULL THEN
    RAISE EXCEPTION 'RightDrop file 09: % is missing in this database. Nothing was changed.', 'extensions.gen_random_bytes(integer)';
  END IF;
  IF to_regprocedure('public.connect_patient_by_code(text)') IS NULL THEN
    RAISE EXCEPTION 'RightDrop file 09: % is missing in this database. Nothing was changed.', 'public.connect_patient_by_code(text)';
  END IF;
  IF to_regprocedure('public.generate_patient_code()') IS NULL THEN
    RAISE EXCEPTION 'RightDrop file 09: % is missing in this database. Nothing was changed.', 'public.generate_patient_code()';
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
# Patient link code: longer codes and a server-side attempt limit

## Summary
Keeps sign-up and linking exactly as simple as they are today (a doctor
registers, enters the patient's code, and is connected), and closes the
code-guessing hole without adding any step, screen, approval or admin role.

No table, column or policy that exists today is changed. Existing accounts,
existing patient codes and existing doctor-patient connections are left
exactly as they are; the new rules apply to what is created from now on.

## 1. New patient codes are long and unguessable (new patients only)
- Before: `RD-` + 6 hex characters = about 16.7 million possibilities.
- Now, for patients who register after this migration: `RD-XXXX-XXXX-XXXX`,
  12 characters from a 32-character alphabet (no 0, 1, I or O) drawn from the
  database's cryptographic random source: 2^60 possibilities.
- Patients who already have a code keep it. Short legacy codes still work,
  and are protected only by the attempt limit below.

## 2. Attempt limit, enforced in the database
- New table `link_code_attempts` (doctor_id, attempted_at): one row per WRONG
  code. RLS enabled with no policies and no grants: clients cannot read or
  write it.
- `connect_patient_by_code` (same name, same parameters, same result columns):
  - refuses with `too_many_attempts` once the calling doctor has entered
    10 wrong codes in the last hour or 30 in the last 24 hours. While
    locked, even a correct code is refused;
  - a wrong code now returns an EMPTY result instead of raising
    `patient_not_found`. (An exception would undo the attempt record, so
    the limit could never count.) No patient data is returned for a wrong code;
  - codes are compared ignoring case, spaces and dashes;
  - calls by the same doctor are serialized, so parallel requests cannot
    get past the limit.
- Everything else is unchanged: caller must have the doctor role, a correct
  code creates the connection and returns the patient's basic details, a
  second connection to the same patient is refused with `already_connected`.

## 3. Grants repeated from the Stage 7 security migration
The same statements as in 20261110190000_security_hardening.sql, repeated so
that this migration is safe on its own: connections can only be created
through `connect_patient_by_code`, and a user can only edit their own name
and phone (not their role or patient code). Repeating them is harmless.

## Not included, by decision of the project owner (hackathon demo)
- No verification of doctors: anyone may register as a doctor.
- No patient approval step: giving the code to a doctor is the patient's consent.
*/

-- ---------------------------------------------------------------------------
-- 1. New patient codes: RD-XXXX-XXXX-XXXX (60 random bits)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_patient_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  alphabet CONSTANT text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; -- 32 symbols, no 0 1 I O
  raw bytea;
  new_code text;
  attempts int := 0;
BEGIN
  IF NEW.role = 'patient' AND NEW.patient_code IS NULL THEN
    LOOP
      raw := extensions.gen_random_bytes(12);
      new_code := 'RD';
      FOR i IN 0..11 LOOP
        IF i % 4 = 0 THEN new_code := new_code || '-'; END IF;
        -- 256 is a multiple of 32, so every symbol is equally likely.
        new_code := new_code || substr(alphabet, (get_byte(raw, i) & 31) + 1, 1);
      END LOOP;
      BEGIN
        UPDATE profiles SET patient_code = new_code WHERE id = NEW.id AND patient_code IS NULL;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        attempts := attempts + 1;
        IF attempts > 5 THEN EXIT; END IF;
      END;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_patient_code() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_patient_code() TO authenticated;

-- Existing patients keep their existing code: no backfill, no UPDATE here.

-- ---------------------------------------------------------------------------
-- 2. Attempt limit
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS link_code_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doctor_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_link_code_attempts_doctor ON link_code_attempts(doctor_id, attempted_at DESC);

ALTER TABLE link_code_attempts ENABLE ROW LEVEL SECURITY;
-- No policies and no grants: only connect_patient_by_code touches this table.
REVOKE ALL ON link_code_attempts FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.connect_patient_by_code(p_code TEXT)
RETURNS TABLE (
  out_id uuid,
  out_full_name text,
  out_email text,
  out_phone text,
  out_patient_code text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  caller_role text;
  v_key text;
  v_hour int;
  v_day int;
  v_patient_id uuid;
  v_full_name text;
  v_email text;
  v_phone text;
  v_patient_code text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Determine the caller's role from app metadata (trustworthy).
  caller_role := auth.jwt() -> 'app_metadata' ->> 'role';
  IF caller_role IS NULL THEN
    SELECT role INTO caller_role FROM profiles WHERE id = v_uid;
  END IF;
  IF caller_role IS NULL OR caller_role <> 'doctor' THEN
    RAISE EXCEPTION 'only_doctors';
  END IF;

  -- One attempt at a time per doctor, so parallel calls cannot slip past the limit.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  SELECT count(*) FILTER (WHERE attempted_at > now() - interval '1 hour'), count(*)
    INTO v_hour, v_day
  FROM link_code_attempts
  WHERE doctor_id = v_uid AND attempted_at > now() - interval '24 hours';

  IF v_hour >= 10 OR v_day >= 30 THEN
    RAISE EXCEPTION 'too_many_attempts';
  END IF;

  -- Compare ignoring case, spaces and dashes.
  v_key := regexp_replace(upper(COALESCE(p_code, '')), '[^A-Z0-9]', '', 'g');

  IF length(v_key) >= 8 THEN
    SELECT id, full_name, email, phone, patient_code
      INTO v_patient_id, v_full_name, v_email, v_phone, v_patient_code
    FROM profiles
    WHERE role = 'patient'
      AND patient_code IS NOT NULL
      AND regexp_replace(upper(patient_code), '[^A-Z0-9]', '', 'g') = v_key;
  END IF;

  IF v_patient_id IS NULL THEN
    -- Wrong code: record it and return nothing. (Returning instead of raising
    -- keeps the record; an exception would roll it back.)
    INSERT INTO link_code_attempts (doctor_id) VALUES (v_uid);
    DELETE FROM link_code_attempts WHERE doctor_id = v_uid AND attempted_at < now() - interval '7 days';
    RETURN;
  END IF;

  -- Insert the connection (unique constraint prevents duplicates).
  BEGIN
    INSERT INTO doctor_patients (doctor_id, patient_id)
      VALUES (v_uid, v_patient_id);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'already_connected';
  END;

  RETURN QUERY
    SELECT v_patient_id, v_full_name, v_email, v_phone, v_patient_code;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.connect_patient_by_code(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.connect_patient_by_code(TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Grants repeated from the Stage 7 security migration (harmless if already applied)
-- ---------------------------------------------------------------------------
REVOKE INSERT ON public.doctor_patients FROM anon, authenticated;

REVOKE INSERT, UPDATE ON public.profiles FROM anon, authenticated;
GRANT UPDATE (full_name, phone) ON public.profiles TO authenticated;
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
    RAISE EXCEPTION 'RightDrop file 09: existing data changed while this file was running (was someone using the app?). Everything was rolled back. Nothing was changed. Run the file again.';
  END IF;
END
$rightdrop_verify$;

COMMIT;

SELECT 'RightDrop file 09 applied. Now run 00_check_status.sql to confirm.' AS result;
