export interface Student {
  id: string;
  full_name: string;
  gmail: string;
  whatsapp_number: string;
  normalized_whatsapp: string;
  school: string;
  grade: number | null;
  created_at: string;
  updated_at: string;
}

export interface StudentEntry {
  gmail: string;
  fullName: string;
  whatsapp: string;
  school: string;
}