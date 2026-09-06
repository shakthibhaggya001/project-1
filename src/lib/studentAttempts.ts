import { supabase } from '@/lib/supabase';
import { getClientIp } from '@/lib/getClientIp';
import { getDeviceId } from '@/lib/getDeviceId';
import { normalizePhone } from '@/lib/utils';
import type { Quiz, Submission } from '@/lib/supabase';
import type { Student } from '@/types';

export const DUPLICATE_GMAIL_ERROR = 'This Gmail is already registered with different details. Please enter your original registration details exactly.';
export const DUPLICATE_WHATSAPP_ERROR = 'This WhatsApp number is already registered under a different account.';
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
  gmail: string,
  fullName: string,
  whatsapp: string,
  school: string,
  quiz: Quiz,
): Promise<LoginResult> {
  const normalizedGmail = gmail.trim();
  const normalizedName = fullName.trim();
  const normalizedWhatsapp = normalizeStudentWhatsapp(whatsapp);
  const normalizedSchool = school.trim();

  try {
    const { data: gmailRow, error: gmailError } = await supabase
      .from('students')
      .select('*')
      .eq('gmail', normalizedGmail)
      .maybeSingle();
    if (gmailError) return { error: gmailError.message };

    let student: Student;
    if (gmailRow) {
      const existing = gmailRow as Student;
      if (!sameIdentityText(existing.full_name, normalizedName)
        || (normalizeStudentWhatsapp(existing.normalized_whatsapp || existing.whatsapp_number) !== normalizedWhatsapp)
        || !sameIdentityText(existing.school, normalizedSchool)) {
        return { error: DUPLICATE_GMAIL_ERROR };
      }
      student = existing;
    } else {
      const { data: whatsappRow, error: whatsappError } = await supabase
        .from('students')
        .select('*')
        .or(`normalized_whatsapp.eq.${normalizedWhatsapp},whatsapp_number.eq.${normalizedWhatsapp}`)
        .maybeSingle();
      if (whatsappError) return { error: whatsappError.message };
      if (whatsappRow) return { error: DUPLICATE_WHATSAPP_ERROR };

      const { data: insertedStudent, error: insertError } = await supabase
        .from('students')
        .insert({
          gmail: normalizedGmail,
          full_name: normalizedName,
          whatsapp_number: normalizedWhatsapp,
          normalized_whatsapp: normalizedWhatsapp,
          school: normalizedSchool,
        })
        .select('*')
        .single();
      if (insertError) {
        if (isUniqueViolation(insertError)) {
          const { data: gmailConflict } = await supabase.from('students').select('id').eq('gmail', normalizedGmail).maybeSingle();
          return { error: gmailConflict ? DUPLICATE_GMAIL_ERROR : DUPLICATE_WHATSAPP_ERROR };
        }
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