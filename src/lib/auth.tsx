import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

type AuthContextType = {
  session: Session | null;
  isAdmin: boolean;
  refreshAdmin: () => Promise<boolean>;
  claimAdminAccess: (code: string) => Promise<string | null>;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const refreshAdmin = async () => {
    const { data } = await supabase.rpc('is_admin');
    const authorized = data === true;
    setIsAdmin(authorized);
    return authorized;
  };

  const claimAdminAccess = async (code: string) => {
    const { data, error } = await supabase.rpc('claim_admin_access', { p_code: code });
    if (error) return error.message;
    if (!(data as { ok?: boolean } | null)?.ok) {
      return (data as { error?: string } | null)?.error || 'Invalid admin access code.';
    }
    setIsAdmin(true);
    return null;
  };
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const initializeSession = async () => {
      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (!active) return;

        if (sessionError || !sessionData.session) {
          setSession(null);
          setLoading(false);
          return;
        }

        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (!active) return;

        if (userError || !userData.user) {
          await supabase.auth.signOut();
          setSession(null);
          setLoading(false);
          return;
        }

        setSession(sessionData.session);
        await refreshAdmin();
      } catch {
        if (!active) return;
        setSession(null);
      } finally {
        if (active) setLoading(false);
      }
    };

    initializeSession();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (!s) {
        setIsAdmin(false);
      } else {
        void refreshAdmin();
      }
      setLoading(false);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  };

  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    return { error: error?.message ?? null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setIsAdmin(false);
  };

  return (
    <AuthContext.Provider value={{ session, isAdmin, refreshAdmin, claimAdminAccess, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
