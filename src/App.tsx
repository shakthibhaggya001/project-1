import { useState } from 'react';
import { AuthProvider, useAuth } from '@/lib/auth';
import Home from '@/components/Home';
import AdminLogin from '@/components/AdminLogin';
import AdminDashboard from '@/components/AdminDashboard';
import PaperEditor from '@/components/PaperEditor';
import StudentQuiz from '@/components/StudentQuiz';
import CheckRank from '@/components/CheckRank';
import { Loader2 } from 'lucide-react';
import type { Quiz } from '@/lib/supabase';

type Route = 'home' | 'take-quiz' | 'check-rank' | 'admin' | 'create-quiz' | 'edit-paper';

function AppContent() {
  const { session, loading, signOut } = useAuth();
  const [route, setRoute] = useState<Route>('home');
  const [editingQuiz, setEditingQuiz] = useState<Quiz | null>(null);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  // Admin routes require auth
  if (route === 'admin' || route === 'create-quiz' || route === 'edit-paper') {
    if (!session) {
      return <AdminLogin />;
    }
    if (route === 'create-quiz') {
      return <PaperEditor quiz={null} mode="create" onBack={() => setRoute('admin')} onSaved={() => setRoute('admin')} />;
    }
    if (route === 'edit-paper' && editingQuiz) {
      return <PaperEditor quiz={editingQuiz} mode="edit" onBack={() => setRoute('admin')} onSaved={() => setRoute('admin')} />;
    }
    return (
      <AdminDashboard
        onCreateQuiz={() => setRoute('create-quiz')}
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
      onTakeQuiz={() => setRoute('take-quiz')}
      onCheckRank={() => setRoute('check-rank')}
      onAdmin={() => setRoute('admin')}
    />
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
