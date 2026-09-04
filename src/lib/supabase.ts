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

export type SiteSettings = {
  id: number;
  portal_title: string;
  subtitle: string;
  description: string;
  contact_numbers: string;
  poster_url: string;
  primary_color: string;
  background_color: string;
  card_color: string;
  updated_at: string;
};

export const defaultSiteSettings: Omit<SiteSettings, 'id' | 'updated_at'> = {
  portal_title: 'Test your knowledge. Claim your rank.',
  subtitle: 'Online Examination Portal',
  description: '40 questions. 40 minutes. Take the timed exam and check your results as soon as they are published.',
  contact_numbers: '',
  poster_url: '/ChatGPT_Image_Sep_3,_2026,_08_13_21_AM.png',
  primary_color: '#1c4f9d',
  background_color: '#171918',
  card_color: '#2b312c',
};

const siteSettingsStorageKey = 'am-class-site-settings';
const siteSettingsPendingKey = 'am-class-site-settings-pending';

export function getLocalSiteSettings(): Omit<SiteSettings, 'id' | 'updated_at'> | null {
  try {
    const stored = localStorage.getItem(siteSettingsStorageKey);
    return stored ? { ...defaultSiteSettings, ...JSON.parse(stored) } : null;
  } catch {
    return null;
  }
}

export function storeLocalSiteSettings(settings: Omit<SiteSettings, 'id' | 'updated_at'>) {
  try {
    localStorage.setItem(siteSettingsStorageKey, JSON.stringify(settings));
    localStorage.setItem(siteSettingsPendingKey, 'true');
  } catch {
    // Database persistence remains available if browser storage is full or disabled.
  }
}

export async function loadSiteSettings() {
  const localSettings = getLocalSiteSettings();
  let hasPendingLocalSettings = false;
  try {
    hasPendingLocalSettings = localStorage.getItem(siteSettingsPendingKey) === 'true';
  } catch {
    hasPendingLocalSettings = false;
  }
  if (localSettings && hasPendingLocalSettings) {
    return { settings: localSettings, error: null };
  }
  const { data, error } = await supabase.from('site_settings').select('*').eq('id', 1).maybeSingle();
  if (data && !error) {
    const settings = { ...defaultSiteSettings, ...(data as SiteSettings) };
    return { settings, error: null };
  }
  return { settings: localSettings ?? defaultSiteSettings, error };
}

export async function saveSiteSettings(settings: Omit<SiteSettings, 'id' | 'updated_at'>) {
  storeLocalSiteSettings(settings);
  const { error } = await supabase.from('site_settings').upsert({ id: 1, ...settings }, { onConflict: 'id' });
  if (!error) {
    try {
      localStorage.removeItem(siteSettingsStorageKey);
      localStorage.removeItem(siteSettingsPendingKey);
    } catch {
      // The database is authoritative after a successful save.
    }
  }
  return error;
}
