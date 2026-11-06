import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, use, useEffect, useState, type ReactNode } from 'react';
import { api, refreshSession, setAccessToken, type Me } from './api';
import { applyTheme } from './theme';

interface AuthValue {
  me: Me | null;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    refreshSession()
      .then(setSignedIn)
      .finally(() => setReady(true));
  }, []);

  const query = useQuery({
    queryKey: ['me'],
    queryFn: () => api<Me>('/auth/me'),
    enabled: signedIn,
    retry: false,
  });

  useEffect(() => {
    if (query.data) applyTheme(query.data.theme);
  }, [query.data]);

  // A session that ends while the app is open, such as after deactivation, returns to login.
  useEffect(() => {
    if (query.error) setSignedIn(false);
  }, [query.error]);

  const value: AuthValue = {
    me: signedIn ? (query.data ?? null) : null,
    loading: !ready || (signedIn && query.isPending),
    async login(email, password) {
      const { accessToken } = await api<{ accessToken: string }>('/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      setAccessToken(accessToken);
      client.clear();
      setSignedIn(true);
    },
    async logout() {
      await api('/auth/logout', { method: 'POST' });
      setAccessToken(null);
      client.clear();
      setSignedIn(false);
      applyTheme('SYSTEM');
    },
  };

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth() {
  const value = use(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}

/** For pages inside the protected layout, where a user is always present. */
export function useMe(): Me {
  const { me } = useAuth();
  if (!me) throw new Error('useMe used outside the protected layout');
  return me;
}
