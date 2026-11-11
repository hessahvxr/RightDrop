-- Stage 6: AI Medication Recognition
-- Create a private storage bucket for temporary medication scan images.
-- Images are uploaded by patients, processed by the scan-medication edge
-- function, and then deleted. The bucket is private (not public) so that
-- only authenticated users with the right RLS policies can access their
-- own images.

INSERT INTO storage.buckets (id, name, public)
VALUES ('medication-scans', 'medication-scans', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: patients can only manage their own scan images.
-- Files are stored under a path like: {user_id}/{timestamp}.jpg

DROP POLICY IF EXISTS "select_own_scans" ON storage.objects;
CREATE POLICY "select_own_scans"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'medication-scans' AND owner = auth.uid());

DROP POLICY IF EXISTS "insert_own_scans" ON storage.objects;
CREATE POLICY "insert_own_scans"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'medication-scans' AND owner = auth.uid());

DROP POLICY IF EXISTS "delete_own_scans" ON storage.objects;
CREATE POLICY "delete_own_scans"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'medication-scans' AND owner = auth.uid());
