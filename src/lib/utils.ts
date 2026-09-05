import type { Quiz, QuizStatus } from './supabase';

export function getQuizStatus(quiz: Quiz): QuizStatus {
  const now = new Date();
  const start = new Date(quiz.start_time);
  const end = new Date(quiz.end_time);
  if (now < start) return 'upcoming';
  if (now >= start && now <= end) return 'open';
  return 'closed';
}

export function isEarlyAccess(quiz: Quiz): boolean {
  const now = new Date();
  const start = new Date(quiz.start_time);
  const earlyWindow = new Date(start.getTime() - 10 * 60 * 1000);
  return now >= earlyWindow && now < start;
}

export function isAccessible(quiz: Quiz): boolean {
  const now = new Date();
  const start = new Date(quiz.start_time);
  const end = new Date(quiz.end_time);
  const earlyWindow = new Date(start.getTime() - 10 * 60 * 1000);
  return now >= earlyWindow && now <= end;
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function formatCountdown(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, '0')},${m.toString().padStart(2, '0')},${s.toString().padStart(2, '0')}`;
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return '-';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatTimeOfDay(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function toLocalDateTimeInput(dateStr: string): string {
  const d = new Date(dateStr);
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 16);
}

export function downloadCSV(filename: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(','),
    ...rows.map((row) =>
      headers
        .map((h) => {
          const val = row[h];
          const str = val === null || val === undefined ? '' : String(val);
          if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        })
        .join(',')
    ),
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const ENGLISH_TEXT_REGEX = /^[\x20-\x7E]+$/;

export function isEnglishText(text: string): boolean {
  if (!text) return true;
  return ENGLISH_TEXT_REGEX.test(text);
}

export function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9]/g, '');
}
