'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { sessionsApi, scoresApi, transcriptApi, getDownloadErrorMessage } from '@/lib/api';
import { FeedbackEvidence, FeedbackItem, EvidenceCitation } from '@/components/dashboard/FeedbackEvidence';
import { AudioTranscriptPlayer, TranscriptTurn } from '@/components/dashboard/AudioTranscriptPlayer';
import { downloadBlob } from '@/lib/utils';
import { useAuthStore } from '@/store';

interface CandidateSession {
  id: string;
  status: string;
  elapsed_secs: number;
  total_score: number | null;
  started_at: string | null;
  review_status: string;
  viva_title?: string;
  subject?: string;
}
interface ScoreReport {
  effective_score: number;
  feedback_lines: string[];
  feedback_evidence?: FeedbackItem[];
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
  const [search, setSearch] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [report, setReport] = useState<ScoreReport | null>(null);
  const [reportMessage, setReportMessage] = useState('');
  const [evidenceTurns, setEvidenceTurns] = useState<TranscriptTurn[]>([]);
  const [evidenceCitation, setEvidenceCitation] = useState<EvidenceCitation | null>(null);
  const [evidenceError, setEvidenceError] = useState('');
  const evidencePanelRef = useRef<HTMLElement>(null);

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

  useEffect(() => {
    if (!selectedId || !evidenceCitation) return;
    let active = true;
    transcriptApi.get(selectedId).then(response => {
      if (active) { setEvidenceTurns(response.data); setEvidenceError(''); }
    }).catch(() => { if (active) setEvidenceError('Could not load the transcript. Select the evidence link to retry.'); });
    return () => { active = false; };
  }, [selectedId, evidenceCitation]);

  useEffect(() => {
    if (!evidenceCitation) return;
    evidencePanelRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }, [evidenceCitation]);

  async function downloadReport(id: string) {
    setDownloading(true); setDownloadError('');
    try { downloadBlob((await scoresApi.getPdf(id)).data, `vivaai-report-${id.slice(0,8)}.pdf`); }
    catch (cause) { setDownloadError(await getDownloadErrorMessage(cause, 'Could not download the report. Please retry.')); }
    finally { setDownloading(false); }
  }
  const visibleSessions = sessions.filter(session => `${session.viva_title || ''} ${session.subject || ''} ${session.status.replaceAll('_',' ')}`.toLowerCase().includes(search.trim().toLowerCase()));

  if (!hasHydrated || !isAuthenticated) return <p className="p-8" role="status">Verifying your account…</p>;
  if (user?.role !== 'student') return <p className="p-8">Interview history is available to candidates through the student portal.</p>;

  return (
    <div className="mx-auto max-w-5xl space-y-7 px-5 py-12 sm:px-8 text-[var(--text-primary)]">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div><p className="eyebrow mb-3">Your progress</p><h1 className="text-3xl font-semibold sm:text-4xl">Results & feedback</h1><p className="mt-2 text-sm text-[var(--text-secondary)]">Resume an interrupted interview or review your feedback.</p></div>
        <Link href="/interview" className="btn-primary">Start an interview</Link>
      </div>
      {loading && <p role="status">Loading your interviews…</p>}
      {error && <div role="alert"><p>{error}</p><button className="btn-secondary mt-2" onClick={() => setAttempt((value) => value + 1)}>Retry</button></div>}
      {!loading && !error && sessions.length === 0 && <p>You haven’t started an interview yet. Your sessions and feedback will appear here.</p>}
      {!loading && sessions.length > 0 && <div><label htmlFor="history-search" className="sr-only">Search interview history</label><input id="history-search" type="search" className="form-input" placeholder="Search by viva, subject, or status…" value={search} onChange={event => setSearch(event.target.value)} /></div>}
      {downloadError && <p role="alert" className="rounded-xl bg-[var(--status-danger-bg)] p-4 text-sm text-[var(--status-danger)]">{downloadError}</p>}
      {!loading && sessions.length > 0 && visibleSessions.length === 0 && <p className="text-sm text-[var(--text-secondary)]">No interviews match your search.</p>}
      <ul className="space-y-3">
        {visibleSessions.map((session) => {
          const resumable = ['scheduled', 'in_progress'].includes(session.status);
          return <li key={session.id} className="academic-dossier p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">{session.viva_title || 'Technical viva'}</h2>
                <p className="mt-1 text-xs text-[var(--text-muted)]">{session.started_at ? new Date(session.started_at).toLocaleString() : 'Ready to start'}</p>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">{session.status.replaceAll('_', ' ')} · {Math.floor(session.elapsed_secs / 60)}m {session.elapsed_secs % 60}s elapsed</p>

              </div>
              {resumable
                ? <Link className="btn-primary" href={`/interview/${session.id}`}>{session.status === 'in_progress' ? 'Resume interview' : 'Enter interview'}</Link>
                : <button className="btn-secondary" onClick={() => { setReport(null); setEvidenceCitation(null); setEvidenceTurns([]); setEvidenceError(''); setReportMessage('Loading feedback…'); setSelectedId((current) => current === session.id ? null : session.id); }}>{selectedId === session.id ? 'Hide feedback' : 'View feedback'}</button>}
            </div>
            {selectedId === session.id && <div className="mt-5 border-t border-[var(--border-default)] pt-4" aria-live="polite">
              {reportMessage && <p className="text-sm">{reportMessage}</p>}
              {report && <div className="space-y-4"><div className="flex flex-wrap justify-end"><button className="btn-secondary text-xs" disabled={downloading} onClick={() => void downloadReport(session.id)}>{downloading ? 'Downloading…' : 'Download assessment report'}</button></div>
                {report.model_used === 'mock' && <p className="text-sm font-semibold">Practice feedback generated in mock mode.</p>}
                <p className="text-xl font-bold">{report.effective_score.toFixed(1)} / 100</p>
                <p className="text-sm text-[var(--text-secondary)]">{report.model_used === 'faculty' ? 'Faculty assessment, based on a review of your interview.' : report.low_confidence_flag ? 'Faculty review is required for this assessment.' : 'Automated assessment. Faculty may review and adjust this result.'}</p>
                <dl className="grid gap-3 sm:grid-cols-2">{Object.entries(report.dimensions).map(([key, value]) => <div key={key}><dt className="text-sm font-semibold capitalize">{key.replaceAll('_', ' ')}: {value.score} / 5</dt><dd className="text-sm text-[var(--text-secondary)]">{value.reason}</dd></div>)}</dl>
                <FeedbackEvidence items={report.feedback_evidence || report.feedback_lines.map(text => ({ text, citations: [], evidence_status: 'not_recorded' as const }))} onSelect={citation => setEvidenceCitation({ ...citation })} />
                {evidenceCitation && <section ref={evidencePanelRef} className="scroll-mt-24 space-y-4 border-t border-[var(--border-default)] pt-4" aria-label="Feedback transcript evidence"><div className="flex items-center justify-between gap-3"><h3 className="text-base font-semibold">Transcript evidence</h3><button className="btn-ghost !text-xs" onClick={() => setEvidenceCitation(null)}>Close evidence</button></div><blockquote className="border-l-2 border-[var(--primary)] pl-4 text-sm leading-relaxed">{evidenceCitation.text}</blockquote>{evidenceError ? <p role="alert" className="text-sm text-[var(--status-danger)]">{evidenceError}</p> : evidenceTurns.length ? <AudioTranscriptPlayer turns={evidenceTurns} audioUrl={sessionsApi.getStreamAudioUrl(selectedId!)} highlightedTurnId={evidenceCitation.turn_id} /> : <p role="status" className="text-sm">Loading transcript…</p>}</section>}
              </div>}
            </div>}
          </li>;
        })}
      </ul>
    </div>
  );
}
