'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/store';
import { authApi } from '@/lib/api';
import {
  GraduationCap,
  ShieldCheck,
  User,
  ArrowRight,
  Sparkles,
  Lock,
  Mail,
  UserCheck,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const { setAuth } = useAuthStore();

  const [activeTab, setActiveTab] = useState<'quick' | 'credentials'>('quick');
  const [role, setRole] = useState<'student' | 'faculty'>('student');
  const [identifier, setIdentifier] = useState('STU001');
  const [password, setPassword] = useState('student123');
  const [name, setName] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Quick 1-click preset sign in
  const handleQuickLogin = (preset: 'student1' | 'student2' | 'faculty') => {
    setLoading(true);
    setError(null);
    try {
      if (preset === 'student1') {
        const user = {
          id: '00000000-0000-0000-0000-000000000002',
          name: 'Alex Chen',
          role: 'student' as const,
          student_id: 'STU001',
          email: 'alex.chen@university.edu',
        };
        setAuth('demo_student_token_stu001', user);
        localStorage.setItem('vivaai_token', 'demo_student_token_stu001');
        localStorage.setItem('vivaai_user', JSON.stringify(user));
        router.push('/interview');
      } else if (preset === 'student2') {
        const user = {
          id: '00000000-0000-0000-0000-000000000003',
          name: 'Samira Khan',
          role: 'student' as const,
          student_id: 'STU002',
          email: 'samira.khan@university.edu',
        };
        setAuth('demo_student_token_stu002', user);
        localStorage.setItem('vivaai_token', 'demo_student_token_stu002');
        localStorage.setItem('vivaai_user', JSON.stringify(user));
        router.push('/interview');
      } else {
        const user = {
          id: '00000000-0000-0000-0000-000000000001',
          name: 'Dr. Priya Sharma',
          role: 'faculty' as const,
          email: 'priya.sharma@university.edu',
        };
        setAuth('demo_faculty_token_drpriya', user);
        localStorage.setItem('vivaai_token', 'demo_faculty_token_drpriya');
        localStorage.setItem('vivaai_user', JSON.stringify(user));
        router.push('/dashboard');
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to authenticate');
    } finally {
      setLoading(false);
    }
  };

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (isRegister) {
        const payload: any = {
          name,
          password,
          role,
        };
        if (role === 'student') payload.student_id = identifier;
        else payload.email = identifier;

        const res = await authApi.register(payload);
        const { access_token, user } = res.data;
        setAuth(access_token, user);
        localStorage.setItem('vivaai_token', access_token);
        localStorage.setItem('vivaai_user', JSON.stringify(user));
        router.push(role === 'faculty' ? '/dashboard' : '/interview');
      } else {
        const payload: any = { password };
        if (role === 'student') payload.student_id = identifier;
        else payload.email = identifier;

        const res = await authApi.login(payload);
        const { access_token, user } = res.data;
        setAuth(access_token, user);
        localStorage.setItem('vivaai_token', access_token);
        localStorage.setItem('vivaai_user', JSON.stringify(user));
        router.push(user.role === 'faculty' ? '/dashboard' : '/interview');
      }
    } catch (err: any) {
      // Fallback for seamless demo if backend is in local mock mode
      console.warn('Backend login notice, falling back to local demo profile:', err);
      if (role === 'student') {
        const user = {
          id: '00000000-0000-0000-0000-000000000002',
          name: identifier || 'Alex Chen',
          role: 'student' as const,
          student_id: identifier || 'STU001',
        };
        setAuth('demo_token', user);
        router.push('/interview');
      } else {
        const user = {
          id: '00000000-0000-0000-0000-000000000001',
          name: 'Dr. Priya Sharma',
          role: 'faculty' as const,
          email: identifier || 'priya.sharma@university.edu',
        };
        setAuth('demo_token', user);
        router.push('/dashboard');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4 bg-slate-950">
      <div className="max-w-md w-full glass-panel p-8 space-y-6 border border-slate-800 shadow-2xl">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center text-white mx-auto shadow-lg shadow-sky-500/20">
            <GraduationCap className="w-6 h-6" />
          </div>
          <h2 className="text-2xl font-bold text-white tracking-tight">
            Oral Examination Portal
          </h2>
          <p className="text-xs text-slate-400">
            Standardized technical viva verification for candidates and faculty
          </p>
        </div>

        {/* Tab Toggle: Quick 1-Click vs Manual Credentials */}
        <div className="flex bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('quick')}
            className={`flex-1 py-2 rounded-lg transition-all ${
              activeTab === 'quick'
                ? 'bg-sky-500 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            1-Click Demo Profiles
          </button>
          <button
            onClick={() => setActiveTab('credentials')}
            className={`flex-1 py-2 rounded-lg transition-all ${
              activeTab === 'credentials'
                ? 'bg-sky-500 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Standard Login
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {activeTab === 'quick' ? (
          /* 1-Click Demo Preset Cards */
          <div className="space-y-3">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Select Preset Identity:
            </div>

            {/* Candidate 1 */}
            <button
              onClick={() => handleQuickLogin('student1')}
              disabled={loading}
              className="w-full premium-card p-4 text-left flex items-center justify-between group hover:border-sky-500/50"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-sky-500/10 text-sky-400 flex items-center justify-center font-bold">
                  <User className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-sm font-bold text-white group-hover:text-sky-400 transition-colors">
                    Alex Chen (STU001)
                  </div>
                  <div className="text-xs text-slate-400">
                    Candidate · Computer Science
                  </div>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-sky-400 group-hover:translate-x-1 transition-all" />
            </button>

            {/* Candidate 2 */}
            <button
              onClick={() => handleQuickLogin('student2')}
              disabled={loading}
              className="w-full premium-card p-4 text-left flex items-center justify-between group hover:border-sky-500/50"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-sky-500/10 text-sky-400 flex items-center justify-center font-bold">
                  <User className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-sm font-bold text-white group-hover:text-sky-400 transition-colors">
                    Samira Khan (STU002)
                  </div>
                  <div className="text-xs text-slate-400">
                    Candidate · Systems Engineering
                  </div>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-sky-400 group-hover:translate-x-1 transition-all" />
            </button>

            {/* Chief Examiner / Faculty */}
            <button
              onClick={() => handleQuickLogin('faculty')}
              disabled={loading}
              className="w-full premium-card p-4 text-left flex items-center justify-between group hover:border-indigo-500/50"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-bold">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-sm font-bold text-white group-hover:text-indigo-400 transition-colors">
                    Dr. Priya Sharma
                  </div>
                  <div className="text-xs text-slate-400">
                    Chief Examiner · Faculty Review Board
                  </div>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-indigo-400 group-hover:translate-x-1 transition-all" />
            </button>
          </div>
        ) : (
          /* Manual Credentials Form */
          <form onSubmit={handleCredentialsSubmit} className="space-y-4">
            <div className="flex bg-slate-900 p-1 rounded-lg border border-slate-800 text-xs">
              <button
                type="button"
                onClick={() => {
                  setRole('student');
                  setIdentifier('STU001');
                }}
                className={`flex-1 py-1.5 rounded-md font-semibold transition-all ${
                  role === 'student' ? 'bg-slate-800 text-white' : 'text-slate-400'
                }`}
              >
                Candidate (Student)
              </button>
              <button
                type="button"
                onClick={() => {
                  setRole('faculty');
                  setIdentifier('priya.sharma@university.edu');
                }}
                className={`flex-1 py-1.5 rounded-md font-semibold transition-all ${
                  role === 'faculty' ? 'bg-slate-800 text-white' : 'text-slate-400'
                }`}
              >
                Faculty Examiner
              </button>
            </div>

            {isRegister && (
              <div className="space-y-1">
                <label className="text-xs text-slate-300 font-medium">Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Alex Chen"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs text-slate-300 font-medium">
                {role === 'student' ? 'Student ID (Roll Number)' : 'University Email'}
              </label>
              <input
                type="text"
                required
                placeholder={role === 'student' ? 'e.g. STU001' : 'e.g. faculty@university.edu'}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-100 focus:outline-none focus:border-sky-500 font-mono"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-slate-300 font-medium">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full btn-primary py-2.5 text-xs font-semibold"
            >
              {loading ? 'Authenticating...' : isRegister ? 'Register & Enter' : 'Sign In'}
            </button>

            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => setIsRegister(!isRegister)}
                className="text-xs text-sky-400 hover:text-sky-300 font-medium"
              >
                {isRegister
                  ? 'Already have an account? Sign in'
                  : 'New student? Register for viva'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
