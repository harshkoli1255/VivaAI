'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store';
import { authApi, getApiErrorMessage } from '@/lib/api';
import { getFacultyPortalUrl } from '@/lib/utils';
import { ArrowRight } from 'lucide-react';
import { AuthPanel } from '@/components/ui/AuthPanel';

export default function LoginPage() {
  const router = useRouter();
  const { setAuth, isAuthenticated, user, hasHydrated } = useAuthStore();

  useEffect(() => {
    if (hasHydrated && isAuthenticated && user?.role === 'student') {
      router.replace('/interview');
    }
  }, [hasHydrated, isAuthenticated, user?.role, router]);

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roleMismatch, setRoleMismatch] = useState(false);

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setRoleMismatch(false);

    try {
      if (isRegister) {
        const payload = {
          name,
          password,
          role: 'student',
          student_id: identifier,
        };

        const res = await authApi.register(payload);
        const data = res.data;
        const access_token = ''; // Credentials remain in the HttpOnly cookie.
        const user = data.user || {
          id: data.user_id,
          name: data.name || name,
          role: (data.role || 'student') as 'student' | 'faculty',
          student_id: identifier,
        };
        setAuth(access_token, user);


        router.push('/interview');
      } else {
        const payload = {
          password,
          student_id: identifier,
        };

        const res = await authApi.login(payload);
        const data = res.data;
        const access_token = ''; // Credentials remain in the HttpOnly cookie.
        const user = data.user || {
          id: data.user_id,
          name: data.name,
          role: (data.role || 'student') as 'student' | 'faculty',
          student_id: identifier,
        };
        if (user.role !== 'student') {
          setError('This account belongs to the Faculty Portal.');
          setRoleMismatch(true);
          return;
        }
        setAuth(access_token, user);


        router.push('/interview');
      }
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Unable to sign in. Check your details and try again.'));
    } finally {
      setLoading(false);
    }
  };

  return <AuthPanel>
    {error && <div role="alert" className="mb-5 rounded-xl bg-[var(--status-danger-bg)] p-4 text-sm text-[var(--status-danger)]">{error}{roleMismatch && <a className="ml-2 underline" href={`${getFacultyPortalUrl()}/login`}>Open Faculty Portal</a>}</div>}
    <form method="post" onSubmit={handleCredentialsSubmit} className="space-y-5">
      {isRegister && <div><label htmlFor="user-name" className="mb-2 block text-sm font-medium">Full name</label><input disabled={!hasHydrated || loading} id="user-name" name="name" autoComplete="name" required value={name} onChange={e => setName(e.target.value)} className="form-input" /></div>}
      <div><label htmlFor="user-identifier" className="mb-2 block text-sm font-medium">University ID</label><input disabled={!hasHydrated || loading} id="user-identifier" name="student_id" autoComplete="username" required placeholder="Enter your university ID" value={identifier} onChange={e => setIdentifier(e.target.value)} className="form-input" /></div>
      <div><label htmlFor="user-password" className="mb-2 block text-sm font-medium">Password</label><input disabled={!hasHydrated || loading} id="user-password" name="password" type="password" autoComplete={isRegister ? 'new-password' : 'current-password'} minLength={isRegister ? 8 : undefined} required value={password} onChange={e => setPassword(e.target.value)} className="form-input" /></div>
      <button disabled={!hasHydrated || loading} type="submit" className="btn-primary w-full">{loading ? 'Signing in…' : isRegister ? 'Create student account' : 'Sign in to Student Portal'}<ArrowRight className="h-4 w-4" /></button>
      <button type="button" onClick={() => setIsRegister(!isRegister)} className="min-h-11 w-full text-center text-sm text-[var(--primary)]">{isRegister ? 'Already have an account? Sign in' : 'New student? Create an account'}</button>
    </form>
    <p className="mt-7 text-center text-xs leading-relaxed text-[var(--text-muted)]">Your recording and transcript are only available to you and authorized faculty.</p>
  </AuthPanel>;
}
