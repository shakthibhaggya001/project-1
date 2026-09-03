import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

export type Quiz = {
  id: string;
  title: string;
  description: string;
  quiz_date: string;
  start_time: string;
  end_time: string;
  results_generated: boolean;
  results_confirmed: boolean;
  results_published: boolean;
  created_at: string;
  duplicated_from: string | null;
};

export type Question = {
  id: string;
  quiz_id: string;
  question_number: number;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_answer: 'A' | 'B' | 'C' | 'D';
};

export type Submission = {
  id: string;
  quiz_id: string;
  student_name: string;
  student_identifier: string;
  grade: number | null;
  school_name: string;
  whatsapp_number: string;
  answers: Record<string, string>;
  score: number;
  rank: number | null;
  started_at: string;
  submitted_at: string;
  time_taken_seconds: number | null;
  attempt_started_at: string | null;
  photo_url: string;
  photo_uploaded_at: string | null;
  created_at: string;
  status: 'in_progress' | 'interrupted' | 'submitted' | 'expired';
  resume_allowed: boolean;
  resume_granted_by: string;
  resume_granted_at: string | null;
  resume_reason: string;
  last_activity_at: string | null;
  normalized_name: string;
  normalized_whatsapp: string;
  student_id: string | null;
  time_extension_until: string | null;
  time_extension_granted_by: string;
  time_extension_granted_at: string | null;
  time_extension_reason: string;
};

export type Student = {
  id: string;
  full_name: string;
  school: string;
  grade: number | null;
  whatsapp_number: string;
  normalized_whatsapp: string;
  created_at: string;
  updated_at: string;
};

export type QuizStatus = 'upcoming' | 'open' | 'closed';
