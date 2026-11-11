-- ============================================================================
-- RightDrop  |  deploy/sql/08_patient_assistant.sql
-- ينشئ patient_reports و assistant_usage ودالتي my_doctors و assistant_register_request (يحتاجها المساعد الذكي).
--
-- نفس محتوى الملف supabase/migrations/20261110230000_patient_assistant.sql حرفياً،
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
    RAISE EXCEPTION 'RightDrop file 08: the base tables (migrations 1-5) are missing in this database. Nothing was changed.';
  END IF;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated')) <> 2 THEN
    RAISE EXCEPTION 'RightDrop file 08: roles anon/authenticated are missing. This is not a Supabase database. Nothing was changed.';
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
# Stage 8: AI patient assistant (supporting tables only)

## Summary
The assistant itself runs in the `patient-assistant` edge function and stores
NO conversations: chat text is never written to the database. This migration
adds only what the feature cannot work without:

1. `patient_reports`: a short summary of a problem that a patient has
   explicitly chosen to send to one of their connected doctors.
2. `my_doctors()`: lets a patient see the id and name (nothing else) of the
   doctors connected to them, so they can choose who receives a summary.
3. `assistant_usage` + `assistant_register_request()`: a per-patient request
   counter used for rate limiting. It stores counts only, never message text.

No existing table, column, policy or function is changed.

## 1. New table `patient_reports`
- `id` (uuid, primary key)
- `patient_id` (uuid, FK -> profiles.id): the patient who sent it
- `doctor_id` (uuid, FK -> profiles.id): the doctor it was sent to
- `summary` (text, 1 to 2000 characters): the text the patient reviewed and approved
- `created_at` (timestamptz)

### Security
- RLS enabled. Grants: SELECT, INSERT, DELETE to `authenticated` only.
- INSERT: only the patient, as themselves, and only to a doctor who is
  currently connected to them. Nothing else can create a report: the edge
  function has no write access to this table, so a summary can reach a doctor
  only through the patient's own approved action.
- SELECT: the patient sees their own reports. A doctor sees reports addressed
  to them, while still connected to that patient. Other doctors and other
  patients see nothing.
- DELETE: only the patient (withdraws the summary; the doctor no longer sees it).
- No UPDATE policy: a sent summary cannot be edited by anyone.
- A patient can send at most 5 summaries in any 24 hours (trigger).

## 2. Function `my_doctors()`
- SECURITY DEFINER, callable by `authenticated` only.
- Returns `doctor_id`, `full_name` for doctors connected to the caller.
  It never returns a doctor's email or phone, and returns nothing for
  doctors the caller is not connected to.

## 3. Rate limiting: `assistant_usage` and `assistant_register_request()`
- `assistant_usage` (patient_id, hour_bucket, request_count). RLS enabled
  with NO policies and no grants: clients cannot read or write it directly.
- `assistant_register_request()`: SECURITY DEFINER. Counts one request for
  the caller and returns true, or returns false (without counting) when the
  caller has already made 20 requests this hour or 60 in the last 24 hours.
  Rows older than 48 hours are removed.
*/

-- ---------------------------------------------------------------------------
-- 1. patient_reports
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patient_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  summary text NOT NULL CHECK (char_length(btrim(summary)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patient_reports_doctor_id ON patient_reports(doctor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_patient_reports_patient_id ON patient_reports(patient_id, created_at DESC);

ALTER TABLE patient_reports ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON patient_reports FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON patient_reports TO authenticated;

DROP POLICY IF EXISTS "select_patient_reports" ON patient_reports;
CREATE POLICY "select_patient_reports"
  ON patient_reports FOR SELECT TO authenticated
  USING (
    auth.uid() = patient_id
    OR (
      auth.uid() = doctor_id
      AND EXISTS (
        SELECT 1 FROM doctor_patients dp
        WHERE dp.doctor_id = auth.uid() AND dp.patient_id = patient_reports.patient_id
      )
    )
  );

DROP POLICY IF EXISTS "insert_patient_reports" ON patient_reports;
CREATE POLICY "insert_patient_reports"
  ON patient_reports FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = patient_id
    AND EXISTS (
      SELECT 1 FROM doctor_patients dp
      WHERE dp.patient_id = auth.uid() AND dp.doctor_id = patient_reports.doctor_id
    )
  );

DROP POLICY IF EXISTS "delete_patient_reports" ON patient_reports;
CREATE POLICY "delete_patient_reports"
  ON patient_reports FOR DELETE TO authenticated
  USING (auth.uid() = patient_id);

-- No UPDATE policy: sent summaries are immutable.

-- At most 5 summaries per patient in any 24 hours.
CREATE OR REPLACE FUNCTION public.limit_patient_reports()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  IF (
    SELECT count(*) FROM patient_reports
    WHERE patient_id = NEW.patient_id AND created_at > now() - interval '24 hours'
  ) >= 5 THEN
    RAISE EXCEPTION 'report_limit_reached';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.limit_patient_reports() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.limit_patient_reports() TO authenticated;

DROP TRIGGER IF EXISTS limit_patient_reports_before_insert ON patient_reports;
CREATE TRIGGER limit_patient_reports_before_insert
  BEFORE INSERT ON patient_reports
  FOR EACH ROW EXECUTE FUNCTION public.limit_patient_reports();

-- ---------------------------------------------------------------------------
-- 2. my_doctors(): id + name of the caller's connected doctors
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_doctors()
RETURNS TABLE (doctor_id uuid, full_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT p.id, p.full_name
  FROM doctor_patients dp
  JOIN profiles p ON p.id = dp.doctor_id
  WHERE dp.patient_id = auth.uid()
  ORDER BY dp.created_at;
$$;

REVOKE EXECUTE ON FUNCTION public.my_doctors() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_doctors() TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Rate limiting for the assistant (counts only, no content)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assistant_usage (
  patient_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  hour_bucket timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (patient_id, hour_bucket)
);

ALTER TABLE assistant_usage ENABLE ROW LEVEL SECURITY;
-- No policies and no grants: only the function below touches this table.
REVOKE ALL ON assistant_usage FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.assistant_register_request()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_bucket timestamptz := date_trunc('hour', now());
  v_hour integer;
  v_day integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  DELETE FROM assistant_usage
  WHERE patient_id = v_uid AND hour_bucket < now() - interval '48 hours';

  SELECT COALESCE(sum(request_count) FILTER (WHERE hour_bucket = v_bucket), 0),
         COALESCE(sum(request_count), 0)
    INTO v_hour, v_day
  FROM assistant_usage
  WHERE patient_id = v_uid AND hour_bucket > now() - interval '24 hours';

  IF v_hour >= 20 OR v_day >= 60 THEN
    RETURN false;
  END IF;

  INSERT INTO assistant_usage (patient_id, hour_bucket, request_count)
  VALUES (v_uid, v_bucket, 1)
  ON CONFLICT (patient_id, hour_bucket)
  DO UPDATE SET request_count = assistant_usage.request_count + 1;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assistant_register_request() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assistant_register_request() TO authenticated;
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
    RAISE EXCEPTION 'RightDrop file 08: existing data changed while this file was running (was someone using the app?). Everything was rolled back. Nothing was changed. Run the file again.';
  END IF;
END
$rightdrop_verify$;

COMMIT;

SELECT 'RightDrop file 08 applied. Now run 00_check_status.sql to confirm.' AS result;
