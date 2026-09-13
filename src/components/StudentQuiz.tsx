import { useEffect, useState, useRef, useCallback } from 'react';
import { supabase, type Quiz, type PublicQuestion } from '@/lib/supabase';
import type { Submission } from '@/lib/supabase';
import type { StudentEntry } from '@/types';
import { getQuizStatus, formatTime, formatCountdown, formatDate, formatTimeOfDay, isAccessible, isEnglishText, normalizePhone } from '@/lib/utils';
import { renderQuestionContent } from '@/lib/questionText';
import {
  Brain,
  Clock,
  Loader2,
  AlertCircle,
  CheckCircle2,
  User,
  Send,
  Lock,
  GraduationCap,
  School,
  Phone,
  Timer,
  ArrowRight,
  PlayCircle,
} from 'lucide-react';

const QUIZ_DURATION = 40 * 60; // 40 minutes in seconds
const PER_QUESTION_TIME = 60; // 1 minute per question in seconds

type Props = {
  onBack: () => void;
  initialQuiz?: Quiz | null;
  initialSubmission?: Submission | null;
  initialStudentEntry?: StudentEntry | null;
};

type StartResult = {
  ok?: boolean;
  error?: string;
  action?: 'new' | 'resume';
  message?: string;
  server_time?: string;
  start_time?: string;
  end_time?: string;
  effective_end_time?: string;
  submission_id?: string;
  student_id?: string;
  attempt_started_at?: string;
  saved_answers?: Record<string, string>;
};

type PublicQuestionRow = Omit<PublicQuestion, 'id' | 'quiz_id'> & {
  id: string;
  quiz_id: string;
};

// Renders a question group's shared context (e.g. "Answer questions 1-5
// based on the table below"). Supports simple pipe-delimited markdown
// tables (| Year | Event |) so admins don't need to hand-write HTML;
// anything else renders as plain paragraphs.
function parseGroupContext(content: string) {
  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
  const tableLines = lines.filter((l) => l.startsWith('|'));
  if (tableLines.length >= 2) {
    const rows = tableLines
      .filter((l) => !/^\|[\s\-:|]+\|$/.test(l))
      .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
    return { type: 'table' as const, header: rows[0] || [], body: rows.slice(1) };
  }
  return { type: 'text' as const, lines };
}

function GroupContext({ content }: { content: string }) {
  const parsed = parseGroupContext(content);
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
        Reference
      </p>
      {parsed.type === 'table' ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr>
                {parsed.header.map((cell, i) => (
                  <th
                    key={i}
                    className="border border-slate-300 bg-slate-100 px-3 py-2 text-left font-semibold text-slate-700"
                  >
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {parsed.body.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="border border-slate-300 px-3 py-2 text-slate-700">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-2 text-slate-700 text-sm leading-relaxed">
          {parsed.lines.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      )}
    </div>
  );
}

export default function StudentQuiz({ onBack, initialQuiz = null, initialSubmission = null, initialStudentEntry = null }: Props) {
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedQuiz, setSelectedQuiz] = useState<Quiz | null>(initialQuiz);
  const [questions, setQuestions] = useState<PublicQuestion[]>([]);
  const [questionsLoading, setQuestionsLoading] = useState(false);
  const [questionsError, setQuestionsError] = useState<string | null>(null);

  const [studentName, setStudentName] = useState(initialStudentEntry?.fullName || '');
  const [studentGrade, setStudentGrade] = useState<'10' | '11' | ''>(
    initialStudentEntry?.grade ? (String(initialStudentEntry.grade) as '10' | '11') : ''
  );
  const [schoolName, setSchoolName] = useState(initialStudentEntry?.school || '');
  const [whatsappNumber, setWhatsappNumber] = useState(initialStudentEntry?.whatsapp || '');
  const [joinError, setJoinError] = useState<string | null>(null);

  // Phases: select → join (info form + start) → quiz → submitted (congratulations)
  const [phase, setPhase] = useState<'select' | 'join' | 'quiz' | 'submitted'>(initialQuiz ? 'join' : 'select');
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [timeLeft, setTimeLeft] = useState(QUIZ_DURATION);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [autoSubmitted, setAutoSubmitted] = useState(false);

  // Server time state
  const [canStart, setCanStart] = useState(false);
  const [timeUntilStart, setTimeUntilStart] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);

  // Attempt tracking
  const submissionIdRef = useRef<string>('');
  const startedAtRef = useRef<string>('');
  // Guards against a slow/older questions request resolving *after* a newer
  // one and clobbering the correct question list with stale data.
  const questionsRequestIdRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const submittedRef = useRef(false);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [questionTimeLeft, setQuestionTimeLeft] = useState(PER_QUESTION_TIME);
  const overallTimeRef = useRef(QUIZ_DURATION);
  const questionTimeRef = useRef(PER_QUESTION_TIME);
  const currentIdxRef = useRef(0);
  const answersRef = useRef<Record<number, string>>({});
  const saveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadExamQuestions = async (quizId: string) => {
    const rpcResult = await supabase.rpc('get_exam_questions', { p_quiz_id: quizId });
    if (!rpcResult.error) return { data: (rpcResult.data || []) as PublicQuestion[], error: null };

    // Compatibility for databases that have not applied the secure RPC yet.
    // Never select correct_answer on this public fallback.
    const fallback = await supabase
      .from('questions')
      .select('id, quiz_id, question_number, question_text, option_a, option_b, option_c, option_d, group_id')
      .eq('quiz_id', quizId)
      .order('question_number', { ascending: true });
    return {
      data: (fallback.data || []) as PublicQuestionRow[],
      error: fallback.error ? fallback.error : null,
    };
  };

  useEffect(() => {
    supabase
      .from('quizzes')
      .select('*')
      .order('start_time', { ascending: false })
      .then(({ data, error }) => {
        if (!error && data) {
          const loadedQuizzes = data as Quiz[];
          setQuizzes(loadedQuizzes);
          if (initialQuiz && loadedQuizzes.some((quiz) => quiz.id === initialQuiz.id)) {
            setSelectedQuiz(initialQuiz);
            setPhase('join');
          }
        }
        setLoading(false);
      });
  }, [initialQuiz]);

  useEffect(() => {
    if (!initialSubmission) return;
    submissionIdRef.current = initialSubmission.id;
    startedAtRef.current = initialSubmission.started_at;
  }, [initialSubmission]);

  // Preview-fetch questions when a quiz is selected (used only to show the
  // question count on the join screen). Guarded with a request id so this
  // fetch can never overwrite the authoritative list loaded in
  // handleStartNow if it happens to resolve later.
  useEffect(() => {
    if (!selectedQuiz) return;
    const requestId = ++questionsRequestIdRef.current;
    setQuestionsLoading(true);
    setQuestionsError(null);
    loadExamQuestions(selectedQuiz.id).then(({ data, error }) => {
        if (requestId !== questionsRequestIdRef.current) return; // stale, ignore
        if (error) {
          setQuestions([]);
          setQuestionsError(error.message);
        } else {
          setQuestions((data || []) as PublicQuestion[]);
        }
        setQuestionsLoading(false);
      });
  }, [selectedQuiz]);

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  // Poll server time when on join screen to determine if exam can start
  useEffect(() => {
    if (phase !== 'join' || !selectedQuiz) return;

    let active = true;

    const checkTime = async () => {
      const { data, error } = await supabase.rpc('get_server_time');
      if (!active) return;
      const now = error ? new Date() : new Date(data as string);
      const start = new Date(selectedQuiz.start_time);
      const end = new Date(selectedQuiz.end_time);

      if (now >= start && now <= end) {
        setCanStart(true);
        setTimeUntilStart(null);
      } else if (now < start) {
        setCanStart(false);
        const diff = Math.floor((start.getTime() - now.getTime()) / 1000);
        setTimeUntilStart(Math.max(0, diff));
      } else {
        setCanStart(false);
        setTimeUntilStart(null);
      }
    };

    checkTime();
    const interval = setInterval(checkTime, 1000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [phase, selectedQuiz]);

  // Progressive answer saving (every 5 seconds while quiz is active).
  // Also doubles as an early-warning check: if the server has marked this
  // attempt 'expired' (e.g. the tab was backgrounded and the browser
  // throttled the JS timer, so the client thinks time remains but the
  // server-side deadline already passed), tell the student immediately
  // instead of letting them keep answering toward a submission that will
  // be silently rejected later.
  useEffect(() => {
    if (phase !== 'quiz' || !submissionIdRef.current) return;

    saveTimerRef.current = setInterval(async () => {
      if (submittedRef.current || !submissionIdRef.current) return;
      const { data } = await supabase.rpc('save_answer_progress', {
        p_submission_id: submissionIdRef.current,
        p_answers: answersRef.current,
      });
      const result = data as { error?: string; message?: string } | null;
      if (result?.error === 'expired' && !submittedRef.current) {
        submittedRef.current = true;
        if (timerRef.current) clearInterval(timerRef.current);
        if (saveTimerRef.current) clearInterval(saveTimerRef.current);
        setSubmitError(
          'Your exam session has expired on the server (this can happen if the browser tab was in the background). Please contact the administrator immediately with your name and exam details — do not close this page.'
        );
      }
    }, 5000);

    return () => {
      if (saveTimerRef.current) clearInterval(saveTimerRef.current);
    };
  }, [phase]);

  // Countdown timer (overall + per-question)
  useEffect(() => {
    if (phase !== 'quiz') return;
    timerRef.current = setInterval(() => {
      overallTimeRef.current -= 1;
      if (overallTimeRef.current <= 0) {
        if (timerRef.current) clearInterval(timerRef.current);
        if (!submittedRef.current) {
          setAutoSubmitted(true);
          handleAutoSubmit();
        }
        setTimeLeft(0);
        return;
      }
      setTimeLeft(overallTimeRef.current);

      questionTimeRef.current -= 1;
      if (questionTimeRef.current <= 0) {
        questionTimeRef.current = PER_QUESTION_TIME;
        setQuestionTimeLeft(PER_QUESTION_TIME);
        if (currentIdxRef.current + 1 >= questions.length) {
          if (!submittedRef.current) {
            setAutoSubmitted(true);
            handleAutoSubmit();
          }
        } else {
          currentIdxRef.current += 1;
          setCurrentQuestionIndex(currentIdxRef.current);
        }
      } else {
        setQuestionTimeLeft(questionTimeRef.current);
      }
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const handleAutoSubmit = useCallback(async () => {
    if (submittedRef.current || !submissionIdRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { data, error } = await supabase.rpc('submit_exam', {
        p_submission_id: submissionIdRef.current,
        p_answers: answersRef.current,
      });
      if (error) {
        if (error.code === '23505') {
          // Already submitted — fine
        } else {
          setSubmitError(error.message);
          submittedRef.current = false;
          setSubmitting(false);
          return;
        }
      }
      // The RPC can return a *successful* call that still carries a
      // server-side rejection (e.g. the exam window closed a moment
      // before this request reached the server). Never treat that as a
      // successful submission — the previous code ignored `data` here
      // and showed "Congratulations!" even when the server had marked
      // the attempt 'expired' and discarded the answers.
      const result = data as { error?: string; message?: string } | null;
      if (result?.error && result.error !== 'ok') {
        submittedRef.current = false;
        setSubmitError(
          result.message ||
            'Time ran out and the server could not accept your submission. Please contact the administrator immediately with your name and exam details.'
        );
        setSubmitting(false);
        return;
      }
      if (saveTimerRef.current) clearInterval(saveTimerRef.current);
      setPhase('submitted');
    } catch {
      submittedRef.current = false;
      setSubmitError('Failed to submit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, []);

  const handleManualSubmit = async () => {
    setShowSubmitConfirm(false);
    if (submittedRef.current || !submissionIdRef.current) return;
    submittedRef.current = true;
    if (timerRef.current) clearInterval(timerRef.current);
    if (saveTimerRef.current) clearInterval(saveTimerRef.current);
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { data, error } = await supabase.rpc('submit_exam', {
        p_submission_id: submissionIdRef.current,
        p_answers: answersRef.current,
      });
      if (error) {
        if (error.code === '23505') {
          // Already submitted — go to submitted screen
        } else {
          setSubmitError(error.message);
          submittedRef.current = false;
          setSubmitting(false);
          return;
        }
      }
      const result = data as { error?: string; message?: string } | null;
      if (result?.error && result.error !== 'ok') {
        submittedRef.current = false;
        setSubmitError(
          result.message ||
            'The server could not accept your submission (your session may have expired). Please contact the administrator immediately with your name and exam details.'
        );
        setSubmitting(false);
        return;
      }
      setPhase('submitted');
    } catch {
      submittedRef.current = false;
      setSubmitError('Failed to submit. Please try again.');
      setSubmitting(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handleNextQuestion = () => {
    if (currentIdxRef.current + 1 >= questions.length) return;
    currentIdxRef.current += 1;
    setCurrentQuestionIndex(currentIdxRef.current);
    questionTimeRef.current = PER_QUESTION_TIME;
    setQuestionTimeLeft(PER_QUESTION_TIME);
  };

  // English-only validation
  const validateForm = (): string | null => {
    if (!studentName.trim()) return 'Please enter your full name.';
    if (!isEnglishText(studentName.trim())) {
      return 'Please enter your details in English only. Sinhala characters are not allowed.';
    }
    if (!studentGrade) return 'Please select your grade.';
    if (!schoolName.trim()) return 'Please enter your school name.';
    if (!isEnglishText(schoolName.trim())) {
      return 'Please enter your details in English only. Sinhala characters are not allowed.';
    }
    if (!whatsappNumber.trim()) return 'Please enter your WhatsApp / Mobile number.';
    if (normalizePhone(whatsappNumber).length < 8) {
      return 'Please enter a valid WhatsApp / Mobile number.';
    }
    return null;
  };

  const startAttemptFallback = async (): Promise<StartResult> => ({
    error: 'start_unavailable',
    message: 'The exam service is unavailable. Please try again shortly.',
  });

  // START NOW — calls server to create/resume attempt
  const handleStartNow = async () => {
    if (!selectedQuiz) return;
    setJoinError(null);

    const validationError = validateForm();
    if (validationError) {
      setJoinError(validationError);
      return;
    }

    setStarting(true);
    try {
      const { data, error } = await supabase.rpc('start_or_resume_attempt', {
        p_quiz_id: selectedQuiz.id,
        p_student_name: studentName.trim(),
        p_whatsapp_number: normalizePhone(whatsappNumber),
        p_grade: studentGrade ? parseInt(studentGrade) : null,
        p_school_name: schoolName.trim(),
      });

      let result = data as StartResult | null;

      if (error) {
        const fallbackResult = await startAttemptFallback();
        if (fallbackResult.error) {
          if (fallbackResult.error === 'already_submitted') {
            setJoinError('You have already attempted this examination.');
          } else if (fallbackResult.error === 'expired') {
            setJoinError('This examination attempt has expired.');
          } else if (fallbackResult.error === 'before_start') {
            setJoinError('Your exam will begin shortly. Please wait for the official start time.');
          } else if (fallbackResult.error === 'after_end') {
            setJoinError('The exam window has closed.');
          } else if (fallbackResult.error === 'resume_not_allowed') {
            setJoinError('Your previous examination session was interrupted. Please contact the administrator to resume this examination.');
          } else if (fallbackResult.error === 'invalid_phone') {
            setJoinError('Please enter a valid WhatsApp / Mobile number.');
          } else if (fallbackResult.error === 'invalid_name') {
            setJoinError('Please enter your name.');
          } else {
            setJoinError(fallbackResult.message || error.message || 'Failed to start exam. Please try again.');
          }
          return;
        }
        result = fallbackResult;
      }

      if (!result) {
        setJoinError('Failed to start exam. Please try again.');
        return;
      }

      if (result.error) {
        if (result.error === 'already_submitted') {
          setJoinError('You have already attempted this examination.');
        } else if (result.error === 'expired') {
          setJoinError('This examination attempt has expired.');
        } else if (result.error === 'before_start') {
          setJoinError('Your exam will begin shortly. Please wait for the official start time.');
        } else if (result.error === 'after_end') {
          setJoinError('The exam window has closed.');
        } else if (result.error === 'resume_not_allowed') {
          setJoinError('Your previous examination session was interrupted. Please contact the administrator to resume this examination.');
        } else if (result.error === 'invalid_phone') {
          setJoinError('Please enter a valid WhatsApp / Mobile number.');
        } else if (result.error === 'invalid_name') {
          setJoinError('Please enter your name.');
        } else {
          setJoinError(result.message || 'Cannot start exam at this time.');
        }
        return;
      }

      // Reload after the attempt is created so the exam never opens with a
      // stale or empty question list from the selection screen. Bump the
      // request id first so this authoritative load always "wins" over any
      // in-flight preview fetch from the join screen, no matter which
      // resolves first.
      const requestId = ++questionsRequestIdRef.current;
      setQuestionsLoading(true);
      setQuestionsError(null);
      const { data: questionRows, error: questionError } = await loadExamQuestions(selectedQuiz.id);

      if (requestId !== questionsRequestIdRef.current) {
        // An even newer request started while this one was in flight
        // (e.g. user clicked Start again) — let that one own the state.
        return;
      }

      if (questionError) {
        setQuestions([]);
        setQuestionsError(questionError.message);
        setQuestionsLoading(false);
        setJoinError(`Unable to load exam questions: ${questionError.message}`);
        return;
      }

      const loadedQuestions = (questionRows || []) as PublicQuestion[];
      if (loadedQuestions.length === 0) {
        setQuestions([]);
        setQuestionsError('No questions have been added to this exam yet.');
        setQuestionsLoading(false);
        setJoinError('This exam has no questions yet. Please contact the administrator.');
        return;
      }
      setQuestions(loadedQuestions);
      setQuestionsLoading(false);

      // Server confirmed — set up attempt
      submissionIdRef.current = result.submission_id || '';
      startedAtRef.current = result.attempt_started_at || result.server_time || '';

      // If resuming, load saved answers
      if (result.action === 'resume' && result.saved_answers) {
        const saved: Record<number, string> = {};
        for (const [k, v] of Object.entries(result.saved_answers)) {
          saved[parseInt(k)] = v;
        }
        setAnswers(saved);
        answersRef.current = saved;
      } else {
        setAnswers({});
        answersRef.current = {};
      }

      // Calculate remaining time from original attempt start
      const attemptStart = new Date(startedAtRef.current);
      const serverNow = new Date(result.server_time || '');
      const elapsed = Math.floor((serverNow.getTime() - attemptStart.getTime()) / 1000);
      const remaining = Math.max(0, QUIZ_DURATION - elapsed);
      // If server provided an effective_end_time (with extension), cap remaining to that
      if (result.effective_end_time) {
        const effectiveEnd = new Date(result.effective_end_time);
        const effectiveRemaining = Math.max(0, Math.floor((effectiveEnd.getTime() - serverNow.getTime()) / 1000));
        overallTimeRef.current = Math.min(remaining, effectiveRemaining);
      } else {
        overallTimeRef.current = remaining;
      }

      setTimeLeft(overallTimeRef.current);
      questionTimeRef.current = PER_QUESTION_TIME;
      currentIdxRef.current = 0;
      setCurrentQuestionIndex(0);
      setQuestionTimeLeft(PER_QUESTION_TIME);
      submittedRef.current = false;
      setAutoSubmitted(false);
      setPhase('quiz');
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : 'Failed to start exam. Please try again.');
    } finally {
      setStarting(false);
    }
  };

  const selectQuiz = (quiz: Quiz) => {
    setSelectedQuiz(quiz);
    setPhase('join');
  };

  // If the student already completed registration on the separate
  // /student-login screen (initialSubmission is set), don't make them fill
  // in the same details again on this component's own join screen — just
  // run the same start/resume flow automatically, once.
  const autoStartTriggeredRef = useRef(false);
  useEffect(() => {
    if (autoStartTriggeredRef.current) return;
    if (!initialSubmission || !selectedQuiz) return;
    if (phase !== 'join') return;
    autoStartTriggeredRef.current = true;
    void handleStartNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSubmission, selectedQuiz, phase]);

  const answeredCount = Object.keys(answers).length;

  // ---- Loading ----
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  // ---- Submitted (Congratulations screen — NO rank/score) ----
  if (phase === 'submitted') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          {/* Confetti animation */}
          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              {[...Array(12)].map((_, i) => (
                <span
                  key={i}
                  className="absolute text-2xl animate-confetti"
                  style={{
                    left: `${50 + (Math.cos((i / 12) * Math.PI * 2) * 40)}%`,
                    top: `${50 + (Math.sin((i / 12) * Math.PI * 2) * 40)}%`,
                    animationDelay: `${i * 0.1}s`,
                    animationDuration: '2s',
                  }}
                >
                  {['🎉', '✨', '🎊', '⭐'][i % 4]}
                </span>
              ))}
            </div>
            <div className="relative inline-flex items-center justify-center w-24 h-24 bg-green-100 rounded-full mb-4 animate-bounce-in">
              <CheckCircle2 className="w-14 h-14 text-green-600" />
            </div>
          </div>

          <h2 className="text-3xl font-bold text-slate-900 mb-2">
            {autoSubmitted ? "Time's Up!" : 'Congratulations!'}
          </h2>
          <p className="text-lg text-slate-700 mb-1">
            {autoSubmitted
              ? 'Your exam has been submitted automatically.'
              : 'Your exam has been submitted successfully.'}
          </p>
          <p className="text-slate-500 mb-8">
            Your results will be available after they are published.
          </p>

          <button
            onClick={onBack}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold px-6 py-3.5 rounded-xl transition"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  // ---- Quiz in progress ----
  if (phase === 'quiz' && selectedQuiz) {
    const timeWarning = timeLeft <= 60;
    const timeCritical = timeLeft <= 30;
    const qTimeWarning = questionTimeLeft <= 10;
    const currentQ = questions[currentQuestionIndex];
    const isLastQuestion = currentQuestionIndex + 1 >= questions.length;

    return (
      <div className="min-h-screen bg-slate-50">
        {/* Prominent timer header */}
        <header
          className={`sticky top-0 z-20 transition-colors shadow-lg ${
            timeCritical
              ? 'bg-red-600'
              : timeWarning
              ? 'bg-orange-500'
              : 'bg-slate-900'
          }`}
        >
          <div className="max-w-3xl mx-auto px-4 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-white min-w-0">
                <Brain className="w-5 h-5 flex-shrink-0" />
                <span className="font-semibold text-sm hidden sm:inline truncate">{selectedQuiz.title}</span>
              </div>
              <div className="flex items-center gap-4 sm:gap-6">
                <div className="text-center">
                  <div
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold ${
                      qTimeWarning ? 'bg-red-500/30 text-red-100' : 'bg-white/10 text-white'
                    }`}
                  >
                    <Clock className="w-4 h-4" />
                    <span className="tabular-nums text-lg">{formatTime(questionTimeLeft)}</span>
                  </div>
                  <p className="text-white/50 text-xs mt-1 hidden sm:block">per question</p>
                </div>
                <div className="text-center">
                  <div className="flex items-center gap-2 text-white">
                    <Timer className="w-6 h-6" />
                    <span className="text-4xl sm:text-5xl font-bold tabular-nums tracking-tight">
                      {formatTime(timeLeft)}
                    </span>
                  </div>
                  <p className="text-white/50 text-xs mt-1 hidden sm:block">total remaining</p>
                </div>
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-3xl mx-auto px-4 py-6 pb-28">
          {/* Question indicator + progress */}
          <div className="mb-5">
            <div className="flex items-center justify-between text-sm text-slate-600 mb-1.5">
              <span className="font-medium">
                Question {currentQuestionIndex + 1} of {questions.length}
              </span>
              <span>{answeredCount} answered</span>
            </div>
            <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 rounded-full transition-all duration-300"
                style={{ width: `${((currentQuestionIndex + 1) / questions.length) * 100}%` }}
              />
            </div>
          </div>

          {questionsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
          ) : currentQ ? (
            <div className="space-y-4">
              {currentQ.group_context && <GroupContext content={currentQ.group_context} />}
              <div className="bg-white border border-slate-200 rounded-2xl p-1.5 overflow-hidden">
                <div
                  className={`h-1.5 rounded-full transition-all duration-1000 ease-linear ${
                    qTimeWarning ? 'bg-red-500' : 'bg-blue-500'
                  }`}
                  style={{ width: `${(questionTimeLeft / PER_QUESTION_TIME) * 100}%` }}
                />
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                <div className="flex gap-3 mb-5">
                  <span className="flex-shrink-0 w-10 h-10 bg-blue-100 text-blue-700 rounded-xl flex items-center justify-center text-lg font-bold">
                    {currentQuestionIndex + 1}
                  </span>
                  <p className="text-lg text-slate-900 font-medium pt-1.5">{renderQuestionContent(currentQ.question_text)}</p>
                </div>
                <div className="grid grid-cols-1 gap-2.5">
                  {(['A', 'B', 'C', 'D'] as const).map((letter) => {
                    const optionText = currentQ[`option_${letter.toLowerCase()}` as keyof PublicQuestion] as string;
                    const isSelected = answers[currentQ.question_number] === letter;
                    return (
                      <button
                        key={letter}
                        onClick={() =>
                          setAnswers((prev) => ({ ...prev, [currentQ.question_number]: letter }))
                        }
                        className={`flex items-center gap-3 px-4 py-3.5 rounded-xl border-2 text-left transition ${
                          isSelected
                            ? 'border-blue-500 bg-blue-50 text-blue-900'
                            : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-slate-100'
                        }`}
                      >
                        <span
                          className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold transition ${
                            isSelected
                              ? 'bg-blue-600 text-white'
                              : 'bg-slate-200 text-slate-500'
                          }`}
                        >
                          {letter}
                        </span>
                        <span className="text-base">{optionText}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {!isLastQuestion && (
                <button
                  onClick={handleNextQuestion}
                  className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-white font-semibold px-6 py-3 rounded-xl transition"
                >
                  Next Question
                  <ArrowRight className="w-5 h-5" />
                </button>
              )}
            </div>
          ) : (
            <div className="text-center py-12 text-slate-400">
              <p>{questionsError || 'No questions available.'}</p>
            </div>
          )}

          {submitError && (
            <div className="mt-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-sm flex items-center gap-2">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              {submitError}
            </div>
          )}
        </main>

        {/* Submit bar */}
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 p-4 z-20">
          <div className="max-w-3xl mx-auto flex items-center gap-3">
            <p className="text-sm text-slate-600 flex-1">
              {answeredCount} of {questions.length} answered
            </p>
            <button
              onClick={() => setShowSubmitConfirm(true)}
              disabled={submitting}
              className="flex items-center gap-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-semibold px-6 py-3 rounded-xl transition"
            >
              {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
              {submitting ? 'Submitting...' : 'Submit Exam'}
            </button>
          </div>
        </div>

        {/* Submit confirmation dialog */}
        {showSubmitConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
            <div className="bg-white rounded-2xl p-6 max-w-sm w-full text-center">
              <div className="inline-flex items-center justify-center w-14 h-14 bg-blue-100 rounded-2xl mb-4">
                <AlertCircle className="w-7 h-7 text-blue-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">Submit your exam?</h3>
              <p className="text-slate-600 text-sm mb-6">
                Are you sure you want to submit your exam? You answered {answeredCount} of {questions.length} questions.
                This cannot be undone.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowSubmitConfirm(false)}
                  className="flex-1 px-5 py-3 rounded-xl border border-slate-300 text-slate-700 font-medium hover:bg-slate-100 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleManualSubmit}
                  disabled={submitting}
                  className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-semibold px-5 py-3 rounded-xl transition"
                >
                  {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                  Submit Exam
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ---- Join screen (info form + START NOW) ----
  if (phase === 'join' && selectedQuiz) {
    if (initialSubmission) {
      // Already registered via the /student-login screen — the auto-start
      // effect is resuming this attempt. Show a loader instead of a second
      // copy of the registration form. If it failed, show the real error
      // and a retry button instead of spinning forever.
      return (
        <main className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
          <div className="flex flex-col items-center gap-3 text-center max-w-md">
            {joinError ? (
              <>
                <AlertCircle className="w-8 h-8 text-red-500" />
                <p className="text-slate-700 font-medium">{joinError}</p>
                <button
                  onClick={() => {
                    setJoinError(null);
                    void handleStartNow();
                  }}
                  disabled={starting}
                  className="mt-2 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Try again
                </button>
              </>
            ) : (
              <>
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                <p className="text-slate-500">Starting your exam…</p>
              </>
            )}
          </div>
        </main>
      );
    }
    const status = getQuizStatus(selectedQuiz);

    if (status === 'closed') {
      return (
        <ClosedScreen
          icon={<Lock className="w-12 h-12 text-slate-400" />}
          title="Exam Closed"
          message={`This exam ended on ${formatDate(selectedQuiz.end_time)} at ${formatTimeOfDay(selectedQuiz.end_time)}. It is no longer accepting submissions.`}
          onBack={() => {
            setPhase('select');
            setSelectedQuiz(null);
          }}
        />
      );
    }

    return (
      <div className="min-h-screen bg-slate-50">
        <header className="bg-white border-b border-slate-200">
          <div className="max-w-2xl mx-auto px-4 py-4">
            <button
              onClick={() => {
                setPhase('select');
                setSelectedQuiz(null);
              }}
              className="text-sm text-slate-600 hover:text-slate-900 transition"
            >
              ← Back
            </button>
          </div>
        </header>
        <main className="max-w-2xl mx-auto px-4 py-8">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8">
            <div className="text-center mb-6">
              <div className="inline-flex items-center justify-center w-14 h-14 bg-blue-100 rounded-2xl mb-3">
                <Brain className="w-7 h-7 text-blue-600" />
              </div>
              <h1 className="text-2xl font-bold text-slate-900">{selectedQuiz.title}</h1>
              {selectedQuiz.description && (
                <p className="text-slate-600 mt-1">{selectedQuiz.description}</p>
              )}
              <div className="flex items-center justify-center gap-2 mt-3 text-sm text-slate-500">
                <Clock className="w-4 h-4" />
                <span>40 minutes • {questions.length || 40} questions</span>
              </div>
              <div className="mt-2 text-sm font-medium text-slate-700">
                Exam starts at {formatTimeOfDay(selectedQuiz.start_time)}
              </div>
            </div>

            {/* Sinhala instruction */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-4 text-center">
              <p className="text-blue-800 font-medium text-sm">
                කරුණාකර පහත සියලු විස්තර ENGLISH වලින් පුරවන්න.
              </p>
              <p className="text-blue-600 text-xs mt-1">
                Please enter all details in English only.
              </p>
            </div>

            {/* Student information form */}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Full Name <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    type="text"
                    required
                    value={studentName}
                    onChange={(e) => {
                      setStudentName(e.target.value);
                      if (e.target.value && !isEnglishText(e.target.value)) {
                        setJoinError('Please enter your details in English only. Sinhala characters are not allowed.');
                      } else {
                        setJoinError(null);
                      }
                    }}
                    className={`w-full bg-slate-50 border rounded-xl pl-11 pr-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:border-transparent ${
                      studentName && !isEnglishText(studentName)
                        ? 'border-red-300 focus:ring-red-500'
                        : 'border-slate-300 focus:ring-blue-500'
                    }`}
                    placeholder="Enter your full name in English"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Grade <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {(['10', '11'] as const).map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setStudentGrade(g)}
                      className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 font-semibold transition ${
                        studentGrade === g
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      <GraduationCap className="w-5 h-5" />
                      Grade {g}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  School Name <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <School className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    type="text"
                    required
                    value={schoolName}
                    onChange={(e) => {
                      setSchoolName(e.target.value);
                      if (e.target.value && !isEnglishText(e.target.value)) {
                        setJoinError('Please enter your details in English only. Sinhala characters are not allowed.');
                      } else {
                        setJoinError(null);
                      }
                    }}
                    className={`w-full bg-slate-50 border rounded-xl pl-11 pr-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:border-transparent ${
                      schoolName && !isEnglishText(schoolName)
                        ? 'border-red-300 focus:ring-red-500'
                        : 'border-slate-300 focus:ring-blue-500'
                    }`}
                    placeholder="Enter your school name in English"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  WhatsApp / Mobile Number <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    type="tel"
                    required
                    value={whatsappNumber}
                    onChange={(e) => setWhatsappNumber(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-11 pr-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="e.g. +94 77 123 4567"
                  />
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  This number is your unique identity for this exam. Use the same number if you need to resume.
                </p>
              </div>

              {joinError && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-sm flex items-start gap-2">
                  <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  {joinError}
                </div>
              )}

              {/* Instructions */}
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-amber-800 text-sm">
                <p className="font-medium mb-1">Before you start:</p>
                <ul className="list-disc list-inside space-y-0.5 text-amber-700">
                  <li>40 minutes total, 1 minute per question</li>
                  <li>The exam auto-submits when time runs out</li>
                  <li>You can only attempt once per exam</li>
                  <li>If you close or refresh, you can resume with the same details</li>
                  <li>Your answers are saved automatically</li>
                </ul>
              </div>

              {/* START NOW button area */}
              <div className="pt-2">
                {!canStart && timeUntilStart !== null && timeUntilStart > 0 ? (
                  <div className="text-center">
                    <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-6">
                      <p className="text-slate-700 font-medium mb-2">Your exam will begin shortly.</p>
                      <p className="text-sm text-slate-500 mb-3">
                        Exam starts at {formatTimeOfDay(selectedQuiz.start_time)}
                      </p>
                      <div className="inline-flex items-center gap-2 text-blue-700">
                        <Clock className="w-5 h-5" />
                        <span className="text-2xl font-bold tabular-nums">
                          {formatCountdown(timeUntilStart)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-2">until exam starts</p>
                    </div>
                    <button
                      disabled
                      className="w-full mt-4 bg-slate-300 text-slate-500 font-semibold py-3.5 rounded-xl cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      <PlayCircle className="w-5 h-5" />
                      Start Now (available at {formatTimeOfDay(selectedQuiz.start_time)})
                    </button>
                  </div>
                ) : canStart ? (
                  <button
                    onClick={handleStartNow}
                    disabled={starting || !studentName.trim() || !studentGrade || !schoolName.trim() || !whatsappNumber.trim()}
                    className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-4 rounded-xl transition flex items-center justify-center gap-2 text-lg shadow-lg shadow-green-600/30"
                  >
                    {starting ? <Loader2 className="w-6 h-6 animate-spin" /> : <PlayCircle className="w-6 h-6" />}
                    {starting ? 'Starting...' : 'Enter Exam'}
                  </button>
                ) : (
                  <div className="text-center text-slate-500 text-sm">
                    <p>Checking exam status...</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ---- Quiz selection ----
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          <button onClick={onBack} className="text-sm text-slate-600 hover:text-slate-900 transition">
            ← Home
          </button>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Take an Exam</h1>
        <p className="text-slate-500 mb-6">Select an available exam to begin</p>

        {quizzes.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <Brain className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p>No exams are available right now.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {quizzes.map((quiz) => {
              const status = getQuizStatus(quiz);
              const accessible = isAccessible(quiz);
              return (
                <button
                  key={quiz.id}
                  onClick={() => selectQuiz(quiz)}
                  disabled={status === 'closed'}
                  className="w-full text-left bg-white border border-slate-200 rounded-2xl p-5 hover:border-blue-300 hover:shadow-md transition disabled:opacity-60 disabled:cursor-not-allowed group"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-slate-900 group-hover:text-blue-600 transition">
                        {quiz.title}
                      </h3>
                      <div className="flex flex-wrap gap-3 mt-1.5 text-sm text-slate-500">
                        <span>{formatDate(quiz.start_time)}</span>
                        <span>•</span>
                        <span>
                          {formatTimeOfDay(quiz.start_time)} – {formatTimeOfDay(quiz.end_time)}
                        </span>
                      </div>
                    </div>
                    <div className="flex-shrink-0">
                      {status === 'open' && (
                        <span className="text-xs font-medium bg-blue-100 text-blue-700 px-2.5 py-1 rounded-full flex items-center gap-1">
                          <span className="inline-block w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
                          Open Now
                        </span>
                      )}
                      {status === 'upcoming' && accessible && (
                        <span className="text-xs font-medium bg-amber-100 text-amber-700 px-2.5 py-1 rounded-full">
                          Early Access
                        </span>
                      )}
                      {status === 'upcoming' && !accessible && (
                        <span className="text-xs font-medium bg-slate-100 text-slate-500 px-2.5 py-1 rounded-full">
                          Upcoming
                        </span>
                      )}
                      {status === 'closed' && (
                        <span className="text-xs font-medium bg-orange-100 text-orange-700 px-2.5 py-1 rounded-full">
                          Closed
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

function ClosedScreen({
  icon,
  title,
  message,
  onBack,
}: {
  icon: React.ReactNode;
  title: string;
  message: string;
  onBack: () => void;
}) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="text-center max-w-md">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-slate-100 rounded-2xl mb-4">
          {icon}
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mb-2">{title}</h2>
        <p className="text-slate-600 mb-6">{message}</p>
        <button
          onClick={onBack}
          className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-6 py-3 rounded-xl transition"
        >
          Back
        </button>
      </div>
    </div>
  );
}
