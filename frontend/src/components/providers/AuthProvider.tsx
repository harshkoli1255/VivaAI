'use client';
import { useEffect } from 'react';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/store';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    let active = true;
    // Remove credentials left by older versions; authenticate only with the HttpOnly cookie.
    try { for (const key of ['vivaai_token', 'vivaai_user', 'vivaai_auth']) localStorage.removeItem(key); } catch {}
    authApi.me().then(({ data }) => {
      if (active && !useAuthStore.getState().hasHydrated) useAuthStore.getState().setAuth('', data);
    }).catch(() => {
      if (active && !useAuthStore.getState().hasHydrated) useAuthStore.getState().logout();
    });
    return () => { active = false; };
  }, []);
  return children;
}
