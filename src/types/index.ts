export interface Student {
  id: string;
  gmail: string;
  student_name: string;
  whatsapp_number: string;
  school: string;
  created_at: string;
}

export interface Exam {
  id: string;
  exam_name: string;
  is_active: boolean;
  starts_at: string;
  ends_at: string;
  created_at: string;
}

export interface ExamAttempt {
  id: string;
  student_id: string;
  exam_id: string;
  ip_address: string | null;
  device_fingerprint: string | null;
  started_at: string;
  submitted_at: string | null;
  score: number | null;
  students?: Pick<Student, 'student_name' | 'gmail' | 'whatsapp_number' | 'school'> | null;
}