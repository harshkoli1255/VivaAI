'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { configsApi, getApiErrorMessage } from '@/lib/api';
import { downloadBlob, getStudentPortalUrl } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';
import { useToast } from '@/components/providers/ToastProvider';
import { ArrowUpRight, BookOpen, Copy, Download, Link2, Pause, Pencil, Play, RefreshCw, Search } from 'lucide-react';

interface ManagedViva {
  id: string; title: string; subject: string; course_code: string; topics: string[]; difficulty: string;
  total_duration_secs: number; revision: number; is_active: boolean; superseded_by_id: string | null;
  question_count: number; pending_question_count: number; session_count: number; in_progress_count: number; updated_at: string;
}
export function VivaLibrary({ onReview }: { onReview: (id: string, title: string) => void }) {
  const [vivas, setVivas] = useState<ManagedViva[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'current' | 'paused' | 'history'>('current');
  const [busy, setBusy] = useState<string | null>(null);
  const { showToast } = useToast();
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try { setVivas((await configsApi.manage()).data); }
    catch (cause) { setError(getApiErrorMessage(cause, 'Could not load your vivas.')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    let active = true;
    configsApi.manage().then(({ data }) => { if (active) setVivas(data); })
      .catch(cause => { if (active) setError(getApiErrorMessage(cause, 'Could not load your vivas.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  async function enrollment(viva: ManagedViva) {
    setBusy(viva.id); setError('');
    try {
      const { data } = await configsApi.enrollment(viva.id, !viva.is_active, viva.updated_at);
      setVivas(current => current.map(item => item.id === viva.id ? data : item));
      showToast(data.is_active ? 'New students can now start this viva.' : 'New enrollment paused. Existing interviews can continue and resume.', 'success');
    } catch (cause) { setError(getApiErrorMessage(cause, 'Could not change enrollment. Refresh the library and retry.')); }
    finally { setBusy(null); }
  }
  async function share(viva: ManagedViva) {
    try {
      await navigator.clipboard.writeText(`${getStudentPortalUrl()}/interview?viva=${encodeURIComponent(viva.id)}`);
      showToast('Student link copied. Students sign in and give consent before starting.', 'success');
    } catch { showToast('Clipboard access is unavailable. Copy the link shown in More options.', 'warning'); }
  }
  async function exportBank(viva: ManagedViva) {
    setBusy(viva.id);
    try {
      const { data } = await configsApi.get(viva.id);
      downloadBlob(new Blob([JSON.stringify({ title: data.title, subject: data.subject, revision: data.revision, questions: data.questions }, null, 2)], { type: 'application/json' }), `viva-bank-${viva.id.slice(0,8)}-v${viva.revision}.json`);
    } catch (cause) { setError(getApiErrorMessage(cause, 'Could not download the question bank.')); }
    finally { setBusy(null); }
  }
  const visible = vivas.filter(viva => {
    const statusMatches = filter === 'history' ? Boolean(viva.superseded_by_id) : !viva.superseded_by_id && (filter !== 'paused' || !viva.is_active);
    return statusMatches && `${viva.title} ${viva.subject} ${viva.course_code} ${viva.topics.join(' ')}`.toLowerCase().includes(query.toLowerCase().trim());
  });
  return <section className="space-y-5" aria-labelledby="viva-library-heading">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow mb-2">Assessment library</p><h2 id="viva-library-heading" className="text-2xl font-semibold">Your vivas</h2><p className="mt-2 text-sm text-[var(--text-secondary)]">Manage questions and settings. Every published edit preserves existing interviews.</p></div><button className="btn-secondary gap-2 text-xs" onClick={() => void refresh()} disabled={loading}><RefreshCw aria-hidden="true" className="h-4 w-4" />Refresh vivas</button></div>
    <div className="flex flex-wrap items-center gap-3"><label className="relative min-w-0 flex-[1_1_240px]"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" /><span className="sr-only">Search vivas</span><input type="search" className="form-input !pl-10" placeholder="Find a viva by title, course, or topic…" value={query} onChange={event => setQuery(event.target.value)} /></label><div className="flex flex-wrap gap-1.5">{(['current','paused','history'] as const).map(value => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)} className={`min-h-11 rounded-xl px-3 text-xs font-semibold ${filter === value ? 'bg-[var(--accent-subtle)] text-[var(--primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-muted)]'}`}>{value === 'current' ? 'Latest versions' : value === 'paused' ? 'Paused' : 'Version history'}</button>)}</div></div>
    {error && <p role="alert" className="rounded-xl bg-[var(--status-danger-bg)] p-4 text-sm text-[var(--status-danger)]">{error}</p>}
    {loading ? <p role="status" className="academic-dossier p-8 text-center text-sm">Loading your viva library…</p> : <div className="grid gap-4 lg:grid-cols-2">{visible.map(viva => <article key={viva.id} aria-label={`Viva: ${viva.title}`} className="academic-dossier flex min-w-0 flex-col gap-5 p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-subtle)] text-[var(--primary)]"><BookOpen aria-hidden="true" className="h-5 w-5" /></span><div className="flex flex-wrap justify-end gap-2"><Badge variant={viva.superseded_by_id ? 'neutral' : viva.is_active ? 'success' : 'warning'}>{viva.superseded_by_id ? 'Historical' : viva.is_active ? 'Open to students' : 'Enrollment paused'}</Badge><Badge variant="neutral">Version {viva.revision}</Badge></div></div>
      <div><p className="mb-2 text-xs font-medium text-[var(--primary)]">{[viva.course_code, viva.subject].filter(Boolean).join(' · ')}</p><h3 className="break-words text-lg font-semibold">{viva.title}</h3><p className="mt-2 line-clamp-2 text-sm leading-relaxed text-[var(--text-secondary)]">{viva.topics.join(' · ') || 'No syllabus topics added.'}</p></div>
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-[var(--text-secondary)]"><span>{viva.question_count} approved questions</span><span>{Math.round(viva.total_duration_secs / 60)} minutes</span><span className="capitalize">{viva.difficulty}</span>{viva.pending_question_count > 0 && <span className="text-[var(--status-warning)]">{viva.pending_question_count} pending approval</span>}</div>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-4"><p className="text-xs text-[var(--text-muted)]">{viva.session_count} interviews · {viva.in_progress_count} in progress</p><div className="flex flex-wrap gap-2">{!viva.superseded_by_id && <Link href={`/setup/${viva.id}`} className="btn-secondary gap-2 px-3 text-xs"><Pencil aria-hidden="true" className="h-3.5 w-3.5" />Edit viva</Link>}<button className="btn-secondary gap-2 px-3 text-xs" onClick={() => onReview(viva.id, viva.title)}>Review interviews<ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" /></button></div></div>
      <details className="border-t border-[var(--border-subtle)] pt-3"><summary className="min-h-9 cursor-pointer py-2 text-xs font-medium text-[var(--text-secondary)]">More options</summary><div className="mt-3 flex flex-wrap gap-2"><Link className="btn-ghost gap-2 px-3 text-xs" href={`/setup/${viva.id}/duplicate`}><Copy aria-hidden="true" className="h-4 w-4" />Duplicate</Link><button disabled={busy === viva.id} className="btn-ghost gap-2 px-3 text-xs" onClick={() => void exportBank(viva)}><Download aria-hidden="true" className="h-4 w-4" />Download questions</button>{!viva.superseded_by_id && <><button disabled={busy === viva.id} onClick={() => void enrollment(viva)} className="btn-ghost gap-2 px-3 text-xs">{viva.is_active ? <Pause aria-hidden="true" className="h-4 w-4" /> : <Play aria-hidden="true" className="h-4 w-4" />}{viva.is_active ? 'Pause new enrollment' : 'Reopen enrollment'}</button>{viva.is_active && <button className="btn-ghost gap-2 px-3 text-xs" onClick={() => void share(viva)}><Link2 aria-hidden="true" className="h-4 w-4" />Copy student link</button>}</>}</div>{viva.is_active && !viva.superseded_by_id && <p className="mt-3 break-all text-xs text-[var(--text-muted)]">{getStudentPortalUrl()}/interview?viva={viva.id}</p>}{viva.superseded_by_id && <Link className="mt-3 inline-block text-xs text-[var(--primary)]" href={`/setup/${viva.superseded_by_id}`}>Open next version →</Link>}</details>
    </article>)}{visible.length === 0 && <div className="academic-dossier p-8 text-center text-sm text-[var(--text-secondary)] lg:col-span-2">{query || filter !== 'current' ? 'No vivas match this view.' : 'Your created vivas will appear here.'}<Link className="ml-2 text-[var(--primary)]" href="/setup">Create a viva</Link></div>}</div>}
  </section>;
}
