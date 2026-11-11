/*
# Prescription Management

## Summary
Creates the `prescriptions` table for eye-drop medications, linked to both
the prescribing doctor and the patient. Enforces row-level security so:
- Doctors can INSERT/UPDATE/DELETE only prescriptions they created, and only
  for patients they are connected to (via the existing doctor_patients table).
- Patients can SELECT only their own prescriptions (read-only — no INSERT,
  UPDATE, or DELETE grants or policies for patients).
- A doctor's UPDATE/DELETE is further gated by a WITH CHECK that re-validates
  the connection, so disconnecting a patient later revokes write access.

## New table: `prescriptions`
- `id` (uuid, primary key)
- `doctor_id` (uuid, FK → profiles.id, the prescribing doctor)
- `patient_id` (uuid, FK → profiles.id, the patient receiving the prescription)
- `medication_name` (text, required — name of the eye drop / medication)
- `concentration` (text, optional — e.g. "0.5%")
- `dosage` (text, required — e.g. "قطرة واحدة")
- `frequency_per_day` (integer, required — number of times per day)
- `eye` (text, required — 'right', 'left', or 'both'; CHECK constraint)
- `start_date` (date, required)
- `end_date` (date, required)
- `instructions` (text, optional — additional instructions)
- `status` (text, required — 'active', 'discontinued'; default 'active'.
   NOTE: 'completed' is a derived status computed on the client from end_date,
   not stored — a prescription whose end_date has passed and status is 'active'
   is displayed as 'completed'.)
- `created_at`, `updated_at` (timestamptz)

## Security (RLS + grants)
- RLS enabled on `prescriptions`.
- Grants: SELECT to authenticated (needed for both doctors and patients).
  INSERT, UPDATE, DELETE to authenticated (gated by policies to doctors only).
- SELECT policy: a doctor can see prescriptions they created; a patient can
  see prescriptions where they are the patient.
- INSERT policy: only the doctor (auth.uid() = doctor_id) AND the patient must
  be connected to that doctor (EXISTS check on doctor_patients).
- UPDATE policy: only the prescribing doctor (auth.uid() = doctor_id) AND the
  patient must still be connected (WITH CHECK re-validates the connection).
- DELETE policy: only the prescribing doctor (auth.uid() = doctor_id).
- No patient write policies exist — patients have no INSERT/UPDATE/DELETE path.

## No changes to existing tables or policies
- profiles, doctor_patients, and all their RLS policies are untouched.
- No existing data is modified or deleted.
*/

-- ---------------------------------------------------------------------------
-- 1. Create prescriptions table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prescriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  medication_name text NOT NULL,
  concentration text,
  dosage text NOT NULL,
  frequency_per_day integer NOT NULL CHECK (frequency_per_day >= 1 AND frequency_per_day <= 24),
  eye text NOT NULL CHECK (eye IN ('right', 'left', 'both')),
  start_date date NOT NULL,
  end_date date NOT NULL,
  instructions text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'discontinued')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_prescriptions_doctor_id ON prescriptions(doctor_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_patient_id ON prescriptions(patient_id);

-- updated_at auto-maintenance
CREATE OR REPLACE FUNCTION public.update_prescription_timestamp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_prescription_timestamp() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_prescription_timestamp() TO authenticated;

DROP TRIGGER IF EXISTS set_prescription_updated_at ON prescriptions;
CREATE TRIGGER set_prescription_updated_at
  BEFORE UPDATE ON prescriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_prescription_timestamp();

-- ---------------------------------------------------------------------------
-- 2. Enable RLS + grants
-- ---------------------------------------------------------------------------
ALTER TABLE prescriptions ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON prescriptions TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. RLS policies
-- ---------------------------------------------------------------------------

-- SELECT: doctor sees their created prescriptions; patient sees their own.
DROP POLICY IF EXISTS "select_prescriptions" ON prescriptions;
CREATE POLICY "select_prescriptions"
  ON prescriptions FOR SELECT TO authenticated
  USING (
    auth.uid() = doctor_id
    OR auth.uid() = patient_id
  );

-- INSERT: only the doctor, and only for a patient they are connected to.
DROP POLICY IF EXISTS "insert_prescriptions" ON prescriptions;
CREATE POLICY "insert_prescriptions"
  ON prescriptions FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = doctor_id
    AND EXISTS (
      SELECT 1 FROM doctor_patients dp
      WHERE dp.doctor_id = auth.uid() AND dp.patient_id = prescriptions.patient_id
    )
  );

-- UPDATE: only the prescribing doctor, and patient must still be connected.
DROP POLICY IF EXISTS "update_prescriptions" ON prescriptions;
CREATE POLICY "update_prescriptions"
  ON prescriptions FOR UPDATE TO authenticated
  USING (auth.uid() = doctor_id)
  WITH CHECK (
    auth.uid() = doctor_id
    AND EXISTS (
      SELECT 1 FROM doctor_patients dp
      WHERE dp.doctor_id = auth.uid() AND dp.patient_id = prescriptions.patient_id
    )
  );

-- DELETE: only the prescribing doctor.
DROP POLICY IF EXISTS "delete_prescriptions" ON prescriptions;
CREATE POLICY "delete_prescriptions"
  ON prescriptions FOR DELETE TO authenticated
  USING (auth.uid() = doctor_id);
