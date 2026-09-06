-- The student entry page performs identity checks before creating a submission.
-- Keep the unique constraints as the final race-condition safeguard.
DROP POLICY IF EXISTS "public_read_students_for_entry" ON public.students;
CREATE POLICY "public_read_students_for_entry" ON public.students
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "public_insert_students_for_entry" ON public.students;
CREATE POLICY "public_insert_students_for_entry" ON public.students
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "public_read_own_entry_submissions" ON public.submissions;
CREATE POLICY "public_read_own_entry_submissions" ON public.submissions
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "public_insert_entry_submissions" ON public.submissions;
CREATE POLICY "public_insert_entry_submissions" ON public.submissions
  FOR INSERT TO anon, authenticated WITH CHECK (true);