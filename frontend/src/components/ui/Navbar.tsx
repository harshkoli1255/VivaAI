'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/store';
import { useTheme } from '@/components/providers/ThemeProvider';
import {
  Moon,
  Sun,
  LogOut,
  GraduationCap,
  ShieldCheck,
  LayoutDashboard,
  Mic,
  Sliders,
  User,
  ArrowRightLeft,
  ChevronDown,
} from 'lucide-react';

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isAuthenticated, setAuth, logout } = useAuthStore();
  const { theme, toggle } = useTheme();
  const [isSwitching, setIsSwitching] = useState(false);

  // Distraction-free live viva room mode
  if (pathname?.startsWith('/interview/') && pathname !== '/interview') {
    return null;
  }

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  const handleQuickSwitch = async (targetRole: 'student' | 'faculty') => {
    setIsSwitching(true);
    try {
      if (targetRole === 'student') {
        const demoStudent = {
          id: '00000000-0000-0000-0000-000000000002',
          name: 'Alex Chen',
          role: 'student' as const,
          student_id: 'STU001',
          email: 'alex.chen@university.edu',
        };
        setAuth('demo_student_token_stu001', demoStudent);
        localStorage.setItem('vivaai_token', 'demo_student_token_stu001');
        localStorage.setItem('vivaai_user', JSON.stringify(demoStudent));
        router.push('/interview');
      } else {
        const demoFaculty = {
          id: '00000000-0000-0000-0000-000000000001',
          name: 'Dr. Priya Sharma',
          role: 'faculty' as const,
          email: 'priya.sharma@university.edu',
        };
        setAuth('demo_faculty_token_drpriya', demoFaculty);
        localStorage.setItem('vivaai_token', 'demo_faculty_token_drpriya');
        localStorage.setItem('vivaai_user', JSON.stringify(demoFaculty));
        router.push('/dashboard');
      }
    } finally {
      setIsSwitching(false);
    }
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        {/* Brand & Identity */}
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-sky-500 via-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-sky-500/20 group-hover:shadow-sky-500/40 transition-all duration-200">
              <GraduationCap className="w-5 h-5" />
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-base tracking-tight text-white flex items-center gap-1.5">
                VivaAI
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/20">
                  PROCTOR v2.4
                </span>
              </span>
              <span className="text-xs text-slate-400 font-medium hidden sm:inline">
                Standardized Oral Examination Board
              </span>
            </div>
          </Link>

          {/* Navigation Links */}
          {isAuthenticated && (
            <nav className="hidden md:flex items-center gap-1">
              {user?.role === 'faculty' ? (
                <>
                  <Link
                    href="/dashboard"
                    className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all ${
                      pathname === '/dashboard'
                        ? 'bg-slate-800 text-sky-400 shadow-sm border border-slate-700'
                        : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                    }`}
                  >
                    <LayoutDashboard className="w-3.5 h-3.5" />
                    Assessment Registry
                  </Link>
                  <Link
                    href="/faculty/setup"
                    className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all ${
                      pathname === '/faculty/setup'
                        ? 'bg-slate-800 text-sky-400 shadow-sm border border-slate-700'
                        : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                    }`}
                  >
                    <Sliders className="w-3.5 h-3.5" />
                    Viva Setup
                  </Link>
                </>
              ) : (
                <>
                  <Link
                    href="/interview"
                    className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all ${
                      pathname === '/interview'
                        ? 'bg-slate-800 text-sky-400 shadow-sm border border-slate-700'
                        : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                    }`}
                  >
                    <Mic className="w-3.5 h-3.5" />
                    Take Viva Exam
                  </Link>
                  <Link
                    href="/dashboard"
                    className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all ${
                      pathname === '/dashboard'
                        ? 'bg-slate-800 text-sky-400 shadow-sm border border-slate-700'
                        : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                    }`}
                  >
                    <LayoutDashboard className="w-3.5 h-3.5" />
                    My Submissions
                  </Link>
                </>
              )}
            </nav>
          )}
        </div>

        {/* Right Controls & Quick Role Switcher */}
        <div className="flex items-center gap-3">
          {/* Quick Preset Role Switcher for seamless review */}
          <div className="hidden sm:flex items-center bg-slate-900 border border-slate-800 rounded-lg p-0.5 text-xs">
            <button
              onClick={() => handleQuickSwitch('student')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium transition-all ${
                user?.role === 'student'
                  ? 'bg-sky-500 text-white shadow-sm font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Switch to Demo Student (STU001)"
            >
              <User className="w-3 h-3" />
              Student
            </button>
            <button
              onClick={() => handleQuickSwitch('faculty')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium transition-all ${
                user?.role === 'faculty'
                  ? 'bg-indigo-600 text-white shadow-sm font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Switch to Demo Faculty (Dr. Priya Sharma)"
            >
              <ShieldCheck className="w-3 h-3" />
              Faculty
            </button>
          </div>

          {/* Theme Toggle */}
          <button
            onClick={toggle}
            aria-label="Toggle Theme"
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-800 transition-colors"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* User Account / Auth Actions */}
          {isAuthenticated ? (
            <div className="flex items-center gap-3 pl-2 border-l border-slate-800">
              <div className="hidden lg:flex flex-col text-right">
                <span className="text-xs font-semibold text-slate-200 leading-tight">
                  {user?.name}
                </span>
                <span className="text-[10px] font-mono text-slate-400 capitalize leading-tight">
                  {user?.role === 'faculty' ? 'Chief Examiner' : `ID: ${user?.student_id || 'STU001'}`}
                </span>
              </div>
              <button
                onClick={handleLogout}
                title="Sign Out"
                className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 border border-slate-800 transition-colors"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                href="/login"
                className="px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white transition-colors"
              >
                Sign In
              </Link>
              <Link
                href="/interview"
                className="btn-primary text-xs py-1.5 px-3.5"
              >
                Launch Viva
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
