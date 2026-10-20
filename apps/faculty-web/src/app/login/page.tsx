'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store';
import { authApi, getApiErrorMessage } from '@/lib/api';
import {
  GraduationCap,
  ShieldCheck,
  ArrowRight,
  AlertCircle,
} from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const { setAuth, isAuthenticated, user, hasHydrated } = useAuthStore();
  const demoLoginsEnabled = process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_MOCK_MODE === 'true';

  useEffect(() => {
    if (hasHydrated && isAuthenticated && user?.role === 'faculty') {
      router.replace('/dashboard');
    }
  }, [hasHydrated, isAuthenticated, user?.role, router]);

  const [activeTab, setActiveTab] = useState<'presets' | 'credentials'>(demoLoginsEnabled ? 'presets' : 'credentials');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roleMismatch, setRoleMismatch] = useState(false);

  // 1-Click Persona Quick Sign In
  const handleQuickLogin = async () => {
    if (!demoLoginsEnabled) return;
    setLoading(true); setError(null);
    try {
      const { data } = await authApi.login({ email: 'priya.sharma@university.edu', password: 'faculty123' });
      setAuth('', data.user); router.push('/dashboard');
    } catch { setError('Demo sign-in failed. Please retry.'); }
    finally { setLoading(false); }
  };

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

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4 sm:p-6 bg-[var(--bg-page)] text-[var(--text-primary)] transition-colors">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded bg-[#0f5b4a] dark:bg-teal-900 text-white flex items-center justify-center mx-auto shadow-sm">
            <GraduationCap className="w-6 h-6 text-emerald-100 dark:text-teal-200" />
          </div>
          <h1 className="font-editorial text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text-primary)]">
            Faculty sign in
          </h1>
          <p className="text-xs sm:text-sm text-[var(--text-secondary)]">
            {demoLoginsEnabled ? 'Use your institutional email or a local development account.' : 'Use your institutional email to access viva reviews.'}
          </p>
        </div>

        {/* Segmented Control */}
        {demoLoginsEnabled && <div className="grid grid-cols-2 p-1 bg-[var(--bg-muted)] rounded border border-[var(--border-default)] text-xs font-semibold">
          <button
            type="button"
            onClick={() => setActiveTab('presets')}
            className={`py-2 rounded transition-all min-h-[40px] ${
              activeTab === 'presets'
                ? 'bg-[var(--bg-card)] text-[var(--text-primary)] font-bold border border-[var(--border-default)] shadow-xs'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            Demo account
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('credentials')}
            className={`py-2 rounded transition-all min-h-[40px] ${
              activeTab === 'credentials'
                ? 'bg-[var(--bg-card)] text-[var(--text-primary)] font-bold border border-[var(--border-default)] shadow-xs'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            Credential Sign-In
          </button>
        </div>}

        {error && (
          <div role="alert" className="p-3.5 rounded bg-[var(--status-danger-bg)] border border-[var(--status-danger-border)] text-[var(--status-danger)] text-xs flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
            {roleMismatch && <a className="font-semibold underline" href={`${process.env.NEXT_PUBLIC_STUDENT_URL || 'http://localhost:3000'}/login`}>Open Student Portal</a>}
          </div>
        )}

        {/* Tab 1: 1-Click Persona Presets */}
        {demoLoginsEnabled && activeTab === 'presets' ? (
          <div className="academic-dossier p-5 space-y-3">
            <span className="text-[11px] font-mono font-semibold text-[var(--text-muted)] uppercase tracking-wider block">
              Local faculty demo account · development only
            </span>
            <button
              type="button"
              onClick={handleQuickLogin}
              disabled={loading || !hasHydrated}
              className="w-full p-3.5 rounded border border-[var(--border-default)] hover:border-[var(--primary)] bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)] text-left flex items-center justify-between group transition-all min-h-[56px]"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 flex items-center justify-center font-bold shrink-0 border border-amber-200 dark:border-amber-800">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-sm font-bold text-[var(--text-primary)] group-hover:text-[var(--primary)]">
                    Faculty demo account
                  </div>
                  <div className="text-xs text-[var(--text-muted)] font-mono">
                    Sample workspace · local only
                  </div>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-[var(--text-muted)] group-hover:text-[var(--primary)] group-hover:translate-x-0.5 transition-all" />
            </button>
          </div>
        ) : (
          /* Tab 2: Manual Credentials Form */
          <div className="academic-dossier p-6">
            <form method="post" onSubmit={handleCredentialsSubmit} className="space-y-4">
              <div className="space-y-1">
                <label htmlFor="user-identifier" className="text-xs font-semibold text-[var(--text-secondary)] block">
                  Faculty Username or University Email
                </label>
                <input
                  disabled={!hasHydrated || loading}
                  id="user-identifier"
                  name="identifier"
                  type="text"
                  required
                  placeholder="harshkoli or name@university.edu"
                  autoComplete="username"
                  value={identifier}
                  onChange={(e) => { setIdentifier(e.target.value); setError(null); setRoleMismatch(false); }}
                  className="form-input font-mono text-xs"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="user-password" className="text-xs font-semibold text-[var(--text-secondary)] block">
                  Password
                </label>
                <input
                  disabled={!hasHydrated || loading}
                  id="user-password"
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="form-input text-xs"
                />
              </div>

              <button
                type="submit"
                disabled={loading || !hasHydrated}
                className="btn-primary w-full mt-2 font-semibold justify-center"
              >
                {loading ? 'Signing in…' : 'Sign in to Faculty Portal'}
              </button>
            </form>
          </div>
        )}

        <div className="text-center text-[11px] text-[var(--text-muted)] font-mono">
          Department of Computer Science & Engineering · Academic Registry
        </div>
      </div>
    </div>
  );
}
