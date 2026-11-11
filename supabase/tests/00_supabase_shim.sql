-- Minimal stand-in for the parts of a Supabase project that the RightDrop
-- migrations rely on, so they can be applied and tested on a plain local
-- PostgreSQL. TEST ONLY: never run this against the real Supabase project.

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;

CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;

-- auth ----------------------------------------------------------------------
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE,
  raw_user_meta_data jsonb,
  raw_app_meta_data jsonb
);

CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(auth.jwt() ->> 'sub', '')::uuid
$$;

-- storage -------------------------------------------------------------------
CREATE SCHEMA storage;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false);
CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets(id),
  name text,
  owner uuid
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT ALL ON storage.objects, storage.buckets TO authenticated, service_role;

-- Supabase grants broad table/function privileges in `public` by default and
-- relies on RLS to restrict rows. Mirror that (the permissive case) so the
-- tests prove the policies themselves hold.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

-- Test helpers ---------------------------------------------------------------
CREATE SCHEMA test;
GRANT USAGE ON SCHEMA test TO anon, authenticated;

-- Simulates supabase.auth.signUp(): inserting the auth user fires the app's
-- own handle_new_user trigger. Returns the new user id.
CREATE FUNCTION test.sign_up(p_email text, p_role text, p_name text) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO auth.users (email, raw_user_meta_data)
  VALUES (p_email, jsonb_build_object('role', p_role, 'full_name', p_name))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Simulates an authenticated API request from that user (role + JWT claims).
CREATE FUNCTION test.login(p_user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_meta jsonb;
BEGIN
  SELECT raw_app_meta_data INTO v_meta FROM auth.users WHERE id = p_user;
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated', 'app_metadata', COALESCE(v_meta, '{}'))::text,
    false);
END $$;
