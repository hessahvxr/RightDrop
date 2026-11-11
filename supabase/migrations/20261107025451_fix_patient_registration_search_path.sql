/*
# Fix patient registration: gen_random_bytes not found in trigger search_path

## Root cause
The `generate_patient_code()` trigger function was declared with
`SET search_path = public`. The `gen_random_bytes()` function from the
`pgcrypto` extension lives in the `extensions` schema, which was NOT in the
search_path. When a patient signed up, the trigger fired, tried to call
`gen_random_bytes()`, could not resolve it, and threw:
  "function gen_random_bytes(integer) does not exist"
This error aborted the AFTER INSERT trigger, which rolled back the entire
transaction — including the `auth.users` INSERT — so the patient account
was never created. Doctor registration worked because the trigger returns
early for non-patients before reaching the `gen_random_bytes` call.

## Fix
1. Recreate `generate_patient_code()` with `SET search_path = public, extensions`
   so `gen_random_bytes` resolves. Also schema-qualify the call as
   `extensions.gen_random_bytes` for extra safety.
2. Recreate `handle_new_user()` with `SET search_path = public, extensions`
   for consistency (it does not call extension functions today, but this
   prevents future regressions).

## No security changes
- RLS policies are untouched.
- SECURITY DEFINER is preserved on both functions (they must run as the
  postgres owner to insert into auth.users / bypass RLS on profiles).
- EXECUTE grants are preserved (authenticated only).
- No tables, columns, or data are modified or deleted.
*/

-- ---------------------------------------------------------------------------
-- 1. Fix generate_patient_code: include extensions in search_path
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_patient_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  new_code TEXT;
  attempts INT := 0;
BEGIN
  IF NEW.role = 'patient' AND NEW.patient_code IS NULL THEN
    LOOP
      new_code := 'RD-' || upper(substr(encode(extensions.gen_random_bytes(4), 'hex'), 1, 6));
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

-- Trigger itself does not need to be recreated — the function is replaced
-- in place and the existing trigger will use the new body.

-- ---------------------------------------------------------------------------
-- 2. Fix handle_new_user: include extensions in search_path for consistency
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_role text;
BEGIN
  v_role := COALESCE(
    NULLIF(new.raw_user_meta_data->>'role', ''),
    'patient'
  );

  -- Promote role into user-immutable app metadata
  UPDATE auth.users
    SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', v_role)
    WHERE id = new.id;

  -- Create the profile row
  INSERT INTO public.profiles (id, email, full_name, role, phone)
  VALUES (
    new.id,
    new.email,
    COALESCE(NULLIF(new.raw_user_meta_data->>'full_name', ''), ''),
    v_role,
    COALESCE(NULLIF(new.raw_user_meta_data->>'phone', ''), NULL)
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN new;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Backfill patient_code for any existing patients that are missing one
--    (e.g. if a patient was created before this fix via some other path)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  new_code TEXT;
  attempts INT;
BEGIN
  FOR r IN SELECT id FROM public.profiles WHERE role = 'patient' AND patient_code IS NULL LOOP
    attempts := 0;
    LOOP
      new_code := 'RD-' || upper(substr(encode(extensions.gen_random_bytes(4), 'hex'), 1, 6));
      BEGIN
        UPDATE public.profiles SET patient_code = new_code WHERE id = r.id AND patient_code IS NULL;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        attempts := attempts + 1;
        IF attempts > 5 THEN EXIT; END IF;
      END;
    END LOOP;
  END LOOP;
END $$;
