/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setCsrfToken } from '../lib/api';

export interface User { id: string; email: string; displayName: string; specialization: string | null; roles: string[]; permissions: string[]; mustChangePassword: boolean }
interface AuthValue { user: User | null; loading: boolean; refresh: () => Promise<void>; logout: () => Promise<void> }
const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = async () => {
    try {
      const data = await api<{ user: User; csrfToken: string }>('/auth/me');
      setCsrfToken(data.csrfToken); setUser(data.user);
    } catch { setCsrfToken(null); setUser(null); }
    finally { setLoading(false); }
  };
  // Authentication is an external server session; hydrate it once when the provider mounts.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refresh(); }, []);
  const logout = async () => { await api('/auth/logout', { method: 'POST' }); setCsrfToken(null); setUser(null); };
  return <AuthContext.Provider value={{ user, loading, refresh, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
