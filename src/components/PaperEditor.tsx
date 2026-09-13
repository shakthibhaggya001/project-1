import { useEffect, useState, useRef, useCallback } from 'react';
import { supabase, type Quiz, type Question } from '@/lib/supabase';
import { getQuizStatus, toLocalDateTimeInput } from '@/lib/utils';
import {
  ArrowLeft,
  Plus,
  Save,
  Loader2,
  CheckCircle2,
  Trash2,
  Copy,
  Eye,
  AlertTriangle,
  Brain,
  FileCheck,
  Upload,
  Sparkles,
} from 'lucide-react';

type QuestionDraft = {
  id?: string;
  question_number: number;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_answer: 'A' | 'B' | 'C' | 'D';
  group_id?: string | null;
  dirty: boolean;
  saving?: boolean;
  saved?: boolean;
};

type Props = {
  quiz: Quiz | null;
  mode: 'create' | 'edit';
  onBack: () => void;
  onSaved: () => void;
};

// Renders a question group's shared context in the admin preview, mirroring
// what students see: simple pipe-delimited markdown tables render as an
// actual table, anything else renders as plain paragraphs.
function PreviewGroupContext({ content }: { content: string }) {
  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
  const tableLines = lines.filter((l) => l.startsWith('|'));
  if (tableLines.length >= 2) {
    const rows = tableLines
      .filter((l) => !/^\|[\s\-:|]+\|$/.test(l))
      .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
    const header = rows[0] || [];
    const body = rows.slice(1);
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Reference</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr>
                {header.map((cell, i) => (
                  <th key={i} className="border border-slate-300 bg-slate-100 px-3 py-2 text-left font-semibold text-slate-700">
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, ri) => (
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
      </div>
    );
  }
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Reference</p>
      <div className="space-y-2 text-slate-700 text-sm leading-relaxed">
        {lines.map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>
    </div>
  );
}

const emptyQuestion = (num: number): QuestionDraft => ({
  question_number: num,
  question_text: '',
  option_a: '',
  option_b: '',
  option_c: '',
  option_d: '',
  correct_answer: 'A',
  dirty: false,
});

const TARGET_QUESTIONS = 40;
const ANSWER_OPTIONS = ['A', 'B', 'C', 'D'] as const;
type AnswerOption = (typeof ANSWER_OPTIONS)[number];

const parseAnswerKeyText = (raw: string): Partial<Record<number, AnswerOption>> => {
  const normalized = raw.replace(/\r/g, '').trim();
  if (!normalized) return {};

  const values = normalized
    .split(/[\n,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const parsed: Partial<Record<number, AnswerOption>> = {};

  values.forEach((value) => {
    const match = value.match(/^(\d+)\s*[-:]?\s*([A-D])$/i);
    if (match) {
      const qNumber = Number(match[1]);
      const answer = match[2].toUpperCase() as AnswerOption;
      parsed[qNumber] = answer;
      return;
    }

    const compactMatch = value.match(/^(\d+)([A-D])$/i);
    if (compactMatch) {
      const qNumber = Number(compactMatch[1]);
      const answer = compactMatch[2].toUpperCase() as AnswerOption;
      parsed[qNumber] = answer;
      return;
    }

    const singleLetterMatch = value.match(/^([A-D])$/i);
    if (singleLetterMatch) {
      const answer = singleLetterMatch[1].toUpperCase() as AnswerOption;
      const nextIndex = Object.keys(parsed).length + 1;
      parsed[nextIndex] = answer;
    }
  });

  if (Object.keys(parsed).length === 0) {
    const sequence = normalized.match(/[A-D]/gi) || [];
    sequence.forEach((letter, index) => {
      parsed[index + 1] = letter.toUpperCase() as AnswerOption;
    });
  }

  return parsed;
};

const parseBulkQuestionText = (raw: string): QuestionDraft[] => {
  // Accept both real newlines and literal "\n"/"\r" sequences that survive some pastes.
  const cleaned = raw
    .replace(/\\r/g, '\r')
    .replace(/\\n/g, '\n')
    .replace(/\r/g, '')
    // Also accept the semicolon-separated single-line format shown in the
    // on-screen instructions ("1. Question text; A. opt; B. opt; C. opt; D. opt").
    .replace(/;\s*(?=[A-D]\s*[.)]\s)/gi, '\n')
    .replace(/;\s*(?=(?:Q(?:uestion)?\s*)?\d+\s*[.)]\s)/gi, '\n')
    .trim();
  if (!cleaned) return [];

  // Parse line-by-line and rely on the question-number / option-letter prefixes
  // instead of blank-line separators, so the import works whether or not the
  // paste preserves blank lines between questions.
  const lines = cleaned
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const parsedQuestions: QuestionDraft[] = [];
  let current: { text: string; options: Partial<Record<AnswerOption, string>> } | null = null;

  const flushQuestion = () => {
    if (!current) return;
    const normalizedText = current.text
      .replace(/^(?:Q(?:uestion)?\s*)?\d+[.)]\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    const options = {
      A: current.options.A || '',
      B: current.options.B || '',
      C: current.options.C || '',
      D: current.options.D || '',
    };
    const hasValidOptions = Object.values(options).every((value) => value.trim().length > 0);

    if (normalizedText && hasValidOptions) {
      const nextQuestion = emptyQuestion(parsedQuestions.length + 1);
      nextQuestion.question_text = normalizedText;
      nextQuestion.option_a = options.A.trim();
      nextQuestion.option_b = options.B.trim();
      nextQuestion.option_c = options.C.trim();
      nextQuestion.option_d = options.D.trim();
      nextQuestion.correct_answer = 'A';
      parsedQuestions.push(nextQuestion);
    }

    current = null;
  };

  lines.forEach((line) => {
    const optionMatch = line.match(/^([A-D])\s*[.)]\s*(.+)$/i);
    const questionMatch = line.match(/^(?:Q(?:uestion)?\s*)?(\d+)[.)]\s*(.+)$/i);

    // An option line only counts once a question is open; otherwise a stem that
    // happens to start with "A." would be swallowed.
    if (optionMatch && current) {
      current.options[optionMatch[1].toUpperCase() as AnswerOption] = optionMatch[2].trim();
      return;
    }

    if (questionMatch) {
      flushQuestion();
      current = { text: questionMatch[2].trim(), options: {} };
      return;
    }

    // Continuation of the current question stem (multi-line question text),
    // but only before any options have been read.
    if (current && Object.keys(current.options).length === 0) {
      current.text = `${current.text} ${line}`.trim();
    }
  });

  flushQuestion();

  return parsedQuestions;
};

export default function PaperEditor({ quiz, mode, onBack, onSaved }: Props) {
  const [step, setStep] = useState<'details' | 'questions'>(mode === 'edit' ? 'questions' : 'details');
  const [title, setTitle] = useState(quiz?.title || '');
  const [description, setDescription] = useState(quiz?.description || '');
  const [quizDate, setQuizDate] = useState(quiz?.quiz_date || '');
  const [startTime, setStartTime] = useState(quiz ? toLocalDateTimeInput(quiz.start_time) : '');
  const [endTime, setEndTime] = useState(quiz ? toLocalDateTimeInput(quiz.end_time) : '');

  const [questions, setQuestions] = useState<QuestionDraft[]>([]);
  const [questionsLoading, setQuestionsLoading] = useState(mode === 'edit');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [liveAttemptCount, setLiveAttemptCount] = useState(0);
  const [quizId, setQuizId] = useState<string | null>(quiz?.id || null);
  const [bulkImportText, setBulkImportText] = useState('');
  const [aiUploading, setAiUploading] = useState(false);
  const [answerKeyText, setAnswerKeyText] = useState('');
  const [groupContexts, setGroupContexts] = useState<Record<string, string>>({});

  const autosaveTimers = useRef<{ [key: number]: ReturnType<typeof setTimeout> }>({});

  // Load existing questions when editing
  useEffect(() => {
    if (mode !== 'edit' || !quiz) return;
    let active = true;
    (async () => {
      const { data, error: qErr } = await supabase
        .from('questions')
        .select('*')
        .eq('quiz_id', quiz.id)
        .order('question_number', { ascending: true });
      if (!active) return;
      if (qErr) {
        setError('Failed to load questions: ' + qErr.message);
        setQuestionsLoading(false);
        return;
      }
      const { data: groupsData } = await supabase
        .from('question_groups')
        .select('id, context_content')
        .eq('quiz_id', quiz.id);
      if (active && groupsData) {
        const map: Record<string, string> = {};
        for (const g of groupsData as { id: string; context_content: string }[]) {
          map[g.id] = g.context_content;
        }
        setGroupContexts(map);
      }
      const loaded = (data as Question[]) || [];
      const drafts: QuestionDraft[] = loaded.map((q) => ({
        id: q.id,
        question_number: q.question_number,
        question_text: q.question_text,
        option_a: q.option_a,
        option_b: q.option_b,
        option_c: q.option_c,
        option_d: q.option_d,
        correct_answer: q.correct_answer,
        group_id: q.group_id ?? null,
        dirty: false,
        saved: true,
      }));
      setQuestions(drafts);
      setQuestionsLoading(false);
    })();
    return () => { active = false; };
  }, [mode, quiz]);

  // Check for live attempts when editing
  useEffect(() => {
    if (mode !== 'edit' || !quizId) return;
    (async () => {
      const { count } = await supabase
        .from('submissions')
        .select('*', { count: 'exact', head: true })
        .eq('quiz_id', quizId)
        .in('status', ['in_progress', 'submitted']);
      setLiveAttemptCount(count || 0);
    })();
  }, [mode, quizId]);

  // Cleanup autosave timers on unmount
  useEffect(() => {
    const timers = autosaveTimers.current;
    return () => {
      Object.values(timers).forEach((t) => clearTimeout(t));
    };
  }, []);

  type QuestionField = keyof QuestionDraft | `option_${'a' | 'b' | 'c' | 'd'}`;

  const updateQuestion = useCallback((idx: number, field: QuestionField, value: string | number) => {
    const normalizedField = field as keyof QuestionDraft;

    setQuestions((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [normalizedField]: value as never, dirty: true, saved: false };
      return next;
    });

    // Debounced autosave for this question (only if it has an ID, i.e. already in DB)
    const q = questions[idx];
    if (q?.id) {
      if (autosaveTimers.current[idx]) clearTimeout(autosaveTimers.current[idx]);
      autosaveTimers.current[idx] = setTimeout(async () => {
        await saveSingleQuestion(idx);
      }, 1500);
    }
  }, [questions]);

  const saveSingleQuestion = async (idx: number) => {
    setQuestions((prev) => {
      const next = [...prev];
      if (next[idx]) next[idx] = { ...next[idx], saving: true };
      return next;
    });

    const q = questions[idx];
    if (!q || !q.id) return;

    const { error: uErr } = await supabase
      .from('questions')
      .update({
        question_text: q.question_text.trim(),
        option_a: q.option_a.trim(),
        option_b: q.option_b.trim(),
        option_c: q.option_c.trim(),
        option_d: q.option_d.trim(),
        correct_answer: q.correct_answer,
        group_id: q.group_id ?? null,
      })
      .eq('id', q.id);

    setQuestions((prev) => {
      const next = [...prev];
      if (next[idx]) next[idx] = { ...next[idx], saving: false, dirty: false, saved: true };
      return next;
    });

    if (!uErr) {
      setLastSaved(new Date());
    }
  };

  const addQuestion = () => {
    const nextNum = questions.length > 0 ? Math.max(...questions.map((q) => q.question_number)) + 1 : 1;
    setQuestions((prev) => [...prev, emptyQuestion(nextNum)]);
  };

  const removeQuestion = async (idx: number) => {
    const q = questions[idx];
    if (q.id) {
      await supabase.from('questions').delete().eq('id', q.id);
    }
    setQuestions((prev) => prev.filter((_, i) => i !== idx));
    setLastSaved(new Date());
  };

  const duplicateQuestion = (idx: number) => {
    setQuestions((prev) => {
      const next = [...prev];
      const dup = { ...prev[idx], id: undefined, dirty: true, saved: false };
      next.splice(idx + 1, 0, dup);
      return next;
    });
  };

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

  const applyBulkImport = () => {
    const imported = parseBulkQuestionText(bulkImportText);
    if (imported.length === 0) {
      setError('No valid questions were detected. Put each question and its A/B/C/D options on their own line, e.g. "1. Question?" then "A. option" on the next line.');
      return;
    }

    setError(null);
    setQuestions((prev) => {
      const next = [...prev];
      const importedWithPositions = imported.map((question, index) => ({
        ...emptyQuestion(index + 1),
        ...question,
        question_number: index + 1,
        correct_answer: question.correct_answer || 'A',
      }));

      const merged = [...next, ...importedWithPositions];
      const deduped = merged.filter((question, index, arr) => {
        if (!question.question_text.trim()) return false;
        return arr.findIndex((item) => item.question_text.trim() === question.question_text.trim()) === index;
      });

      return deduped.slice(0, TARGET_QUESTIONS);
    });

    if (answerKeyText.trim()) {
      const parsedKey = parseAnswerKeyText(answerKeyText);
      setQuestions((prev) => prev.map((question, index) => {
        const key = parsedKey[index + 1];
        if (!key) return question;
        return { ...question, correct_answer: key, dirty: true, saved: false };
      }));
    }

    setBulkImportText('');

    // Surface the parsed count so a partial import (e.g. a paste that lost some
    // questions) is never silent.
    setStatusMsg(
      imported.length === TARGET_QUESTIONS
        ? `Imported all ${imported.length} questions.`
        : `Imported ${imported.length} question(s). Expected ${TARGET_QUESTIONS} — check the pasted text for any question missing one of its A–D options.`
    );
  };

  const applyAnswerKey = () => {
    const parsedKey = parseAnswerKeyText(answerKeyText);
    if (Object.keys(parsedKey).length === 0) {
      setError('No answer key values were detected. Try formats like "1-A, 2-C, 3-B" or "A, C, B, D".');
      return;
    }

    setError(null);
    setQuestions((prev) =>
      prev.map((question, index) => {
        const key = parsedKey[index + 1];
        if (!key || question.correct_answer === key) return question;
        // Mark dirty so the change is actually persisted on save (existing
        // questions are only written when q.dirty is true).
        return { ...question, correct_answer: key, dirty: true, saved: false };
      })
    );
  };

  type AiExtractedGroup = {
    context: string | null;
    questions: Array<{
      number?: number;
      text: string;
      options: { A: string; B: string; C: string; D: string };
      correct_answer: 'A' | 'B' | 'C' | 'D' | null;
    }>;
  };

  const handleAiPdfUpload = async (file: File) => {
    setError(null);
    setStatusMsg(null);

    if (file.type !== 'application/pdf') {
      setError('Please upload a PDF file. Export your Word/Google Doc as PDF first (File → Download → PDF).');
      return;
    }

    setAiUploading(true);
    try {
      // A quiz row (with title/date/times) must exist before questions or
      // question_groups can be attached to it.
      let effectiveQuizId = quizId;
      if (!effectiveQuizId) {
        effectiveQuizId = await createQuizAndSave();
        if (!effectiveQuizId) {
          setAiUploading(false);
          return;
        }
      }

      const fileBase64: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1] || '');
        };
        reader.onerror = () => reject(new Error('Could not read the file.'));
        reader.readAsDataURL(file);
      });

      const res = await fetch('/api/extract-questions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fileBase64, mediaType: 'application/pdf' }),
      });
      const payload = await res.json();
      if (!res.ok) {
        const detail = payload?.details ? `${payload.details}`.slice(0, 300) : '';
        setError(`${payload?.error || 'AI extraction failed.'}${detail ? ` — ${detail}` : ''}`);
        return;
      }

      const groups: AiExtractedGroup[] = payload?.groups || [];
      if (groups.length === 0) {
        setError('The AI could not find any questions in this document.');
        return;
      }

      const newDrafts: QuestionDraft[] = [];
      let orderIndex = 0;
      for (const group of groups) {
        let groupId: string | null = null;
        if (group.context && group.context.trim()) {
          const { data, error: gErr } = await supabase
            .from('question_groups')
            .insert({ quiz_id: effectiveQuizId, context_content: group.context.trim(), display_order: orderIndex })
            .select()
            .single();
          if (gErr) {
            setError(`Could not save a shared table/context: ${gErr.message}`);
            return;
          }
          groupId = (data as { id: string })?.id || null;
          if (groupId) {
            const contextText = group.context.trim();
            setGroupContexts((prev) => ({ ...prev, [groupId as string]: contextText }));
          }
        }
        orderIndex += 1;

        for (const q of group.questions || []) {
          if (!q.text?.trim()) continue;
          newDrafts.push({
            question_number: 0,
            question_text: q.text.trim(),
            option_a: q.options?.A || '',
            option_b: q.options?.B || '',
            option_c: q.options?.C || '',
            option_d: q.options?.D || '',
            correct_answer: q.correct_answer || 'A',
            group_id: groupId,
            dirty: true,
            saved: false,
          });
        }
      }

      if (newDrafts.length === 0) {
        setError('The AI could not find any valid questions in this document.');
        return;
      }

      setQuestions((prev) => {
        const importedWithPositions = newDrafts.map((q, index) => ({ ...q, question_number: index + 1 }));
        const merged = [...prev, ...importedWithPositions];
        const deduped = merged.filter((question, index, arr) => {
          if (!question.question_text.trim()) return false;
          return arr.findIndex((item) => item.question_text.trim() === question.question_text.trim()) === index;
        });
        return deduped.slice(0, TARGET_QUESTIONS);
      });

      setStatusMsg(
        `AI extracted ${newDrafts.length} question(s) from the PDF. Correct answers default to "A" unless the paper marked one — please review every answer with the Quick Answer Key Grid before publishing.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process the PDF.');
    } finally {
      setAiUploading(false);
    }
  };

  const createQuizAndSave = async (): Promise<string | null> => {
    if (!title.trim() || !quizDate || !startTime || !endTime) {
      setError('Please fill in title, date, start time, and end time.');
      return null;
    }
    const { data, error: qErr } = await supabase
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
    if (qErr) {
      setError('Failed to create paper: ' + qErr.message);
      return null;
    }
    const newId = (data as Quiz).id;
    setQuizId(newId);
    return newId;
  };

  const updateQuizDetails = async (id: string) => {
    const { error: uErr } = await supabase
      .from('quizzes')
      .update({
        title: title.trim(),
        description: description.trim(),
        quiz_date: quizDate,
        start_time: new Date(startTime).toISOString(),
        end_time: new Date(endTime).toISOString(),
      })
      .eq('id', id);
    if (uErr) {
      setError('Failed to update paper details: ' + uErr.message);
    }
  };

  const handleSaveDraft = async () => {
    setError(null);
    setSaving(true);
    setStatusMsg(null);
    try {
      const saveErrors: string[] = [];
      let questionsToSave = questions;

      // Treat pasted bulk text as part of Save Changes, so it cannot be left unsaved.
      if (bulkImportText.trim()) {
        const importedQuestions = parseBulkQuestionText(bulkImportText);
        if (importedQuestions.length === 0) {
          setError('Could not read the pasted questions. Use question numbers and A, B, C, and D options.');
          return;
        }
        // Apply the pasted answer key here too, otherwise saving straight from a
        // bulk paste would store every correct answer as the default "A".
        if (answerKeyText.trim()) {
          const parsedKey = parseAnswerKeyText(answerKeyText);
          importedQuestions.forEach((question, index) => {
            const key = parsedKey[index + 1];
            if (key) question.correct_answer = key;
          });
        }
        questionsToSave = importedQuestions;
        setQuestions(importedQuestions);
        setBulkImportText('');
      }

      let id = quizId;
      if (!id) {
        id = await createQuizAndSave();
        if (!id) return;
      } else {
        await updateQuizDetails(id);
      }

      // Save all dirty/new questions
      for (let i = 0; i < questionsToSave.length; i++) {
        const q = questionsToSave[i];
        if (!q.question_text.trim()) continue;

        if (q.id) {
          // Update existing
          if (q.dirty) {
            const { error: uErr } = await supabase
              .from('questions')
              .update({
                question_text: q.question_text.trim(),
                option_a: q.option_a.trim(),
                option_b: q.option_b.trim(),
                option_c: q.option_c.trim(),
                option_d: q.option_d.trim(),
                correct_answer: q.correct_answer,
                group_id: q.group_id ?? null,
              })
              .eq('id', q.id);
              if (uErr) saveErrors.push(`Question ${i + 1}: ${uErr.message}`);
          }
        } else {
          // Insert new
          const { data, error: iErr } = await supabase
            .from('questions')
            .insert({
              quiz_id: id,
              question_number: q.question_number,
              question_text: q.question_text.trim(),
              option_a: q.option_a.trim(),
              option_b: q.option_b.trim(),
              option_c: q.option_c.trim(),
              option_d: q.option_d.trim(),
              correct_answer: q.correct_answer,
              group_id: q.group_id ?? null,
            })
            .select()
            .single();
          if (iErr) {
            saveErrors.push(`Question ${i + 1}: ${iErr.message}`);
          } else if (data) {
            setQuestions((prev) => {
              const next = [...prev];
              next[i] = { ...next[i], id: (data as unknown as Question).id, dirty: false, saved: true };
              return next;
            });
          }
        }
      }

      if (saveErrors.length > 0) {
        setError(`Could not save the paper. ${saveErrors.join(' ')}`);
        return;
      }

      // Mark all as saved
      setQuestions((prev) => prev.map((q) => ({ ...q, dirty: false, saved: true })));
      setLastSaved(new Date());
      setStatusMsg('Draft saved successfully.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save draft');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSingleNewQuestion = async (idx: number) => {
    const q = questions[idx];
    if (!q || !q.question_text.trim() || q.id) return;
    if (!quizId) return;

    setQuestions((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], saving: true };
      return next;
    });

    const { data, error: iErr } = await supabase
      .from('questions')
      .insert({
        quiz_id: quizId,
        question_number: q.question_number,
        question_text: q.question_text.trim(),
        option_a: q.option_a.trim(),
        option_b: q.option_b.trim(),
        option_c: q.option_c.trim(),
        option_d: q.option_d.trim(),
        correct_answer: q.correct_answer,
        group_id: q.group_id ?? null,
      })
      .select()
      .single();

    setQuestions((prev) => {
      const next = [...prev];
      if (iErr) {
        next[idx] = { ...next[idx], saving: false };
      } else {
        next[idx] = { ...next[idx], id: (data as Question)?.id, saving: false, dirty: false, saved: true };
      }
      return next;
    });

    if (!iErr) setLastSaved(new Date());
  };

  const validQuestions = questions.filter((q) => q.question_text.trim());
  const filledCount = validQuestions.length;
  const isReady = filledCount === TARGET_QUESTIONS && validQuestions.every(
    (q) =>
      q.option_a.trim() &&
      q.option_b.trim() &&
      q.option_c.trim() &&
      q.option_d.trim() &&
      ANSWER_OPTIONS.includes(q.correct_answer)
  );

  const validationIssues: string[] = [];
  if (filledCount < TARGET_QUESTIONS) {
    validationIssues.push(`${TARGET_QUESTIONS - filledCount} more question(s) needed (currently ${filledCount}/${TARGET_QUESTIONS})`);
  }
  validQuestions.forEach((q) => {
    if (!q.option_a.trim() || !q.option_b.trim() || !q.option_c.trim() || !q.option_d.trim()) {
      validationIssues.push(`Question ${q.question_number} is missing one or more options`);
    }
    if (!ANSWER_OPTIONS.includes(q.correct_answer)) {
      validationIssues.push(`Question ${q.question_number} is missing a valid correct option`);
    }
  });

  const status = quiz ? getQuizStatus(quiz) : 'upcoming';
  const isLive = status === 'open' && liveAttemptCount > 0;

  // ---- Preview Mode ----
  if (showPreview && quizId) {
    return (
      <div className="min-h-screen bg-slate-50">
        <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
          <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
            <button
              onClick={() => setShowPreview(false)}
              className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 transition"
            >
              <ArrowLeft className="w-4 h-4" /> Back to Editor
            </button>
            <h1 className="text-lg font-bold text-slate-900 ml-2">Preview: {title}</h1>
          </div>
        </header>
        <main className="max-w-3xl mx-auto px-4 py-6">
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-6 text-sm text-blue-800">
            This is a preview of how students will see the exam. No attempt will be started.
          </div>
          <div className="space-y-4">
            {validQuestions.map((q, i) => (
              <div key={i} className="space-y-4">
                {q.group_id && groupContexts[q.group_id] && (
                  <PreviewGroupContext content={groupContexts[q.group_id]} />
                )}
                <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                <div className="flex gap-3 mb-4">
                  <span className="flex-shrink-0 w-10 h-10 bg-blue-100 text-blue-700 rounded-xl flex items-center justify-center text-lg font-bold">
                    {q.question_number}
                  </span>
                  <p className="text-lg text-slate-900 font-medium pt-1.5">{q.question_text}</p>
                </div>
                <div className="grid grid-cols-1 gap-2.5">
                  {(['A', 'B', 'C', 'D'] as const).map((letter) => (
                    <div
                      key={letter}
                      className="flex items-center gap-3 px-4 py-3.5 rounded-xl border-2 border-slate-200 bg-slate-50 text-slate-700"
                    >
                      <span className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold bg-slate-200 text-slate-500">
                        {letter}
                      </span>
                      <span className="text-base">
                        {q[`option_${letter.toLowerCase()}` as keyof QuestionDraft] as string}
                      </span>
                    </div>
                  ))}
                </div>
                </div>
              </div>
            ))}
            {validQuestions.length === 0 && (
              <div className="text-center py-12 text-slate-400">
                <p>No questions to preview yet.</p>
              </div>
            )}
          </div>
        </main>
      </div>
    );
  }

  // ---- Details Step (create mode only) ----
  if (step === 'details') {
    return (
      <div className="min-h-screen bg-slate-50">
        <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
          <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-4">
            <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg transition">
              <ArrowLeft className="w-5 h-5 text-slate-600" />
            </button>
            <h1 className="text-lg font-bold text-slate-900">Create New Paper</h1>
          </div>
        </header>
        <main className="max-w-2xl mx-auto px-4 py-6">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-sm mb-4">
              {error}
            </div>
          )}
          <form onSubmit={handleDetailsNext} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Paper Title</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="History AM - Paper 01"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Description (optional)</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="A brief description of this paper"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Exam Date</label>
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
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Start Time</label>
                <input
                  type="datetime-local"
                  required
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">End Time</label>
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
              The exam will be accessible to students only between the start and end times.
              Students get 40 minutes from when they start.
            </p>
            <button
              type="submit"
              className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-6 py-3 rounded-xl transition"
            >
              Next: Add Questions
            </button>
          </form>
        </main>
      </div>
    );
  }

  // ---- Questions Step ----
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-3 flex-wrap">
          <button
            onClick={() => {
              if (mode === 'create') {
                onBack();
              } else {
                onSaved();
              }
            }}
            className="p-2 hover:bg-slate-100 rounded-lg transition"
          >
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </button>
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-blue-600" />
            <h1 className="text-lg font-bold text-slate-900">{title || 'New Paper'}</h1>
          </div>
          <div className="ml-auto flex items-center gap-3 flex-wrap">
            {quiz && (
              <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                status === 'open' ? 'bg-blue-100 text-blue-700' :
                status === 'closed' ? 'bg-orange-100 text-orange-700' :
                'bg-slate-100 text-slate-600'
              }`}>
                {status === 'open' ? 'Live' : status === 'closed' ? 'Closed' : 'Upcoming'}
              </span>
            )}
            <span className="text-sm text-slate-500">
              Questions: {filledCount} / {TARGET_QUESTIONS}
            </span>
            {lastSaved && (
              <span className="text-xs text-slate-400 hidden sm:inline">
                Last saved: {lastSaved.toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 pb-32">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-sm mb-4">
            {error}
          </div>
        )}
        {statusMsg && (
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-green-700 text-sm mb-4 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            {statusMsg}
            {lastSaved && <span className="text-green-500 ml-2">at {lastSaved.toLocaleTimeString()}</span>}
          </div>
        )}

        {/* Live exam warning */}
        {isLive && (
          <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 text-amber-800 text-sm mb-4 flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Students are currently taking this examination.</p>
              <p className="text-amber-700 mt-0.5">Changing questions or answers may affect active attempts. Save only verified corrections while the exam is live.</p>
            </div>
          </div>
        )}

        {!isLive && liveAttemptCount > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-blue-800 text-sm mb-4 flex items-start gap-2">
            <FileCheck className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">This paper has submitted attempts.</p>
              <p className="text-blue-700 mt-0.5">After correcting the answer key, save the paper, then use Regenerate Results in the dashboard to recalculate scores and rankings.</p>
            </div>
          </div>
        )}

        {/* Readiness indicator */}
        {isReady ? (
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-green-700 text-sm mb-4 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5" />
            <span className="font-medium">Paper is ready</span>
            <span className="text-green-500">- All {TARGET_QUESTIONS} questions complete</span>
          </div>
        ) : validationIssues.length > 0 ? (
          <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-600 text-sm mb-4">
            <p className="font-medium mb-1">Before publishing, fix these:</p>
            <ul className="list-disc list-inside space-y-0.5 text-slate-500">
              {validationIssues.slice(0, 5).map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mb-6 rounded-2xl border border-blue-200 bg-blue-50/50 p-4 shadow-sm">
          <div className="mb-3 flex items-start gap-3">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-blue-100">
              <Sparkles className="h-4 w-4 text-blue-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">AI Question Import (PDF)</h2>
              <p className="text-sm text-slate-500">
                Upload your exam paper as a PDF and Claude will read it and fill in the questions
                below automatically — including grouping any questions that share a table
                ("Answer questions 1–5 based on the table below"). Export Word/Google Docs as
                PDF first (File → Download → PDF). Always double-check the extracted questions
                and correct answers before publishing.
              </p>
            </div>
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500">
            {aiUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {aiUploading ? 'Reading PDF…' : 'Upload PDF'}
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              disabled={aiUploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleAiPdfUpload(file);
                e.target.value = '';
              }}
            />
          </label>
        </div>

        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Bulk Question Import</h2>
              <p className="text-sm text-slate-500">
                Paste your questions below. Put each question and its options on their own line,
                for example:
              </p>
              <pre className="text-xs bg-slate-50 border border-slate-200 rounded-lg p-3 mt-1 text-slate-600 whitespace-pre-wrap">
{`1. Question text?
A. option
B. option
C. option
D. option`}
              </pre>
            </div>
            <button
              type="button"
              onClick={() => setBulkImportText('')}
              className="text-sm font-medium text-slate-500 hover:text-slate-700 transition"
            >
              Clear
            </button>
          </div>
          <textarea
            value={bulkImportText}
            onChange={(e) => setBulkImportText(e.target.value)}
            rows={8}
            className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="1. Who was the first president of the United States?\nA. Abraham Lincoln\nB. George Washington\nC. Thomas Jefferson\nD. John Adams\n\n2. Which planet is known as the Red Planet?\nA. Mars\nB. Venus\nC. Jupiter\nD. Mercury"
          />
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={applyBulkImport}
              className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500"
            >
              Import Questions
            </button>
            <button
              type="button"
              onClick={() => setQuestions((prev) => prev.slice(0, TARGET_QUESTIONS))}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
            >
              Keep Current Set
            </button>
          </div>
        </div>

        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Quick Answer Key Grid</h2>
              <p className="text-sm text-slate-500">Tap the correct letter for each question number, or paste a full answer schedule below.</p>
            </div>
            <span className="text-xs font-medium uppercase tracking-[0.2em] text-slate-400">{filledCount}/{TARGET_QUESTIONS}</span>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
            {Array.from({ length: TARGET_QUESTIONS }, (_, index) => {
              const questionNumber = index + 1;
              const currentQuestion = questions.find((q) => q.question_number === questionNumber) || questions[index] || emptyQuestion(questionNumber);
              return (
                <div key={questionNumber} className="rounded-xl border border-slate-200 bg-slate-50 p-2">
                  <div className="mb-2 text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                    Q{questionNumber}
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    {ANSWER_OPTIONS.map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => {
                          setQuestions((prev) => {
                            const next = [...prev];
                            const targetIndex = next.findIndex((q) => q.question_number === questionNumber);
                            const safeIndex = targetIndex >= 0 ? targetIndex : Math.min(index, next.length);
                            if (safeIndex >= 0 && next[safeIndex]) {
                              next[safeIndex] = {
                                ...next[safeIndex],
                                question_number: questionNumber,
                                correct_answer: option,
                                dirty: true,
                                saved: false,
                              };
                            } else {
                              next.push({ ...emptyQuestion(questionNumber), question_number: questionNumber, correct_answer: option });
                            }
                            return next.slice(0, TARGET_QUESTIONS);
                          });
                        }}
                        className={`rounded-lg px-1 py-1.5 text-xs font-bold transition ${
                          currentQuestion.correct_answer === option
                            ? 'bg-green-500 text-white'
                            : 'bg-white text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4">
            <label className="mb-2 block text-sm font-medium text-slate-700">Answer Key Paste</label>
            <textarea
              value={answerKeyText}
              onChange={(e) => setAnswerKeyText(e.target.value)}
              rows={3}
              className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="1-A, 2-C, 3-B, 4-D\nA, C, B, D"
            />
            <div className="mt-3 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={applyAnswerKey}
                className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700"
              >
                Apply Answer Key
              </button>
              <button
                type="button"
                onClick={() => setAnswerKeyText('')}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
              >
                Clear
              </button>
            </div>
          </div>
        </div>

        {/* Questions list */}
        {questionsLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        ) : (
          <div className="space-y-4">
            {questions.map((q, idx) => (
              <div
                key={idx}
                className={`bg-white border rounded-2xl p-5 shadow-sm ${
                  q.dirty ? 'border-amber-200' : q.saved ? 'border-slate-200' : 'border-slate-200'
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className="flex-shrink-0 w-8 h-8 bg-slate-100 text-slate-700 rounded-lg flex items-center justify-center text-sm font-semibold">
                      {q.question_number}
                    </span>
                    {q.saving && <Loader2 className="w-4 h-4 animate-spin text-blue-500" />}
                    {q.saved && !q.dirty && !q.saving && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                    {q.dirty && <span className="text-xs text-amber-600 font-medium">unsaved</span>}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => duplicateQuestion(idx)}
                      title="Duplicate question"
                      className="p-1.5 hover:bg-slate-100 rounded-lg transition"
                    >
                      <Copy className="w-4 h-4 text-slate-400" />
                    </button>
                    <button
                      onClick={() => removeQuestion(idx)}
                      title="Remove question"
                      className="p-1.5 hover:bg-red-50 rounded-lg transition"
                    >
                      <Trash2 className="w-4 h-4 text-red-400" />
                    </button>
                  </div>
                </div>

                <textarea
                  value={q.question_text}
                  onChange={(e) => updateQuestion(idx, 'question_text', e.target.value)}
                  rows={2}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none mb-3"
                  placeholder={`Question ${q.question_number} text...`}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(['A', 'B', 'C', 'D'] as const).map((letter) => {
                    const optionFieldMap = {
                      A: 'option_a',
                      B: 'option_b',
                      C: 'option_c',
                      D: 'option_d',
                    } as const;
                    const optionField = optionFieldMap[letter];

                    return (
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
                          value={q[optionField] as string}
                          onChange={(e) => updateQuestion(idx, optionField, e.target.value)}
                          className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder={`Option ${letter}`}
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between mt-3">
                  <p className="text-xs text-slate-400">
                    Click the letter button to mark the correct answer. Green = correct.
                  </p>
                  {!q.id && q.question_text.trim() && (
                    <button
                      onClick={() => handleSaveSingleNewQuestion(idx)}
                      className="text-sm font-medium text-blue-600 hover:text-blue-500 transition flex items-center gap-1"
                    >
                      <Save className="w-4 h-4" /> Save Question
                    </button>
                  )}
                </div>
              </div>
            ))}

            {questions.length === 0 && !questionsLoading && (
              <div className="text-center py-12 text-slate-400">
                <FileCheck className="w-12 h-12 mx-auto mb-3 opacity-40" />
                <p>No questions yet. Click "Add Question" to start.</p>
              </div>
            )}
          </div>
        )}

        {/* Add question button */}
        {!questionsLoading && (
          <button
            onClick={addQuestion}
            className="w-full mt-4 flex items-center justify-center gap-2 bg-white border-2 border-dashed border-slate-300 hover:border-blue-400 hover:bg-blue-50/50 text-slate-600 hover:text-blue-600 font-medium px-6 py-4 rounded-2xl transition"
          >
            <Plus className="w-5 h-5" /> Add Question
          </button>
        )}
      </main>

      {/* Bottom action bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 p-4 z-20">
        <div className="max-w-5xl mx-auto flex items-center gap-3 flex-wrap">
          {mode === 'create' && (
            <button
              onClick={() => setStep('details')}
              className="px-5 py-3 rounded-xl border border-slate-300 text-slate-700 font-medium hover:bg-slate-100 transition"
            >
              Back
            </button>
          )}
          <button
            onClick={handleSaveDraft}
            disabled={saving}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold px-6 py-3 rounded-xl transition"
          >
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
            {saving ? 'Saving...' : mode === 'edit' ? 'Save Changes' : 'Save Draft'}
          </button>
          {quizId && (
            <button
              onClick={() => setShowPreview(true)}
              className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium px-5 py-3 rounded-xl transition"
            >
              <Eye className="w-5 h-5" /> Preview
            </button>
          )}
          <button
            onClick={onSaved}
            className="ml-auto text-sm text-slate-500 hover:text-slate-700 transition px-4 py-3"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
