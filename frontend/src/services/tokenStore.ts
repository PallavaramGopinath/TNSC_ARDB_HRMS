import type { TokenPair } from '@/types/api';

// TNCU keeps tokens in localStorage (Blazored.LocalStorage); same here.
const KEY = 'ardb.auth';

export const tokenStore = {
  get(): TokenPair | null {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as TokenPair) : null;
    } catch {
      return null;
    }
  },
  set(p: TokenPair) {
    localStorage.setItem(KEY, JSON.stringify(p));
  },
  clear() {
    localStorage.removeItem(KEY);
  },
};
