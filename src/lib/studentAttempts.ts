import { supabase } from '@/lib/supabase';
import { getClientIp } from '@/lib/getClientIp';
import { getDeviceId } from '@/lib/getDeviceId';
import { normalizePhone } from '@/lib/utils';
import type { Quiz, Submission } from '@/lib/supabase';
import type { Student } from '@/types';

export const DUPLICATE_DETAILS_ERROR = 'This WhatsApp number is already registered with different details (name, grade, or school). Please enter your original registration details exactly.';
export const DUPLICATE_ATTEMPT_ERROR = 'You have already attempted this exam. Multiple attempts are not allowed.';

type LoginResult = { student: Student; submission: Submission; quiz: Quiz } | { error: string };

const sameIdentityText = (left: string, right: string) => left.trim().toLowerCase() === right.trim().toLowerCase();
const isUniqueViolation = (error: { code?: string } | null) => error?.code === '23505';
const normalizeStudentWhatsapp = (value: string) => {
  const digits = normalizePhone(value);
  if (digits.startsWith('94') && digits.length === 11) return `0${digits.slice(2)}`;
  if (digits.startsWith('7') && digits.length === 9) return `0${digits}`;
  return digits;
};

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
    const { data: whatsappRow, error: whatsappError } = await supabase
      .from('students')
      .select('*')
      .eq('normalized_whatsapp', normalizedWhatsapp)
      .maybeSingle();
    if (whatsappError) return { error: whatsappError.message };

    let student: Student;
    if (whatsappRow) {
      const existing = whatsappRow as Student;
      if (!sameIdentityText(existing.full_name, normalizedName)
        || existing.grade !== grade
        || !sameIdentityText(existing.school, normalizedSchool)) {
        return { error: DUPLICATE_DETAILS_ERROR };
      }
      student = existing;
    } else {
      const { data: insertedStudent, error: insertError } = await supabase
        .from('students')
        .insert({
          full_name: normalizedName,
          grade,
          whatsapp_number: normalizedWhatsapp,
          normalized_whatsapp: normalizedWhatsapp,
          school: normalizedSchool,
        })
        .select('*')
        .single();
      if (insertError) {
        if (isUniqueViolation(insertError)) return { error: DUPLICATE_DETAILS_ERROR };
        return { error: insertError.message };
      }
      student = insertedStudent as Student;
    }

    const { data: existingAttempt, error: attemptLookupError } = await supabase
      .from('submissions')
      .select('*')
      .eq('student_id', student.id)
      .eq('quiz_id', quiz.id)
      .maybeSingle();
    if (attemptLookupError) return { error: attemptLookupError.message };
    if (existingAttempt) return { error: DUPLICATE_ATTEMPT_ERROR };

    const [deviceFingerprint, ipAddress] = await Promise.all([getDeviceId(), getClientIp()]);
    const { data: submission, error: attemptInsertError } = await supabase
      .from('submissions')
      .insert({
        student_id: student.id,
        quiz_id: quiz.id,
        student_name: normalizedName,
        student_identifier: normalizedWhatsapp,
        answers: {},
        score: 0,
        device_fingerprint: deviceFingerprint,
        ip_address: ipAddress,
        started_at: new Date().toISOString(),
      })
      .select('*')
      .single();
    if (attemptInsertError) {
      return { error: isUniqueViolation(attemptInsertError) ? DUPLICATE_ATTEMPT_ERROR : attemptInsertError.message };
    }

    return { student, submission: submission as Submission, quiz };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unable to start the exam. Please try again.' };
  }
}