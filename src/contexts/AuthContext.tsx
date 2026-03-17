import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { User, Session } from '@supabase/supabase-js';

export type OrgRole = 'super_admin' | 'admin' | 'approver' | 'viewer';

export interface Profile {
  id: string;
  user_id: string;
  full_name: string;
  department: string;
  role: OrgRole;
  avatar_url: string;
  org_id: string | null;
  preferences: Record<string, unknown>;
}

export interface Organization {
  id: string;
  name: string;
  logo_url: string | null;
  branding: Record<string, unknown>;
  owner_id: string;
  plan: string;
  created_at: string;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  organization: Organization | null;
  orgRole: OrgRole;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: unknown }>;
  signInWithMagicLink: (email: string) => Promise<{ error: unknown }>;
  signInWithMicrosoft: () => Promise<{ error: unknown }>;
  signUp: (email: string, password: string, fullName: string, orgName: string, department: string) => Promise<{ error: unknown }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: unknown }>;
  updateProfile: (updates: Partial<Profile>) => Promise<void>;
  refreshProfile: () => Promise<void>;
  hasPermission: (required: OrgRole[]) => boolean;
}

// DEMO MODE: Always show as Director Huzaifa Dawasaz (Dubai Media Office)
const DEV_MOCK_AUTH = false;

const MOCK_USER = {
  id: 'director-huzaifa',
  email: 'huzaifa.dawasaz@mediaoffice.ae',
  app_metadata: {},
  user_metadata: { full_name: 'Huzaifa Dawasaz' },
  aud: 'authenticated',
  created_at: '2024-01-01T00:00:00Z',
} as unknown as User;

const MOCK_SESSION = {
  access_token: 'mock-token',
  refresh_token: 'mock-refresh',
  user: MOCK_USER,
  expires_at: 9999999999,
  expires_in: 9999999,
  token_type: 'bearer',
} as unknown as Session;

const MOCK_PROFILE: Profile = {
  id: 'profile-director',
  user_id: 'director-huzaifa',
  full_name: 'Huzaifa Dawasaz',
  department: 'Media Operations',
  role: 'approver',
  avatar_url: '',
  org_id: 'org-mediaoffice',
  preferences: { theme: 'dark', language: 'en' },
};

const MOCK_ORG: Organization = {
  id: 'org-mediaoffice',
  name: 'Dubai Media Office',
  logo_url: null,
  branding: {},
  owner_id: 'director-huzaifa',
  plan: 'enterprise',
  created_at: '2024-01-01T00:00:00Z',
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(DEV_MOCK_AUTH ? MOCK_USER : null);
  const [session, setSession] = useState<Session | null>(DEV_MOCK_AUTH ? MOCK_SESSION : null);
  const [profile, setProfile] = useState<Profile | null>(DEV_MOCK_AUTH ? MOCK_PROFILE : null);
  const [organization, setOrganization] = useState<Organization | null>(DEV_MOCK_AUTH ? MOCK_ORG : null);
  const [loading, setLoading] = useState(DEV_MOCK_AUTH ? false : true);

  const orgRole: OrgRole = profile?.role || 'viewer';

  const fetchProfile = useCallback(async (userId: string) => {
    const { data } = await supabase.from('profiles').select('*').eq('user_id', userId).single();
    if (data) {
      setProfile(data as Profile);
      if (data.org_id) {
        const { data: org } = await supabase.from('organizations').select('*').eq('id', data.org_id).single();
        if (org) setOrganization(org as Organization);
      }
    }
    return data as Profile | null;
  }, []);

  useEffect(() => {
    if (DEV_MOCK_AUTH) return; // Skip real auth in mock mode — demo as Director Huzaifa Dawasaz

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) fetchProfile(s.user.id).finally(() => setLoading(false));
      else setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) fetchProfile(s.user.id);
      else { setProfile(null); setOrganization(null); }
    });
    return () => subscription.unsubscribe();
  }, [fetchProfile]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signInWithMagicLink = async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({ email });
    return { error };
  };

  const signInWithMicrosoft = async () => {
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'azure', options: { scopes: 'email profile' } });
    return { error };
  };

  const signUp = async (email: string, password: string, fullName: string, orgName: string, department: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName, org_name: orgName, department },
      },
    });

    if (error) {
      // Return user-friendly error messages
      if (error.message?.includes('rate limit') || error.status === 429) {
        return { error: 'Too many signup attempts. Please wait a few minutes and try again.' };
      }
      if (error.message?.includes('already registered')) {
        return { error: 'This email is already registered. Please sign in instead.' };
      }
      return { error: error.message || 'Signup failed. Please try again.' };
    }

    if (!data.user) return { error: 'Signup failed. Please try again.' };

    // Check if user already exists (empty identities = existing user)
    if (data.user.identities?.length === 0) {
      return { error: 'This email is already registered. Please sign in instead.' };
    }

    // Create organization
    const { data: org } = await supabase.from('organizations').insert({ name: orgName, owner_id: data.user.id, plan: 'starter' }).select().single();

    // Create profile
    await supabase.from('profiles').insert({
      user_id: data.user.id,
      full_name: fullName,
      department,
      role: 'super_admin',
      org_id: org?.id,
      preferences: { theme: 'dark', language: 'en' },
    });

    // Create org member
    if (org) {
      await supabase.from('org_members').insert({ org_id: org.id, user_id: data.user.id, role: 'super_admin' });
      await supabase.from('subscriptions').insert({ org_id: org.id, plan: 'starter', status: 'active' });
    }

    return { error: null };
  };

  const signOut = async () => {
    if (!DEV_MOCK_AUTH) await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
    setOrganization(null);
    // Clear persisted filters so the next user starts fresh
    try { localStorage.removeItem('jotflow_filters'); } catch {}
  };

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    return { error };
  };

  const updateProfile = async (updates: Partial<Profile>) => {
    if (!user) return;
    await supabase.from('profiles').update(updates).eq('user_id', user.id);
    await fetchProfile(user.id);
  };

  const refreshProfile = async () => {
    if (user) await fetchProfile(user.id);
  };

  const hasPermission = (required: OrgRole[]) => required.includes(orgRole);

  return (
    <AuthContext.Provider value={{
      user, session, profile, organization, orgRole, loading,
      signIn, signInWithMagicLink, signInWithMicrosoft, signUp, signOut,
      resetPassword, updateProfile, refreshProfile, hasPermission,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
