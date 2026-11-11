/*
# Stage 5: Medication Reminders and Dose Tracking

## Summary
Adds two new tables:
1. `prescription_dose_times` — stores the exact administration times a doctor
   sets for a prescription (e.g. 08:00, 14:00, 20:00 for a 3x/day prescription).
   The number of rows must match the prescription's frequency_per_day.
2. `dose_records` — tracks each individual dose event: whether it was taken or
   missed, the scheduled date+time, and the actual time the patient confirmed.

No existing tables or policies are modified.

## Security (RLS)
- `prescription_dose_times`:
  - SELECT: the prescribing doctor or the patient can read.
  - INSERT/UPDATE/DELETE: only the prescribing doctor (gated by the same
    doctor_patients connection check as prescriptions).
- `dose_records`:
  - SELECT: the patient who owns the dose, or the prescribing doctor.
  - INSERT: only the patient can create a dose record for themselves.
  - UPDATE/DELETE: no policies (records are immutable once created; the
    patient can only mark a dose once).
*/

-- ---------------------------------------------------------------------------
-- 1. prescription_dose_times
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prescription_dose_times (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id uuid NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  dose_time time NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dose_times_prescription_id ON prescription_dose_times(prescription_id);

ALTER TABLE prescription_dose_times ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON prescription_dose_times TO authenticated;

-- SELECT: doctor or patient of the parent prescription.
DROP POLICY IF EXISTS "select_dose_times" ON prescription_dose_times;
CREATE POLICY "select_dose_times"
  ON prescription_dose_times FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM prescriptions p
      WHERE p.id = prescription_dose_times.prescription_id
        AND (p.doctor_id = auth.uid() OR p.patient_id = auth.uid())
    )
  );

-- INSERT: only the prescribing doctor, and patient must be connected.
DROP POLICY IF EXISTS "insert_dose_times" ON prescription_dose_times;
CREATE POLICY "insert_dose_times"
  ON prescription_dose_times FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM prescriptions p
      WHERE p.id = prescription_dose_times.prescription_id
        AND p.doctor_id = auth.uid()
        AND EXISTS (
          SELECT 1 FROM doctor_patients dp
          WHERE dp.doctor_id = auth.uid() AND dp.patient_id = p.patient_id
        )
    )
  );

-- UPDATE: only the prescribing doctor.
DROP POLICY IF EXISTS "update_dose_times" ON prescription_dose_times;
CREATE POLICY "update_dose_times"
  ON prescription_dose_times FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM prescriptions p
      WHERE p.id = prescription_dose_times.prescription_id AND p.doctor_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM prescriptions p
      WHERE p.id = prescription_dose_times.prescription_id
        AND p.doctor_id = auth.uid()
        AND EXISTS (
          SELECT 1 FROM doctor_patients dp
          WHERE dp.doctor_id = auth.uid() AND dp.patient_id = p.patient_id
        )
    )
  );

-- DELETE: only the prescribing doctor.
DROP POLICY IF EXISTS "delete_dose_times" ON prescription_dose_times;
CREATE POLICY "delete_dose_times"
  ON prescription_dose_times FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM prescriptions p
      WHERE p.id = prescription_dose_times.prescription_id AND p.doctor_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 2. dose_records
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dose_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id uuid NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  dose_time time NOT NULL,
  scheduled_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('taken', 'missed')),
  taken_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Prevent duplicate confirmations for the same dose (same prescription, same date, same time).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_dose_record_per_dose
  ON dose_records (prescription_id, scheduled_date, dose_time);

CREATE INDEX IF NOT EXISTS idx_dose_records_patient_id ON dose_records(patient_id);
CREATE INDEX IF NOT EXISTS idx_dose_records_prescription_id ON dose_records(prescription_id);
CREATE INDEX IF NOT EXISTS idx_dose_records_scheduled_date ON dose_records(scheduled_date);

ALTER TABLE dose_records ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON dose_records TO authenticated;

-- SELECT: the patient who owns it, or the prescribing doctor.
DROP POLICY IF EXISTS "select_dose_records" ON dose_records;
CREATE POLICY "select_dose_records"
  ON dose_records FOR SELECT TO authenticated
  USING (
    auth.uid() = patient_id
    OR EXISTS (
      SELECT 1 FROM prescriptions p
      WHERE p.id = dose_records.prescription_id AND p.doctor_id = auth.uid()
    )
  );

-- INSERT: only the patient, and only for their own prescriptions.
DROP POLICY IF EXISTS "insert_dose_records" ON dose_records;
CREATE POLICY "insert_dose_records"
  ON dose_records FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = patient_id
    AND EXISTS (
      SELECT 1 FROM prescriptions p
      WHERE p.id = dose_records.prescription_id AND p.patient_id = auth.uid()
    )
  );

-- No UPDATE or DELETE policies: dose records are immutable once created.
