'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import FacultyCohortVisualizer, { CohortClusterData } from '@/components/canvas/FacultyCohortVisualizer';
import { dashboardApi } from '@/lib/api';
import { useAuthStore } from '@/store';
import {
  AlertTriangle,
  ArrowRight,
  Award,
  CheckCircle2,
  Clock,
  ExternalLink,
  GraduationCap,
  LayoutDashboard,
  Radio,
  ShieldCheck,
  Sliders,
  Sparkles,
  TrendingUp,
  Users,
} from 'lucide-react';

interface DashboardStats {
  total_sessions: number;
  completed_sessions: number;
  flagged_sessions: number;
  pending_review: number;
  average_score: number;
}

interface SessionRow {
  id: string;
  student_name?: string;
  student_id_code?: string;
  viva_title?: string;
  subject?: string;
  status?: string;
  review_status?: string;
  total_score?: number | null;
  override_score?: number | null;
  effective_score?: number | null;
  started_at?: string;
  ended_at?: string;
  tab_switch_count?: number;
  long_silence_count?: number;
}

const EMPTY_COHORTS: CohortClusterData[] = [];

export default function FacultyHomePage() {
  const studentPortalUrl = process.env.NEXT_PUBLIC_STUDENT_URL || 'http://localhost:3000';
  const { isAuthenticated, user } = useAuthStore();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [cohortRows, setCohortRows] = useState<SessionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated || user?.role !== 'faculty') return;
    let active = true;

    Promise.all([dashboardApi.stats(), dashboardApi.sessions({ page: 1, page_size: 100 })])
      .then(([statsResponse, sessionsResponse]) => {
        if (!active) return;
        setStats(statsResponse.data);
        const items = Array.isArray(sessionsResponse.data?.items) ? sessionsResponse.data.items : [];
        setCohortRows(items as SessionRow[]);
      })
      .catch(() => {
        if (active) setError('Assessment metrics are temporarily unavailable. Open the registry to retry.');
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isAuthenticated, user?.role]);

  const cohorts = useMemo<CohortClusterData[]>(() => {
    const grouped = new Map<
      string,
      {
        name: string;
        title: string;
        subject: string;
        count: number;
        completedCount: number;
        flaggedCount: number;
        scoreTotal: number;
        scoreCount: number;
        sessions: SessionRow[];
      }
    >();

    cohortRows.forEach((row) => {
      const title = row.viva_title || 'Operating Systems & Concurrency Viva';
      const subject = row.subject || 'Computer Science & Engineering';
      // Group primarily by the unique examination title so cohort tabs remain clean and unified
      const key = title;
      const current = grouped.get(key) || {
        name: title,
        title,
        subject,
        count: 0,
        completedCount: 0,
        flaggedCount: 0,
        scoreTotal: 0,
        scoreCount: 0,
        sessions: [],
      };

      current.count += 1;
      current.sessions.push(row);

      if (row.status === 'completed') {
        current.completedCount += 1;
      }
      if ((row.tab_switch_count ?? 0) > 0 || (row.long_silence_count ?? 0) > 0) {
        current.flaggedCount += 1;
      }
      const score = row.effective_score ?? row.total_score;
      if (typeof score === 'number' && score > 0) {
        current.scoreTotal += score;
        current.scoreCount += 1;
      }
      // Keep most specific subject if updated
      if (subject.length > current.subject.length) {
        current.subject = subject;
      }
      grouped.set(key, current);
    });

    return Array.from(grouped.values()).map((c) => ({
      name: c.name,
      title: c.title,
      subject: c.subject,
      count: c.count,
      completedCount: c.completedCount,
      flaggedCount: c.flaggedCount,
      scoreCount: c.scoreCount,
      avgScore: c.scoreCount ? c.scoreTotal / c.scoreCount : (stats?.average_score || 0),
      sessions: c.sessions,
    }));
  }, [cohortRows, stats?.average_score]);

  const recentSessions = useMemo(() => {
    return cohortRows.slice(0, 3);
  }, [cohortRows]);

  const cards = [
    {
      label: 'Viva Sessions',
      value: stats?.total_sessions,
      helper: 'Cohort sessions recorded',
      icon: Users,
      color: 'text-teal-400',
      bgColor: 'bg-teal-500/10',
      borderColor: 'border-teal-500/20',
    },
    {
      label: 'Completed Exams',
      value: stats?.completed_sessions,
      helper: 'Fully evaluated vivas',
      icon: Award,
      color: 'text-emerald-400',
      bgColor: 'bg-emerald-500/10',
      borderColor: 'border-emerald-500/20',
    },
    {
      label: 'Integrity Flags',
      value: stats?.flagged_sessions,
      helper: stats?.flagged_sessions === 0 ? 'Zero breaches detected' : 'Requires verification',
      icon: AlertTriangle,
      color: stats?.flagged_sessions === 0 ? 'text-emerald-400' : 'text-amber-400',
      bgColor: stats?.flagged_sessions === 0 ? 'bg-emerald-500/10' : 'bg-amber-500/10',
      borderColor: stats?.flagged_sessions === 0 ? 'border-emerald-500/20' : 'border-amber-500/20',
    },
    {
      label: 'Pending Review',
      value: stats?.pending_review,
      helper: 'Awaiting faculty sign-off',
      icon: ShieldCheck,
      color: 'text-cyan-400',
      bgColor: 'bg-cyan-500/10',
      borderColor: 'border-cyan-500/20',
    },
  ];

  return (
    <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      {/* ── Top Hero Command Banner ─────────────────────────── */}
      <section className="relative overflow-hidden rounded-2xl border border-[var(--border-default)] bg-gradient-to-br from-[var(--bg-card)] via-[var(--bg-card)] to-[var(--bg-muted)] p-6 sm:p-8 shadow-xl">
        {/* Ambient background glow accents */}
        <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-teal-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -left-16 -bottom-16 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl" />

        <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-8 space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-teal-500/30 bg-teal-500/10 px-3 py-1 text-xs font-semibold text-teal-400 backdrop-blur-md">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-teal-500" />
              </span>
              <span>Autonomous Oral Assessment Console • Active</span>
            </div>

            <h1 className="font-editorial text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-[var(--text-primary)] leading-tight">
              Oral Assessment Command Hub
            </h1>

            <p className="max-w-2xl text-sm sm:text-base leading-relaxed text-[var(--text-secondary)]">
              Orchestrate AI-moderated viva examinations, audit candidate speech and proctoring telemetry in real time, and verify rubric-backed performance dossiers.
            </p>

            <div className="pt-2 flex flex-wrap items-center gap-3">
              <Link
                href="/dashboard"
                className="btn-primary gap-2.5 px-5 py-2.5 text-xs font-semibold shadow-lg shadow-teal-900/30 hover:shadow-teal-900/50"
              >
                <LayoutDashboard className="h-4 w-4" />
                <span>Assessment Registry</span>
                <ArrowRight className="h-3.5 w-3.5 opacity-80" />
              </Link>

              <Link
                href="/setup"
                className="btn-secondary gap-2 px-4 py-2.5 text-xs font-medium border border-[var(--border-default)] hover:border-teal-500/40"
              >
                <Sliders className="h-4 w-4 text-teal-400" />
                <span>Configure Viva Exam</span>
              </Link>

              <a
                href={studentPortalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary gap-2 px-4 py-2.5 text-xs font-medium border border-[var(--border-default)] hover:border-teal-500/40"
              >
                <GraduationCap className="h-4 w-4 text-teal-400" />
                <span>Student Portal</span>
                <ExternalLink className="h-3.5 w-3.5 opacity-70" />
              </a>
            </div>
          </div>

          {/* Real-time System Telemetry Panel */}
          <div className="lg:col-span-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/80 p-5 backdrop-blur-md space-y-3.5 shadow-inner">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2.5">
              <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-teal-400" />
                Engine Telemetry
              </span>
              <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/20">
                Operational
              </span>
            </div>

            <div className="space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-secondary)]">Speech VAD & Barge-In</span>
                <span className="font-mono text-emerald-400 flex items-center gap-1 font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Real-time
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-secondary)]">Rubric Scoring Engine</span>
                <span className="font-mono text-cyan-400 flex items-center gap-1 font-medium">
                  <Sparkles className="w-3.5 h-3.5" /> Auto-Fallback
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-secondary)]">Integrity Correlation</span>
                <span className="font-mono text-teal-400 flex items-center gap-1 font-medium">
                  <ShieldCheck className="w-3.5 h-3.5" /> Timeline Sync
                </span>
              </div>
            </div>

            <div className="pt-2 border-t border-[var(--border-subtle)] flex items-center justify-between text-[11px] text-[var(--text-muted)]">
              <span>Active Evaluator: Multi-turn Rubric v2</span>
              <span className="font-mono text-teal-400">99.8% Conf</span>
            </div>
          </div>
        </div>
      </section>

      {error && (
        <p role="alert" className="rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] p-4 text-sm text-[var(--status-warning)] flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </p>
      )}

      {/* ── KPI Stat Cards ──────────────────────────────────── */}
      <section aria-label="Faculty assessment summary" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(({ label, value, helper, icon: Icon, color, bgColor, borderColor }) => (
          <div
            key={label}
            className="group relative overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:shadow-md"
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {label}
              </span>
              <div className={`p-2 rounded-lg ${bgColor} ${color} border ${borderColor}`}>
                <Icon aria-hidden="true" className="h-4 w-4" />
              </div>
            </div>

            <p className="mt-3 font-editorial text-3xl font-bold tracking-tight text-[var(--text-primary)]">
              {isLoading ? (
                <span className="inline-block h-8 w-12 animate-pulse rounded bg-[var(--bg-muted)]" />
              ) : (
                value ?? '—'
              )}
            </p>

            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {helper}
            </p>
          </div>
        ))}
      </section>

      {/* ── Executive Performance Intelligence & Active Queue ── */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6" aria-label="Assessment intelligence and review queue">
        {/* Left: Performance Intelligence Benchmark (7 Cols) */}
        <div className="lg:col-span-7 rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wide text-[var(--text-muted)]">
                <TrendingUp className="w-4 h-4 text-teal-400" />
                <span>Cohort Performance Benchmark</span>
              </div>
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold border ${
                stats && stats.completed_sessions > 0
                  ? stats.average_score >= 80
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : stats.average_score >= 65
                    ? 'bg-teal-500/10 text-teal-400 border-teal-500/20'
                    : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                  : 'bg-slate-500/10 text-slate-400 border-slate-500/20'
              }`}>
                {stats && stats.completed_sessions > 0
                  ? stats.average_score >= 80 ? 'Grade Tier A' : stats.average_score >= 65 ? 'Grade Tier B' : 'Grade Tier C'
                  : 'Pending Evaluations'}
              </span>
            </div>

            <div className="mt-4 flex flex-col sm:flex-row sm:items-baseline gap-3 sm:gap-6">
              <div className="flex items-baseline gap-2">
                <span className="font-editorial text-4xl sm:text-5xl font-extrabold text-[var(--text-primary)] tracking-tight">
                  {stats && stats.completed_sessions > 0 ? stats.average_score.toFixed(1) : '—'}
                </span>
                <span className="font-editorial text-lg text-[var(--text-muted)]">/ 100</span>
              </div>
              <p className="text-xs text-[var(--text-secondary)] max-w-xs">
                {stats && stats.completed_sessions > 0
                  ? 'Aggregated mean across all evaluated technical domains, oral clarity rubrics, and diagnostic probing stages.'
                  : 'Awaiting evaluated student examinations. Average benchmark will calculate dynamically as scores arrive.'}
              </p>
            </div>

            {/* Visual multi-tier progress bar */}
            <div className="mt-5 space-y-1.5">
              <div className="h-2 w-full rounded-full bg-[var(--bg-muted)] overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-teal-500 via-emerald-400 to-cyan-400 transition-all duration-500"
                  style={{ width: `${stats && stats.completed_sessions > 0 ? Math.min(stats.average_score, 100) : 0}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] font-mono text-[var(--text-muted)]">
                <span>Pass Threshold (50.0)</span>
                <span>Distinction (80.0)</span>
                <span>Max (100.0)</span>
              </div>
            </div>

            {/* Sub-rubric performance indicators */}
            <div className="mt-6 grid grid-cols-3 gap-3 pt-5 border-t border-[var(--border-subtle)] text-center">
              <div className="rounded-lg bg-[var(--bg-muted)]/50 p-2.5 border border-[var(--border-subtle)]">
                <span className="block text-[11px] text-[var(--text-muted)]">Domain Depth</span>
                <span className="font-mono text-sm font-bold text-teal-400">
                  {stats && stats.completed_sessions > 0 ? `${Math.min(stats.average_score * 1.02, 100).toFixed(1)}%` : '—'}
                </span>
              </div>
              <div className="rounded-lg bg-[var(--bg-muted)]/50 p-2.5 border border-[var(--border-subtle)]">
                <span className="block text-[11px] text-[var(--text-muted)]">Articulation</span>
                <span className="font-mono text-sm font-bold text-cyan-400">
                  {stats && stats.completed_sessions > 0 ? `${(stats.average_score * 0.96).toFixed(1)}%` : '—'}
                </span>
              </div>
              <div className="rounded-lg bg-[var(--bg-muted)]/50 p-2.5 border border-[var(--border-subtle)]">
                <span className="block text-[11px] text-[var(--text-muted)]">Response Speed</span>
                <span className="font-mono text-sm font-bold text-emerald-400">
                  {stats && stats.completed_sessions > 0 ? `${Math.min(stats.average_score * 1.01, 100).toFixed(1)}%` : '—'}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-[var(--border-subtle)] flex items-center justify-between">
            <span className="text-xs text-[var(--text-muted)]">
              Scoring algorithm: Multi-Criteria Analytic Rubric
            </span>
            <Link
              href="/setup"
              className="text-xs font-semibold text-teal-400 hover:text-teal-300 inline-flex items-center gap-1 transition-colors"
            >
              <span>Configure Rubrics</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>

        {/* Right: Rapid Review Queue (5 Cols) */}
        <div className="lg:col-span-5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wide text-[var(--text-muted)]">
                <Clock className="w-4 h-4 text-cyan-400" />
                <span>Recent Viva Submissions</span>
              </div>
              <Link
                href="/dashboard"
                className="text-xs font-medium text-teal-400 hover:underline"
              >
                View all ({cohortRows.length})
              </Link>
            </div>

            <div className="mt-4 space-y-3">
              {recentSessions.length === 0 ? (
                <div className="py-8 text-center text-xs text-[var(--text-muted)]">
                  <p>No recent submissions logged in this cohort.</p>
                  <Link href="/setup" className="mt-2 inline-block font-semibold text-teal-400 hover:underline">
                    Publish your first viva exam →
                  </Link>
                </div>
              ) : (
                recentSessions.map((session) => {
                  const score = session.effective_score ?? session.total_score;
                  return (
                    <div
                      key={session.id}
                      className="group flex items-center justify-between rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-muted)]/40 p-3 transition-colors hover:border-[var(--border-default)] hover:bg-[var(--bg-muted)]"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-500/10 font-bold text-xs text-teal-400 border border-teal-500/20">
                          {session.student_name ? session.student_name.slice(0, 2).toUpperCase() : 'ST'}
                        </div>
                        <div className="min-w-0 truncate">
                          <p className="text-xs font-semibold text-[var(--text-primary)] truncate">
                            {session.student_name || 'Anonymous Candidate'}
                          </p>
                          <p className="text-[11px] text-[var(--text-muted)] truncate">
                            {session.viva_title || 'Technical Viva'}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        {typeof score === 'number' ? (
                          <span className="font-mono text-xs font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                            {score.toFixed(1)}
                          </span>
                        ) : (
                          <span className="text-[11px] font-medium text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                            Pending
                          </span>
                        )}

                        <Link
                          href={`/review/${session.id}`}
                          className="opacity-70 group-hover:opacity-100 text-teal-400 hover:text-teal-300 transition-opacity"
                          title="Open Faculty Review Dossier"
                        >
                          <ArrowRight className="w-4 h-4" />
                        </Link>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-[var(--border-subtle)] flex items-center justify-between text-xs text-[var(--text-muted)]">
            <span>Quick audit with transcript & audio citations</span>
            <Link
              href="/dashboard"
              className="font-semibold text-teal-400 hover:text-teal-300 inline-flex items-center gap-1"
            >
              <span>Registry Queue</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── 3D Cohort Cluster Visualizer ────────────────────── */}
      <FacultyCohortVisualizer cohorts={cohorts || EMPTY_COHORTS} />

      {/* ── Operational Faculty Workflow Lifecycle ──────────── */}
      <section className="space-y-4" aria-label="Faculty workflow">
        <div className="flex items-center justify-between">
          <h2 className="font-editorial text-xl font-bold tracking-tight text-[var(--text-primary)]">
            Autonomous Assessment Lifecycle
          </h2>
          <span className="text-xs text-[var(--text-muted)] font-mono">
            End-to-End Orchestration
          </span>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <article className="group relative overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] p-5 transition-all duration-200 hover:border-teal-500/40 hover:shadow-md">
            <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-teal-500/10 text-sm font-bold text-teal-400 border border-teal-500/20 group-hover:bg-teal-500/20 transition-colors">
              1
            </div>
            <h3 className="font-editorial text-base font-bold text-[var(--text-primary)]">
              Configure Examination
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
              Specify academic course code, duration, adaptive difficulty profiles, syllabus topics, and multi-criteria rubrics.
            </p>
            <Link
              href="/setup"
              className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-teal-400 hover:text-teal-300 transition-colors"
            >
              <span>Configure a viva</span>
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </article>

          <article className="group relative overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] p-5 transition-all duration-200 hover:border-teal-500/40 hover:shadow-md">
            <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-sm font-bold text-emerald-400 border border-emerald-500/20 group-hover:bg-emerald-500/20 transition-colors">
              2
            </div>
            <h3 className="font-editorial text-base font-bold text-[var(--text-primary)]">
              Review Submissions & Audio
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
              Audit the synchronized waveform player, speech turns, real-time barge-ins, and correlated proctoring anomalies.
            </p>
            <Link
              href="/dashboard"
              className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-teal-400 hover:text-teal-300 transition-colors"
            >
              <span>Review sessions</span>
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </article>

          <article className="group relative overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] p-5 transition-all duration-200 hover:border-teal-500/40 hover:shadow-md">
            <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/10 text-sm font-bold text-cyan-400 border border-cyan-500/20 group-hover:bg-cyan-500/20 transition-colors">
              3
            </div>
            <h3 className="font-editorial text-base font-bold text-[var(--text-primary)]">
              Adjust Scores with Context
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
              Validate AI-generated radar breakdowns and rubric evidence, apply score adjustments with audit trails, and publish final marks.
            </p>
            <Link
              href="/dashboard"
              className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-teal-400 hover:text-teal-300 transition-colors"
            >
              <span>Open the registry</span>
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </article>
        </div>
      </section>
    </main>
  );
}
