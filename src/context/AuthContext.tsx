import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { User, Workspace } from '@/lib/types';

type AuthState = {
  user: User | null;
  workspaces: Workspace[];
  workspace: Workspace | null;
  loading: boolean;
  refresh: () => Promise<void>;
  switchWorkspace: (id: string) => void;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);
const STORAGE_KEY = 'orbit.activeWorkspace';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeId, setActiveId] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<{ user: User; workspaces: Workspace[] }>('/api/auth/me');
      setUser(data.user);
      setWorkspaces(data.workspaces);
      const preferred = data.workspaces.find((ws) => ws.id === localStorage.getItem(STORAGE_KEY)) ?? data.workspaces[0] ?? null;
      setActiveId(preferred?.id ?? null);
      if (preferred) localStorage.setItem(STORAGE_KEY, preferred.id);
    } catch {
      setUser(null);
      setWorkspaces([]);
      setActiveId(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const unauthorized = () => {
      setUser(null);
      setWorkspaces([]);
      setActiveId(null);
    };
    window.addEventListener('orbit:unauthorized', unauthorized);
    return () => window.removeEventListener('orbit:unauthorized', unauthorized);
  }, [refresh]);

  const switchWorkspace = useCallback((id: string) => {
    setActiveId(id);
    localStorage.setItem(STORAGE_KEY, id);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } catch {
      /* cookie cleared server-side when possible */
    }
    localStorage.removeItem(STORAGE_KEY);
    setUser(null);
    setWorkspaces([]);
    setActiveId(null);
  }, []);

  const workspace = useMemo(() => workspaces.find((ws) => ws.id === activeId) ?? null, [workspaces, activeId]);
  const value = useMemo(
    () => ({ user, workspaces, workspace, loading, refresh, switchWorkspace, logout }),
    [user, workspaces, workspace, loading, refresh, switchWorkspace, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

export function useWorkspace(): Workspace {
  const { workspace } = useAuth();
  if (!workspace) throw new Error('No active workspace');
  return workspace;
}

export function useApiError() {
  return { message: errorMessage };
}
