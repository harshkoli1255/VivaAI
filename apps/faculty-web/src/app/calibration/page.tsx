'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, getApiErrorMessage } from '@/lib/api';
import { downloadBlob } from '@/lib/utils';
import { useAuthStore } from '@/store';

type Comparison = { session_id: string; faculty_score: number; ai_score: number; gap: number; model: string; prompt_version: string };
type Report = { summary: { comparisons: number; minimum_count_met: boolean; contains_mock_scores: boolean; mean_absolute_gap: number; mean_ai_minus_human: number; pearson_correlation: number | null }; comparisons: Comparison[]; scope: string };

export default function CalibrationPage() {
  const router = useRouter();
  const { user, isAuthenticated, hasHydrated } = useAuthStore();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  useEffect(() => {
    if (hasHydrated && (!isAuthenticated || user?.role !== 'faculty')) router.replace('/login');
  }, [hasHydrated, isAuthenticated, user, router]);
  if (!hasHydrated || !isAuthenticated || user?.role !== 'faculty') return <p className="p-8">Checking faculty access…</p>;
  async function compare() {
    if (!file) return;
    setBusy(true); setError(''); setReport(null);
    try {
      const data = new FormData(); data.append('file', file);
      setReport((await api.post<Report>('/calibration', data, { headers: { 'Content-Type': 'multipart/form-data' } })).data);
    } catch (cause) { setError(getApiErrorMessage(cause, 'Comparison failed. Check the CSV and try again.')); }
    finally { setBusy(false); }
  }
  function download() {
    if (!report) return;
    downloadBlob(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }), 'viva-calibration.json');
  }
  return <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8">
    <Link href="/dashboard" className="text-sm text-[var(--primary)]">← Back to dashboard</Link>
    <div className="workspace-banner mt-6 rounded-3xl p-7 sm:p-9"><p className="text-xs font-semibold uppercase tracking-widest text-[var(--primary)]">Faculty calibration</p><h1 className="mt-3 text-3xl font-semibold tracking-tight">How closely do the marks agree?</h1><p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--text-secondary)]">Compare your independent marks with the original AI scores. This records a comparison and does not change student marks.</p></div>
    <section className="academic-dossier mt-6 rounded-2xl p-6">
      <label htmlFor="calibration-file" className="block text-sm font-semibold">Faculty marks CSV</label>
      <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">Use columns <code>session_id,faculty_score</code>, with marks out of 100. Use consented sessions and obtain any separate study or sharing approval. At least 10 different vivas are required for the PDF benchmark.</p>
      <input id="calibration-file" type="file" accept=".csv,text/csv" disabled={busy} className="mt-4 block w-full text-sm" onChange={event => { setFile(event.target.files?.[0] || null); setReport(null); setError(''); }} />
      <button type="button" className="btn-primary mt-5" disabled={!file || busy} onClick={() => void compare()}>{busy ? 'Comparing…' : 'Compare marks'}</button>
      {error && <p role="alert" className="mt-4 text-sm text-[var(--status-danger)]">{error}</p>}
      {!report && !error && <p className="mt-5 text-sm text-[var(--text-muted)]">No comparisons yet. Results appear only after you provide faculty marks.</p>}
    </section>
    {report && <section className="academic-dossier mt-6 rounded-2xl p-6" aria-label="Calibration results">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{report.summary.comparisons} viva comparisons</h2><button className="btn-secondary text-xs" onClick={download}>Download results</button></div>
      {!report.summary.minimum_count_met && <p role="status" className="mt-3 text-sm text-[var(--status-warning)]">Preliminary only: fewer than 10 vivas. The PDF minimum is not met.</p>}
      {report.summary.contains_mock_scores && <p role="status" className="mt-3 text-sm text-[var(--status-warning)]">Mock scores are included. This development comparison does not establish real AI grading accuracy.</p>}
      <dl className="mt-5 grid gap-4 sm:grid-cols-3">{[['Average absolute gap', report.summary.mean_absolute_gap.toFixed(2) + ' / 100'], ['AI minus faculty', report.summary.mean_ai_minus_human.toFixed(2)], ['Correlation', report.summary.pearson_correlation?.toFixed(3) ?? 'Undefined: insufficient variation']].map(([label,value]) => <div key={label} className="rounded-xl bg-[var(--bg-muted)] p-4"><dt className="text-xs text-[var(--text-secondary)]">{label}</dt><dd className="mt-2 text-lg font-semibold">{value}</dd></div>)}</dl>
      <div className="mt-6 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-3">Viva</th><th className="p-3">Faculty</th><th className="p-3">AI</th><th className="p-3">Difference</th></tr></thead><tbody>{report.comparisons.map(row => <tr key={row.session_id} className="border-t border-[var(--border-subtle)]"><td className="p-3"><Link href={`/review/${row.session_id}`} className="text-[var(--primary)]">{row.session_id.slice(0,8)}</Link></td><td className="p-3">{row.faculty_score}</td><td className="p-3">{row.ai_score}</td><td className="p-3">{row.gap.toFixed(2)}</td></tr>)}</tbody></table></div>
      <p className="mt-4 text-xs leading-relaxed text-[var(--text-muted)]">{report.scope}</p>
    </section>}
  </main>;
}
