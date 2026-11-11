/*
# Create profiles table with user role

1. New Tables
- `profiles`
  - `id` (uuid, primary key, matches auth.users.id)
  - `email` (text, the user's auth email)
  - `full_name` (text, display name)
  - `role` (text, either 'doctor' or 'patient' — stored in user-immutable app metadata)
  - `phone` (text, optional contact phone)
  - `created_at` (timestamptz)

2. Security
- Enable RLS on `profiles`.
- Grant SELECT, INSERT, UPDATE to `authenticated` only (app requires sign-in).
- Each user can SELECT, INSERT, and UPDATE only their own profile row (auth.uid() = id).
- No DELETE policy: profiles are tied to auth accounts and should not be removed from the client.

3. Role storage note
- The role is stored in `raw_app_meta_data` (user-immutable) on the auth user, NOT in
  `raw_user_meta_data` (user-mutable). The frontend sets it at sign-up via the `data`
  option of supabase.auth.signUp, which populates `raw_user_meta_data`. To move it into
  `raw_app_meta_data` securely we rely on a trigger (below) that copies the role from the
  sign-up metadata into `raw_app_meta_data` on insert, so it cannot be changed by the client
  afterward. This keeps role checks trustworthy on both client and server.

4. Trigger
- `on_auth_user_created` trigger: after a new auth.users row is inserted, read the `role`
  value from `raw_user_meta_data` and write it into `raw_app_meta_data`. Then insert a
  matching row into `profiles` with the email, full_name, phone, and role. This runs once
  per new account, automatically.
*/

CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text,
  role text NOT NULL DEFAULT 'patient' CHECK (role IN ('doctor', 'patient')),
  phone text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON profiles TO authenticated;

DROP POLICY IF EXISTS "select_own_profile" ON profiles;
CREATE POLICY "select_own_profile"
  ON profiles FOR SELECT TO authenticated
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "insert_own_profile" ON profiles;
CREATE POLICY "insert_own_profile"
  ON profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "update_own_profile" ON profiles;
CREATE POLICY "update_own_profile"
  ON profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Function that runs on new auth user creation: promotes role to app metadata
-- and creates the matching profile row.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
