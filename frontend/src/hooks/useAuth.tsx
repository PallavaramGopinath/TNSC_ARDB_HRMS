import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { onAuthChange } from '@/services/api';
import { authApi } from '@/services/auth';
import { tokenStore } from '@/services/tokenStore';
import type { AuthUser, TokenPair } from '@/types/api';

interface AuthState {
  user: AuthUser | null;
  signIn: (p: TokenPair) => void;
  signOut: () => Promise<void>;
  hasModule: (menuId: number, cap?: 'read' | 'maker' | 'checker') => boolean;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => tokenStore.get()?.user ?? null);

  useEffect(() => onAuthChange((p) => setUser(p?.user ?? null)), []);

  const signIn = useCallback((p: TokenPair) => {
    tokenStore.set(p);
    setUser(p.user);
  }, []);

  const signOut = useCallback(async () => {
    const rt = tokenStore.get()?.refreshToken;
    tokenStore.clear();
    setUser(null);
    await authApi.logout(rt).catch(() => undefined);
  }, []);

  const hasModule = useCallback(
    (menuId: number, cap: 'read' | 'maker' | 'checker' = 'read') => {
      if (!user) return false;
      if (user.isAdmin) return true;
      const g = user.modules[String(menuId)];
      if (!g) return false;
      return cap === 'read' || (cap === 'maker' ? g.includes('M') : g.includes('C'));
    },
    [user],
  );

  const value = useMemo(() => ({ user, signIn, signOut, hasModule }), [user, signIn, signOut, hasModule]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}
