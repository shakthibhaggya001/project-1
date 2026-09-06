import { CheckCircle2 } from 'lucide-react';
import type { Exam, ExamAttempt } from '@/types';

type Props = { exam: Exam; attempt: ExamAttempt; onBack: () => void };

export default function ExamAttemptStarted({ exam, attempt, onBack }: Props) {
  return (
    <main className="min-h-screen bg-slate-900 px-4 py-8 text-white">
      <div className="mx-auto max-w-xl rounded-[2rem] border border-white/10 bg-slate-800 p-8 text-center shadow-2xl">
        <CheckCircle2 className="mx-auto h-14 w-14 text-lime-300" />
        <h1 className="mt-5 text-3xl font-black">{exam.exam_name} is ready</h1>
        <p className="mt-3 text-slate-300">Your attempt has been created and is reserved for this exam.</p>
        <p className="mt-6 rounded-xl bg-slate-900 p-3 text-left font-mono text-xs text-slate-400">Attempt ID: {attempt.id}</p>
        <button type="button" onClick={onBack} className="mt-6 rounded-xl bg-blue-600 px-5 py-3 font-semibold">Return home</button>
      </div>
    </main>
  );
}