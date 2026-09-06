import { FormEvent, useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, Loader2, Mail, School, User, Phone } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { handleStudentLogin } from '@/lib/studentAttempts';
import type { Exam, ExamAttempt } from '@/types';

type Props = { onStarted: (attempt: ExamAttempt, exam: Exam) => void; onBack: () => void };

export default function StudentLoginForm({ onStarted, onBack }: Props) {
  const [exams, setExams] = useState<Exam[]>([]);
  const [examId, setExamId] = useState('');
  const [gmail, setGmail] = useState('');
  const [name, setName] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [school, setSchool] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [examsLoading, setExamsLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(() => Date.now());

  const selectedExam = exams.find((exam) => exam.id === examId) || null;
  const startsAt = selectedExam ? Date.parse(selectedExam.starts_at) : NaN;
  const endsAt = selectedExam ? Date.parse(selectedExam.ends_at) : NaN;
  const examHasStarted = selectedExam ? currentTime >= startsAt : false;
  const examHasEnded = selectedExam ? currentTime > endsAt : false;
  const examIsWaiting = selectedExam ? currentTime < startsAt : false;
  const canStartExam = !!selectedExam && examHasStarted && !examHasEnded;

  useEffect(() => {
    if (!selectedExam) return;
    const interval = window.setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [selectedExam]);

  useEffect(() => {
    const loadExams = async () => {
      try {
        const { data, error: queryError } = await supabase.from('exams').select('*').order('starts_at', { ascending: true });
        if (queryError) setError(queryError.message);
        const availableExams = ((data || []) as Exam[]).filter((exam) => Date.parse(exam.ends_at) >= Date.now());
        setExams(availableExams);
        if (availableExams[0]) setExamId(availableExams[0].id);
      } catch {
        setError('Unable to load available exams. Please try again.');
      } finally {
        setExamsLoading(false);
      }
    };
    loadExams();
  }, []);

  const validate = () => {
    if (!gmail.trim() || !name.trim() || !whatsapp.trim() || !school.trim()) return 'All fields are required.';
    if (!/^[^\s@]+@gmail\.com$/i.test(gmail.trim())) return 'Please enter a valid Gmail address ending in @gmail.com.';
    const digits = whatsapp.replace(/[\s-]/g, '');
    if (!/^\d{9,12}$/.test(digits)) return 'WhatsApp number must contain 9 to 12 digits.';
    if (!examId) return 'Please select an exam.';
    if (!canStartExam) return examHasEnded ? 'This exam is no longer available.' : 'Exam has not started yet.';
    return null;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const validationError = validate();
    setError(validationError);
    if (validationError) return;
    setLoading(true);
    const result = await handleStudentLogin(gmail, name, whatsapp, school, examId);
    setLoading(false);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    const exam = exams.find((item) => item.id === examId);
    if (exam) onStarted(result.attempt, exam);
  };

  return (
    <main className="min-h-screen bg-slate-900 px-4 py-8 text-white">
      <div className="mx-auto max-w-xl rounded-[2rem] border border-white/10 bg-slate-800 p-6 shadow-2xl sm:p-8">
        <button type="button" onClick={onBack} className="mb-6 text-sm text-slate-300 hover:text-white">Back</button>
        <h1 className="text-3xl font-black">Student exam entry</h1>
        <p className="mt-2 text-slate-300">Use the same registration details for every attempt.</p>
        {error && <div role="alert" className="mt-5 flex gap-2 rounded-xl border border-red-400/40 bg-red-950/40 p-3 text-sm text-red-100"><AlertCircle className="h-5 w-5 shrink-0" />{error}</div>}
        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block text-sm font-medium">Exam<select value={examId} onChange={(event) => setExamId(event.target.value)} disabled={examsLoading} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-white"><option value="">{examsLoading ? 'Loading exams...' : 'Select an exam'}</option>{exams.map((exam) => <option key={exam.id} value={exam.id}>{exam.exam_name}</option>)}</select></label>
          {selectedExam && examIsWaiting && <div className="rounded-xl border border-amber-300/30 bg-amber-950/30 p-3 text-sm text-amber-100"><p className="font-semibold">Exam has not started yet</p><p className="mt-1 font-mono text-lg">Starts in: {formatCountdown(Math.max(0, startsAt - currentTime))}</p></div>}
          {selectedExam && examHasEnded && <div className="rounded-xl border border-red-400/40 bg-red-950/40 p-3 text-sm text-red-100">This exam is no longer available.</div>}
          <Field icon={Mail} label="Gmail" value={gmail} onChange={setGmail} type="email" />
          <Field icon={User} label="Full Name" value={name} onChange={setName} />
          <Field icon={Phone} label="WhatsApp Number" value={whatsapp} onChange={setWhatsapp} inputMode="numeric" />
          <Field icon={School} label="School Name" value={school} onChange={setSchool} />
          <button type="submit" disabled={loading || examsLoading || !canStartExam} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3.5 font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-600 disabled:opacity-60">{loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowRight className="h-5 w-5" />} {loading ? 'Starting...' : 'Start Exam'}</button>
          {selectedExam && examIsWaiting && <p className="text-center text-sm text-amber-200">Please wait until the countdown reaches zero.</p>}
        </form>
      </div>
    </main>
  );
}

function Field({ icon: Icon, label, value, onChange, type = 'text', inputMode }: { icon: typeof Mail; label: string; value: string; onChange: (value: string) => void; type?: string; inputMode?: 'numeric' }) {
  return <label className="block text-sm font-medium">{label}<span className="relative mt-2 block"><Icon className="absolute left-3 top-3.5 h-4 w-4 text-slate-400" /><input required type={type} inputMode={inputMode} value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-xl border border-white/10 bg-slate-900 py-3 pl-10 pr-4 text-white outline-none focus:border-blue-400" /></span></label>;
}

function formatCountdown(milliseconds: number) {
  const totalSeconds = Math.ceil(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}