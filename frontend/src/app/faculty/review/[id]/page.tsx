'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/store';
import { dashboardApi, sessionsApi, scoresApi, resolveApiUrl } from '@/lib/api';
import { ScoreRadarChart } from '@/components/dashboard/ScoreRadarChart';
import { AudioTranscriptPlayer, TranscriptTurn, ProctoringEvent } from '@/components/dashboard/AudioTranscriptPlayer';
import { Badge } from '@/components/ui/Badge';
import { useToast } from '@/components/providers/ToastProvider';
import { ArrowLeft, FileText, Save, Scale, ShieldCheck, User, Clock, CheckCircle2, FileDown } from 'lucide-react';

interface ReviewDetail {
  session: {
    id: string;
    status: string;
    review_status: string;
    started_at: string | null;
    ended_at: string | null;
    total_score: number | null;
    override_score: number | null;
    override_reason: string | null;
    tab_switch_count: number;
    long_silence_count: number;
    proctoring_events: ProctoringEvent[];
    audio_url: string | null;
  };
  student: { name: string; student_id: string | null };
  viva_config: { title: string; subject: string; rubric_weights?: Record<string, number> };
  transcript: TranscriptTurn[];
  score_report: null | {
    total_score: number;
    dimensions: Record<string, { score: number | null; reason: string | null; turn_ids: string[] | null }>;
    feedback_lines: string[] | null;
    low_confidence_flag: boolean;
    low_confidence_reasons: string[] | null;
  };
}

const dimensionNames: Record<string, string> = {
  conceptual: 'Conceptual understanding',
  depth_reasoning: 'Depth and reasoning',
  problem_solving: 'Problem solving',
  practical_project: 'Practical application',
  communication: 'Communication',
};

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(date);
}

function normalizeTranscript(rows: unknown): TranscriptTurn[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((item, index) => {
    const row = item as Record<string, unknown>;
    const rawSpeaker = row.speaker;
    return {
      id: typeof row.id === 'string' ? row.id : `turn-${index + 1}`,
      turn_index: typeof row.turn_index === 'number' ? row.turn_index : index,
      speaker: rawSpeaker === 'student' || rawSpeaker === 'candidate' ? 'student' : 'interviewer',
      text: typeof row.text === 'string' ? row.text : '',
      timestamp_secs: typeof row.timestamp_secs === 'number' ? row.timestamp_secs : 0,
      phase: typeof row.phase === 'string' ? row.phase : undefined,
      answer_label: typeof row.answer_label === 'string' ? row.answer_label : null,
      stt_confidence: typeof row.stt_confidence === 'number' ? row.stt_confidence : null,
    };
  });
}

function normalizeDetail(data: Record<string, unknown>): ReviewDetail {
  const session = (data.session || {}) as Record<string, unknown>;
  const student = (data.student || {}) as Record<string, unknown>;
  const vivaConfig = (data.viva_config || {}) as Record<string, unknown>;
  const scoreReport = data.score_report as ReviewDetail['score_report'] | undefined;
  return {
    session: {
      id: typeof session.id === 'string' ? session.id : '',
      status: typeof session.status === 'string' ? session.status : 'unknown',
      review_status: typeof session.review_status === 'string' ? session.review_status : 'unknown',
      started_at: typeof session.started_at === 'string' ? session.started_at : null,
      ended_at: typeof session.ended_at === 'string' ? session.ended_at : null,
      total_score: typeof session.total_score === 'number' ? session.total_score : null,
      override_score: typeof session.override_score === 'number' ? session.override_score : null,
      override_reason: typeof session.override_reason === 'string' ? session.override_reason : null,
      tab_switch_count: typeof session.tab_switch_count === 'number' ? session.tab_switch_count : 0,
      long_silence_count: typeof session.long_silence_count === 'number' ? session.long_silence_count : 0,
      proctoring_events: Array.isArray(session.proctoring_events) ? (session.proctoring_events as ProctoringEvent[]) : [],
      audio_url: typeof session.audio_url === 'string'
        ? (session.audio_url.startsWith('http') ? session.audio_url : `${resolveApiUrl()}${session.audio_url}`)
        : null,
    },
    student: {
      name: typeof student.name === 'string' ? student.name : 'Unknown candidate',
      student_id: typeof student.student_id === 'string' ? student.student_id : null,
    },
    viva_config: {
      title: typeof vivaConfig.title === 'string' ? vivaConfig.title : 'Untitled viva',
      subject: typeof vivaConfig.subject === 'string' ? vivaConfig.subject : '',
      rubric_weights: (vivaConfig.rubric_weights || {}) as Record<string, number>,
    },
    transcript: normalizeTranscript(data.transcript),
    score_report: scoreReport || null,
  };
}

export default function CandidateDossierPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params?.id as string;
  const { isAuthenticated, user, hasHydrated } = useAuthStore();
  const { showToast } = useToast();
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [highlightedTurnId, setHighlightedTurnId] = useState<string | null>(null);
  const [overrideScore, setOverrideScore] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!hasHydrated) return;
    if (!isAuthenticated) router.replace('/login');
    else if (user?.role !== 'faculty') {
      // Cross-origin portal handoff; auth is intentionally not copied across apps.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`${process.env.NEXT_PUBLIC_STUDENT_URL || 'http://localhost:3000'}/login`);
    }
  }, [hasHydrated, isAuthenticated, user?.role, router]);

  const loadDetail = useCallback(async () => {
    if (!sessionId) return;
    try {
      const response = await dashboardApi.sessionDetail(sessionId);
      setError(null);
      const next = normalizeDetail(response.data as Record<string, unknown>);
      setDetail(next);
      setOverrideScore(String(next.session.override_score ?? next.session.total_score ?? ''));
      setOverrideReason(next.session.override_reason || '');
    } catch {
      setError('This session could not be loaded. It may no longer be available, or your connection may have failed.');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!hasHydrated || !isAuthenticated || user?.role !== 'faculty' || !sessionId) return;
    let active = true;
    dashboardApi.sessionDetail(sessionId).then((response) => {
      if (!active) return;
      const next = normalizeDetail(response.data as Record<string, unknown>);
      setError(null);
      setDetail(next);
      setOverrideScore(String(next.session.override_score ?? next.session.total_score ?? ''));
      setOverrideReason(next.session.override_reason || '');
      setLoading(false);
    }).catch(() => {
      if (!active) return;
      setError('This session could not be loaded. It may no longer be available, or your connection may have failed.');
      setLoading(false);
    });
    return () => { active = false; };
  }, [hasHydrated, isAuthenticated, user?.role, sessionId]);

  const dimensionScores = useMemo(() => {
    if (!detail?.score_report) return null;
    const dimensions = detail.score_report.dimensions;
    const keys = ['conceptual', 'depth_reasoning', 'problem_solving', 'practical_project', 'communication'];
    if (keys.some((key) => typeof dimensions[key]?.score !== 'number')) return null;
    const value = (key: string) => dimensions[key].score as number;
    return {
      conceptual: value('conceptual'),
      depth_reasoning: value('depth_reasoning'),
      problem_solving: value('problem_solving'),
      practical_project: value('practical_project'),
      communication: value('communication'),
    };
  }, [detail]);

  const handleApplyOverride = async (event: React.FormEvent) => {
    event.preventDefault();
    const score = Number(overrideScore);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      showToast('Enter a score between 0 and 100.', 'warning');
      return;
    }
    if (!overrideReason.trim()) {
      showToast('Add a reason before saving the score adjustment.', 'warning');
      return;
    }
    setIsSaving(true);
    try {
      await sessionsApi.override(sessionId, { override_score: score, reason: overrideReason.trim() });
      setDetail((current) => current ? {
        ...current,
        session: { ...current.session, override_score: score, override_reason: overrideReason.trim() },
      } : current);
      showToast('Score adjustment saved.', 'success');
    } catch {
      showToast('Score adjustment could not be saved. Retry when the service is available.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const handleExportPdf = async () => {
    setIsExportingPdf(true);
    showToast('Generating official accredited PDF examination report...', 'info');
    try {
      const res = await scoresApi.getPdf(sessionId);
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vivaai_accredited_report_${sessionId.slice(0, 8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      showToast('Accredited PDF grade report downloaded.', 'success');
    } catch (err: unknown) {
      console.error('PDF export failed:', err);
      showToast('Could not download PDF report. Evaluation may still be calculating.', 'error');
    } finally {
      setIsExportingPdf(false);
    }
  };

  const focusTurn = (turnId: string) => {
    setHighlightedTurnId(turnId);
    (document.getElementById(turnId) || document.getElementById(turnId.startsWith('turn-') ? turnId : `turn-${turnId}`))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  if (!hasHydrated || !isAuthenticated || user?.role !== 'faculty') {
    return <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-[var(--bg-page)] px-4 text-sm text-[var(--text-secondary)]">Checking your faculty account…</div>;
  }

  if (loading) return <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-[var(--bg-page)] px-4 text-sm text-[var(--text-secondary)]" role="status">Loading session review…</div>;
  if (error || !detail) return <main className="mx-auto max-w-3xl px-4 py-10"><Link href="/dashboard" className="inline-flex min-h-11 items-center gap-2 text-sm text-[var(--text-secondary)]"><ArrowLeft className="h-4 w-4" />Return to registry</Link><section className="mt-6 rounded border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] p-6 text-center"><p role="alert" className="text-sm text-[var(--status-danger)]">{error || 'Session details are unavailable.'}</p><button type="button" onClick={() => { setLoading(true); setError(null); void loadDetail(); }} className="btn-outline mt-4 text-xs">Retry</button></section></main>;

  const effectiveScore = detail.session.override_score ?? detail.session.total_score;
  const sessionEvents = detail.session.tab_switch_count + detail.session.long_silence_count;
  const rubricEntries = Object.entries(detail.score_report?.dimensions || {}).filter(([, item]) => Boolean(item.reason || item.turn_ids?.length));

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[var(--bg-page)] px-4 py-8 text-[var(--text-primary)] transition-colors sm:px-6 sm:py-10 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-default)] pb-4">
          <Link href="/dashboard" className="inline-flex min-h-11 items-center gap-1.5 text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"><ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />Return to assessment registry</Link>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleExportPdf}
              disabled={isExportingPdf}
              className="btn-secondary text-xs px-3.5 py-1.5 min-h-[38px] flex items-center gap-2 border-[var(--border-default)] hover:border-[var(--primary)] font-semibold shadow-xs"
              title="Download official accredited PDF grade dossier"
            >
              <FileDown className="w-4 h-4 text-emerald-600 dark:text-teal-400" />
              <span>{isExportingPdf ? 'Exporting PDF...' : 'Export Accredited PDF'}</span>
            </button>
            <Badge variant={detail.session.status === 'flagged' ? 'warning' : 'neutral'}>{detail.session.status.replaceAll('_', ' ')}</Badge>
            <Badge variant="neutral">Review: {detail.session.review_status.replaceAll('_', ' ')}</Badge>
          </div>
        </div>

        {/* ── Candidate Assessment Dossier Hero ── */}
        <section className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] p-5 sm:p-6 shadow-sm">
          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
            {/* Candidate Identity & Exam Info */}
            <div className="flex items-start gap-4">
              <div className="relative">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--accent-subtle)] text-[var(--primary)] font-bold">
                  <User aria-hidden="true" className="h-6 w-6" />
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-emerald-500 rounded-full border-2 border-[var(--bg-card)] flex items-center justify-center">
                  <ShieldCheck className="w-2.5 h-2.5 text-white" />
                </div>
              </div>
              <div className="min-w-0 space-y-1.5">
                <div className="flex items-center gap-2">
                  <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--text-primary)]">
                    {detail.student.name}
                  </h1>
                  <Badge variant="success" className="text-[10px] py-0 px-1.5">Verified</Badge>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-mono text-[11px] font-semibold text-[var(--text-secondary)] bg-[var(--bg-muted)] px-2 py-0.5 rounded border border-[var(--border-subtle)]">
                    Roll ID: {detail.student.student_id || '—'}
                  </span>
                  <span className="font-mono text-[11px] font-semibold text-[var(--primary)] uppercase bg-[var(--accent-subtle)] px-2 py-0.5 rounded border border-[var(--primary)]/20">
                    {detail.viva_config.subject}
                  </span>
                  <span className="font-semibold text-[var(--text-primary)]">
                    {detail.viva_config.title}
                  </span>
                </div>
              </div>
            </div>

            {/* Score & Completion Metatiles */}
            <div className="grid grid-cols-2 gap-4 border-t border-[var(--border-subtle)] pt-4 sm:flex sm:items-center sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
              <div className="bg-[var(--bg-muted)] p-3 rounded-lg border border-[var(--border-subtle)] min-w-[120px]">
                <span className="block font-mono text-[10px] uppercase font-bold text-[var(--text-muted)]">Effective Score</span>
                <div className="flex items-baseline gap-1 mt-0.5">
                  <strong className="text-2xl font-bold text-emerald-600 dark:text-teal-400">{effectiveScore ?? '—'}</strong>
                  <span className="text-xs text-[var(--text-muted)] font-mono">/ 100</span>
                </div>
                {detail.session.override_score !== null && (
                  <span className="inline-block text-[10px] text-emerald-700 dark:text-teal-300 font-semibold mt-0.5">
                    Faculty adjusted
                  </span>
                )}
              </div>

              <div className="bg-[var(--bg-muted)] p-3 rounded-lg border border-[var(--border-subtle)] min-w-[140px]">
                <span className="block font-mono text-[10px] uppercase font-bold text-[var(--text-muted)]">Completed At</span>
                <strong className="text-xs font-semibold block mt-1 text-[var(--text-primary)]">
                  {formatDate(detail.session.ended_at || detail.session.started_at)}
                </strong>
                <span className="text-[10px] text-[var(--text-muted)] font-mono">UTC Session Archive</span>
              </div>
            </div>
          </div>

          {/* Academic Integrity & Activity Strip */}
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-[var(--border-subtle)] pt-3 text-xs text-[var(--text-secondary)]">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[var(--bg-muted)] border border-[var(--border-subtle)] font-mono text-[11px]">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
              <span>{detail.session.tab_switch_count} Tab Switches</span>
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[var(--bg-muted)] border border-[var(--border-subtle)] font-mono text-[11px]">
              <Clock className="w-3.5 h-3.5 text-[var(--primary)]" />
              <span>{detail.session.long_silence_count} Prolonged Silences</span>
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-teal-300 font-medium text-[11px]">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              <span>{sessionEvents === 0 ? 'Full Academic Integrity (Zero Anomaly Flags)' : `${sessionEvents} Integrity Events Logged`}</span>
            </span>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
          <section className="space-y-4 lg:col-span-7" aria-labelledby="transcript-heading">
            <div className="flex items-center justify-between gap-3">
              <h2 id="transcript-heading" className="flex items-center gap-2 text-base font-bold text-[var(--text-primary)]">
                <FileText aria-hidden="true" className="h-4 w-4 text-[var(--primary)]" />
                <span>Transcript & Audio Playback</span>
              </h2>
              <Badge variant="neutral">{detail.transcript.length} turns recorded</Badge>
            </div>
            <AudioTranscriptPlayer
              turns={detail.transcript}
              audioUrl={detail.session.audio_url}
              highlightedTurnId={highlightedTurnId}
              proctoringEvents={detail.session.proctoring_events}
              onTurnClick={(turn) => setHighlightedTurnId(turn.id)}
            />
          </section>

          <aside className="space-y-6 lg:col-span-5">
            <section className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] space-y-4 p-5 shadow-sm" aria-labelledby="rubric-heading">
              <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
                <div>
                  <h2 id="rubric-heading" className="text-base font-bold text-[var(--text-primary)]">Rubric Evaluation</h2>
                  <p className="mt-0.5 text-xs text-[var(--text-secondary)]">Multi-dimensional rubric scoring across core competencies.</p>
                </div>
                <Scale aria-hidden="true" className="h-5 w-5 shrink-0 text-[var(--primary)]" />
              </div>
              {dimensionScores ? (
                <ScoreRadarChart
                  scores={dimensionScores}
                  weights={detail.viva_config.rubric_weights as { conceptual: number; depth_reasoning: number; problem_solving: number; practical_project: number; communication: number } | undefined}
                />
              ) : (
                <p className="rounded border border-dashed border-[var(--border-default)] p-5 text-sm text-[var(--text-secondary)]">No rubric report is available yet.</p>
              )}
              {detail.score_report?.low_confidence_flag && (
                <p className="rounded border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] p-3 text-xs text-[var(--status-warning)]">
                  This score report is marked low confidence. Review the reasons and evidence before relying on the score.
                </p>
              )}
            </section>

            <section className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] space-y-3 p-5 shadow-sm" aria-labelledby="evidence-heading">
              <div className="border-b border-[var(--border-subtle)] pb-3">
                <h2 id="evidence-heading" className="text-base font-bold text-[var(--text-primary)]">Scoring Citations & Evidence</h2>
                <p className="mt-0.5 text-xs text-[var(--text-secondary)]">Select a cited turn to locate it in the verbatim transcript.</p>
              </div>
              {rubricEntries.length === 0 ? (
                <p className="text-xs text-[var(--text-secondary)]">No evidence notes or transcript citations are available.</p>
              ) : (
                rubricEntries.map(([key, item]) => {
                  const numericScore = typeof item.score === 'number' ? item.score : null;
                  const percent = numericScore !== null ? (numericScore > 5 ? numericScore : numericScore * 20) : null;

                  return (
                    <article key={key} className="space-y-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-muted)]/60 p-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-xs font-bold text-[var(--text-primary)]">{dimensionNames[key] || key.replaceAll('_', ' ')}</h3>
                        {numericScore !== null && (
                          <span className="font-mono text-xs font-bold text-emerald-600 dark:text-teal-400">
                            {numericScore > 5 ? `${numericScore}/100` : `${numericScore}/5`}
                          </span>
                        )}
                      </div>

                      {/* Score Bar */}
                      {percent !== null && (
                        <div className="h-1.5 w-full bg-[var(--bg-card)] rounded-full overflow-hidden border border-[var(--border-subtle)]">
                          <div
                            className="h-full bg-emerald-500 rounded-full"
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      )}

                      {item.reason && <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">{item.reason}</p>}
                      {item.turn_ids?.length ? (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {item.turn_ids.map((turnId) => {
                            const citedTurn = detail.transcript.find((turn) => turn.id === turnId || `turn-${turn.id}` === turnId);
                            return (
                              <button
                                key={turnId}
                                type="button"
                                onClick={() => focusTurn(turnId)}
                                className="min-h-[32px] rounded border border-[var(--border-default)] bg-[var(--bg-card)] hover:border-[var(--primary)] px-2.5 py-1 text-[11px] font-semibold text-[var(--primary)] flex items-center gap-1 transition-colors"
                              >
                                <span>{citedTurn ? `Turn #${citedTurn.turn_index + 1}` : 'Citation'}</span>
                                <ArrowLeft className="w-3 h-3 rotate-180" />
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </article>
                  );
                })
              )}
            </section>

            {detail.score_report?.feedback_lines?.length ? <section className="academic-dossier space-y-3 p-5"><h2 className="font-editorial text-base font-bold">Feedback</h2><ul className="list-disc space-y-2 pl-5 text-xs text-[var(--text-secondary)]">{detail.score_report.feedback_lines.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ul></section> : null}

            <section className="academic-dossier space-y-4 p-5" aria-labelledby="override-heading">
              <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] pb-3"><ShieldCheck aria-hidden="true" className="h-5 w-5 text-[var(--primary)]" /><div><h2 id="override-heading" className="font-editorial text-base font-bold">Adjust score</h2><p className="mt-0.5 text-xs text-[var(--text-secondary)]">Add a reason to record a faculty adjustment.</p></div></div>
              <form onSubmit={handleApplyOverride} className="space-y-4 text-xs">
                <div><label htmlFor="override-score" className="mb-1 block font-semibold text-[var(--text-secondary)]">Score (0–100)</label><input id="override-score" name="overrideScore" type="number" min={0} max={100} step="0.1" required value={overrideScore} onChange={(event) => setOverrideScore(event.target.value)} className="form-input w-36 font-mono text-base" /></div>
                <div><label htmlFor="override-reason" className="mb-1 block font-semibold text-[var(--text-secondary)]">Reason for adjustment</label><textarea id="override-reason" name="overrideReason" rows={3} required placeholder="Explain why this score should change." value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} className="form-textarea text-xs" /></div>
                <button type="submit" disabled={isSaving} className="btn-primary min-h-11 w-full gap-2 text-xs"><Save aria-hidden="true" className="h-3.5 w-3.5" />{isSaving ? 'Saving…' : 'Save adjustment'}</button>
              </form>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
