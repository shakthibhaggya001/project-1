import { supabase } from '@/lib/supabase';
import { normalizePhone } from '@/lib/utils';
import type { Quiz, Submission, Student } from '@/lib/supabase';

export const DUPLICATE_DETAILS_ERROR = 'This WhatsApp number is already registered with different details (name, grade, or school). Please enter your original registration details exactly.';
export const DUPLICATE_ATTEMPT_ERROR = 'You have already attempted this exam. Multiple attempts are not allowed.';

type LoginResult = { student: Student; submission: Submission; quiz: Quiz } | { error: string };

const normalizeStudentWhatsapp = (value: string) => {
  const digits = normalizePhone(value);
  if (digits.startsWith('94') && digits.length === 11) return `0${digits.slice(2)}`;
  if (digits.startsWith('7') && digits.length === 9) return `0${digits}`;
  return digits;
};

// Uses the start_or_resume_attempt RPC (SECURITY DEFINER) instead of direct
// table inserts. Direct .from('students')/.from('submissions').insert()
// calls are blocked by row-level security — those tables are locked down
// to admin-only reads/writes so that student PII and the answer key are
// never directly exposed to anonymous clients. The RPC runs server-side
// with elevated privileges and already implements student identity
// lookup/creation, duplicate-attempt detection, and resume handling.
export async function handleStudentLogin(
  fullName: string,
  grade: number,
  whatsapp: string,
  school: string,
  quiz: Quiz,
): Promise<LoginResult> {
  const normalizedName = fullName.trim();
  const normalizedWhatsapp = normalizeStudentWhatsapp(whatsapp);
  const normalizedSchool = school.trim();

  try {
    const { data, error } = await supabase.rpc('start_or_resume_attempt', {
      p_quiz_id: quiz.id,
      p_student_name: normalizedName,
      p_whatsapp_number: normalizedWhatsapp,
      p_grade: grade,
      p_school_name: normalizedSchool,
    });

    if (error) return { error: error.message };

    const result = data as {
      error?: string;
      message?: string;
      ok?: boolean;
      submission_id?: string;
      student_id?: string;
      attempt_started_at?: string;
      saved_answers?: Record<string, string>;
    } | null;

    if (!result || result.error) {
      const code = result?.error;
      if (code === 'already_submitted' || code === 'resume_not_allowed') {
        return { error: result?.message || DUPLICATE_ATTEMPT_ERROR };
      }
      return { error: result?.message || 'Unable to start the exam. Please try again.' };
    }

    const now = new Date().toISOString();
    const student: Student = {
      id: result.student_id || '',
      full_name: normalizedName,
      school: normalizedSchool,
      grade,
      whatsapp_number: normalizedWhatsapp,
      normalized_whatsapp: normalizedWhatsapp,
      created_at: now,
      updated_at: now,
    };

    const submission: Submission = {
      id: result.submission_id || '',
      quiz_id: quiz.id,
      student_name: normalizedName,
      student_identifier: normalizedWhatsapp,
      grade,
      school_name: normalizedSchool,
      whatsapp_number: normalizedWhatsapp,
      answers: result.saved_answers || {},
      score: 0,
      rank: null,
      started_at: result.attempt_started_at || now,
      submitted_at: '',
      time_taken_seconds: null,
      attempt_started_at: result.attempt_started_at || now,
      photo_url: '',
      photo_uploaded_at: null,
      created_at: now,
      status: 'in_progress',
      resume_allowed: false,
      resume_granted_by: '',
      resume_granted_at: null,
      resume_reason: '',
      last_activity_at: now,
      normalized_name: normalizedName.toUpperCase(),
      normalized_whatsapp: normalizedWhatsapp,
      student_id: result.student_id || null,
      time_extension_until: null,
      time_extension_granted_by: '',
      time_extension_granted_at: null,
      time_extension_reason: '',
      ip_address: null,
      device_fingerprint: null,
    };

    return { student, submission, quiz };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unable to start the exam. Please try again.' };
  }
}
