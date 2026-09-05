import { useEffect, useState, useCallback } from 'react';
import { supabase, type Quiz, type Submission } from '@/lib/supabase';
import { getQuizStatus, formatDate, formatTimeOfDay, formatDuration, downloadCSV, toLocalDateTimeInput } from '@/lib/utils';
import {
  Plus,
  LogOut,
  Brain,
  Users,
  Clock,
  CheckCircle2,
  Loader2,
  Trophy,
  Medal,
  Award,
  Download,
  BarChart3,
  ChevronRight,
  Pencil,
  Trash2,
  Save,
  AlertTriangle,
  FileCheck,
  Send,
  Eye,
  Image as ImageIcon,
  Copy,
} from 'lucide-react';

type Props = {
  onCreateQuiz: () => void;
  onSiteSettings: () => void;
  onEditPaper: (quiz: Quiz) => void;
  onSignOut: () => void;
};

type Top10Student = {
  id: string;
  rank: number;
  student_name: string;
  school_name: string;
  grade: number | null;
  whatsapp_number: string;
  score: number;
  photo_url: string;
};

export default function AdminDashboard({ onCreateQuiz, onSiteSettings, onEditPaper, onSignOut }: Props) {
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedQuiz, setSelectedQuiz] = useState<Quiz | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [subCount, setSubCount] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [unpublishing, setUnpublishing] = useState(false);
  const [actionResult, setActionResult] = useState<string | null>(null);
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);
  const [showUnpublishConfirm, setShowUnpublishConfirm] = useState(false);
  const [editingQuiz, setEditingQuiz] = useState<Quiz | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editQuizDate, setEditQuizDate] = useState('');
  const [editStartTime, setEditStartTime] = useState('');
  const [editEndTime, setEditEndTime] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deletingQuiz, setDeletingQuiz] = useState<Quiz | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [top10Data, setTop10Data] = useState<Top10Student[]>([]);
  const [top10Loading, setTop10Loading] = useState(false);
  const [activeTab, setActiveTab] = useState<'results' | 'top10-photos'>('results');
  const [duplicating, setDuplicating] = useState(false);
  const [questionCounts, setQuestionCounts] = useState<Record<string, number>>({});

  const fetchQuizzes = useCallback(async () => {
    setLoadError(null);
    const { data, error } = await supabase
      .from('quizzes')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      console.error(error);

      const isAuthError = /jwt|token|expired|session|unauthorized|not authenticated/i.test(error.message);
      if (isAuthError) {
        await supabase.auth.signOut();
        setLoadError('Your session has expired. Please sign in again.');
        setLoading(false);
        return;
      }

      setLoadError(error.message);
      setLoading(false);
      return;
    }
    setQuizzes((data as Quiz[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchQuizzes();
  }, [fetchQuizzes]);

  // Fetch question counts for all quizzes
  useEffect(() => {
    if (quizzes.length === 0) return;
    (async () => {
      const counts: Record<string, number> = {};
      for (const quiz of quizzes) {
        const { data } = await supabase.rpc('get_quiz_question_count', { p_quiz_id: quiz.id });
        counts[quiz.id] = (data as number) || 0;
      }
      setQuestionCounts(counts);
    })();
  }, [quizzes]);

  const fetchSubmissions = useCallback(async (quizId: string) => {
    const { count, error: countErr } = await supabase
      .from('submissions')
      .select('*', { count: 'exact', head: true })
      .eq('quiz_id', quizId);
    if (!countErr) setSubCount(count || 0);

    const { data, error } = await supabase
      .from('submissions')
      .select('*')
      .eq('quiz_id', quizId)
      .order('rank', { ascending: true, nullsFirst: false });
    if (!error && data) {
      setSubmissions(data as Submission[]);
    }
  }, []);

  const fetchTop10 = useCallback(async (quizId: string) => {
    setTop10Loading(true);
    const { data, error } = await supabase.rpc('get_published_top10', {
      p_quiz_id: quizId,
    });
    if (!error && data) {
      setTop10Data(data as Top10Student[]);
    } else {
      setTop10Data([]);
    }
    setTop10Loading(false);
  }, []);

  useEffect(() => {
    if (!selectedQuiz) return;
    fetchSubmissions(selectedQuiz.id);
    const interval = setInterval(() => fetchSubmissions(selectedQuiz.id), 5000);
    return () => clearInterval(interval);
  }, [selectedQuiz, fetchSubmissions]);

  useEffect(() => {
    if (selectedQuiz?.results_published && activeTab === 'top10-photos') {
      fetchTop10(selectedQuiz.id);
    }
  }, [selectedQuiz, activeTab, fetchTop10]);

  const refreshSelectedQuiz = useCallback(async () => {
    const { data } = await supabase
      .from('quizzes')
      .select('*')
      .eq('id', selectedQuiz!.id)
      .single();
    if (data) {
      setSelectedQuiz(data as Quiz);
      setQuizzes((prev) => prev.map((q) => (q.id === data.id ? data as Quiz : q)));
    }
  }, [selectedQuiz]);

  const handleGenerate = async () => {
    if (!selectedQuiz) return;
    setGenerating(true);
    setActionResult(null);
    try {
      const { data, error } = await supabase.rpc('generate_quiz_results', {
        p_quiz_id: selectedQuiz.id,
      });
      if (error) throw error;
      const result = data as { total_participants: number; top_score: number; error?: string };
      if (result.error) {
        setActionResult(`Error: ${result.error}`);
      } else {
        setActionResult(
          `Results generated! ${result.total_participants} participants scored. Top score: ${result.top_score}.`
        );
        await fetchSubmissions(selectedQuiz.id);
        await refreshSelectedQuiz();
      }
    } catch (err) {
      const message = err instanceof Error
        ? err.message
        : typeof err === 'object' && err !== null && 'message' in err
        ? String((err as { message?: unknown }).message)
        : 'Failed to generate results';
      setActionResult(`Error: ${message}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleConfirm = async () => {
    if (!selectedQuiz) return;
    setConfirming(true);
    setActionResult(null);
    try {
      const { data, error } = await supabase.rpc('confirm_quiz_results', {
        p_quiz_id: selectedQuiz.id,
      });
      if (error) throw error;
      const result = data as { ok?: boolean; error?: string };
      if (result.error) {
        setActionResult(`Error: ${result.error}`);
      } else {
        setActionResult('Results confirmed. You can now publish them.');
        await refreshSelectedQuiz();
      }
    } catch (err) {
      const message = err instanceof Error
        ? err.message
        : typeof err === 'object' && err !== null && 'message' in err
        ? String((err as { message?: unknown }).message)
        : 'Failed to confirm results';
      setActionResult(`Error: ${message}`);
    } finally {
      setConfirming(false);
    }
  };

  const handlePublish = async () => {
    setShowPublishConfirm(false);
    if (!selectedQuiz) return;
    setPublishing(true);
    setActionResult(null);
    try {
      const { data, error } = await supabase.rpc('publish_quiz_results', {
        p_quiz_id: selectedQuiz.id,
      });
      if (error) throw error;
      const result = data as { ok?: boolean; error?: string };
      if (result.error) {
        setActionResult(`Error: ${result.error}`);
      } else {
        setActionResult('Results published! Students can now view their results.');
        await refreshSelectedQuiz();
        await fetchSubmissions(selectedQuiz.id);
      }
    } catch (err) {
      setActionResult(`Error: ${err instanceof Error ? err.message : 'Failed to publish results'}`);
    } finally {
      setPublishing(false);
    }
  };

  const handleUnpublish = async () => {
    setShowUnpublishConfirm(false);
    if (!selectedQuiz) return;
    setUnpublishing(true);
    setActionResult(null);
    try {
      const { error } = await supabase.rpc('unpublish_quiz_results', {
        p_quiz_id: selectedQuiz.id,
      });
      if (error) throw error;
      setActionResult('Results unpublished. Students can no longer view results.');
      await refreshSelectedQuiz();
    } catch (err) {
      setActionResult(`Error: ${err instanceof Error ? err.message : 'Failed to unpublish results'}`);
    } finally {
      setUnpublishing(false);
    }
  };

  const handleExportCSV = () => {
    const rows = submissions.map((s) => ({
      Rank: s.rank ?? '',
      Name: s.student_name,
      Grade: s.grade ?? '',
      School: s.school_name,
      WhatsApp: s.whatsapp_number,
      Score: s.score,
      'Time Taken': formatDuration(s.time_taken_seconds),
      'Submitted At': new Date(s.submitted_at).toLocaleString(),
    }));
    downloadCSV(`${selectedQuiz?.title || 'quiz'}-results.csv`, rows);
  };

  const handleExportTop10CSV = () => {
    const rows = top10Data.map((s) => ({
      Rank: s.rank,
      Name: s.student_name,
      School: s.school_name,
      Grade: s.grade ?? '',
      Score: s.score,
      WhatsApp: s.whatsapp_number,
      'Photo URL': s.photo_url || 'No photo uploaded',
    }));
    downloadCSV(`${selectedQuiz?.title || 'quiz'}-top10.csv`, rows);
  };

  const handleDownloadPhoto = async (student: Top10Student) => {
    if (!student.photo_url) return;
    try {
      const response = await fetch(student.photo_url);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const safeName = student.student_name.replace(/[^a-zA-Z0-9]/g, '_');
      const ext = student.photo_url.split('.').pop()?.split('?')[0] || 'jpg';
      link.download = `Rank${student.rank}_${safeName}.${ext}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch {
      window.open(student.photo_url, '_blank');
    }
  };

  const handleDownloadAllPhotos = async () => {
    const withPhotos = top10Data.filter((s) => s.photo_url);
    for (const student of withPhotos) {
      await handleDownloadPhoto(student);
    }
  };

  const startEdit = (quiz: Quiz) => {
    setEditingQuiz(quiz);
    setEditTitle(quiz.title);
    setEditDescription(quiz.description || '');
    setEditQuizDate(quiz.quiz_date);
    setEditStartTime(toLocalDateTimeInput(quiz.start_time));
    setEditEndTime(toLocalDateTimeInput(quiz.end_time));
    setEditError(null);
  };

  const handleSaveEdit = async () => {
    if (!editingQuiz) return;
    setEditError(null);
    if (!editTitle.trim() || !editQuizDate || !editStartTime || !editEndTime) {
      setEditError('Please fill in all required fields.');
      return;
    }
    if (new Date(editStartTime) >= new Date(editEndTime)) {
      setEditError('End time must be after start time.');
      return;
    }
    setSavingEdit(true);
    try {
      const { error } = await supabase
        .from('quizzes')
        .update({
          title: editTitle.trim(),
          description: editDescription.trim(),
          quiz_date: editQuizDate,
          start_time: new Date(editStartTime).toISOString(),
          end_time: new Date(editEndTime).toISOString(),
        })
        .eq('id', editingQuiz.id);
      if (error) throw new Error(error.message);
      await fetchQuizzes();
      if (selectedQuiz && selectedQuiz.id === editingQuiz.id) {
        setSelectedQuiz({
          ...editingQuiz,
          title: editTitle.trim(),
          description: editDescription.trim(),
          quiz_date: editQuizDate,
          start_time: new Date(editStartTime).toISOString(),
          end_time: new Date(editEndTime).toISOString(),
        });
      }
      setEditingQuiz(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDuplicate = async (quiz: Quiz) => {
    setDuplicating(true);
    try {
      const { data, error } = await supabase.rpc('duplicate_quiz', {
        p_source_quiz_id: quiz.id,
        p_new_title: quiz.title + ' (Copy)',
      });
      if (error) throw new Error(error.message);
      const result = data as { ok?: boolean; error?: string; new_quiz_id?: string };
      if (result.error) {
        setEditError(result.error);
      } else {
        await fetchQuizzes();
        setActionResult(`Paper duplicated! ${result.new_quiz_id ? 'New paper created.' : ''}`);
      }
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to duplicate paper');
    } finally {
      setDuplicating(false);
    }
  };

  const handleDeleteQuiz = async () => {
    if (!deletingQuiz) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from('quizzes').delete().eq('id', deletingQuiz.id);
      if (error) throw new Error(error.message);
      if (selectedQuiz && selectedQuiz.id === deletingQuiz.id) {
        setSelectedQuiz(null);
        setSubmissions([]);
        setSubCount(0);
      }
      setDeletingQuiz(null);
      await fetchQuizzes();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to delete quiz');
    } finally {
      setDeleting(false);
    }
  };

  const top10 = submissions.filter((s) => s.rank !== null && s.rank <= 10).sort((a, b) => (a.rank! - b.rank!));
  const top50 = submissions.filter((s) => s.rank !== null && s.rank <= 50).sort((a, b) => (a.rank! - b.rank!));
  const scoredCount = submissions.filter((s) => s.rank !== null).length;

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-lg rounded-2xl border border-red-200 bg-white p-6 text-center shadow-sm">
          <AlertTriangle className="mx-auto h-8 w-8 text-red-500" />
          <h1 className="mt-3 text-lg font-bold text-slate-900">Unable to load quizzes</h1>
          <p className="mt-2 text-sm text-slate-600">{loadError}</p>
          <button
            onClick={fetchQuizzes}
            className="mt-4 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  // ---- Quiz Detail View ----
  if (selectedQuiz) {
    const status = getQuizStatus(selectedQuiz);
    return (
      <div className="min-h-screen bg-slate-50">
        <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
          <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-3">
            <button
              onClick={() => {
                setSelectedQuiz(null);
                setSubmissions([]);
                setSubCount(0);
                setActionResult(null);
                setTop10Data([]);
                setActiveTab('results');
              }}
              className="text-sm text-slate-600 hover:text-slate-900 transition"
            >
              ← Dashboard
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onEditPaper(selectedQuiz)}
                className="flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-500 transition px-3 py-1.5 rounded-lg hover:bg-blue-50"
              >
                <Pencil className="w-4 h-4" /> Edit Questions
              </button>
              <button
                onClick={() => handleDuplicate(selectedQuiz)}
                disabled={duplicating}
                className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 transition px-3 py-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-50"
              >
                <Copy className="w-4 h-4" /> Duplicate
              </button>
              <button
                onClick={() => startEdit(selectedQuiz)}
                className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 transition px-3 py-1.5 rounded-lg hover:bg-slate-100"
              >
                <Clock className="w-4 h-4" /> Edit Schedule
              </button>
              <button
                onClick={() => setDeletingQuiz(selectedQuiz)}
                className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-red-600 transition px-3 py-1.5 rounded-lg hover:bg-red-50"
              >
                <Trash2 className="w-4 h-4" /> Delete
              </button>
              <StatusBadge status={status} published={selectedQuiz.results_published} />
            </div>
          </div>
        </header>

        <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
          {/* Quiz Info */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <h2 className="text-xl font-bold text-slate-900">{selectedQuiz.title}</h2>
            {selectedQuiz.description && (
              <p className="text-slate-600 mt-1">{selectedQuiz.description}</p>
            )}
            <div className="flex flex-wrap gap-4 mt-3 text-sm text-slate-500">
              <span className="flex items-center gap-1.5">
                <CalendarIcon /> {formatDate(selectedQuiz.start_time)}
              </span>
              <span className="flex items-center gap-1.5">
                <Clock className="w-4 h-4" /> {formatTimeOfDay(selectedQuiz.start_time)} –{' '}
                {formatTimeOfDay(selectedQuiz.end_time)}
              </span>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard icon={Users} label="Submissions" value={subCount} color="blue" />
            <StatCard icon={FileCheck} label="Scored" value={scoredCount} color="green" />
            <StatCard
              icon={BarChart3}
              label="Avg Score"
              value={
                submissions.length > 0
                  ? (submissions.reduce((a, s) => a + s.score, 0) / submissions.length).toFixed(1)
                  : '-'
              }
              color="green"
            />
            <StatCard
              icon={Trophy}
              label="Top Score"
              value={submissions.length > 0 ? Math.max(...submissions.map((s) => s.score)) : '-'}
              color="amber"
            />
          </div>

          {/* Result Publication Status */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <h3 className="font-semibold text-slate-900 mb-4">Result Publication Workflow</h3>
            <div className="flex flex-wrap items-center gap-3 mb-5">
              <WorkflowStep
                label="Generated"
                done={selectedQuiz.results_generated}
                active={!selectedQuiz.results_generated}
              />
              <WorkflowArrow />
              <WorkflowStep
                label="Confirmed"
                done={selectedQuiz.results_confirmed}
                active={selectedQuiz.results_generated && !selectedQuiz.results_confirmed}
              />
              <WorkflowArrow />
              <WorkflowStep
                label="Published"
                done={selectedQuiz.results_published}
                active={selectedQuiz.results_confirmed && !selectedQuiz.results_published}
              />
            </div>

            <div className="flex flex-wrap gap-3">
              {/* Generate */}
              <button
                onClick={handleGenerate}
                disabled={generating || subCount === 0}
                className={`flex items-center gap-2 font-semibold px-5 py-2.5 rounded-xl transition disabled:opacity-50 ${
                  selectedQuiz.results_generated
                    ? 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    : 'bg-blue-600 hover:bg-blue-500 text-white'
                }`}
              >
                {generating ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                {generating ? 'Generating...' : selectedQuiz.results_generated ? 'Regenerate Results' : 'Generate Results'}
              </button>

              {/* Confirm */}
              <button
                onClick={handleConfirm}
                disabled={confirming || !selectedQuiz.results_generated || selectedQuiz.results_confirmed}
                className={`flex items-center gap-2 font-semibold px-5 py-2.5 rounded-xl transition disabled:opacity-50 ${
                  selectedQuiz.results_confirmed
                    ? 'bg-slate-100 text-slate-600'
                    : 'bg-amber-600 hover:bg-amber-500 text-white'
                }`}
              >
                {confirming ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileCheck className="w-5 h-5" />}
                {selectedQuiz.results_confirmed ? 'Confirmed' : 'Confirm Results'}
              </button>

              {/* Publish */}
              <button
                onClick={() => setShowPublishConfirm(true)}
                disabled={publishing || !selectedQuiz.results_confirmed || selectedQuiz.results_published}
                className={`flex items-center gap-2 font-semibold px-5 py-2.5 rounded-xl transition disabled:opacity-50 ${
                  selectedQuiz.results_published
                    ? 'bg-slate-100 text-slate-600'
                    : 'bg-green-600 hover:bg-green-500 text-white'
                }`}
              >
                <Send className="w-5 h-5" />
                {selectedQuiz.results_published ? 'Published' : 'Publish Results'}
              </button>

              {/* Unpublish */}
              {selectedQuiz.results_published && (
                <button
                  onClick={() => setShowUnpublishConfirm(true)}
                  disabled={unpublishing}
                  className="flex items-center gap-2 font-semibold px-5 py-2.5 rounded-xl transition disabled:opacity-50 bg-red-50 text-red-600 hover:bg-red-100 border border-red-200"
                >
                  {unpublishing ? <Loader2 className="w-5 h-5 animate-spin" /> : <AlertTriangle className="w-5 h-5" />}
                  Unpublish
                </button>
              )}
            </div>

            {actionResult && (
              <p className="mt-4 text-sm text-slate-700 bg-slate-50 rounded-lg px-3 py-2 border border-slate-200">
                {actionResult}
              </p>
            )}
          </div>

          {/* Tabs */}
          {selectedQuiz.results_published && (
            <div className="flex gap-2 border-b border-slate-200">
              <button
                onClick={() => setActiveTab('results')}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition ${
                  activeTab === 'results'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <BarChart3 className="w-4 h-4" /> Results
              </button>
              <button
                onClick={() => setActiveTab('top10-photos')}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition ${
                  activeTab === 'top10-photos'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <ImageIcon className="w-4 h-4" /> Top 10 Photos
              </button>
            </div>
          )}

          {/* Results Tab */}
          {selectedQuiz.results_published && activeTab === 'results' && (
            <>
              {/* Export */}
              {submissions.length > 0 && (
                <button
                  onClick={handleExportCSV}
                  className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white font-medium px-5 py-2.5 rounded-xl transition"
                >
                  <Download className="w-5 h-5" /> Export Full Results (CSV)
                </button>
              )}

              {/* Top 10 */}
              {top10.length > 0 && (
                <div>
                  <h3 className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2">
                    <Award className="w-5 h-5 text-amber-500" /> Top 10
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {top10.map((s) => (
                      <div
                        key={s.id}
                        className={`flex items-center gap-3 bg-white border rounded-2xl p-4 ${
                          s.rank === 1
                            ? 'border-amber-300 bg-amber-50'
                            : s.rank === 2
                            ? 'border-slate-300 bg-slate-50'
                            : s.rank === 3
                            ? 'border-orange-200 bg-orange-50'
                            : 'border-slate-200'
                        }`}
                      >
                        <span
                          className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center font-bold ${
                            s.rank === 1
                              ? 'bg-amber-400 text-white'
                              : s.rank === 2
                              ? 'bg-slate-400 text-white'
                              : s.rank === 3
                              ? 'bg-orange-400 text-white'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {s.rank}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-slate-900 truncate">{s.student_name}</p>
                          <p className="text-sm text-slate-500">
                            Score: {s.score}/40 • {formatDuration(s.time_taken_seconds)}
                          </p>
                        </div>
                        {s.rank === 1 && <Trophy className="w-5 h-5 text-amber-500" />}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Top 50 */}
              {top50.length > 0 && (
                <div>
                  <h3 className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2">
                    <Medal className="w-5 h-5 text-blue-500" /> Top 50
                  </h3>
                  <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-slate-600">
                        <tr>
                          <th className="text-left px-4 py-3 font-medium">Rank</th>
                          <th className="text-left px-4 py-3 font-medium">Name</th>
                          <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Grade</th>
                          <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">School</th>
                          <th className="text-right px-4 py-3 font-medium">Score</th>
                          <th className="text-right px-4 py-3 font-medium hidden sm:table-cell">Time</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {top50.map((s) => (
                          <tr key={s.id} className="hover:bg-slate-50 transition">
                            <td className="px-4 py-3 font-semibold text-slate-900">{s.rank}</td>
                            <td className="px-4 py-3 text-slate-900">{s.student_name}</td>
                            <td className="px-4 py-3 text-slate-500 hidden sm:table-cell">
                              {s.grade ?? '-'}
                            </td>
                            <td className="px-4 py-3 text-slate-500 hidden sm:table-cell">
                              {s.school_name || '-'}
                            </td>
                            <td className="px-4 py-3 text-right font-medium text-slate-900">{s.score}/40</td>
                            <td className="px-4 py-3 text-right text-slate-500 hidden sm:table-cell">
                              {formatDuration(s.time_taken_seconds)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Full Results */}
              {submissions.length > 0 && (
                <div>
                  <h3 className="text-lg font-bold text-slate-900 mb-3">All Participants ({submissions.length})</h3>
                  <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-slate-600">
                        <tr>
                          <th className="text-left px-4 py-3 font-medium">Rank</th>
                          <th className="text-left px-4 py-3 font-medium">Name</th>
                          <th className="text-right px-4 py-3 font-medium">Score</th>
                          <th className="text-right px-4 py-3 font-medium hidden sm:table-cell">Time</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {submissions.map((s) => (
                          <tr key={s.id} className="hover:bg-slate-50 transition">
                            <td className="px-4 py-3 font-semibold text-slate-900">{s.rank ?? '-'}</td>
                            <td className="px-4 py-3 text-slate-900">{s.student_name}</td>
                            <td className="px-4 py-3 text-right font-medium text-slate-900">{s.score}/40</td>
                            <td className="px-4 py-3 text-right text-slate-500 hidden sm:table-cell">
                              {formatDuration(s.time_taken_seconds)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Top 10 Photos Tab */}
          {selectedQuiz.results_published && activeTab === 'top10-photos' && (
            <div>
              <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <ImageIcon className="w-5 h-5 text-amber-500" /> Top 10 Photos
                </h3>
                <div className="flex gap-2">
                  {top10Data.some((s) => s.photo_url) && (
                    <button
                      onClick={handleDownloadAllPhotos}
                      className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-medium px-4 py-2 rounded-xl transition text-sm"
                    >
                      <Download className="w-4 h-4" /> Download All Photos
                    </button>
                  )}
                  {top10Data.length > 0 && (
                    <button
                      onClick={handleExportTop10CSV}
                      className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white font-medium px-4 py-2 rounded-xl transition text-sm"
                    >
                      <Download className="w-4 h-4" /> Export Data (CSV)
                    </button>
                  )}
                </div>
              </div>

              {top10Loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                </div>
              ) : top10Data.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  <ImageIcon className="w-12 h-12 mx-auto mb-3 opacity-40" />
                  <p>No Top 10 data available. Generate and publish results first.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {top10Data.map((s) => (
                    <div
                      key={s.id}
                      className={`bg-white border rounded-2xl overflow-hidden ${
                        s.rank === 1
                          ? 'border-amber-300'
                          : s.rank === 2
                          ? 'border-slate-300'
                          : s.rank === 3
                          ? 'border-orange-200'
                          : 'border-slate-200'
                      }`}
                    >
                      {/* Photo */}
                      <div className="aspect-square bg-slate-100 flex items-center justify-center overflow-hidden">
                        {s.photo_url ? (
                          <img
                            src={s.photo_url}
                            alt={s.student_name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="text-center text-slate-400">
                            <ImageIcon className="w-12 h-12 mx-auto mb-2 opacity-40" />
                            <p className="text-sm">No photo uploaded</p>
                          </div>
                        )}
                      </div>
                      {/* Info */}
                      <div className="p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <span
                            className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm ${
                              s.rank === 1
                                ? 'bg-amber-400 text-white'
                                : s.rank === 2
                                ? 'bg-slate-400 text-white'
                                : s.rank === 3
                                ? 'bg-orange-400 text-white'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {s.rank}
                          </span>
                          <p className="font-semibold text-slate-900 truncate">{s.student_name}</p>
                        </div>
                        <p className="text-sm text-slate-500">{s.school_name || '-'}</p>
                        <p className="text-sm text-slate-500">Grade {s.grade ?? '-'}</p>
                        <p className="text-sm text-slate-500">Score: {s.score}</p>
                        <div className="flex gap-2 mt-3">
                          {s.photo_url && (
                            <button
                              onClick={() => handleDownloadPhoto(s)}
                              className="flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-500 transition px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100"
                            >
                              <Download className="w-4 h-4" /> Download
                            </button>
                          )}
                          <a
                            href={s.photo_url || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg transition ${
                              s.photo_url
                                ? 'text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200'
                                : 'text-slate-300 cursor-not-allowed bg-slate-50'
                            }`}
                          >
                            <Eye className="w-4 h-4" /> View
                          </a>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {subCount === 0 && (
            <div className="text-center py-12 text-slate-400">
              <Users className="w-12 h-12 mx-auto mb-3 opacity-40" />
              <p>No submissions yet. The count will update live as students submit.</p>
            </div>
          )}
        </main>

        {/* Publish Confirmation Dialog */}
        {showPublishConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
            <div className="bg-white rounded-2xl p-6 max-w-md w-full text-center">
              <div className="inline-flex items-center justify-center w-14 h-14 bg-green-100 rounded-2xl mb-4">
                <Send className="w-7 h-7 text-green-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">Publish Results?</h3>
              <p className="text-slate-600 text-sm mb-6">
                Are you sure you want to publish the results? After publishing, students will be able to view their results and rankings.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowPublishConfirm(false)}
                  className="flex-1 px-5 py-3 rounded-xl border border-slate-300 text-slate-700 font-medium hover:bg-slate-100 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handlePublish}
                  disabled={publishing}
                  className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-semibold px-5 py-3 rounded-xl transition"
                >
                  {publishing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                  Publish Results
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Unpublish Confirmation Dialog */}
        {showUnpublishConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
            <div className="bg-white rounded-2xl p-6 max-w-md w-full text-center">
              <div className="inline-flex items-center justify-center w-14 h-14 bg-red-100 rounded-2xl mb-4">
                <AlertTriangle className="w-7 h-7 text-red-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">Unpublish Results?</h3>
              <p className="text-slate-600 text-sm mb-6">
                Students will no longer be able to view their results. You will need to confirm and publish again to make them visible.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowUnpublishConfirm(false)}
                  className="flex-1 px-5 py-3 rounded-xl border border-slate-300 text-slate-700 font-medium hover:bg-slate-100 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUnpublish}
                  disabled={unpublishing}
                  className="flex-1 flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-semibold px-5 py-3 rounded-xl transition"
                >
                  {unpublishing ? <Loader2 className="w-5 h-5 animate-spin" /> : <AlertTriangle className="w-5 h-5" />}
                  Unpublish
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ---- Edit Modal ----
  if (editingQuiz) {
    return (
      <div className="min-h-screen bg-slate-50">
        <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
          <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
            <button
              onClick={() => setEditingQuiz(null)}
              className="text-sm text-slate-600 hover:text-slate-900 transition"
            >
              ← Cancel
            </button>
            <h1 className="text-lg font-bold text-slate-900 ml-2">Edit Schedule</h1>
          </div>
        </header>
        <main className="max-w-2xl mx-auto px-4 py-6">
          {editError && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-sm mb-4">
              {editError}
            </div>
          )}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Paper Title</label>
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Description</label>
              <textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={2}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Paper Date</label>
              <input
                type="date"
                value={editQuizDate}
                onChange={(e) => setEditQuizDate(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Start Time</label>
                <input
                  type="datetime-local"
                  value={editStartTime}
                  onChange={(e) => setEditStartTime(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">End Time</label>
                <input
                  type="datetime-local"
                  value={editEndTime}
                  onChange={(e) => setEditEndTime(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
            <button
              onClick={handleSaveEdit}
              disabled={savingEdit}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold px-6 py-3 rounded-xl transition"
            >
              {savingEdit ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
              {savingEdit ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </main>
      </div>
    );
  }

  // ---- Delete Confirmation Modal ----
  if (deletingQuiz) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-6 max-w-md w-full text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-red-100 rounded-2xl mb-4">
            <AlertTriangle className="w-7 h-7 text-red-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Delete this paper?</h2>
          <p className="text-slate-600 mb-1">
            "{deletingQuiz.title}" will be permanently deleted.
          </p>
          <p className="text-sm text-slate-500 mb-6">
            All questions and student submissions for this quiz will also be removed.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => setDeletingQuiz(null)}
              disabled={deleting}
              className="flex-1 px-5 py-3 rounded-xl border border-slate-300 text-slate-700 font-medium hover:bg-slate-100 transition"
            >
              Cancel
            </button>
            <button
              onClick={handleDeleteQuiz}
              disabled={deleting}
              className="flex-1 flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-semibold px-5 py-3 rounded-xl transition"
            >
              {deleting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 className="w-5 h-5" />}
              {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Dashboard List ----
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Brain className="w-6 h-6 text-blue-600" />
            <span className="font-bold text-slate-900">Quiz Admin</span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <button
              onClick={onSiteSettings}
              className="flex items-center gap-1.5 text-slate-600 hover:text-slate-900 text-sm transition"
            >
              <Pencil className="w-4 h-4" /> Site Settings
            </button>
            <button
              onClick={onCreateQuiz}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm px-4 py-2 rounded-xl transition"
            >
              <Plus className="w-4 h-4" /> New Paper
            </button>
            <button
              onClick={onSignOut}
              className="flex items-center gap-1.5 text-slate-500 hover:text-slate-900 text-sm transition"
            >
              <LogOut className="w-4 h-4" /> Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Papers</h1>
        <p className="text-slate-500 mb-6">Manage your exam papers and questions</p>

        {quizzes.length === 0 ? (
          <div className="text-center py-16 bg-white border border-slate-200 rounded-2xl">
            <Brain className="w-12 h-12 mx-auto mb-3 text-slate-300" />
            <p className="text-slate-500 mb-4">No papers yet. Create your first one!</p>
            <button
              onClick={onCreateQuiz}
              className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white font-medium px-5 py-2.5 rounded-xl transition"
            >
              <Plus className="w-4 h-4" /> Create Paper
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {quizzes.map((quiz) => {
              const status = getQuizStatus(quiz);
              const qCount = questionCounts[quiz.id] ?? 0;
              return (
                <div
                  key={quiz.id}
                  className="w-full text-left bg-white border border-slate-200 rounded-2xl p-5 hover:border-blue-300 hover:shadow-md transition group"
                >
                  <div className="flex items-center justify-between gap-4">
                    <button
                      onClick={() => setSelectedQuiz(quiz)}
                      className="min-w-0 flex-1"
                    >
                      <h3 className="font-semibold text-slate-900 group-hover:text-blue-600 transition text-left">
                        {quiz.title}
                      </h3>
                      <div className="flex flex-wrap gap-3 mt-1.5 text-sm text-slate-500">
                        <span>{formatDate(quiz.start_time)}</span>
                        <span>•</span>
                        <span>
                          {formatTimeOfDay(quiz.start_time)} – {formatTimeOfDay(quiz.end_time)}
                        </span>
                        <span>•</span>
                        <span className="font-medium text-slate-600">{qCount} / 40 questions</span>
                      </div>
                    </button>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => onEditPaper(quiz)}
                        className="flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-500 transition px-3 py-1.5 rounded-lg hover:bg-blue-50"
                        title="Edit questions"
                      >
                        <Pencil className="w-4 h-4" /> Edit
                      </button>
                      <button
                        onClick={() => handleDuplicate(quiz)}
                        disabled={duplicating}
                        className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 transition px-3 py-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-50"
                        title="Duplicate paper"
                      >
                        <Copy className="w-4 h-4" /> Duplicate
                      </button>
                      <button
                        onClick={() => setDeletingQuiz(quiz)}
                        className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
                        title="Delete quiz"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <StatusBadge status={status} published={quiz.results_published} />
                      <button
                        onClick={() => setSelectedQuiz(quiz)}
                        className="p-1 rounded-lg"
                        title="View results"
                      >
                        <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-blue-500 transition" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

function WorkflowStep({ label, done, active }: { label: string; done: boolean; active: boolean }) {
  return (
    <div
      className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium ${
        done
          ? 'bg-green-100 text-green-700'
          : active
          ? 'bg-blue-100 text-blue-700'
          : 'bg-slate-100 text-slate-400'
      }`}
    >
      {done ? (
        <CheckCircle2 className="w-4 h-4" />
      ) : (
        <div className={`w-4 h-4 rounded-full border-2 ${active ? 'border-blue-500' : 'border-slate-300'}`} />
      )}
      {label}
    </div>
  );
}

function WorkflowArrow() {
  return <ChevronRight className="w-4 h-4 text-slate-300" />;
}

function StatusBadge({ status, published }: { status: string; published: boolean }) {
  if (published) {
    return (
      <span className="flex items-center gap-1 text-xs font-medium bg-green-100 text-green-700 px-2.5 py-1 rounded-full">
        <CheckCircle2 className="w-3.5 h-3.5" /> Results Published
      </span>
    );
  }
  const config: Record<string, { color: string; label: string }> = {
    upcoming: { color: 'bg-slate-100 text-slate-600', label: 'Upcoming' },
    open: { color: 'bg-blue-100 text-blue-700', label: 'Live' },
    closed: { color: 'bg-orange-100 text-orange-700', label: 'Closed' },
  };
  const c = config[status] || config.upcoming;
  return (
    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${c.color}`}>
      {status === 'open' && <span className="inline-block w-1.5 h-1.5 bg-blue-500 rounded-full mr-1 animate-pulse" />}
      {c.label}
    </span>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof Users;
  label: string;
  value: number | string;
  color: 'blue' | 'green' | 'amber';
}) {
  const colors = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    amber: 'bg-amber-50 text-amber-600',
  };
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-2 ${colors[color]}`}>
        <Icon className="w-5 h-5" />
      </div>
      <p className="text-2xl font-bold text-slate-900">{value}</p>
      <p className="text-sm text-slate-500">{label}</p>
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}
