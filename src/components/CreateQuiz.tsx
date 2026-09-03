import { useState } from 'react';
import { supabase, type Quiz } from '@/lib/supabase';
import { ArrowLeft, Plus, Save, Loader2, CheckCircle2, Trash2, Copy } from 'lucide-react';

type QuestionDraft = {
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_answer: 'A' | 'B' | 'C' | 'D';
};

const emptyQuestion = (): QuestionDraft => ({
  question_text: '',
  option_a: '',
  option_b: '',
  option_c: '',
  option_d: '',
  correct_answer: 'A',
});

const DEFAULT_QUESTIONS = 40;

type Props = {
  onBack: () => void;
  onSaved: () => void;
};

export default function CreateQuiz({ onBack, onSaved }: Props) {
  const [step, setStep] = useState<'details' | 'questions'>('details');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [quizDate, setQuizDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [questions, setQuestions] = useState<QuestionDraft[]>(
    Array.from({ length: DEFAULT_QUESTIONS }, emptyQuestion)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdQuiz, setCreatedQuiz] = useState<Quiz | null>(null);

  const handleDetailsNext = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !quizDate || !startTime || !endTime) {
      setError('Please fill in title, date, start time, and end time.');
      return;
    }
    if (new Date(startTime) >= new Date(endTime)) {
      setError('End time must be after start time.');
      return;
    }
    setError(null);
    setStep('questions');
  };

  const updateQuestion = (idx: number, field: keyof QuestionDraft, value: string) => {
    setQuestions((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const addQuestion = () => {
    setQuestions((prev) => [...prev, emptyQuestion()]);
  };

  const removeQuestion = (idx: number) => {
    setQuestions((prev) => prev.filter((_, i) => i !== idx));
  };

  const duplicateQuestion = (idx: number) => {
    setQuestions((prev) => {
      const next = [...prev];
      next.splice(idx + 1, 0, { ...prev[idx] });
      return next;
    });
  };

  const handleSave = async () => {
    setError(null);
    const validQuestions = questions.filter((q) => q.question_text.trim());
    if (validQuestions.length === 0) {
      setError('Please add at least one question.');
      return;
    }
    for (let i = 0; i < validQuestions.length; i++) {
      const q = validQuestions[i];
      if (!q.option_a.trim() || !q.option_b.trim() || !q.option_c.trim() || !q.option_d.trim()) {
        setError(`Question ${i + 1} is missing one or more options.`);
        return;
      }
    }

    setSaving(true);
    try {
      const { data: quizData, error: quizError } = await supabase
        .from('quizzes')
        .insert({
          title: title.trim(),
          description: description.trim(),
          quiz_date: quizDate,
          start_time: new Date(startTime).toISOString(),
          end_time: new Date(endTime).toISOString(),
        })
        .select()
        .single();

      if (quizError) throw new Error(quizError.message);

      const rows = validQuestions.map((q, i) => ({
        quiz_id: (quizData as Quiz).id,
        question_number: i + 1,
        question_text: q.question_text.trim(),
        option_a: q.option_a.trim(),
        option_b: q.option_b.trim(),
        option_c: q.option_c.trim(),
        option_d: q.option_d.trim(),
        correct_answer: q.correct_answer,
      }));

      const { error: qError } = await supabase.from('questions').insert(rows);
      if (qError) throw new Error(qError.message);

      setCreatedQuiz(quizData as Quiz);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save quiz');
    } finally {
      setSaving(false);
    }
  };

  if (createdQuiz) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Quiz Created!</h2>
          <p className="text-slate-600 mb-6">
            "{createdQuiz.title}" with {questions.filter((q) => q.question_text.trim()).length}{' '}
            questions has been saved and is ready for students.
          </p>
          <button
            onClick={onSaved}
            className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-6 py-3 rounded-xl transition"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-4">
          <button
            onClick={onBack}
            className="p-2 hover:bg-slate-100 rounded-lg transition"
          >
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </button>
          <h1 className="text-lg font-bold text-slate-900">
            {step === 'details' ? 'Create New Quiz' : 'Add Questions'}
          </h1>
          <div className="ml-auto flex items-center gap-2 text-sm">
            <span className={step === 'details' ? 'text-blue-600 font-semibold' : 'text-slate-400'}>
              1. Details
            </span>
            <span className="text-slate-300">→</span>
            <span className={step === 'questions' ? 'text-blue-600 font-semibold' : 'text-slate-400'}>
              2. Questions
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-sm mb-4">
            {error}
          </div>
        )}

        {step === 'details' ? (
          <form onSubmit={handleDetailsNext} className="space-y-5 max-w-2xl">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Quiz Title</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Weekly Quiz - Sunday, August 31"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Description (optional)
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="A brief description of this quiz"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Quiz Date</label>
              <input
                type="date"
                required
                value={quizDate}
                onChange={(e) => setQuizDate(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Start Time
                </label>
                <input
                  type="datetime-local"
                  required
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  End Time
                </label>
                <input
                  type="datetime-local"
                  required
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
            <p className="text-sm text-slate-500">
              The quiz will be accessible to students only between the start and end times above.
              Students get 40 minutes from when they start, but the quiz window itself closes at the
              end time.
            </p>
            <button
              type="submit"
              className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-6 py-3 rounded-xl transition"
            >
              Next: Add Questions →
            </button>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <p className="text-sm text-slate-600">
                {questions.filter((q) => q.question_text.trim()).length} of {questions.length}{' '}
                questions filled in
              </p>
              <button
                onClick={addQuestion}
                className="flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-500 transition"
              >
                <Plus className="w-4 h-4" /> Add Question
              </button>
            </div>

            {questions.map((q, idx) => (
              <div
                key={idx}
                className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm"
              >
                <div className="flex items-start gap-3 mb-4">
                  <span className="flex-shrink-0 w-8 h-8 bg-slate-100 text-slate-700 rounded-lg flex items-center justify-center text-sm font-semibold">
                    {idx + 1}
                  </span>
                  <textarea
                    value={q.question_text}
                    onChange={(e) => updateQuestion(idx, 'question_text', e.target.value)}
                    rows={2}
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                    placeholder={`Question ${idx + 1} text...`}
                  />
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => duplicateQuestion(idx)}
                      title="Duplicate question"
                      className="p-1.5 hover:bg-slate-100 rounded-lg transition"
                    >
                      <Copy className="w-4 h-4 text-slate-400" />
                    </button>
                    {questions.length > 1 && (
                      <button
                        onClick={() => removeQuestion(idx)}
                        title="Remove question"
                        className="p-1.5 hover:bg-red-50 rounded-lg transition"
                      >
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 ml-11">
                  {(['A', 'B', 'C', 'D'] as const).map((letter) => (
                    <div key={letter} className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => updateQuestion(idx, 'correct_answer', letter)}
                        className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold transition ${
                          q.correct_answer === letter
                            ? 'bg-green-500 text-white'
                            : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                        }`}
                        title="Mark as correct answer"
                      >
                        {letter}
                      </button>
                      <input
                        type="text"
                        value={q[`option_${letter.toLowerCase()}` as keyof QuestionDraft]}
                        onChange={(e) =>
                          updateQuestion(idx, `option_${letter.toLowerCase()}` as keyof QuestionDraft, e.target.value)
                        }
                        className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder={`Option ${letter}`}
                      />
                    </div>
                  ))}
                </div>
                <p className="ml-11 mt-2 text-xs text-slate-400">
                  Click the letter button to mark the correct answer. Green = correct.
                </p>
              </div>
            ))}

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() => setStep('details')}
                className="px-5 py-3 rounded-xl border border-slate-300 text-slate-700 font-medium hover:bg-slate-100 transition"
              >
                ← Back
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 sm:flex-none bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold px-6 py-3 rounded-xl transition flex items-center justify-center gap-2"
              >
                {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                {saving ? 'Saving...' : 'Save Quiz'}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
