import { supabase } from '@/lib/supabase';
import { getClientIp } from '@/lib/getClientIp';
import { getDeviceId } from '@/lib/getDeviceId';
import type { ExamAttempt, Student } from '@/types';

export const DUPLICATE_GMAIL_ERROR = 'This Gmail is already registered with different details. Please enter your original registration details exactly.';
export const DUPLICATE_WHATSAPP_ERROR = 'This WhatsApp number is already registered under a different account.';
export const DUPLICATE_ATTEMPT_ERROR = 'You have already attempted this exam. Multiple attempts are not allowed.';

type LoginResult = { student: Student; attempt: ExamAttempt } | { error: string };

const sameIdentityText = (left: string, right: string) => left.trim().toLowerCase() === right.trim().toLowerCase();
const isUniqueViolation = (error: { code?: string } | null) => error?.code === '23505';

export async function handleStudentLogin(
  gmail: string,
  name: string,
  whatsapp: string,
  school: string,
  examId: string,
): Promise<LoginResult> {
  const normalizedGmail = gmail.trim();
  const normalizedName = name.trim();
  const normalizedWhatsapp = whatsapp.replace(/[\s-]/g, '').trim();
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
      if (!sameIdentityText(existing.student_name, normalizedName)
        || existing.whatsapp_number !== normalizedWhatsapp
        || !sameIdentityText(existing.school, normalizedSchool)) {
        return { error: DUPLICATE_GMAIL_ERROR };
      }
      student = existing;
    } else {
      const { data: whatsappRow, error: whatsappError } = await supabase
        .from('students')
        .select('*')
        .eq('whatsapp_number', normalizedWhatsapp)
        .maybeSingle();
      if (whatsappError) return { error: whatsappError.message };
      if (whatsappRow) return { error: DUPLICATE_WHATSAPP_ERROR };

      const { data: insertedStudent, error: insertError } = await supabase
        .from('students')
        .insert({ gmail: normalizedGmail, student_name: normalizedName, whatsapp_number: normalizedWhatsapp, school: normalizedSchool })
        .select('*')
        .single();
      if (insertError) {
        return { error: isUniqueViolation(insertError) ? 'These registration details are already in use. Please check your Gmail and WhatsApp number.' : insertError.message };
      }
      student = insertedStudent as Student;
    }

    const { data: existingAttempt, error: attemptLookupError } = await supabase
      .from('exam_attempts')
      .select('*')
      .eq('student_id', student.id)
      .eq('exam_id', examId)
      .maybeSingle();
    if (attemptLookupError) return { error: attemptLookupError.message };
    if (existingAttempt) return { error: DUPLICATE_ATTEMPT_ERROR };

    const [deviceFingerprint, ipAddress] = await Promise.all([getDeviceId(), getClientIp()]);
    const { data: attempt, error: attemptInsertError } = await supabase
      .from('exam_attempts')
      .insert({
        student_id: student.id,
        exam_id: examId,
        device_fingerprint: deviceFingerprint,
        ip_address: ipAddress,
        started_at: new Date().toISOString(),
      })
      .select('*')
      .single();
    if (attemptInsertError) {
      return { error: isUniqueViolation(attemptInsertError) ? DUPLICATE_ATTEMPT_ERROR : attemptInsertError.message };
    }

    return { student, attempt: attempt as ExamAttempt };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unable to start the exam. Please try again.' };
  }
}