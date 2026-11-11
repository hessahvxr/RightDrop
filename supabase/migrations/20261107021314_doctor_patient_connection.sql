/*
# Doctor-Patient Connection

## Summary
This migration adds the foundation for a real doctor-patient relationship:
a unique Patient ID for every patient, and a join table that records which
doctor is connected to which patient. It also adds a secure server-side
function that lets a doctor connect to a patient using that Patient ID.

## Changes

### 1. New column on `profiles`
- `patient_code` (text, unique) — a short human-friendly code such as
  "RD-AB12CD". Generated automatically ONLY for patients (not doctors).
  Displayed on the patient's profile so they can share it with their doctor.

### 2. New table `doctor_patients`
- `id` (uuid, primary key)
- `doctor_id` (uuid, references profiles.id, the doctor)
- `patient_id` (uuid, references profiles.id, the patient)
- `created_at` (timestamptz)
- Unique constraint on (doctor_id, patient_id) prevents duplicate connections.

### 3. Trigger `set_patient_code_on_create`
- Fires AFTER INSERT on `profiles`. If the new row is a patient and has no
  patient_code yet, generate one in the form RD-XXXXXX (6 random alphanumeric
  chars) and update the row. Retries on rare uniqueness collisions.

### 4. SECURITY DEFINER function `connect_patient_by_code`
- Callable only by authenticated doctors. Takes a patient_code, looks up the
  matching patient profile, and inserts a row into doctor_patients linking
  the calling doctor to that patient. Returns the patient's basic info
  (id, full_name, email, phone, patient_code) on success.
- Guards: caller must be a doctor; code must exist; no duplicate connection.
- REVOKE EXECUTE from PUBLIC/anon so only authenticated users can call it.

### 5. Security (RLS + grants)
- `profiles`: the existing own-row select policy is replaced with one that
  allows a user to read their own profile OR a doctor to read a profile of a
  patient they are connected to (via EXISTS check on doctor_patients).
  Grant SELECT on profiles to authenticated (RLS still gates rows).
- `doctor_patients`: RLS enabled. Grants: SELECT/INSERT/DELETE to authenticated.
  - SELECT: a doctor can see connections where they are the doctor; a patient
    can see connections where they are the patient.
  - INSERT: only the doctor in the new row can create it.
  - DELETE: only the doctor can remove a connection.

## Important notes
1. Patient codes are generated server-side in the trigger, so they cannot be
   faked or chosen by the client.
2. The connect function is SECURITY DEFINER so it can read any profile to look
   up the code — but it only returns the connected patient's basic, non-sensitive
   fields (name, email, phone, code). It never returns passwords or auth data.
3. Doctors can only see the profiles of patients they are connected to.
*/

-- ---------------------------------------------------------------------------
-- 1. Add patient_code column to profiles
-- ---------------------------------------------------------------------------
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS patient_code text UNIQUE;

-- Backfill codes for existing patients that don't have one yet.
DO $$
DECLARE
  r RECORD;
  new_code TEXT;
  attempts INT;
BEGIN
  FOR r IN SELECT id FROM profiles WHERE role = 'patient' AND patient_code IS NULL LOOP
    attempts := 0;
    LOOP
      new_code := 'RD-' || upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6));
      BEGIN
        UPDATE profiles SET patient_code = new_code WHERE id = r.id AND patient_code IS NULL;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        attempts := attempts + 1;
        IF attempts > 5 THEN EXIT; END IF;
      END;
    END LOOP;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Create doctor_patients relationship table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doctor_patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (doctor_id, patient_id)
);

ALTER TABLE doctor_patients ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, DELETE ON doctor_patients TO authenticated;

-- SELECT: doctor sees their connections; patient sees who is connected to them.
DROP POLICY IF EXISTS "select_doctor_patients" ON doctor_patients;
CREATE POLICY "select_doctor_patients"
  ON doctor_patients FOR SELECT TO authenticated
  USING (auth.uid() = doctor_id OR auth.uid() = patient_id);

-- INSERT: only the doctor in the new row can create the connection.
DROP POLICY IF EXISTS "insert_doctor_patients" ON doctor_patients;
CREATE POLICY "insert_doctor_patients"
  ON doctor_patients FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = doctor_id);

-- DELETE: only the doctor can remove a connection.
DROP POLICY IF EXISTS "delete_doctor_patients" ON doctor_patients;
CREATE POLICY "delete_doctor_patients"
  ON doctor_patients FOR DELETE TO authenticated
  USING (auth.uid() = doctor_id);

-- ---------------------------------------------------------------------------
-- 3. Trigger to auto-generate patient_code for new patients
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_patient_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_code TEXT;
  attempts INT := 0;
BEGIN
  IF NEW.role = 'patient' AND NEW.patient_code IS NULL THEN
    LOOP
      new_code := 'RD-' || upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6));
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

DROP TRIGGER IF EXISTS set_patient_code_on_create ON profiles;
CREATE TRIGGER set_patient_code_on_create
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.generate_patient_code();

-- ---------------------------------------------------------------------------
-- 4. SECURITY DEFINER function: doctor connects a patient by code
-- ---------------------------------------------------------------------------
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
SET search_path = public
AS $$
DECLARE
  caller_role text;
  v_patient_id uuid;
  v_full_name text;
  v_email text;
  v_phone text;
  v_patient_code text;
BEGIN
  -- Determine the caller's role from app metadata (trustworthy).
  caller_role := auth.jwt() -> 'app_metadata' ->> 'role';
  IF caller_role IS NULL THEN
    SELECT role INTO caller_role FROM profiles WHERE id = auth.uid();
  END IF;
  IF caller_role IS NULL OR caller_role <> 'doctor' THEN
    RAISE EXCEPTION 'only_doctors';
  END IF;

  -- Look up the patient by code.
  SELECT id, full_name, email, phone, patient_code
    INTO v_patient_id, v_full_name, v_email, v_phone, v_patient_code
  FROM profiles
  WHERE patient_code = upper(trim(p_code)) AND role = 'patient';

  IF v_patient_id IS NULL THEN
    RAISE EXCEPTION 'patient_not_found';
  END IF;

  -- Insert the connection (unique constraint prevents duplicates).
  BEGIN
    INSERT INTO doctor_patients (doctor_id, patient_id)
      VALUES (auth.uid(), v_patient_id);
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
-- 5. Let doctors read connected patients' profiles (patients keep own-only)
-- ---------------------------------------------------------------------------
GRANT SELECT ON profiles TO authenticated;

DROP POLICY IF EXISTS "select_own_profile" ON profiles;
DROP POLICY IF EXISTS "select_connected_patients" ON profiles;

CREATE POLICY "select_own_or_connected"
  ON profiles FOR SELECT TO authenticated
  USING (
    auth.uid() = id
    OR EXISTS (
      SELECT 1 FROM doctor_patients dp
      WHERE dp.doctor_id = auth.uid() AND dp.patient_id = profiles.id
    )
  );
