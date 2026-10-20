'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/store';
import { configsApi, sessionsApi } from '@/lib/api';
import { getFacultyPortalUrl } from '@/lib/utils';
import { MicCheck } from '@/components/interview/MicCheck';
import { Badge } from '@/components/ui/Badge';
import {
  ShieldCheck,
  Clock,
  BookOpen,
  ArrowRight,
  CheckCircle2,
  Scale,
  FileText,
  User,
  AlertCircle,
  Lock,
  Headphones,
  Check,
  Activity,
} from 'lucide-react';

interface VivaConfig {
  id: string;
  subject: string;
  title: string;
  total_duration_secs: number;
  topics: string[];
  question_count: number;
}

// Cleanly extracts concise syllabus topic tags for sleek card presentation
function parseTopicTags(topics: string[]): string[] {
  if (!topics || !topics.length) return ['Curriculum Assessment'];
  const tags: string[] = [];
  for (const topic of topics) {
    if (topic.toLowerCase().startsWith('unit')) {
      const cleaned = topic.replace(/^unit\s+\d+:\s*/i, '');
      const parts = cleaned.split(/[,;·]/);
      for (const part of parts) {
        const t = part.trim().replace(/\.$/, '');
        if (t.length > 2 && t.length < 32 && !tags.includes(t)) {
          tags.push(t);
        }
      }
    } else if (topic.includes('·')) {
      const parts = topic.split('·');
      for (const part of parts) {
        const t = part.trim();
        if (t && !tags.includes(t)) tags.push(t);
      }
    } else {
      const t = topic.trim().replace(/\.$/, '');
      if (t && !tags.includes(t)) tags.push(t);
    }
  }
  return tags.slice(0, 5);
}

export default function InterviewSetupPage() {
  const router = useRouter();
  const { user, isAuthenticated, hasHydrated } = useAuthStore();

  const [configs, setConfigs] = useState<VivaConfig[]>([]);
  const [configsLoading, setConfigsLoading] = useState(true);
  const [configsError, setConfigsError] = useState<string | null>(null);
  const [configRetry, setConfigRetry] = useState(0);
  const [selectedConfigId, setSelectedConfigId] = useState<string>('');
  const [hardwareReady, setHardwareReady] = useState(false);
  const [consentGiven, setConsentGiven] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Authentication check
  useEffect(() => {
    if (!hasHydrated) return;
    if (!isAuthenticated) {
      router.replace('/login');
    } else if (user?.role !== 'student') {
      window.location.assign(`${getFacultyPortalUrl()}/login`);
    }
  }, [hasHydrated, isAuthenticated, user?.role, router]);

  // Load Viva Configurations from API
  useEffect(() => {
    let active = true;
    async function loadConfigs() {
      setConfigsLoading(true);
      setConfigsError(null);
      try {
        const res = await configsApi.list();
        const data = Array.isArray(res.data) ? res.data : res.data?.items || [];
        if (active) {
          setConfigs(data);
          if (data.length > 0) {
            setSelectedConfigId((prev) => (prev ? prev : data[0].id));
          }
        }
      } catch {
        if (active) setConfigsError('Could not load scheduled examinations. Please check your network and retry.');
      } finally {
        if (active) setConfigsLoading(false);
      }
    }
    loadConfigs();
    return () => { active = false; };
  }, [configRetry]);

  const selectedConfig = useMemo(
    () => configs.find((c) => c.id === selectedConfigId),
    [configs, selectedConfigId]
  );

  const canStart = Boolean(
    selectedConfigId &&
    hardwareReady &&
    consentGiven &&
    !submitting &&
    !configsLoading &&
    configsError === null
  );

  const handleStartExam = async () => {
    if (!canStart) return;
    setSubmitting(true);
    setSubmitError(null);

    try {
      if (typeof window !== 'undefined') {
        const { voiceEngine } = await import('@/lib/speech');
        voiceEngine?.unlockAudio();
      }
      const res = await sessionsApi.create({
        viva_config_id: selectedConfigId,
        consent_given: true,
      });
      if (typeof window !== 'undefined') {
        try { sessionStorage.setItem('vivaai_direct_start', 'true'); } catch {}
      }
      const session = res.data;
      router.push(`/interview/${session.id}`);
    } catch {
      setSubmitError('The viva examination room could not be created. Please retry or contact faculty.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!hasHydrated || !isAuthenticated || user?.role !== 'student') {
    return (
      <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-[var(--bg-page)] px-4 text-sm text-[var(--text-secondary)]">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
          <span>Verifying student credentials...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-[var(--bg-page)] text-[var(--text-primary)] py-6 sm:py-10 px-4 sm:px-6 lg:px-8 transition-colors">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* ── Top Header Bar with Candidate Identity Chip ── */}
        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] p-5 sm:p-6 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            {/* Title & Step Track */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-bold tracking-wide uppercase bg-[var(--accent-subtle)] text-[var(--primary)] border border-[var(--primary)]/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Step 1 of 2: Readiness & System Check
                </span>
                <span className="text-xs text-[var(--text-muted)] font-medium">
                  • Next: Live AI Examination
                </span>
              </div>
              <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-[var(--text-primary)]">
                Oral Examination Check-in & System Readiness
              </h1>
              <p className="text-xs sm:text-sm text-[var(--text-secondary)] max-w-2xl leading-relaxed">
                Confirm your scheduled viva module, calibrate your audio hardware, and accept academic standards before entering the session.
              </p>
              <Link href="/sessions" className="inline-block text-sm font-semibold text-[var(--primary)] underline">Resume an interview or view past feedback</Link>
            </div>

            {/* Candidate Identity Pill */}
            <div className="flex items-center gap-3 bg-[var(--bg-muted)] border border-[var(--border-subtle)] p-3 rounded-lg shrink-0 self-start md:self-auto">
              <div className="relative">
                <div className="w-10 h-10 rounded-full bg-[var(--accent-subtle)] text-[var(--primary)] flex items-center justify-center font-bold border border-[var(--primary)]/20">
                  <User className="w-5 h-5" />
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-500 rounded-full border-2 border-[var(--bg-card)] flex items-center justify-center">
                  <Check className="w-2 h-2 text-white stroke-[3]" />
                </div>
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-sm text-[var(--text-primary)]">{user?.name}</span>
                  <Badge variant="success" className="text-[10px] py-0 px-1.5">Verified</Badge>
                </div>
                <div className="font-mono text-xs text-[var(--text-muted)] mt-0.5">
                  Roll ID: <span className="font-semibold text-[var(--text-secondary)]">{user?.student_id || '—'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Two-Column Main Grid ── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">

          {/* ════ LEFT COLUMN: Assessment Dossier & Academic Standards ════ */}
          <div className="lg:col-span-6 space-y-6">

            {/* 1. Scheduled Examination Module Selection */}
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] p-5 sm:p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-[var(--primary)]" />
                  <h2 className="text-sm font-bold tracking-tight text-[var(--text-primary)]">
                    1. Scheduled Examination Module
                  </h2>
                </div>
                <Badge variant="neutral">
                  {configs.length} {configs.length === 1 ? 'Module' : 'Modules'} Available
                </Badge>
              </div>

              <div className="space-y-3">
                {configsLoading ? (
                  <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-muted)] p-6 text-center text-sm text-[var(--text-secondary)]">
                    <div className="w-5 h-5 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                    <span>Loading scheduled viva modules...</span>
                  </div>
                ) : configsError ? (
                  <div className="rounded-lg border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] p-4 text-xs text-[var(--status-danger)]" role="alert">
                    <p className="font-medium">{configsError}</p>
                    <button
                      type="button"
                      onClick={() => setConfigRetry((v) => v + 1)}
                      className="mt-2 text-xs font-semibold underline"
                    >
                      Retry Connection
                    </button>
                  </div>
                ) : configs.length === 0 ? (
                  <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-muted)] p-6 text-center text-xs text-[var(--text-muted)]">
                    No examination modules are currently assigned to your account. Please contact your faculty administrator.
                  </div>
                ) : (
                  configs.map((config) => {
                    const isSelected = config.id === selectedConfigId;
                    const topicTags = parseTopicTags(config.topics);

                    return (
                      <button
                        key={config.id}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => setSelectedConfigId(config.id)}
                        className={`w-full text-left rounded-lg p-4 sm:p-4.5 border transition-all relative ${
                          isSelected
                            ? 'border-emerald-500 dark:border-teal-400 bg-emerald-500/[0.04] dark:bg-teal-500/[0.08] ring-1 ring-emerald-500/30 shadow-sm'
                            : 'border-[var(--border-default)] bg-[var(--bg-card)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-card-hover)]'
                        }`}
                      >
                        <div className="space-y-2.5">
                          {/* Card Header: Subject Tag & Duration */}
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-[11px] font-semibold text-[var(--primary)] uppercase tracking-wider bg-[var(--accent-subtle)] border border-[var(--primary)]/20 px-2 py-0.5 rounded">
                              {config.subject}
                            </span>
                            <div className="flex items-center gap-2">
                              <span className="inline-flex items-center gap-1 font-mono text-xs text-[var(--text-muted)] bg-[var(--bg-muted)] border border-[var(--border-subtle)] px-2 py-0.5 rounded">
                                <Clock className="w-3 h-3 text-[var(--primary)]" />
                                {Math.max(1, Math.round((config.total_duration_secs || 900) / 60))} min
                              </span>
                              <div
                                className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${
                                  isSelected
                                    ? 'border-emerald-500 bg-emerald-500 text-white'
                                    : 'border-[var(--border-strong)] bg-transparent'
                                }`}
                              >
                                {isSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                              </div>
                            </div>
                          </div>

                          {/* Exam Title */}
                          <div>
                            <h3 className="text-sm sm:text-base font-bold text-[var(--text-primary)]">
                              {config.title}
                            </h3>
                          </div>

                          {/* Syllabus Topic Badges */}
                          <div className="space-y-1 pt-0.5">
                            <span className="text-[11px] font-medium text-[var(--text-muted)]">
                              Syllabus Competencies:
                            </span>
                            <div className="flex flex-wrap gap-1.5 pt-1">
                              {topicTags.map((tag, i) => (
                                <span
                                  key={i}
                                  className="inline-flex items-center px-2 py-0.5 rounded text-[11px] bg-[var(--bg-muted)] border border-[var(--border-subtle)] text-[var(--text-secondary)] font-medium"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* 2. Academic Standards & Protocol */}
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] p-5 sm:p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-[var(--primary)]" />
                  <h2 className="text-sm font-bold tracking-tight text-[var(--text-primary)]">
                    Academic Standards & Protocol
                  </h2>
                </div>
                <Badge variant="neutral">Official Guidelines</Badge>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div className="p-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-muted)]/50 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-[var(--primary)]" />
                    <span className="font-semibold text-xs text-[var(--text-primary)]">{Math.round((selectedConfig?.total_duration_secs || 900) / 60)}-Minute Clock</span>
                  </div>
                  <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                    Strict server-timed question pacing ensures equal opportunity for all candidates.
                  </p>
                </div>

                <div className="p-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-muted)]/50 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Scale className="w-3.5 h-3.5 text-[var(--primary)]" />
                    <span className="font-semibold text-xs text-[var(--text-primary)]">Zero-Penalty Advance</span>
                  </div>
                  <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                    State &quot;I don&apos;t know&quot; clearly to advance instantly without negative penalty.
                  </p>
                </div>

                <div className="p-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-muted)]/50 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-[var(--primary)]" />
                    <span className="font-semibold text-xs text-[var(--text-primary)]">Transcript Audit</span>
                  </div>
                  <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                    Verbatim audio and transcripts are archived for faculty verification and scoring audit.
                  </p>
                </div>

                <div className="p-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-muted)]/50 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-[var(--primary)]" />
                    <span className="font-semibold text-xs text-[var(--text-primary)]">Adaptive AI Examiner</span>
                  </div>
                  <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                    Speak naturally when the AI pauses. The system will adapt follow-up depth dynamically.
                  </p>
                </div>
              </div>
            </div>

          </div>

          {/* ════ RIGHT COLUMN: Hardware Calibration, Honor Pledge & Launch ════ */}
          <div className="lg:col-span-6 space-y-6">

            {/* 1. Audio Hardware Diagnostic Console */}
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] p-5 sm:p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
                <div className="flex items-center gap-2">
                  <Headphones className="w-4 h-4 text-[var(--primary)]" />
                  <h2 className="text-sm font-bold tracking-tight text-[var(--text-primary)]">
                    2. Audio & Hardware Pre-Flight
                  </h2>
                </div>
                <Badge variant={hardwareReady ? 'success' : 'neutral'} dot={hardwareReady}>
                  {hardwareReady ? 'All Systems Go' : 'Hardware Check Required'}
                </Badge>
              </div>

              {/* Interactive Audio Check Component */}
              <MicCheck onReadyChange={setHardwareReady} />

              {/* System Diagnostics Strip */}
              <div className="pt-2 border-t border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--text-muted)] font-mono">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  Audio or typed answers
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  Permission checked before recording
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  Connection checked on entry
                </span>
              </div>
            </div>

            {/* 2. Candidate Honor Pledge & Entry Gateway */}
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] p-5 sm:p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-[var(--primary)]" />
                  <h2 className="text-sm font-bold tracking-tight text-[var(--text-primary)]">
                    3. Candidate Honor Pledge & Launch
                  </h2>
                </div>
                <Badge variant={consentGiven ? 'success' : 'neutral'}>
                  {consentGiven ? 'Pledged' : 'Pending'}
                </Badge>
              </div>

              {/* Consent Checkbox Box */}
              <label className="flex items-start gap-3 p-4 rounded-lg bg-[var(--bg-muted)]/70 border border-[var(--border-default)] hover:border-[var(--border-strong)] cursor-pointer select-none transition-colors">
                <input
                  id="exam-consent"
                  name="consent"
                  type="checkbox"
                  checked={consentGiven}
                  onChange={(e) => setConsentGiven(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-[var(--border-strong)] text-[var(--primary)] focus:ring-[var(--primary)] cursor-pointer shrink-0"
                />
                <span className="text-xs text-[var(--text-primary)] leading-relaxed">
                  I certify that I am <strong className="text-[var(--text-primary)] font-bold">{user?.name}</strong>{user?.student_id ? ` (ID: ${user.student_id})` : ''}. I pledge to complete this oral viva examination independently without external assistance, and agree to verbatim transcript generation and session audio tracking for faculty review.
                </span>
              </label>

              {/* Readiness Status Message */}
              <div className="text-xs min-h-[22px] flex items-center" aria-live="polite">
                {!hardwareReady && (
                  <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-medium">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    Complete the audio checks or select typed answers before starting.
                  </span>
                )}
                {hardwareReady && !consentGiven && (
                  <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-medium">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    Check the candidate honor pledge box above to unlock entry.
                  </span>
                )}
                {hardwareReady && consentGiven && selectedConfigId && (
                  <span className="text-emerald-700 dark:text-teal-400 font-semibold flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    All checks verified. Click below to enter your live viva room.
                  </span>
                )}
              </div>

              {submitError && (
                <div role="alert" className="rounded-lg border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] p-3 text-xs text-[var(--status-danger)] flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{submitError}</span>
                </div>
              )}

              {/* Primary Call to Action Button */}
              <button
                type="button"
                onClick={handleStartExam}
                disabled={!canStart}
                className={`w-full py-3.5 px-6 rounded-lg font-bold text-sm tracking-wide transition-all flex items-center justify-center gap-2 min-h-[50px] shadow-sm ${
                  canStart
                    ? 'bg-emerald-600 hover:bg-emerald-500 dark:bg-teal-500 dark:hover:bg-teal-400 text-white dark:text-slate-950 shadow-emerald-950/20 hover:shadow-md hover:scale-[1.01] active:scale-[0.99] cursor-pointer'
                    : 'bg-[var(--bg-muted)] text-[var(--text-muted)] border border-[var(--border-default)] cursor-not-allowed opacity-75'
                }`}
              >
                {submitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    <span>Preparing Secure Examination Room...</span>
                  </>
                ) : canStart ? (
                  <>
                    <span>Enter Live Examination Room</span>
                    <ArrowRight className="w-4 h-4 stroke-[2.5]" />
                  </>
                ) : (
                  <>
                    <Lock className="w-4 h-4" />
                    <span>Complete Checks to Enter Exam Room</span>
                  </>
                )}
              </button>

              {/* Subtle Module Summary Pill */}
              {selectedConfig && (
                <p className="text-[11px] text-center text-[var(--text-muted)]">
                  Selected: <span className="font-semibold text-[var(--text-secondary)]">{selectedConfig.title}</span> ({selectedConfig.subject})
                </p>
              )}
            </div>

          </div>

        </div>

      </div>
    </div>
  );
}
