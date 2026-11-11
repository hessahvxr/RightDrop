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
