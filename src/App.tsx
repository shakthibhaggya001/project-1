import { useState } from 'react';
import { AuthProvider, useAuth } from '@/lib/auth';
import Home from '@/components/Home';
import AdminLogin from '@/components/AdminLogin';
import AdminDashboard from '@/components/AdminDashboard';
import PaperEditor from '@/components/PaperEditor';
import StudentQuiz from '@/components/StudentQuiz';
import CheckRank from '@/components/CheckRank';
import SiteSettings from '@/components/SiteSettings';
import StudentLoginForm from '@/components/StudentLoginForm';
import AdminAttemptsView from '@/components/AdminAttemptsView';
import ExamAttemptStarted from '@/components/ExamAttemptStarted';
import { SiteSettingsProvider, useSiteSettings } from '@/lib/siteSettings';
import { Loader2 } from 'lucide-react';
import type { Quiz } from '@/lib/supabase';
import type { Exam, ExamAttempt } from '@/types';

type Route = 'home' | 'take-quiz' | 'student-login' | 'attempt-started' | 'check-rank' | 'admin' | 'admin-attempts' | 'create-quiz' | 'edit-paper' | 'site-settings';

function AppContent() {
  const { session, isAdmin, loading, signOut } = useAuth();
  const { loading: settingsLoading } = useSiteSettings();
  const [route, setRoute] = useState<Route>(() => {
    if (window.location.pathname === '/admin') return 'admin-attempts';
    if (window.location.pathname === '/student-login') return 'student-login';
    return 'home';
  });
  const [editingQuiz, setEditingQuiz] = useState<Quiz | null>(null);
  const [startedAttempt, setStartedAttempt] = useState<ExamAttempt | null>(null);
  const [startedExam, setStartedExam] = useState<Exam | null>(null);

  if (loading || settingsLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (route === 'admin-attempts') return <AdminAttemptsView onBack={() => setRoute('home')} />;
  if (route === 'student-login') return <StudentLoginForm onBack={() => setRoute('home')} onStarted={(attempt, exam) => { setStartedAttempt(attempt); setStartedExam(exam); setRoute('attempt-started'); }} />;
  if (route === 'attempt-started' && startedAttempt && startedExam) return <ExamAttemptStarted attempt={startedAttempt} exam={startedExam} onBack={() => setRoute('home')} />;

  // Admin routes require auth
  if (route === 'admin' || route === 'create-quiz' || route === 'edit-paper' || route === 'site-settings') {
    if (!session) {
      return <AdminLogin />;
    }
    if (!isAdmin) {
      return <AdminLogin />;
    }
    if (route === 'create-quiz') {
      return <PaperEditor quiz={null} mode="create" onBack={() => setRoute('admin')} onSaved={() => setRoute('admin')} />;
    }
    if (route === 'edit-paper' && editingQuiz) {
      return <PaperEditor quiz={editingQuiz} mode="edit" onBack={() => setRoute('admin')} onSaved={() => setRoute('admin')} />;
    }
    if (route === 'site-settings') {
      return <SiteSettings onBack={() => setRoute('admin')} />;
    }
    return (
      <AdminDashboard
        onCreateQuiz={() => setRoute('create-quiz')}
        onSiteSettings={() => setRoute('site-settings')}
        onEditPaper={(quiz: Quiz) => {
          setEditingQuiz(quiz);
          setRoute('edit-paper');
        }}
        onSignOut={async () => {
          await signOut();
          setRoute('home');
        }}
      />
    );
  }

  if (route === 'take-quiz') {
    return <StudentQuiz onBack={() => setRoute('home')} />;
  }

  if (route === 'check-rank') {
    return <CheckRank onBack={() => setRoute('home')} />;
  }

  return (
    <Home
      onTakeQuiz={() => setRoute('student-login')}
      onCheckRank={() => setRoute('check-rank')}
      onAdmin={() => setRoute('admin')}
    />
  );
}

export default function App() {
  return (
    <AuthProvider>
      <SiteSettingsProvider>
        <AppContent />
      </SiteSettingsProvider>
    </AuthProvider>
  );
}
 