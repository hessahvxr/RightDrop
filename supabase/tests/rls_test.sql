-- RightDrop access-rule tests. Run via supabase/tests/run.sh on a throwaway
-- local database (shim + all migrations applied). Any failed expectation
-- aborts with "FAIL: ...".
\set ON_ERROR_STOP 1
\set QUIET 1
SET client_min_messages = warning;
-- Hide empty result grids; INFO lines (the test results) still print.
\o /dev/null

-- helpers --------------------------------------------------------------------
CREATE FUNCTION test.ok(label text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', label; END IF;
  RAISE INFO 'ok   %', label;
END $$;

-- Statement must raise an error (optionally containing `needle`).
CREATE FUNCTION test.denied(label text, stmt text, needle text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
DECLARE msg text;
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    msg := SQLERRM;
    IF needle IS NOT NULL AND position(needle in msg) = 0 THEN
      RAISE EXCEPTION 'FAIL: % (wrong error: %)', label, msg;
    END IF;
    RAISE INFO 'ok   % [%]', label, msg;
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL: % (statement was allowed)', label;
END $$;

-- Statement must succeed and affect exactly n rows (n = 0: silently filtered by RLS).
CREATE FUNCTION test.affects(label text, stmt text, n bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE c bigint;
BEGIN
  EXECUTE stmt;
  GET DIAGNOSTICS c = ROW_COUNT;
  IF c <> n THEN RAISE EXCEPTION 'FAIL: % (affected % rows, expected %)', label, c, n; END IF;
  RAISE INFO 'ok   %', label;
END $$;

CREATE FUNCTION test.count(stmt text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE c bigint;
BEGIN EXECUTE 'select count(*) from (' || stmt || ') q' INTO c; RETURN c; END $$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA test TO anon, authenticated;

-- fixtures (as the platform: sign-ups fire the app's own triggers) -------------
SELECT test.sign_up('doca@test.sa', 'doctor',  'Dr A')      AS doca \gset
SELECT test.sign_up('docb@test.sa', 'doctor',  'Dr B')      AS docb \gset
SELECT test.sign_up('pata@test.sa', 'patient', 'Patient A') AS pata \gset
SELECT test.sign_up('patb@test.sa', 'patient', 'Patient B') AS patb \gset
SELECT patient_code AS codea FROM profiles WHERE id = :'pata' \gset

\echo '# sign-up triggers'
SELECT test.ok('new patient gets a long RD-XXXX-XXXX-XXXX code', (SELECT patient_code ~ '^RD-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$' FROM profiles WHERE id = :'pata'));
SELECT test.ok('doctor gets no patient code', (SELECT patient_code IS NULL FROM profiles WHERE id = :'doca'));
SELECT test.ok('role copied to app metadata', (SELECT raw_app_meta_data->>'role' = 'doctor' FROM auth.users WHERE id = :'doca'));

SET ROLE authenticated;

\echo '# connecting doctor and patient'
SELECT test.login(:'patb');
SELECT test.denied('patient cannot use connect RPC', format('select * from connect_patient_by_code(%L)', :'codea'), 'only_doctors');
SELECT test.denied('patient cannot insert a connection row directly',
  format('insert into doctor_patients (doctor_id, patient_id) values (%L, %L)', :'patb', :'pata'), 'permission denied');
SELECT test.login(:'docb');
SELECT test.denied('doctor cannot insert a connection row directly (must use code)',
  format('insert into doctor_patients (doctor_id, patient_id) values (%L, %L)', :'docb', :'pata'), 'permission denied');
SELECT test.ok('unconnected doctor cannot read patient profile', test.count(format('select 1 from profiles where id = %L', :'pata')) = 0);
SELECT test.login(:'doca');
SELECT test.ok('a wrong code connects nobody and returns no patient data', test.count('select * from connect_patient_by_code(''RD-000000'')') = 0);
SELECT test.ok('doctor connects with the patient code', test.count(format('select * from connect_patient_by_code(%L)', lower(:'codea'))) = 1);
SELECT test.denied('second connect is rejected', format('select * from connect_patient_by_code(%L)', :'codea'), 'already_connected');
SELECT test.ok('connected doctor reads patient profile', test.count(format('select 1 from profiles where id = %L', :'pata')) = 1);
SELECT test.ok('doctor does not see other patients', test.count(format('select 1 from profiles where id = %L', :'patb')) = 0);

\echo '# sign-up and roles: simple registration, no approval step'
RESET ROLE;
SELECT test.sign_up('docc@test.sa', 'doctor',  'Dr C')            AS docc \gset
SELECT test.sign_up('docd@test.sa', 'doctor',  'Dr D')            AS docd \gset
SELECT test.sign_up('patc@test.sa', 'patient', 'Patient C')       AS patc \gset
SELECT test.sign_up('patd@test.sa', 'patient', 'Patient D')       AS patd \gset
SELECT test.sign_up('pate@test.sa', 'patient', 'Patient E')       AS pate \gset
SELECT test.sign_up('norole@test.sa', '',      'No Role Chosen')  AS norole \gset
SELECT patient_code AS coded FROM profiles WHERE id = :'patd' \gset
SELECT patient_code AS codee FROM profiles WHERE id = :'pate' \gset
SELECT test.ok('patient sign-up: usable at once (profile, role, code), nothing pending', (SELECT role = 'patient' AND patient_code IS NOT NULL FROM profiles WHERE id = :'patc') AND (SELECT raw_app_meta_data->>'role' = 'patient' FROM auth.users WHERE id = :'patc'));
SELECT test.ok('doctor sign-up: usable at once (profile, role), nothing pending', (SELECT role = 'doctor' FROM profiles WHERE id = :'docc') AND (SELECT raw_app_meta_data->>'role' = 'doctor' FROM auth.users WHERE id = :'docc'));
SELECT test.ok('an account with no role chosen is a patient, never a doctor', (SELECT role = 'patient' FROM profiles WHERE id = :'norole'));
SELECT test.denied('a role other than doctor or patient cannot be registered', 'select test.sign_up(''admin@test.sa'', ''admin'', ''x'')', 'check constraint');
-- existing accounts keep their old short code: simulate one that was created before this change
UPDATE profiles SET patient_code = 'RD-AB12CD' WHERE id = :'patc';
SET ROLE authenticated;
SELECT test.login(:'docc');
SELECT test.ok('a new doctor can link a patient straight away, with no approval', test.count(format('select * from connect_patient_by_code(%L)', :'coded')) = 1);
SELECT test.ok('an existing short code still works (existing accounts are left as they are)', test.count('select * from connect_patient_by_code(''rd-ab12cd'')') = 1);
SELECT test.login(:'patc');
SELECT test.denied('roles stay separate: a patient cannot use the doctor link function', format('select * from connect_patient_by_code(%L)', :'codee'), 'only_doctors');
SELECT test.denied('roles stay separate: a patient cannot change their own role', format('update profiles set role = ''doctor'' where id = %L', :'patc'), 'permission denied');
SELECT test.denied('roles stay separate: a patient cannot create a connection row', format('insert into doctor_patients (doctor_id, patient_id) values (%L, %L)', :'patc', :'pate'), 'permission denied');
SELECT test.login(:'docc');
SELECT test.denied('roles stay separate: a doctor cannot change their own role', format('update profiles set role = ''patient'' where id = %L', :'docc'), 'permission denied');
SELECT test.denied('roles stay separate: a doctor cannot record doses as the patient', format(
  'insert into dose_records (prescription_id, patient_id, dose_time, scheduled_date, status) values (gen_random_uuid(), %L, ''08:00'', current_date, ''taken'')', :'patd'));

\echo '# link code: strength and guessing'
RESET ROLE;
DO $$ BEGIN PERFORM test.sign_up('bulk' || g || '@test.sa', 'patient', 'Bulk ' || g) FROM generate_series(1, 300) g; END $$;
SELECT test.ok('300 new codes: all long, all in the safe alphabet, all different',
  (SELECT count(*) = 300 AND count(DISTINCT patient_code) = 300 AND bool_and(patient_code ~ '^RD-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$') FROM profiles WHERE email LIKE 'bulk%'));
SELECT test.ok('every one of the 32 symbols is actually used (codes are not from a narrow range)',
  (SELECT count(DISTINCT ch) = 32 FROM profiles, regexp_split_to_table(replace(substr(patient_code, 4), '-', ''), '') ch WHERE email LIKE 'bulk%'));
SET ROLE authenticated;
SELECT test.login(:'docd');
SELECT test.ok('code is accepted with spaces, lower case and no dashes', test.count(format('select * from connect_patient_by_code(%L)', '  ' || lower(replace(:'coded', '-', ' ')) || ' ')) = 1);
SELECT test.ok('wrong guesses 1 to 10 each return nothing', (SELECT sum(test.count(format('select * from connect_patient_by_code(%L)', 'RD-WRNG-GUES-' || lpad(g::text, 4, '2')))) = 0 FROM generate_series(1, 10) g));
RESET ROLE;
SELECT test.ok('each wrong guess was recorded on the server', (SELECT count(*) = 10 FROM link_code_attempts WHERE doctor_id = :'docd'));
SET ROLE authenticated;
SELECT test.login(:'docd');
SELECT test.denied('11th guess in the hour is refused', 'select * from connect_patient_by_code(''RD-WRNG-GUES-ZZZZ'')', 'too_many_attempts');
SELECT test.denied('while locked, even a CORRECT code is refused', format('select * from connect_patient_by_code(%L)', :'codee'), 'too_many_attempts');
SELECT test.denied('the attempt record cannot be read by the doctor', 'select * from link_code_attempts', 'permission denied');
SELECT test.denied('the attempt record cannot be cleared by the doctor', 'delete from link_code_attempts', 'permission denied');
SELECT test.login(:'docc');
SELECT test.ok('another doctor is not affected by that lock', test.count(format('select * from connect_patient_by_code(%L)', :'codee')) = 1);
SELECT test.ok('correct codes are not counted as attempts', test.count('select 1') = 1);
RESET ROLE;
SELECT test.ok('...no attempts recorded for the doctor who only entered correct codes', (SELECT count(*) = 0 FROM link_code_attempts WHERE doctor_id = :'docc'));
UPDATE link_code_attempts SET attempted_at = attempted_at - interval '61 minutes' WHERE doctor_id = :'docd';
SET ROLE authenticated;
SELECT test.login(:'docd');
SELECT test.ok('after an hour the doctor can try again', test.count(format('select * from connect_patient_by_code(%L)', :'codee')) = 1);
RESET ROLE;
INSERT INTO link_code_attempts (doctor_id, attempted_at) SELECT :'docd', now() - interval '3 hours' FROM generate_series(1, 20);
SET ROLE authenticated;
SELECT test.login(:'docd');
SELECT test.denied('30 wrong codes in a day lock the doctor for the day', 'select * from connect_patient_by_code(''RD-WRNG-GUES-YYYY'')', 'too_many_attempts');
SELECT test.login(:'patc');
SELECT test.denied('a patient cannot read the attempt record either', 'select * from link_code_attempts', 'permission denied');
SELECT test.login(:'doca');

\echo '# profiles'
SELECT test.login(:'pata');
SELECT test.affects('patient edits own name and phone', format('update profiles set full_name = ''A2'', phone = ''050'' where id = %L', :'pata'), 1);
SELECT test.denied('patient cannot change own role', format('update profiles set role = ''doctor'' where id = %L', :'pata'), 'permission denied');
SELECT test.denied('patient cannot change own patient code', format('update profiles set patient_code = ''RD-AAAAAA'' where id = %L', :'pata'), 'permission denied');
SELECT test.affects('patient cannot edit another profile', format('update profiles set full_name = ''x'' where id = %L', :'patb'), 0);
SELECT test.denied('client cannot insert profiles', 'insert into profiles (id, email, role) values (gen_random_uuid(), ''z@z'', ''doctor'')', 'permission denied');

\echo '# prescriptions'
SELECT test.login(:'doca');
SELECT test.affects('doctor prescribes for connected patient', format(
  'insert into prescriptions (id, doctor_id, patient_id, medication_name, concentration, dosage, frequency_per_day, eye, start_date, end_date)
   values (''11111111-1111-1111-1111-111111111111'', %L, %L, ''Timolol'', ''0.5%%'', ''1 drop'', 2, ''both'', current_date - 2, current_date + 5)', :'doca', :'pata'), 1);
SELECT test.denied('doctor cannot prescribe for unconnected patient', format(
  'insert into prescriptions (doctor_id, patient_id, medication_name, dosage, frequency_per_day, eye, start_date, end_date)
   values (%L, %L, ''X'', ''1'', 1, ''both'', current_date, current_date)', :'doca', :'patb'), 'row-level security');
SELECT test.affects('doctor sets dose times', 'insert into prescription_dose_times (prescription_id, dose_time, sort_order)
   values (''11111111-1111-1111-1111-111111111111'', ''08:00'', 0), (''11111111-1111-1111-1111-111111111111'', ''20:00'', 1)', 2);
SELECT test.login(:'docb');
SELECT test.denied('other doctor cannot prescribe for this patient', format(
  'insert into prescriptions (doctor_id, patient_id, medication_name, dosage, frequency_per_day, eye, start_date, end_date)
   values (%L, %L, ''X'', ''1'', 1, ''both'', current_date, current_date)', :'docb', :'pata'), 'row-level security');
SELECT test.ok('other doctor sees no prescriptions', test.count('select 1 from prescriptions') = 0);
SELECT test.ok('other doctor sees no dose times', test.count('select 1 from prescription_dose_times') = 0);
SELECT test.login(:'pata');
SELECT test.ok('patient sees own prescription', test.count('select 1 from prescriptions') = 1);
SELECT test.ok('patient sees own dose times', test.count('select 1 from prescription_dose_times') = 2);
SELECT test.affects('patient cannot edit a prescription', 'update prescriptions set dosage = ''9 drops''', 0);
SELECT test.affects('patient cannot delete a prescription', 'delete from prescriptions', 0);
SELECT test.denied('patient cannot create a prescription', format(
  'insert into prescriptions (doctor_id, patient_id, medication_name, dosage, frequency_per_day, eye, start_date, end_date)
   values (%L, %L, ''X'', ''1'', 1, ''both'', current_date, current_date)', :'pata', :'pata'), 'row-level security');
SELECT test.denied('patient cannot add dose times', 'insert into prescription_dose_times (prescription_id, dose_time) values (''11111111-1111-1111-1111-111111111111'', ''12:00'')', 'row-level security');
SELECT test.affects('patient cannot delete dose times', 'delete from prescription_dose_times', 0);
SELECT test.login(:'patb');
SELECT test.ok('other patient sees no prescriptions', test.count('select 1 from prescriptions') = 0);

\echo '# dose records'
SELECT test.login(:'pata');
SELECT test.affects('patient confirms a dose', format(
  'insert into dose_records (prescription_id, patient_id, dose_time, scheduled_date, status, taken_at)
   values (''11111111-1111-1111-1111-111111111111'', %L, ''08:00'', current_date, ''taken'', now() + interval ''3 days'')', :'pata'), 1);
SELECT test.ok('future taken_at replaced by server time', (SELECT abs(extract(epoch from taken_at - now())) < 60 FROM dose_records WHERE dose_time = '08:00' AND scheduled_date = current_date));
SELECT test.affects('patient records a skipped dose', format(
  'insert into dose_records (prescription_id, patient_id, dose_time, scheduled_date, status, taken_at)
   values (''11111111-1111-1111-1111-111111111111'', %L, ''20:00'', current_date - 1, ''missed'', now())', :'pata'), 1);
SELECT test.ok('skipped dose has no taken_at', (SELECT taken_at IS NULL FROM dose_records WHERE status = 'missed'));
SELECT test.affects('taken without a time gets server time', format(
  'insert into dose_records (prescription_id, patient_id, dose_time, scheduled_date, status)
   values (''11111111-1111-1111-1111-111111111111'', %L, ''08:00'', current_date - 1, ''taken'')', :'pata'), 1);
SELECT test.ok('...taken_at filled', (SELECT taken_at IS NOT NULL FROM dose_records WHERE dose_time = '08:00' AND scheduled_date = current_date - 1));
SELECT test.denied('same dose cannot be confirmed twice', format(
  'insert into dose_records (prescription_id, patient_id, dose_time, scheduled_date, status)
   values (''11111111-1111-1111-1111-111111111111'', %L, ''08:00'', current_date, ''taken'')', :'pata'), 'duplicate key');
SELECT test.denied('future doses cannot be pre-recorded', format(
  'insert into dose_records (prescription_id, patient_id, dose_time, scheduled_date, status)
   values (''11111111-1111-1111-1111-111111111111'', %L, ''08:00'', current_date + 4, ''taken'')', :'pata'), 'dose_in_future');
SELECT test.denied('doses before the start date are rejected', format(
  'insert into dose_records (prescription_id, patient_id, dose_time, scheduled_date, status)
   values (''11111111-1111-1111-1111-111111111111'', %L, ''08:00'', current_date - 30, ''taken'')', :'pata'), 'dose_outside_prescription_dates');
SELECT test.affects('records cannot be edited', 'update dose_records set status = ''taken''', 0);
SELECT test.affects('records cannot be deleted', 'delete from dose_records', 0);
SELECT test.login(:'patb');
SELECT test.denied('other patient cannot record on this prescription', format(
  'insert into dose_records (prescription_id, patient_id, dose_time, scheduled_date, status)
   values (''11111111-1111-1111-1111-111111111111'', %L, ''20:00'', current_date, ''taken'')', :'patb'));
SELECT test.ok('other patient sees no records', test.count('select 1 from dose_records') = 0);
SELECT test.login(:'doca');
SELECT test.ok('prescribing doctor sees the patient''s records', test.count('select 1 from dose_records') = 3);
SELECT test.denied('doctor cannot record doses for the patient', format(
  'insert into dose_records (prescription_id, patient_id, dose_time, scheduled_date, status)
   values (''11111111-1111-1111-1111-111111111111'', %L, ''20:00'', current_date, ''taken'')', :'pata'), 'row-level security');
SELECT test.login(:'docb');
SELECT test.ok('other doctor sees no records', test.count('select 1 from dose_records') = 0);

\echo '# scan image storage'
SELECT test.login(:'pata');
SELECT test.affects('patient uploads own scan', format('insert into storage.objects (bucket_id, name, owner) values (''medication-scans'', %L, %L)', :'pata' || '/1.jpg', :'pata'), 1);
SELECT test.login(:'patb');
SELECT test.ok('other patient cannot see the scan', test.count('select 1 from storage.objects') = 0);
SELECT test.affects('other patient cannot delete the scan', 'delete from storage.objects', 0);

\echo '# assistant: summaries shared with the doctor (patient consent)'
SELECT test.login(:'pata');
SELECT test.ok('patient sees own connected doctor by name', (SELECT count(*) = 1 AND bool_and(full_name = 'Dr A') FROM my_doctors()));
SELECT test.ok('my_doctors exposes id and name only', pg_get_function_result('public.my_doctors()'::regprocedure) = 'TABLE(doctor_id uuid, full_name text)');
SELECT test.ok('patient still cannot read the doctor profile row (email, phone)', test.count(format('select 1 from profiles where id = %L', :'doca')) = 0);
SELECT test.affects('patient sends an approved summary to their doctor', format(
  'insert into patient_reports (id, patient_id, doctor_id, summary) values (''22222222-2222-2222-2222-222222222222'', %L, %L, ''يذكر المريض احمراراً في العين اليمنى بعد القطرة منذ يومين.'')', :'pata', :'doca'), 1);
SELECT test.denied('patient cannot send a summary to a doctor they are not connected to', format(
  'insert into patient_reports (patient_id, doctor_id, summary) values (%L, %L, ''x'')', :'pata', :'docb'), 'row-level security');
SELECT test.denied('empty summary is rejected', format(
  'insert into patient_reports (patient_id, doctor_id, summary) values (%L, %L, ''   '')', :'pata', :'doca'), 'check constraint');
SELECT test.denied('over-long summary is rejected', format(
  'insert into patient_reports (patient_id, doctor_id, summary) values (%L, %L, repeat(''ا'', 2001))', :'pata', :'doca'), 'check constraint');
SELECT test.denied('a sent summary cannot be edited', 'update patient_reports set summary = ''changed''', 'permission denied');
SELECT test.login(:'patb');
SELECT test.ok('patient with no doctor gets an empty doctor list', (SELECT count(*) = 0 FROM my_doctors()));
SELECT test.ok('other patient cannot see the summary', test.count('select 1 from patient_reports') = 0);
SELECT test.denied('nobody can send a summary in another patient''s name', format(
  'insert into patient_reports (patient_id, doctor_id, summary) values (%L, %L, ''forged'')', :'pata', :'doca'), 'row-level security');
SELECT test.affects('other patient cannot delete the summary', 'delete from patient_reports', 0);
SELECT test.login(:'docb');
SELECT test.ok('a doctor it was not sent to cannot see the summary', test.count('select 1 from patient_reports') = 0);
SELECT test.login(:'doca');
SELECT test.ok('the chosen doctor sees the summary', test.count('select 1 from patient_reports where summary like ''%احمرار%''') = 1);
SELECT test.denied('doctor cannot create a summary for the patient', format(
  'insert into patient_reports (patient_id, doctor_id, summary) values (%L, %L, ''by doctor'')', :'pata', :'doca'), 'row-level security');
SELECT test.denied('doctor cannot edit the summary', 'update patient_reports set summary = ''changed''', 'permission denied');
SELECT test.affects('doctor cannot delete the summary', 'delete from patient_reports', 0);
SELECT test.ok('doctor has no doctors list of their own', (SELECT count(*) = 0 FROM my_doctors()));
SELECT test.login(:'pata');
SELECT test.affects('patient sends 4 more summaries (5 in a day)', format(
  'insert into patient_reports (patient_id, doctor_id, summary) select %L, %L, ''ملخص '' || g from generate_series(1, 4) g', :'pata', :'doca'), 4);
SELECT test.denied('a 6th summary in 24 hours is refused', format(
  'insert into patient_reports (patient_id, doctor_id, summary) values (%L, %L, ''sixth'')', :'pata', :'doca'), 'report_limit_reached');
SELECT test.affects('patient withdraws (deletes) a summary', 'delete from patient_reports where id = ''22222222-2222-2222-2222-222222222222''', 1);
SELECT test.login(:'doca');
SELECT test.ok('withdrawn summary is gone for the doctor', test.count('select 1 from patient_reports where id = ''22222222-2222-2222-2222-222222222222''') = 0);
SELECT test.ok('doctor still sees the other 4', test.count('select 1 from patient_reports') = 4);

\echo '# assistant: rate limit counter'
SELECT test.login(:'pata');
SELECT test.denied('usage table cannot be read by clients', 'select * from assistant_usage', 'permission denied');
SELECT test.denied('usage table cannot be written by clients', format('insert into assistant_usage values (%L, now(), 0)', :'pata'), 'permission denied');
SELECT test.ok('requests 1 to 20 in an hour are allowed', (SELECT bool_and(assistant_register_request()) FROM generate_series(1, 20)));
SELECT test.ok('request 21 in the same hour is refused', assistant_register_request() = false);
SELECT test.ok('refused requests are not counted', assistant_register_request() = false);
SELECT test.login(:'patb');
SELECT test.ok('another patient has their own counter', assistant_register_request() = true);
RESET ROLE;
SELECT test.ok('counter stores counts only: 20 for A, 1 for B', (SELECT array_agg(request_count ORDER BY request_count) = ARRAY[1, 20] FROM assistant_usage));
SELECT test.ok('usage table has no text columns', (SELECT count(*) = 0 FROM information_schema.columns WHERE table_name = 'assistant_usage' AND data_type IN ('text', 'character varying', 'json', 'jsonb')));
UPDATE assistant_usage SET hour_bucket = hour_bucket - interval '2 hours' WHERE request_count = 20;
INSERT INTO assistant_usage SELECT patient_id, hour_bucket - interval '3 hours', 39 FROM assistant_usage WHERE request_count = 20;
SET ROLE authenticated;
SELECT test.login(:'pata');
SELECT test.ok('59 in the last day: one more is allowed', assistant_register_request() = true);
SELECT test.ok('60 in the last day: the next is refused', assistant_register_request() = false);
RESET ROLE;
UPDATE assistant_usage SET hour_bucket = hour_bucket - interval '3 days';
SET ROLE authenticated;
SELECT test.login(:'pata');
SELECT test.ok('counter recovers after the window and old rows are removed', assistant_register_request() = true AND (SELECT true));
RESET ROLE;
SELECT test.ok('old usage rows were cleaned up for that patient', (SELECT count(*) = 1 FROM assistant_usage u JOIN profiles p ON p.id = u.patient_id WHERE p.email = 'pata@test.sa'));
SET ROLE authenticated;

\echo '# disconnecting'
SELECT test.login(:'doca');
SELECT test.affects('doctor discontinues the prescription', 'update prescriptions set status = ''discontinued''', 1);
SELECT test.affects('doctor removes the connection', 'delete from doctor_patients', 1);
SELECT test.denied('after disconnect the doctor can no longer edit the prescription', 'update prescriptions set dosage = ''2 drops''', 'row-level security');
SELECT test.ok('after disconnect the doctor cannot read the profile', test.count(format('select 1 from profiles where id = %L', :'pata')) = 0);
SELECT test.ok('after disconnect the doctor can no longer read the patient''s summaries', test.count('select 1 from patient_reports') = 0);
SELECT test.login(:'pata');
SELECT test.ok('the patient still sees their own sent summaries', test.count('select 1 from patient_reports') = 4);
SELECT test.ok('after disconnect the patient has no doctors to send to', (SELECT count(*) = 0 FROM my_doctors()));

\echo '# signed-out (anon) access'
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);
SET ROLE anon;
SELECT test.ok('anon reads no profiles', test.count('select 1 from profiles') = 0);
SELECT test.ok('anon reads no prescriptions', test.count('select 1 from prescriptions') = 0);
SELECT test.ok('anon reads no dose records', test.count('select 1 from dose_records') = 0);
SELECT test.denied('anon cannot call connect RPC', 'select * from connect_patient_by_code(''RD-000000'')', 'permission denied');
SELECT test.denied('anon cannot read summaries', 'select 1 from patient_reports', 'permission denied');
SELECT test.denied('anon cannot list doctors', 'select * from my_doctors()', 'permission denied');
SELECT test.denied('anon cannot use the rate counter', 'select assistant_register_request()', 'permission denied');
SELECT test.denied('anon cannot read link attempts', 'select 1 from link_code_attempts', 'permission denied');
RESET ROLE;
\echo 'ALL ACCESS-RULE TESTS PASSED'
