'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { sessionsApi, scoresApi } from '@/lib/api';
import { useAuthStore } from '@/store';

interface CandidateSession {
  id: string;
  status: string;
  elapsed_secs: number;
  total_score: number | null;
  started_at: string | null;
  review_status: string;
}
interface ScoreReport {
  effective_score: number;
  feedback_lines: string[];
  low_confidence_flag: boolean;
  model_used: string;
  dimensions: Record<string, { score: number; reason: string }>;
}

export default function CandidateSessionsPage() {
  const router = useRouter();
  const { hasHydrated, isAuthenticated, user } = useAuthStore();
  const [sessions, setSessions] = useState<CandidateSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [report, setReport] = useState<ScoreReport | null>(null);
  const [reportMessage, setReportMessage] = useState('');

  useEffect(() => {
    if (hasHydrated && !isAuthenticated) router.replace('/login');
  }, [hasHydrated, isAuthenticated, router]);

  useEffect(() => {
    if (!hasHydrated || !isAuthenticated || user?.role !== 'student') return;
    let active = true;
    async function load() {
      try {
        const response = await sessionsApi.mySessions();
        if (active) { setSessions(response.data); setError(''); }
      } catch {
        if (active) setError('Your interviews could not be loaded. Please retry.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [hasHydrated, isAuthenticated, user?.role, attempt]);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    let poll: ReturnType<typeof setTimeout>;
    async function loadReport() {
      try {
        const response = await scoresApi.get(selectedId!);
        if (active) { setReport(response.data); setReportMessage(''); }
      } catch (err) {
        if (!active) return;
        const status = (err as { response?: { status?: number } }).response?.status;
        if (status === 409) {
          setReportMessage('Your answers are saved. Automated feedback requires faculty review. Please contact your faculty for an update.');
          poll = setTimeout(() => { void loadReport(); }, 10000);
          return;
        }
        if (status === 404) {
          try {
            const { data } = await sessionsApi.scoring(selectedId!);
            if (!active) return;
            if (data.status === 'failed') {
              setReportMessage('Your interview is saved. Evaluation needs faculty review.');
              return;
            }
            setReportMessage(data.status === 'processing' ? 'Your interview is saved. Feedback is being prepared.'
              : `Your interview is saved. Evaluation is queued${data.attempts ? ' for another attempt' : ''}.`);
          } catch { if (active) setReportMessage('Your interview is saved. Feedback status is temporarily unavailable.'); }
        } else {
          setReportMessage('Feedback could not be loaded. Checking again shortly.');
        }
        poll = setTimeout(() => { void loadReport(); }, 10000);
      }
    }
    void loadReport();
    return () => { active = false; clearTimeout(poll); };
  }, [selectedId]);

  if (!hasHydrated || !isAuthenticated) return <p className="p-8" role="status">Verifying your account…</p>;
  if (user?.role !== 'student') return <p className="p-8">Interview history is available to candidates through the student portal.</p>;

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 text-[var(--text-primary)]">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold">My interviews</h1><p className="mt-2 text-sm text-[var(--text-secondary)]">Resume an interrupted interview or review your feedback.</p></div>
        <Link href="/interview" className="btn-primary">Start an interview</Link>
      </div>
      {loading && <p role="status">Loading your interviews…</p>}
      {error && <div role="alert"><p>{error}</p><button className="btn-secondary mt-2" onClick={() => setAttempt((value) => value + 1)}>Retry</button></div>}
      {!loading && !error && sessions.length === 0 && <p>You haven’t started an interview yet. Your sessions and feedback will appear here.</p>}
      <ul className="space-y-3">
        {sessions.map((session) => {
          const resumable = ['scheduled', 'in_progress'].includes(session.status);
          return <li key={session.id} className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">{session.started_at ? new Date(session.started_at).toLocaleString() : 'Ready to start'}</h2>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">{session.status.replaceAll('_', ' ')} · {Math.floor(session.elapsed_secs / 60)}m {session.elapsed_secs % 60}s elapsed</p>
                <p className="mt-1 font-mono text-xs text-[var(--text-muted)]">Reference: {session.id}</p>
              </div>
              {resumable
                ? <Link className="btn-primary" href={`/interview/${session.id}`}>{session.status === 'in_progress' ? 'Resume interview' : 'Enter interview'}</Link>
                : <button className="btn-secondary" onClick={() => { setReport(null); setReportMessage('Loading feedback…'); setSelectedId((current) => current === session.id ? null : session.id); }}>{selectedId === session.id ? 'Hide feedback' : 'View feedback'}</button>}
            </div>
            {selectedId === session.id && <div className="mt-5 border-t border-[var(--border-default)] pt-4" aria-live="polite">
              {reportMessage && <p className="text-sm">{reportMessage}</p>}
              {report && <div className="space-y-4">
                {report.model_used === 'mock' && <p className="text-sm font-semibold">Practice feedback generated in mock mode.</p>}
                <p className="text-xl font-bold">{report.effective_score.toFixed(1)} / 100</p>
                <p className="text-sm text-[var(--text-secondary)]">{report.model_used === 'faculty' ? 'Faculty assessment, based on a review of your interview.' : report.low_confidence_flag ? 'Faculty review is required for this assessment.' : 'Automated assessment. Faculty may review and adjust this result.'}</p>
                <dl className="grid gap-3 sm:grid-cols-2">{Object.entries(report.dimensions).map(([key, value]) => <div key={key}><dt className="text-sm font-semibold capitalize">{key.replaceAll('_', ' ')}: {value.score} / 5</dt><dd className="text-sm text-[var(--text-secondary)]">{value.reason}</dd></div>)}</dl>
                <ul className="list-disc space-y-2 pl-5 text-sm">{report.feedback_lines.map((line, index) => <li key={index}>{line}</li>)}</ul>
              </div>}
            </div>}
          </li>;
        })}
      </ul>
    </div>
  );
}
