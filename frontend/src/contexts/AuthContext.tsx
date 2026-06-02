import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { apiFetch } from '../lib/api';
import { ApiError, humanizeError } from '../lib/errors';
import { useIdleTimeout } from '../hooks/useIdleTimeout';

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export type OrgRole = 'super_admin' | 'admin' | 'approver' | 'viewer' | 'user';

export interface AppUser {
  id: string;
  email: string;
  fullName: string;
  role: OrgRole;
  department: string;
  avatarUrl: string;
  preferences: Record<string, unknown>;
  orgId: string | null;
}

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
  user: AppUser | null;
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

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);

  const orgRole: OrgRole = profile?.role || user?.role || 'viewer';

  const applyUser = useCallback((u: AppUser | null) => {
    setUser(u);
    if (u) {
      setProfile({
        id: u.id,
        user_id: u.id,
        full_name: u.fullName,
        department: u.department,
        role: u.role,
        avatar_url: u.avatarUrl,
        org_id: u.orgId,
        preferences: u.preferences,
      });
    } else {
      setProfile(null);
      setOrganization(null);
    }
  }, []);

  const fetchOrg = useCallback(async (orgId: string) => {
    try {
      const org = await apiFetch<Organization>(`/api/organizations/${orgId}`);
      if (org) setOrganization(org);
    } catch {
      // org fetch failure is non-fatal
    }
  }, []);

  const verifyWorkspace = useCallback(async (email: string): Promise<boolean> => {
    try {
      const data = await apiFetch<{ isMember: boolean }>('/api/auth/verify-workspace-member', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      if (!data?.isMember) {
        sessionStorage.setItem('auth_rejection', 'not_workspace_member');
        sessionStorage.setItem('auth_rejection_email', email);
        return false;
      }
      return true;
    } catch {
      sessionStorage.setItem('auth_rejection', 'verification_error');
      return false;
    }
  }, []);

  // On mount: check existing session
  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch<{ user: AppUser | null }>('/api/auth/session');
        if (data.user) {
          const isMember = await verifyWorkspace(data.user.email);
          if (isMember) {
            applyUser(data.user);
            if (data.user.orgId) fetchOrg(data.user.orgId);
          } else {
            await apiFetch('/api/auth/logout', { method: 'POST' });
          }
        }
      } catch {
        // no session
      } finally {
        setLoading(false);
      }
    })();
  }, [applyUser, fetchOrg, verifyWorkspace]);

  const signIn = async (email: string, password: string) => {
    try {
      const data = await apiFetch<{ ok: boolean; user: AppUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      const isMember = await verifyWorkspace(data.user.email);
      if (!isMember) {
        await apiFetch('/api/auth/logout', { method: 'POST' });
        return { error: 'Your email is not a member of the JotForm workspace.' };
      }
      applyUser(data.user);
      if (data.user.orgId) fetchOrg(data.user.orgId);
      return { error: null };
    } catch (err) {
      // Server-side workspace enforcement: POST /api/auth/login returns 403
      // { error: 'not_workspace_member' } for non-members. Mirror the rejection
      // UX that verifyWorkspace() sets so Login.tsx shows the friendly banner.
      if (err instanceof ApiError && err.status === 403 && err.serverMessage === 'not_workspace_member') {
        sessionStorage.setItem('auth_rejection', 'not_workspace_member');
        sessionStorage.setItem('auth_rejection_email', email);
        return { error: 'Your email is not a member of the JotForm workspace.' };
      }
      return { error: humanizeError(err, 'Sign in failed. Please check your details and try again.') };
    }
  };

  const signInWithMagicLink = async (_email: string) => {
    return { error: 'Magic link sign-in is not supported. Please use email and password.' };
  };

  const signInWithMicrosoft = async () => {
    window.location.href = '/api/auth/microsoft';
    return { error: null };
  };

  const signUp = async (email: string, password: string, fullName: string, _orgName: string, department: string) => {
    try {
      const data = await apiFetch<{ ok: boolean; user: AppUser }>('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ email, password, fullName, department }),
      });
      applyUser(data.user);
      return { error: null };
    } catch (err) {
      return { error: humanizeError(err, 'Sign up failed. Please try again.') };
    }
  };

  const signOut = async () => {
    try { await apiFetch('/api/auth/logout', { method: 'POST' }); } catch {}
    setUser(null);
    setProfile(null);
    setOrganization(null);
    try { localStorage.removeItem('jotflow_filters'); } catch {}
  };

  useIdleTimeout(async () => {
    if (!user) return;
    sessionStorage.setItem('auth_rejection', 'idle_timeout');
    await signOut();
  }, IDLE_TIMEOUT_MS, !!user);

  const resetPassword = async (email: string) => {
    try {
      await apiFetch('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      return { error: null };
    } catch (err) {
      return { error: humanizeError(err, 'Could not send the reset link. Please try again.') };
    }
  };

  const updateProfile = async (updates: Partial<Profile>) => {
    if (!user) return;
    await apiFetch(`/api/profiles/${user.id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
    await refreshProfile();
  };

  const refreshProfile = async () => {
    if (!user) return;
    try {
      const data = await apiFetch<{ user: AppUser | null }>('/api/auth/session');
      if (data.user) applyUser(data.user);
    } catch {}
  };

  const hasPermission = (required: OrgRole[]) => required.includes(orgRole);

  return (
    <AuthContext.Provider value={{
      user, profile, organization, orgRole, loading,
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
