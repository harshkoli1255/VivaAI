'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store';
import { authApi, getApiErrorMessage } from '@/lib/api';
import { getStudentPortalUrl } from '@/lib/utils';
import { ArrowRight } from 'lucide-react';
import { AuthPanel } from '@/components/ui/AuthPanel';

export default function LoginPage() {
  const router = useRouter();
  const { setAuth, isAuthenticated, user, hasHydrated } = useAuthStore();

  useEffect(() => {
    if (hasHydrated && isAuthenticated && user?.role === 'faculty') {
      router.replace('/dashboard');
    }
  }, [hasHydrated, isAuthenticated, user?.role, router]);

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roleMismatch, setRoleMismatch] = useState(false);

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setRoleMismatch(false);

    try {
      const payload = {
        password,
        email: identifier,
      };

      const res = await authApi.login(payload);
      const data = res.data;
      const access_token = ''; // Credentials remain in the HttpOnly cookie.
      const user = data.user || {
        id: data.user_id,
        name: data.name,
        role: (data.role || 'faculty') as 'student' | 'faculty',
        email: identifier,
      };
      if (user.role !== 'faculty') {
        setError('This account belongs to the Student Portal.');
        setRoleMismatch(true);
        return;
      }
      setAuth(access_token, user);


      router.push('/dashboard');
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Unable to sign in. Check your details and try again.'));
    } finally {
      setLoading(false);
    }
  };

  return <AuthPanel faculty>
    {error && <div role="alert" className="mb-5 rounded-xl bg-[var(--status-danger-bg)] p-4 text-sm text-[var(--status-danger)]">{error}{roleMismatch && <a className="ml-2 underline" href={`${getStudentPortalUrl()}/login`}>Open Student Portal</a>}</div>}
    <form method="post" onSubmit={handleCredentialsSubmit} className="space-y-5"><div><label htmlFor="user-identifier" className="mb-2 block text-sm font-medium">Email</label><input id="user-identifier" type="email" name="email" autoComplete="username" disabled={!hasHydrated || loading} required value={identifier} onChange={e => setIdentifier(e.target.value)} placeholder="you@university.edu" className="form-input" /></div><div><label htmlFor="user-password" className="mb-2 block text-sm font-medium">Password</label><input id="user-password" type="password" name="password" autoComplete="current-password" disabled={!hasHydrated || loading} required value={password} onChange={e => setPassword(e.target.value)} className="form-input" /></div><button type="submit" disabled={!hasHydrated || loading} className="btn-primary w-full">{loading ? 'Signing in…' : 'Sign in to Faculty Portal'}<ArrowRight className="h-4 w-4" /></button></form><p className="mt-7 text-center text-xs leading-relaxed text-[var(--text-muted)]">Use the faculty account provided by your institution.</p>
  </AuthPanel>;
}
