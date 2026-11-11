-- RightDrop: عدد الصفوف في الجداول الأساسية (قراءة فقط)
-- READ-ONLY. One SELECT. It changes nothing.
--
-- شغّله قبل تطبيق الملفات 07-09 واحفظ الأرقام، ثم شغّله بعدها:
-- الأرقام لازم تبقى نفسها (إلا إذا أحد استخدم التطبيق في نفس الوقت).

SELECT 'auth.users' AS table_name, (SELECT count(*) FROM auth.users) AS row_count
UNION ALL SELECT 'profiles', (SELECT count(*) FROM public.profiles)
UNION ALL SELECT 'profiles with a patient_code', (SELECT count(*) FROM public.profiles WHERE patient_code IS NOT NULL)
UNION ALL SELECT 'doctor_patients', (SELECT count(*) FROM public.doctor_patients)
UNION ALL SELECT 'prescriptions', (SELECT count(*) FROM public.prescriptions)
UNION ALL SELECT 'prescription_dose_times', (SELECT count(*) FROM public.prescription_dose_times)
UNION ALL SELECT 'dose_records', (SELECT count(*) FROM public.dose_records);
