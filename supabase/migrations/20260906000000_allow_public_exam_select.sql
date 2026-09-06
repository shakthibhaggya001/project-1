-- Students need to see upcoming and currently available exams before registration.
DROP POLICY IF EXISTS "Allow public select exams" ON public.exams;
CREATE POLICY "Allow public select exams" ON public.exams
  FOR SELECT TO anon, authenticated
  USING (true);