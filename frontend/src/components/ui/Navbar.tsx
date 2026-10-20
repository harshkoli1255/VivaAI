'use client';

import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/store';
import { authApi } from '@/lib/api';
import { useTheme } from '@/components/providers/ThemeProvider';
import { getFacultyPortalUrl, getStudentPortalUrl } from '@/lib/utils';
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
  Menu,
  X,
  FileCheck2,
  ExternalLink,
} from 'lucide-react';

const subscribe = () => () => {};

interface NavbarProps {
  appMode?: 'student' | 'faculty';
}

export function Navbar({ appMode = 'student' }: NavbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isAuthenticated, setAuth, logout } = useAuthStore();
  const { theme, toggle } = useTheme();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);

  // Distraction-free live viva room mode
  if (pathname?.startsWith('/interview/') && pathname !== '/interview') {
    return null;
  }

  const handleLogout = async () => {
    try {
      await authApi.logout();
    } catch {}
    logout();
    setMobileMenuOpen(false);
    router.push('/login');
  };

  const targetPortalUrl =
    appMode === 'student'
      ? getFacultyPortalUrl()
      : getStudentPortalUrl();

  const targetPortalLabel = appMode === 'student' ? 'Faculty Portal' : 'Student Portal';

  const handleQuickSwitch = (targetRole: 'student' | 'faculty') => {
    if (targetRole === 'student') {
      const demoStudent = {
        id: '00000000-0000-0000-0000-000000000002',
        name: 'Alex Chen',
        role: 'student' as const,
        student_id: 'STU001',
        email: 'alex.chen@university.edu',
      };
      setAuth('demo_student_token_stu001', demoStudent);


      setMobileMenuOpen(false);
      if (appMode === 'student') {
        router.push('/interview');
      } else {
        window.location.href = `${process.env.NEXT_PUBLIC_STUDENT_URL || 'http://localhost:3000'}/interview`;
      }
    } else {
      const demoFaculty = {
        id: '00000000-0000-0000-0000-000000000001',
        name: 'Dr. Priya Sharma',
        role: 'faculty' as const,
        email: 'priya.sharma@university.edu',
      };
      setAuth('demo_faculty_token_drpriya', demoFaculty);


      setMobileMenuOpen(false);
      if (appMode === 'faculty') {
        router.push('/dashboard');
      } else {
        window.location.href = `${process.env.NEXT_PUBLIC_FACULTY_URL || 'http://localhost:3001'}/dashboard`;
      }
    }
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b border-[var(--border-default)] bg-[var(--bg-page)]/95 backdrop-blur-sm transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        {/* Brand & Identity */}
        <div className="flex items-center gap-6 lg:gap-8">
          <Link
            href="/"
            className="flex items-center gap-3 group focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] rounded p-1"
          >
            <div className="w-9 h-9 rounded bg-[#0f5b4a] dark:bg-teal-900 text-white flex items-center justify-center font-bold shadow-sm transition-colors">
              <GraduationCap className="w-5 h-5 text-emerald-100 dark:text-teal-200" />
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="font-editorial text-lg font-bold tracking-tight text-[var(--text-primary)]">
                  VivaAI
                </span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-[var(--bg-muted)] text-[var(--primary)] border border-[var(--border-default)]">
                  {appMode === 'faculty' ? 'FACULTY PORTAL' : 'STUDENT PORTAL'}
                </span>
              </div>
              <span className="text-[11px] text-[var(--text-muted)] font-normal hidden sm:inline leading-tight">
                {appMode === 'faculty' ? 'Assessment & Review Console' : 'Standardized Oral Examination'}
              </span>
            </div>
          </Link>

          {/* Desktop Navigation Links */}
          {isAuthenticated && (
            <nav className="hidden md:flex items-center gap-2" aria-label="Main Navigation">
              {appMode === 'faculty' ? (
                <>
                  <Link
                    href="/dashboard"
                    className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-semibold transition-colors ${
                      pathname === '/dashboard'
                        ? 'bg-[var(--accent-subtle)] text-[var(--primary)] border border-[var(--border-default)]'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-muted)]'
                    }`}
                  >
                    <LayoutDashboard className="w-3.5 h-3.5" />
                    Assessment Registry
                  </Link>
                  <Link
                    href="/setup"
                    className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-semibold transition-colors ${
                      pathname === '/setup'
                        ? 'bg-[var(--accent-subtle)] text-[var(--primary)] border border-[var(--border-default)]'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-muted)]'
                    }`}
                  >
                    <Sliders className="w-3.5 h-3.5" />
                    Configure Viva
                  </Link>
                </>
              ) : (
                <>
                  <Link
                    href="/interview"
                    className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-semibold transition-colors ${
                      pathname === '/interview'
                        ? 'bg-[var(--accent-subtle)] text-[var(--primary)] border border-[var(--border-default)]'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-muted)]'
                    }`}
                  >
                    <Mic className="w-3.5 h-3.5" />
                    Take Viva Exam
                  </Link>
                </>
              )}
            </nav>
          )}
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-3">
          {/* Quick Cross-Portal Switcher Link */}
          <a
            href={targetPortalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-muted)] border border-[var(--border-default)] transition-colors min-h-[36px]"
            title={`Open ${targetPortalLabel} in new tab`}
          >
            <span>{targetPortalLabel}</span>
            <ExternalLink className="w-3 h-3 text-[var(--text-muted)]" />
          </a>

          {/* Role Presets Toggle */}
          <div className="hidden sm:flex items-center bg-[var(--bg-muted)] border border-[var(--border-default)] rounded p-0.5 text-xs">
            <button
              onClick={() => handleQuickSwitch('student')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded font-medium transition-all min-h-[36px] ${
                user?.role === 'student' && isAuthenticated
                  ? 'bg-[var(--bg-card)] text-[var(--text-primary)] font-semibold border border-[var(--border-default)] shadow-xs'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
              title="Switch identity to Demo Student (Alex Chen - STU001)"
            >
              <User className="w-3.5 h-3.5 text-emerald-700 dark:text-teal-400" />
              Student View
            </button>
            <button
              onClick={() => handleQuickSwitch('faculty')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded font-medium transition-all min-h-[36px] ${
                user?.role === 'faculty' && isAuthenticated
                  ? 'bg-[var(--bg-card)] text-[var(--text-primary)] font-semibold border border-[var(--border-default)] shadow-xs'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
              title="Switch identity to Demo Faculty (Dr. Priya Sharma)"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
              Faculty View
            </button>
          </div>

          {/* Theme Toggle */}
          <button
            onClick={toggle}
            aria-label="Toggle light or dark visual theme"
            className="w-10 h-10 flex items-center justify-center rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-muted)] border border-[var(--border-default)] transition-colors"
          >
            {mounted ? (
              theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />
            ) : (
              <span className="w-4 h-4 block" />
            )}
          </button>

          {/* Authenticated user indicator / Sign in button */}
          {isAuthenticated ? (
            <div className="hidden md:flex items-center gap-3 pl-2 border-l border-[var(--border-subtle)]">
              <div className="flex flex-col text-right">
                <span className="text-xs font-semibold text-[var(--text-primary)] leading-tight">
                  {user?.name}
                </span>
                <span className="text-[11px] text-[var(--text-muted)] font-mono leading-tight">
                  {user?.role === 'faculty' ? 'Faculty Reviewer' : `ID: ${user?.student_id || 'STU001'}`}
                </span>
              </div>
              <button
                onClick={handleLogout}
                title="Sign Out"
                className="w-10 h-10 flex items-center justify-center rounded text-[var(--text-secondary)] hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30 border border-[var(--border-default)] transition-colors"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="hidden sm:flex items-center gap-2">
              <Link
                href="/login"
                className="btn-outline text-xs px-3 min-h-[36px] flex items-center justify-center"
              >
                Sign In
              </Link>
              <Link
                href={appMode === 'faculty' ? '/dashboard' : '/interview'}
                className="btn-primary text-xs px-4 min-h-[36px] flex items-center justify-center"
              >
                {appMode === 'faculty' ? 'Console' : 'Start Viva'}
              </Link>
            </div>
          )}

          {/* Mobile Menu Hamburger */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle navigation menu"
            className="md:hidden w-11 h-11 flex items-center justify-center rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-muted)] border border-[var(--border-default)] transition-colors"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-[var(--border-default)] bg-[var(--bg-page)] px-4 py-4 space-y-4 shadow-lg">
          {/* Quick Persona Switcher on mobile */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
              Identity Switcher (Local Testing)
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleQuickSwitch('student')}
                className={`flex items-center justify-center gap-1.5 py-2 text-xs rounded border transition-colors ${
                  user?.role === 'student' && isAuthenticated
                    ? 'bg-[var(--bg-card)] font-bold border-[var(--primary)] text-[var(--primary)]'
                    : 'border-[var(--border-default)] text-[var(--text-secondary)]'
                }`}
              >
                <User className="w-3.5 h-3.5" />
                Student
              </button>
              <button
                onClick={() => handleQuickSwitch('faculty')}
                className={`flex items-center justify-center gap-1.5 py-2 text-xs rounded border transition-colors ${
                  user?.role === 'faculty' && isAuthenticated
                    ? 'bg-[var(--bg-card)] font-bold border-[var(--primary)] text-[var(--primary)]'
                    : 'border-[var(--border-default)] text-[var(--text-secondary)]'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                Faculty
              </button>
            </div>
          </div>

          <a
            href={targetPortalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between p-2.5 rounded bg-[var(--bg-muted)] border border-[var(--border-default)] text-xs font-medium text-[var(--text-primary)]"
          >
            <span>Open {targetPortalLabel}</span>
            <ExternalLink className="w-3.5 h-3.5 text-[var(--text-muted)]" />
          </a>

          {/* Navigation Items */}
          <div className="space-y-1">
            {appMode === 'faculty' ? (
              <>
                <Link
                  href="/dashboard"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center gap-2 p-2 rounded text-sm text-[var(--text-primary)] hover:bg-[var(--bg-muted)]"
                >
                  <LayoutDashboard className="w-4 h-4 text-[var(--primary)]" />
                  Assessment Registry
                </Link>
                <Link
                  href="/setup"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center gap-2 p-2 rounded text-sm text-[var(--text-primary)] hover:bg-[var(--bg-muted)]"
                >
                  <Sliders className="w-4 h-4 text-[var(--primary)]" />
                  Configure Viva
                </Link>
              </>
            ) : (
              <Link
                href="/interview"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-2 p-2 rounded text-sm text-[var(--text-primary)] hover:bg-[var(--bg-muted)]"
              >
                <Mic className="w-4 h-4 text-[var(--primary)]" />
                Take Viva Exam
              </Link>
            )}
          </div>

          {/* User & Sign Out */}
          <div className="pt-3 border-t border-[var(--border-subtle)] flex items-center justify-between">
            {isAuthenticated ? (
              <>
                <div>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">{user?.name}</p>
                  <p className="text-xs text-[var(--text-muted)] font-mono">
                    {user?.role === 'faculty' ? 'Faculty Reviewer' : `ID: ${user?.student_id || 'STU001'}`}
                  </p>
                </div>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold text-red-700 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sign Out
                </button>
              </>
            ) : (
              <div className="w-full flex gap-2">
                <Link
                  href="/login"
                  onClick={() => setMobileMenuOpen(false)}
                  className="btn-outline flex-1 text-center text-xs py-2"
                >
                  Sign In
                </Link>
                <Link
                  href={appMode === 'faculty' ? '/dashboard' : '/interview'}
                  onClick={() => setMobileMenuOpen(false)}
                  className="btn-primary flex-1 text-center text-xs py-2"
                >
                  {appMode === 'faculty' ? 'Console' : 'Start Viva'}
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}

export default Navbar;
