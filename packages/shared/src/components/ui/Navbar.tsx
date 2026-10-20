'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/store';
import { useToast } from '@/components/providers/ToastProvider';
import { authApi } from '@/lib/api';
import { useTheme } from '@/components/providers/ThemeProvider';
import { getFacultyPortalUrl, getStudentPortalUrl } from '@/lib/utils';
import {
  Moon,
  Sun,
  LogOut,
  GraduationCap,
  LayoutDashboard,
  Mic,
  Sliders,
  Menu,
  X,
  ExternalLink,
} from 'lucide-react';

const subscribe = () => () => {};

interface NavbarProps {
  appMode?: 'student' | 'faculty';
}

export function Navbar({ appMode = 'student' }: NavbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { showToast } = useToast();
  const { user, isAuthenticated, logout } = useAuthStore();
  const { theme, toggle } = useTheme();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const mobileMenuOpen = openPath === pathname;
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.body.style.overflow = mobileMenuOpen ? 'hidden' : '';
    }
    return () => {
      if (typeof document !== 'undefined') {
        document.body.style.overflow = '';
      }
    };
  }, [mobileMenuOpen]);

  // Keep the live interview focused; the interview screen has its own controls.
  if (pathname?.startsWith('/interview/') && pathname !== '/interview') return null;

  const handleLogout = async () => {
    try {
      await authApi.logout();
    } catch {
      showToast('Sign-out could not be confirmed. Reconnect and retry before leaving this device.', 'error');
      return;
    }
    logout();
    setOpenPath(null);
    router.push('/login');
  };

  const otherPortalUrl = appMode === 'student'
    ? getFacultyPortalUrl()
    : getStudentPortalUrl();
  const otherPortalName = appMode === 'student' ? 'Faculty portal' : 'Student portal';
  const showSignInLink = pathname !== '/login';
  const isLoggedIn = mounted && isAuthenticated;

  return (
    <header className="sticky top-0 z-40 w-full border-b border-[var(--border-default)] bg-[var(--bg-page)]/95 backdrop-blur-sm transition-colors">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-6 lg:gap-8">
          <Link href="/" aria-label="VivaAI home" className="group flex min-w-0 items-center gap-3 rounded p-1 focus-visible:outline">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-[#0f5b4a] text-white shadow-sm dark:bg-teal-900">
              <GraduationCap className="h-5 w-5 text-emerald-100 dark:text-teal-200" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="flex items-center gap-2">
                <span className="font-editorial text-lg font-bold tracking-tight text-[var(--text-primary)]">VivaAI</span>
                <span className="rounded border border-[var(--border-default)] bg-[var(--bg-muted)] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[var(--primary)]">
                  {appMode === 'faculty' ? 'FACULTY' : 'STUDENT'}
                </span>
              </span>
              <span className="hidden text-[11px] leading-tight text-[var(--text-muted)] sm:inline">
                {appMode === 'faculty' ? 'Assessment and review console' : 'Oral examination portal'}
              </span>
            </span>
          </Link>

          {isLoggedIn && (
            <nav className="hidden items-center gap-2 md:flex" aria-label="Main navigation">
              {appMode === 'faculty' ? (
                <>
                  <Link href="/dashboard" aria-current={pathname === '/dashboard' ? 'page' : undefined} className={`flex min-h-10 items-center gap-2 rounded px-3 text-xs font-semibold transition-colors ${pathname === '/dashboard' ? 'border border-[var(--border-default)] bg-[var(--accent-subtle)] text-[var(--primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]'}`}>
                    <LayoutDashboard className="h-3.5 w-3.5" /> Assessment registry
                  </Link>
                  <Link href="/setup" aria-current={pathname === '/setup' ? 'page' : undefined} className={`flex min-h-10 items-center gap-2 rounded px-3 text-xs font-semibold transition-colors ${pathname === '/setup' ? 'border border-[var(--border-default)] bg-[var(--accent-subtle)] text-[var(--primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]'}`}>
                    <Sliders className="h-3.5 w-3.5" /> Configure viva
                  </Link>
                </>
              ) : (
                <><Link href="/sessions" className="flex min-h-10 items-center rounded px-3 text-xs font-semibold text-[var(--text-secondary)]">My interviews</Link>
                <Link href="/interview" aria-current={pathname === '/interview' ? 'page' : undefined} className={`flex min-h-10 items-center gap-2 rounded px-3 text-xs font-semibold transition-colors ${pathname === '/interview' ? 'border border-[var(--border-default)] bg-[var(--accent-subtle)] text-[var(--primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]'}`}>
                  <Mic className="h-3.5 w-3.5" /> Take a viva
                </Link></>
              )}
            </nav>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <a href={otherPortalUrl} target="_blank" rel="noopener noreferrer" className="hidden min-h-10 items-center gap-1.5 rounded border border-[var(--border-default)] px-2.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)] lg:flex">
            {otherPortalName}<ExternalLink aria-hidden="true" className="h-3 w-3 text-[var(--text-muted)]" />
          </a>

          <button type="button" onClick={toggle} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} className="flex h-10 w-10 items-center justify-center rounded border border-[var(--border-default)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]">
            {mounted ? theme === 'dark' ? <Sun aria-hidden="true" className="h-4 w-4" /> : <Moon aria-hidden="true" className="h-4 w-4" /> : <span className="block h-4 w-4" />}
          </button>

          {!mounted ? (
            <div className="hidden h-10 w-24 sm:block" />
          ) : isLoggedIn ? (
            <div className="hidden items-center gap-3 border-l border-[var(--border-subtle)] pl-2 md:flex">
              <div className="flex flex-col text-right">
                <span className="max-w-40 truncate text-xs font-semibold leading-tight text-[var(--text-primary)]">{user?.name}</span>
                <span className="text-[11px] leading-tight text-[var(--text-muted)]">
                  {user?.role === 'faculty' ? 'Faculty' : `ID: ${user?.student_id || '—'}`}
                </span>
              </div>
              <button type="button" onClick={handleLogout} aria-label="Sign out" className="flex h-10 w-10 items-center justify-center rounded border border-[var(--border-default)] text-[var(--text-secondary)] transition-colors hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/30">
                <LogOut aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>
          ) : (
            showSignInLink && <Link href="/login" className="hidden min-h-10 items-center rounded border border-[var(--border-default)] px-3 text-xs font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-muted)] sm:flex">Sign in</Link>
          )}

          <button type="button" onClick={() => setOpenPath((open) => open === pathname ? null : pathname)} aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'} aria-expanded={mobileMenuOpen} aria-controls="mobile-navigation" className="flex h-11 w-11 items-center justify-center rounded border border-[var(--border-default)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)] md:hidden">
            {mobileMenuOpen ? <X aria-hidden="true" className="h-5 w-5" /> : <Menu aria-hidden="true" className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {mobileMenuOpen && (
        <nav id="mobile-navigation" aria-label="Mobile navigation" className="space-y-4 border-t border-[var(--border-default)] bg-[var(--bg-page)] px-4 py-4 shadow-lg md:hidden">
          <a href={otherPortalUrl} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center justify-between rounded border border-[var(--border-default)] bg-[var(--bg-muted)] px-3 text-sm font-medium text-[var(--text-primary)]">
            Open {otherPortalName}<ExternalLink aria-hidden="true" className="h-4 w-4 text-[var(--text-muted)]" />
          </a>
          {isLoggedIn && (
            <div className="space-y-1">
              {appMode === 'faculty' ? (
                <>
                  <Link href="/dashboard" onClick={() => setOpenPath(null)} className="flex min-h-11 items-center gap-2 rounded px-2 text-sm hover:bg-[var(--bg-muted)]"><LayoutDashboard className="h-4 w-4 text-[var(--primary)]" />Assessment registry</Link>
                  <Link href="/setup" onClick={() => setOpenPath(null)} className="flex min-h-11 items-center gap-2 rounded px-2 text-sm hover:bg-[var(--bg-muted)]"><Sliders className="h-4 w-4 text-[var(--primary)]" />Configure viva</Link>
                </>
              ) : (
                <><Link href="/sessions" onClick={() => setOpenPath(null)} className="flex min-h-11 items-center rounded px-2 text-sm hover:bg-[var(--bg-muted)]">My interviews</Link>
                <Link href="/interview" onClick={() => setOpenPath(null)} className="flex min-h-11 items-center gap-2 rounded px-2 text-sm hover:bg-[var(--bg-muted)]"><Mic className="h-4 w-4 text-[var(--primary)]" />Take a viva</Link></>
              )}
            </div>
          )}
          {!mounted ? null : isLoggedIn ? (
            <div className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-3">
              <div>
                <p className="text-sm font-semibold text-[var(--text-primary)]">{user?.name}</p>
                <p className="text-xs text-[var(--text-muted)]">{user?.role === 'faculty' ? 'Faculty' : `ID: ${user?.student_id || '—'}`}</p>
              </div>
              <button type="button" onClick={handleLogout} className="btn-outline gap-1.5 border-red-200 px-3 text-xs text-red-700 dark:border-red-900 dark:text-red-300"><LogOut className="h-3.5 w-3.5" />Sign out</button>
            </div>
          ) : (
            showSignInLink && <Link href="/login" onClick={() => setOpenPath(null)} className="btn-primary block w-full text-center text-xs">Sign in</Link>
          )}
        </nav>
      )}
    </header>
  );
}

export default Navbar;
