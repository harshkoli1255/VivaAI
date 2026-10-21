'use client';

import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/store';
import { useToast } from '@/components/providers/ToastProvider';
import { useTheme } from '@/components/providers/ThemeProvider';
import { authApi } from '@/lib/api';
import { getFacultyPortalUrl, getStudentPortalUrl } from '@/lib/utils';
import { AudioLines, LogOut, Menu, X, Sun, Moon } from 'lucide-react';

const subscribe = () => () => {};
export function Navbar({ appMode = 'student' }: { appMode?: 'student' | 'faculty' }) {
  const pathname = usePathname();
  const router = useRouter();
  const { showToast } = useToast();
  const { theme, toggle } = useTheme();
  const { user, isAuthenticated, logout } = useAuthStore();
  const [open, setOpen] = useState(false);
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  if (pathname?.startsWith('/interview/')) return null;
  const faculty = appMode === 'faculty';
  const signedIn = mounted && isAuthenticated;
  const links = faculty ? [{ href: '/dashboard', label: 'Dashboard' }, { href: '/setup', label: 'Create viva' }] : [{ href: '/interview', label: 'My viva' }, { href: '/sessions', label: 'Results & feedback' }];
  async function signOut() {
    try { await authApi.logout(); } catch { showToast('Could not sign out. Check your connection and retry.', 'error'); return; }
    logout(); setOpen(false); router.push('/login');
  }
  return <header className="portal-header sticky top-0 z-40 border-b border-[var(--border-subtle)] backdrop-blur-xl">
    <div className="mx-auto flex h-20 max-w-7xl items-center justify-between gap-3 px-5 sm:px-8">
      <div className="flex min-w-0 items-center gap-7"><Link href="/" aria-label="VivaAI home" className="flex items-center gap-2.5"><span className="flex h-10 w-10 items-center justify-center rounded-[14px] brand-mark"><AudioLines className="h-6 w-6" /></span><span className="text-xl font-bold tracking-tight">Viva<span className="text-[var(--primary)]">AI</span></span></Link><span className="portal-label hidden lg:block">{faculty ? 'Faculty studio' : 'Student portal'}</span>
      {signedIn && <nav className="hidden items-center gap-2 md:flex" aria-label="Main navigation">{links.map(link => <Link key={link.href} href={link.href} aria-current={pathname === link.href ? 'page' : undefined} className={`rounded-xl px-4 py-2.5 text-sm font-medium ${pathname === link.href ? 'bg-[var(--accent-subtle)] text-[var(--primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-muted)]'}`}>{link.label}</Link>)}</nav>}</div>
      <div className="flex items-center gap-3"><button type="button" onClick={toggle} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} className="flex h-11 w-11 items-center justify-center rounded-xl text-[var(--text-secondary)] hover:bg-[var(--bg-muted)]">{mounted && theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</button>{signedIn ? <><div className="hidden max-w-40 text-right sm:block"><p className="truncate text-sm font-semibold">{user?.name}</p><p className="text-xs text-[var(--text-muted)]">{faculty ? 'Faculty' : user?.student_id}</p></div><button onClick={signOut} aria-label="Sign out" className="flex h-11 w-11 items-center justify-center rounded-xl text-[var(--text-secondary)] hover:bg-[var(--bg-muted)]"><LogOut className="h-4 w-4" /></button><button onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="mobile-navigation" aria-label={open ? 'Close navigation menu' : 'Open navigation menu'} className="flex h-11 w-11 items-center justify-center md:hidden">{open ? <X /> : <Menu />}</button></> : <><a className="hidden text-sm text-[var(--text-secondary)] sm:block" href={faculty ? getStudentPortalUrl() : getFacultyPortalUrl()}>{faculty ? 'Student portal' : 'For faculty'}</a>{pathname !== '/login' && <Link href="/login" className="btn-secondary">Sign in</Link>}</>}</div>
    </div>
    {open && signedIn && <nav id="mobile-navigation" aria-label="Mobile navigation" className="flex flex-col gap-2 border-t border-[var(--border-subtle)] p-4 md:hidden">{links.map(link => <Link key={link.href} href={link.href} onClick={() => setOpen(false)} aria-current={pathname === link.href ? 'page' : undefined} className={`rounded-xl px-4 py-3 text-sm font-medium ${pathname === link.href ? 'bg-[var(--accent-subtle)] text-[var(--primary)]' : 'hover:bg-[var(--bg-muted)]'}`}>{link.label}</Link>)}</nav>}
  </header>;
}
export default Navbar;
