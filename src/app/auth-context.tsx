/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setCsrfToken } from '../lib/api';

export interface User { id: string; email: string; displayName: string; specialization: string | null; roles: string[]; permissions: string[]; mustChangePassword: boolean }
export interface SessionInfo { idleTimeoutMinutes: number; lastSeenAt: number; expiresAt: number }
interface AuthValue {
  user: User | null;
  session: SessionInfo | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}
const AuthContext = createContext<AuthValue | null>(null);

interface MeResponse { user: User; csrfToken: string; session: SessionInfo }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = async () => {
    try {
      const data = await api<MeResponse>('/auth/me');
      setCsrfToken(data.csrfToken); setUser(data.user); setSession(data.session);
    } catch { setCsrfToken(null); setUser(null); setSession(null); }
    finally { setLoading(false); }
  };
  // Authentication is an external server session; hydrate it once when the provider mounts.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refresh(); }, []);
  const logout = async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* the session may already be gone */ }
    setCsrfToken(null); setUser(null); setSession(null);
  };
  return <AuthContext.Provider value={{ user, session, loading, refresh, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
