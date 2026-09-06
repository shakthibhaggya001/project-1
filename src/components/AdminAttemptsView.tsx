import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2, ShieldAlert } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Quiz, Submission } from '@/lib/supabase';

type Props = { onBack: () => void };

export default function AdminAttemptsView({ onBack }: Props) {
  const [exams, setExams] = useState<Quiz[]>([]);
  const [examId, setExamId] = useState('');
  const [attempts, setAttempts] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadExams = async () => {
      try {
        const { data, error: queryError } = await supabase.from('quizzes').select('*').order('start_time', { ascending: false });
        if (queryError) throw queryError;
        const rows = (data || []) as Quiz[];
        setExams(rows);
        if (rows[0]) setExamId(rows[0].id);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load exams.');
      } finally {
        setLoading(false);
      }
    };
    loadExams();
  }, []);

  useEffect(() => {
    if (!examId) return;
    const loadAttempts = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data, error: queryError } = await supabase
          .from('submissions')
          .select('*, students (full_name, gmail, whatsapp_number, school)')
          .eq('quiz_id', examId)
          .order('started_at', { ascending: false });
        if (queryError) throw queryError;
        setAttempts(((data || []) as Submission[]).sort((left, right) => Date.parse(right.started_at) - Date.parse(left.started_at)));
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load attempts.');
        setAttempts([]);
      } finally {
        setLoading(false);
      }
    };
    loadAttempts();
  }, [examId]);

  const duplicateValues = useMemo(() => {
    const values = (key: 'ip_address' | 'device_fingerprint') => {
      const counts = new Map<string, Set<string>>();
      attempts.forEach((attempt) => {
        const value = attempt[key];
        if (!value) return;
        const studentIds = counts.get(value) || new Set<string>();
        if (attempt.student_id) studentIds.add(attempt.student_id);
        counts.set(value, studentIds);
      });
      return new Set([...counts].filter(([, studentIds]) => studentIds.size > 1).map(([value]) => value));
    };
    return { ips: values('ip_address'), devices: values('device_fingerprint') };
  }, [attempts]);

  // Access control should be added before exposing this page in production.
  return (
    <main className="min-h-screen bg-slate-900 px-4 py-8 text-white">
      <div className="mx-auto max-w-7xl">
        <button type="button" onClick={onBack} className="mb-5 text-sm text-slate-300 hover:text-white">Back</button>
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div><p className="text-sm font-bold uppercase tracking-[0.2em] text-lime-300">Admin monitoring</p><h1 className="mt-2 text-3xl font-black">Exam attempts</h1></div>
          <select value={examId} onChange={(event) => setExamId(event.target.value)} disabled={loading && exams.length === 0} className="rounded-xl border border-white/10 bg-slate-800 px-4 py-3 text-white"><option value="">Select an exam</option>{exams.map((exam) => <option key={exam.id} value={exam.id}>{exam.title}</option>)}</select>
        </div>
        {error && <div role="alert" className="mt-6 flex gap-2 rounded-xl border border-red-400/40 bg-red-950/40 p-3 text-sm text-red-100"><AlertCircle className="h-5 w-5 shrink-0" />{error}</div>}
        <div className="mt-6 overflow-x-auto rounded-2xl border border-white/10 bg-slate-800 shadow-2xl">
          {loading ? <div className="flex justify-center p-12"><Loader2 className="h-7 w-7 animate-spin text-lime-300" /></div> : <table className="min-w-full text-left text-sm"><thead className="border-b border-white/10 text-xs uppercase tracking-wider text-slate-400"><tr><th className="px-4 py-4">Student</th><th className="px-4 py-4">Contact</th><th className="px-4 py-4">Started</th><th className="px-4 py-4">IP address</th><th className="px-4 py-4">Device</th><th className="px-4 py-4">Status</th></tr></thead><tbody className="divide-y divide-white/10">{attempts.map((attempt) => { const duplicate = (!!attempt.ip_address && duplicateValues.ips.has(attempt.ip_address)) || (!!attempt.device_fingerprint && duplicateValues.devices.has(attempt.device_fingerprint)); const student = attempt.students; return <tr key={attempt.id} className={duplicate ? 'bg-red-950/40' : ''}><td className="px-4 py-4"><p className="font-semibold">{student?.full_name || 'Unknown student'}</p><p className="text-xs text-slate-400">{student?.school || 'School unavailable'}</p></td><td className="px-4 py-4"><p>{student?.gmail || '-'}</p><p className="text-xs text-slate-400">{student?.whatsapp_number || '-'}</p></td><td className="whitespace-nowrap px-4 py-4 text-slate-300">{new Date(attempt.started_at).toLocaleString()}</td><td className="px-4 py-4 font-mono text-xs">{attempt.ip_address || 'Unavailable'}</td><td className="max-w-40 truncate px-4 py-4 font-mono text-xs">{attempt.device_fingerprint || 'Unavailable'}</td><td className="px-4 py-4">{duplicate ? <span className="inline-flex items-center gap-1 rounded-full bg-red-500/20 px-2.5 py-1 text-xs font-semibold text-red-200"><ShieldAlert className="h-3.5 w-3.5" />Possible duplicate</span> : <span className="text-slate-400">Normal</span>}</td></tr>; })}</tbody></table>}
          {!loading && !error && attempts.length === 0 && <p className="p-10 text-center text-slate-400">No attempts for this exam.</p>}
        </div>
      </div>
    </main>
  );
}