'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store';
import { dashboardApi } from '@/lib/api';
import { getStudentPortalUrl } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';
import { AlertTriangle, ArrowRight, Award, Download, Plus, RefreshCw, Search, ShieldCheck, Users } from 'lucide-react';

interface CandidateSession {
  id: string;
  studentId: string;
  studentName: string;
  title: string;
  subject: string;
  status: string;
  reviewStatus: string;
  score: number | null;
  overrideScore: number | null;
  startedAt: string | null;
  endedAt: string | null;
  tabSwitches: number;
  longSilences: number;
}

interface DashboardStats {
  total_sessions: number;
  completed_sessions: number;
  flagged_sessions: number;
  pending_review: number;
  average_score: number;
}

const emptyStats: DashboardStats = {
  total_sessions: 0,
  completed_sessions: 0,
  flagged_sessions: 0,
  pending_review: 0,
  average_score: 0,
};

function normalizeSession(raw: Record<string, unknown>): CandidateSession {
  const score = raw.effective_score ?? raw.total_score;
  const overrideScore = raw.override_score;
  return {
    id: typeof raw.id === 'string' ? raw.id : '',
    studentId: typeof raw.student_id_code === 'string' ? raw.student_id_code : '',
    studentName: typeof raw.student_name === 'string' ? raw.student_name : 'Unknown candidate',
    title: typeof raw.viva_title === 'string' ? raw.viva_title : 'Untitled viva',
    subject: typeof raw.subject === 'string' ? raw.subject : '',
    status: typeof raw.status === 'string' ? raw.status : 'unknown',
    reviewStatus: typeof raw.review_status === 'string' ? raw.review_status : 'unknown',
    score: typeof score === 'number' ? score : null,
    overrideScore: typeof overrideScore === 'number' ? overrideScore : null,
    startedAt: typeof raw.started_at === 'string' ? raw.started_at : null,
    endedAt: typeof raw.ended_at === 'string' ? raw.ended_at : null,
    tabSwitches: typeof raw.tab_switch_count === 'number' ? raw.tab_switch_count : 0,
    longSilences: typeof raw.long_silence_count === 'number' ? raw.long_silence_count : 0,
  };
}

function formatSessionDate(dateString: string | null): string {
  if (!dateString) return '—';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(date);
}

function humanize(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function AssessmentDashboardPage() {
  const router = useRouter();
  const { user, isAuthenticated, hasHydrated } = useAuthStore();
  const [sessions, setSessions] = useState<CandidateSession[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'flagged'>('all');
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 20;

  useEffect(() => {
    if (!hasHydrated) return;
    if (!isAuthenticated) router.replace('/login');
    else if (user?.role !== 'faculty') {
      window.location.assign(`${getStudentPortalUrl()}/login`);
    }
  }, [hasHydrated, isAuthenticated, user?.role, router]);

  const loadDashboard = useCallback(async () => {
    try {
      const [sessionsResponse, statsResponse] = await Promise.all([
        dashboardApi.sessions({
          page,
          page_size: pageSize,
          ...(statusFilter === 'all' ? {} : { status: statusFilter }),
          ...(searchDebounced ? { search: searchDebounced } : {}),
        }),
        dashboardApi.stats(),
      ]);
      const result = sessionsResponse.data;
      setError(null);
      const items = Array.isArray(result?.items) ? result.items : [];
      setSessions(items.map((item: Record<string, unknown>) => normalizeSession(item)));
      setTotal(typeof result?.total === 'number' ? result.total : items.length);
      setStats({ ...emptyStats, ...(statsResponse.data || {}) });
    } catch {
      setError('We could not load the assessment registry. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, searchDebounced]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchDebounced(searchQuery.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (!hasHydrated || !isAuthenticated || user?.role !== 'faculty') return;
    let active = true;
    Promise.all([
      dashboardApi.sessions({
        page,
        page_size: pageSize,
        ...(statusFilter === 'all' ? {} : { status: statusFilter }),
        ...(searchDebounced ? { search: searchDebounced } : {}),
      }),
      dashboardApi.stats(),
    ]).then(([sessionsResponse, statsResponse]) => {
      if (!active) return;
      const result = sessionsResponse.data;
      const items = Array.isArray(result?.items) ? result.items : [];
      setError(null);
      setSessions(items.map((item: Record<string, unknown>) => normalizeSession(item)));
      setTotal(typeof result?.total === 'number' ? result.total : items.length);
      setStats({ ...emptyStats, ...(statsResponse.data || {}) });
      setLoading(false);
    }).catch(() => {
      if (!active) return;
      setError('We could not load the assessment registry. Check your connection and try again.');
      setLoading(false);
    });
    return () => { active = false; };
  }, [hasHydrated, isAuthenticated, user?.role, page, statusFilter, searchDebounced]);

  const handleExportCsv = async () => {
    setIsExporting(true);
    setExportError(null);
    try {
      const status = statusFilter === 'all' ? undefined : statusFilter;
      const response = await dashboardApi.exportCsv(status, searchDebounced || undefined);
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'text/csv;charset=utf-8;' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `vivaai_assessments_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
    } catch {
      setExportError('CSV export failed. Please retry when the service is available.');
    } finally {
      setIsExporting(false);
    }
  };

  const filteredSessions = sessions;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (!hasHydrated || !isAuthenticated || user?.role !== 'faculty') {
    return <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-[var(--bg-page)] px-4 text-sm text-[var(--text-secondary)]">Checking your faculty account…</div>;
  }

  const statCards = [
    { label: 'Viva sessions', value: stats?.total_sessions, helper: 'All sessions', icon: Users },
    { label: 'Completed', value: stats?.completed_sessions, helper: 'Completed sessions', icon: Award },
    { label: 'Flagged', value: stats?.flagged_sessions, helper: 'Sessions needing attention', icon: AlertTriangle },
    { label: 'Pending review', value: stats?.pending_review, helper: 'Awaiting faculty review', icon: ShieldCheck },
    { label: 'Average score', value: stats && stats.completed_sessions > 0 ? `${stats.average_score.toFixed(1)} / 100` : (stats ? '—' : undefined), helper: 'Scored sessions only', icon: Award },
  ];

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[var(--bg-page)] px-4 py-8 text-[var(--text-primary)] transition-colors sm:px-6 sm:py-10 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="flex flex-col justify-between gap-4 border-b border-[var(--border-default)] pb-6 sm:flex-row sm:items-end">
          <div className="space-y-1.5">
            <p className="font-mono text-xs font-semibold uppercase tracking-wider text-[var(--primary)]">Faculty assessment board</p>
            <h1 className="font-editorial text-2xl font-bold tracking-tight sm:text-4xl">Assessment registry</h1>
            <p className="max-w-2xl text-sm text-[var(--text-secondary)]">Review viva sessions, scores, and recorded session activity.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={handleExportCsv} disabled={isExporting} className="btn-outline min-h-11 gap-2 px-3.5 text-xs">
              <Download aria-hidden="true" className="h-3.5 w-3.5" />{isExporting ? 'Exporting…' : 'Export CSV'}
            </button>
            <Link href="/setup" className="btn-primary min-h-11 gap-2 px-4 text-xs"><Plus aria-hidden="true" className="h-3.5 w-3.5" />Configure viva</Link>
          </div>
        </div>

        {exportError && <p role="alert" className="rounded border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] p-3 text-sm text-[var(--status-danger)]">{exportError}</p>}

        <section aria-label="Assessment statistics" className="grid grid-cols-2 gap-px overflow-hidden rounded border border-[var(--border-default)] bg-[var(--border-subtle)] sm:grid-cols-3 lg:grid-cols-5">
          {statCards.map(({ label, value, helper, icon: Icon }) => (
            <div key={label} className="min-w-0 bg-[var(--bg-card)] p-4 sm:p-5">
              <div className="flex items-center justify-between gap-2 text-xs text-[var(--text-muted)]"><span className="truncate font-mono uppercase tracking-wide">{label}</span><Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--primary)]" /></div>
              <p className="mt-2 font-editorial text-2xl font-bold text-[var(--text-primary)]">{loading && value === undefined ? '—' : value ?? '—'}</p>
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">{helper}</p>
            </div>
          ))}
        </section>

        <section aria-label="Search and filter sessions" className="flex flex-col gap-3 rounded border border-[var(--border-default)] bg-[var(--bg-card)] p-3 sm:flex-row sm:items-center sm:justify-between">
          <label htmlFor="dashboard-search" className="relative min-w-0 flex-1">
            <Search aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
            <span className="sr-only">Search sessions</span>
            <input id="dashboard-search" type="search" placeholder="Search by candidate, ID, or viva…" value={searchQuery} onChange={(event) => { setSearchQuery(event.target.value); setLoading(true); setError(null); setPage(1); }} className="min-h-11 w-full rounded bg-transparent py-2 pl-9 pr-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none" />
          </label>
          <div className="flex flex-wrap gap-1.5" aria-label="Filter by session status">
            {(['all', 'completed', 'flagged'] as const).map((status) => (
              <button key={status} type="button" aria-pressed={statusFilter === status} onClick={() => { if (statusFilter === status) return; setStatusFilter(status); setLoading(true); setError(null); setPage(1); }} className={`min-h-10 rounded px-3 text-xs font-medium transition-colors ${statusFilter === status ? 'border border-[var(--border-default)] bg-[var(--accent-subtle)] font-bold text-[var(--primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-muted)]'}`}>
                {status === 'all' ? 'All sessions' : humanize(status)}
              </button>
            ))}
          </div>
        </section>

        {error ? (
          <section className="rounded border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] p-6 text-center" role="alert">
            <p className="text-sm text-[var(--status-danger)]">{error}</p>
            <button type="button" onClick={() => { setLoading(true); setError(null); void loadDashboard(); }} className="btn-outline mt-4 gap-2 text-xs"><RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />Retry</button>
          </section>
        ) : loading ? (
          <div className="rounded border border-[var(--border-default)] bg-[var(--bg-card)] p-12 text-center text-sm text-[var(--text-secondary)]" role="status">Loading assessment sessions…</div>
        ) : (
          <>
            <div className="hidden overflow-x-auto rounded border border-[var(--border-default)] bg-[var(--bg-card)] sm:block">
              <table className="table-academic min-w-[900px] w-full">
                <caption className="sr-only">Viva assessment sessions</caption>
                <thead><tr><th>Candidate</th><th>Viva</th><th>Score</th><th>Status</th><th>Session activity</th><th>Ended</th><th className="text-right">Action</th></tr></thead>
                <tbody>
                  {filteredSessions.map((session) => (
                    <tr key={session.id}>
                      <td><div className="font-bold text-[var(--text-primary)]">{session.studentName}</div><span className="font-mono text-xs text-[var(--text-muted)]">{session.studentId || 'ID unavailable'}</span></td>
                      <td><div className="max-w-xs truncate text-sm">{session.title}</div><span className="text-xs text-[var(--text-muted)]">{session.subject || 'Subject unavailable'}</span></td>
                      <td className="font-semibold">{session.score === null ? 'Pending' : `${session.score} / 100`}{session.overrideScore !== null && <span className="ml-1 text-[11px] text-[var(--text-muted)]">(adjusted)</span>}</td>
                      <td><Badge variant={session.status === 'flagged' ? 'warning' : session.status === 'completed' ? 'success' : 'neutral'}>{humanize(session.status)}</Badge><div className="mt-1 text-[11px] text-[var(--text-muted)]">Review: {humanize(session.reviewStatus)}</div></td>
                      <td className="text-xs text-[var(--text-secondary)]">{session.tabSwitches} tab switches · {session.longSilences} long silences</td>
                      <td className="whitespace-nowrap font-mono text-xs text-[var(--text-muted)]">{formatSessionDate(session.endedAt || session.startedAt)}</td>
                      <td className="text-right"><Link href={`/review/${session.id}`} className="btn-secondary inline-flex min-h-10 items-center gap-1 px-3 text-xs">Review<ArrowRight aria-hidden="true" className="h-3.5 w-3.5" /></Link></td>
                    </tr>
                  ))}
                  {filteredSessions.length === 0 && <tr><td colSpan={7} className="py-12 text-center text-sm text-[var(--text-muted)]">{total === 0 && !searchDebounced && statusFilter === 'all' ? 'No viva sessions yet.' : 'No sessions match your search and filters.'}</td></tr>}
                </tbody>
              </table>
            </div>

            <div className="space-y-3 sm:hidden">
              {filteredSessions.map((session) => (
                <article key={session.id} className="academic-dossier space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="truncate text-sm font-bold">{session.studentName}</h2><p className="font-mono text-xs text-[var(--text-muted)]">{session.studentId || 'ID unavailable'}</p></div><Badge variant={session.status === 'flagged' ? 'warning' : session.status === 'completed' ? 'success' : 'neutral'}>{humanize(session.status)}</Badge></div>
                  <div><p className="font-medium text-sm">{session.title}</p><p className="text-xs text-[var(--text-muted)]">{session.subject || 'Subject unavailable'}</p></div>
                  <div className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-3 text-xs"><span>Score: {session.score === null ? 'Pending' : `${session.score}/100`}</span><span className="font-mono text-[var(--text-muted)]">{formatSessionDate(session.endedAt || session.startedAt)}</span></div>
                  <p className="text-xs text-[var(--text-secondary)]">{session.tabSwitches} tab switches · {session.longSilences} long silences</p>
                  <Link href={`/review/${session.id}`} className="btn-secondary flex w-full items-center justify-center gap-2 text-xs">Review session<ArrowRight aria-hidden="true" className="h-3.5 w-3.5" /></Link>
                </article>
              ))}
              {filteredSessions.length === 0 && <div className="rounded border border-[var(--border-default)] bg-[var(--bg-card)] p-8 text-center text-sm text-[var(--text-muted)]">{total === 0 && !searchDebounced && statusFilter === 'all' ? 'No viva sessions yet.' : 'No sessions match your search and filters.'}</div>}
            </div>

            <div className="flex items-center justify-between gap-3 text-xs text-[var(--text-muted)]">
              <span>Showing {total === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total} sessions</span>
              <div className="flex gap-2">
                <button type="button" disabled={page <= 1} onClick={() => { setLoading(true); setError(null); setPage((value) => Math.max(1, value - 1)); }} className="btn-outline min-h-10 px-3 text-xs">Previous</button>
                <span className="flex min-h-10 items-center px-2" aria-live="polite">Page {page} of {totalPages}</span>
                <button type="button" disabled={page >= totalPages} onClick={() => { setLoading(true); setError(null); setPage((value) => value + 1); }} className="btn-outline min-h-10 px-3 text-xs">Next</button>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
