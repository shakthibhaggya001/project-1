import { FormEvent, useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, Loader2, School, User, Phone } from 'lucide-react';
import { supabase, type Quiz, type Submission } from '@/lib/supabase';
import { handleStudentLogin } from '@/lib/studentAttempts';
import { formatCountdown, normalizePhone } from '@/lib/utils';
import type { StudentEntry } from '@/types';

type Props = { onStarted: (submission: Submission, quiz: Quiz, entry: StudentEntry) => void; onBack: () => void };

export default function StudentLoginForm({ onStarted, onBack }: Props) {
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [quizId, setQuizId] = useState('');
  const [name, setName] = useState('');
  const [grade, setGrade] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [school, setSchool] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [schoolError, setSchoolError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [quizzesLoading, setQuizzesLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(() => Date.now());

  const selectedQuiz = quizzes.find((quiz) => quiz.id === quizId) || null;
  const startsAt = selectedQuiz ? Date.parse(selectedQuiz.start_time) : NaN;
  const endsAt = selectedQuiz ? Date.parse(selectedQuiz.end_time) : NaN;
  const quizHasStarted = selectedQuiz ? currentTime >= startsAt : false;
  const quizHasEnded = selectedQuiz ? currentTime > endsAt : false;
  const quizIsWaiting = selectedQuiz ? currentTime < startsAt : false;
  const canStartQuiz = !!selectedQuiz && quizHasStarted && !quizHasEnded;

  useEffect(() => {
    if (!selectedQuiz) return;
    const interval = window.setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [selectedQuiz]);

  useEffect(() => {
    const loadExams = async () => {
      try {
        const { data, error: queryError } = await supabase.from('quizzes').select('*').gt('end_time', new Date().toISOString()).order('start_time', { ascending: true });
        if (queryError) setError(queryError.message);
        const availableQuizzes = (data || []) as Quiz[];
        setQuizzes(availableQuizzes);
        if (availableQuizzes[0]) setQuizId(availableQuizzes[0].id);
      } catch {
        setError('Unable to load available quizzes. Please try again.');
      } finally {
        setQuizzesLoading(false);
      }
    };
    loadExams();
  }, []);

  const validate = () => {
    if (!name.trim() || !grade || !whatsapp.trim() || !school.trim()) return 'All fields are required.';
    if (nameError || schoolError) return 'Please use English letters only.';
    const digits = whatsapp.replace(/[\s-]/g, '');
    if (!/^\d{9,12}$/.test(digits)) return 'WhatsApp number must contain 9 to 12 digits.';
    if (!quizId) return 'Please select a quiz.';
    if (!canStartQuiz) return quizHasEnded ? 'This exam is no longer available.' : 'Exam has not started yet.';
    return null;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const validationError = validate();
    setError(validationError);
    if (validationError) return;
    setLoading(true);
    const result = await handleStudentLogin(name, Number(grade), whatsapp, school, selectedQuiz!);
    setLoading(false);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    onStarted(result.submission, result.quiz, { fullName: name.trim(), grade: Number(grade) as 10 | 11, whatsapp: normalizePhone(whatsapp), school: school.trim() });
  };

  return (
    <main className="min-h-screen bg-slate-900 px-4 py-8 text-white">
      <div className="mx-auto max-w-xl rounded-[2rem] border border-white/10 bg-slate-800 p-6 shadow-2xl sm:p-8">
        <button type="button" onClick={onBack} className="mb-6 text-sm text-slate-300 hover:text-white">Back</button>
        <h1 className="text-3xl font-black">Student exam entry</h1>
        <p className="mt-2 text-slate-300">Use the same registration details for every attempt.</p>
        <p className="mt-3 rounded-xl border border-blue-300/20 bg-blue-950/30 px-3 py-2 text-sm text-blue-100">Please fill in all details in English only.</p>
        {error && <div role="alert" className="mt-5 flex gap-2 rounded-xl border border-red-400/40 bg-red-950/40 p-3 text-sm text-red-100"><AlertCircle className="h-5 w-5 shrink-0" />{error}</div>}
        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block text-sm font-medium">Exam<select value={quizId} onChange={(event) => setQuizId(event.target.value)} disabled={quizzesLoading} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-white"><option value="">{quizzesLoading ? 'Loading exams...' : 'Select an exam'}</option>{quizzes.map((quiz) => <option key={quiz.id} value={quiz.id}>{quiz.title}</option>)}</select></label>
          {selectedQuiz && quizIsWaiting && <div className="rounded-xl border border-amber-300/30 bg-amber-950/30 p-3 text-sm text-amber-100"><p className="font-semibold">Exam has not started yet</p><p className="mt-1 font-mono text-lg">Starts in: {formatCountdown(Math.max(0, Math.ceil((startsAt - currentTime) / 1000)))}</p></div>}
          {selectedQuiz && quizHasEnded && <div className="rounded-xl border border-red-400/40 bg-red-950/40 p-3 text-sm text-red-100">This exam is no longer available.</div>}
          <Field icon={User} label="Full Name" value={name} onChange={(value) => { setName(value); setNameError(value && !isEnglishEntry(value) ? 'Please use English letters only' : null); }} error={nameError} />
          <label className="block text-sm font-medium">Grade<select required value={grade} onChange={(event) => setGrade(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-white"><option value="">Select grade</option><option value="10">10</option><option value="11">11</option></select></label>
          <Field icon={School} label="School Name" value={school} onChange={(value) => { setSchool(value); setSchoolError(value && !isEnglishEntry(value) ? 'Please use English letters only' : null); }} error={schoolError} />
          <Field icon={Phone} label="WhatsApp Number" value={whatsapp} onChange={setWhatsapp} inputMode="numeric" />
          <button type="submit" disabled={loading || quizzesLoading || !canStartQuiz || !!nameError || !!schoolError} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3.5 font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-600 disabled:opacity-60">{loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowRight className="h-5 w-5" />} {loading ? 'Starting...' : 'Start Exam'}</button>
          {selectedQuiz && quizIsWaiting && <p className="text-center text-sm text-amber-200">Please wait until the countdown reaches zero.</p>}
        </form>
      </div>
    </main>
  );
}

function Field({ icon: Icon, label, value, onChange, type = 'text', inputMode, error }: { icon: typeof User; label: string; value: string; onChange: (value: string) => void; type?: string; inputMode?: 'numeric'; error?: string | null }) {
  return <label className="block text-sm font-medium">{label}<span className="relative mt-2 block"><Icon className="absolute left-3 top-3.5 h-4 w-4 text-slate-400" /><input required type={type} inputMode={inputMode} value={value} onChange={(event) => onChange(event.target.value)} className={`w-full rounded-xl border bg-slate-900 py-3 pl-10 pr-4 text-white outline-none focus:border-blue-400 ${error ? 'border-red-400' : 'border-white/10'}`} /></span>{error && <span className="mt-1 block text-sm font-normal text-red-300">{error}</span>}</label>;
}

function isEnglishEntry(value: string) {
  return /^[a-zA-Z0-9\s.'-]+$/.test(value);
}

