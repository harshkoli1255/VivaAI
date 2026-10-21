'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/store';
import { configsApi, sessionsApi } from '@/lib/api';
import { getFacultyPortalUrl } from '@/lib/utils';
import { MicCheck } from '@/components/interview/MicCheck';
import { ShieldCheck, Clock, BookOpen, ArrowRight } from 'lucide-react';

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
  const [invitationNotice, setInvitationNotice] = useState('');
  const [vivaQuery, setVivaQuery] = useState('');
  const [resumable, setResumable] = useState<Array<{ id: string; viva_title?: string; elapsed_secs: number }>>([]);

  // Authentication check
  useEffect(() => {
    const invited = new URLSearchParams(window.location.search).get('viva');
    if (invited && /^[0-9a-f-]{36}$/i.test(invited)) {
      try { sessionStorage.setItem('vivaai_invited_viva', invited); } catch { /* The URL still works for signed-in students. */ }
    }
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
          let invited = new URLSearchParams(window.location.search).get('viva');
          try { invited = invited || sessionStorage.getItem('vivaai_invited_viva'); } catch { /* URL-only invitations remain usable. */ }
          if (invited) {
            const match = data.find((config: VivaConfig) => config.id === invited);
            setSelectedConfigId(match ? match.id : '');
            setInvitationNotice(match ? 'Your shared viva is selected. Check your audio and give consent when you are ready.' : 'This shared viva is not currently open to new interviews. You can resume an existing interview below, choose another viva, or ask faculty for an updated link.');
            try { sessionStorage.removeItem('vivaai_invited_viva'); } catch { /* Optional storage. */ }
          } else if (data.length > 0) setSelectedConfigId(prev => data.some((config: VivaConfig) => config.id === prev) ? prev : data[0].id);
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

  useEffect(() => {
    if (!hasHydrated || !isAuthenticated || user?.role !== 'student') return;
    let active = true;
    sessionsApi.mySessions().then(({ data }) => { if (active) setResumable(data.filter((session: { status: string }) => ['scheduled', 'in_progress'].includes(session.status))); }).catch(() => { /* History is also available from the dedicated Results page. */ });
    return () => { active = false; };
  }, [hasHydrated, isAuthenticated, user?.role]);
  const visibleConfigs = configs.filter(config => `${config.title} ${config.subject} ${config.topics.join(' ')}`.toLowerCase().includes(vivaQuery.toLowerCase().trim()));

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
    <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-12">
      <div className="workspace-banner mb-9 flex flex-wrap items-end justify-between gap-4">
        <div><p className="eyebrow mb-3">Welcome, {user?.name?.split(' ')[0]}</p><h1 className="text-3xl sm:text-4xl">Let’s get you ready.</h1><p className="mt-3 text-sm text-[var(--text-secondary)]">Choose your viva, check your audio, and you’re all set.</p></div>
        <Link href="/sessions" className="text-sm font-medium text-[var(--primary)]">Past interviews & feedback</Link>
      </div>
      {resumable.length > 0 && <section aria-label="Continue your interview" className="academic-dossier mb-7 p-5 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="eyebrow mb-2">Continue where you left off</p><h2 className="text-lg font-semibold">Your saved interviews</h2></div><Link href="/sessions" className="text-sm text-[var(--primary)]">View all interviews →</Link></div><div className="mt-4 space-y-3">{resumable.slice(0,2).map(session => <div key={session.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--bg-muted)] p-4"><div><p className="text-sm font-semibold">{session.viva_title || 'Saved viva'}</p><p className="mt-1 text-xs text-[var(--text-secondary)]">{Math.floor(session.elapsed_secs / 60)}m {Math.floor(session.elapsed_secs % 60)}s saved · keeps your original viva settings</p></div><Link href={`/interview/${session.id}`} className="btn-secondary text-xs">Resume interview<ArrowRight aria-hidden="true" className="h-3.5 w-3.5" /></Link></div>)}</div></section>}
      {invitationNotice && <p role="status" className="mb-6 rounded-xl border border-[var(--status-info-border)] bg-[var(--status-info-bg)] p-4 text-sm leading-relaxed text-[var(--status-info)]">{invitationNotice}</p>}
      <div className="grid items-start gap-7 lg:grid-cols-[1fr_1.1fr]">
        <div className="space-y-7">
          <section className="academic-dossier p-6 sm:p-7"><div className="mb-5 flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#e7edff] text-sm font-bold text-[#3558e8]">1</span><h2 className="text-lg">Choose your viva</h2></div>
            {configsLoading ? <p role="status" className="py-6 text-sm text-[var(--text-secondary)]">Loading your vivas…</p> : configsError ? <div role="alert"><p className="text-sm text-[var(--status-danger)]">{configsError}</p><button onClick={() => setConfigRetry(v => v + 1)} className="btn-secondary mt-3">Try again</button></div> : configs.length === 0 ? <p className="text-sm text-[var(--text-secondary)]">No vivas are available yet. Please contact your faculty.</p> : <div className="space-y-3"><label className="sr-only" htmlFor="student-viva-search">Search available vivas</label><input id="student-viva-search" className="form-input mb-2" type="search" placeholder="Find a viva by subject or topic…" value={vivaQuery} onChange={event => setVivaQuery(event.target.value)} />{visibleConfigs.length === 0 && <p className="py-3 text-sm text-[var(--text-muted)]">No vivas match your search.</p>}{visibleConfigs.map(config => <button key={config.id} onClick={() => { setSelectedConfigId(config.id); setInvitationNotice(''); }} aria-pressed={config.id === selectedConfigId} className={`w-full rounded-2xl border p-5 text-left transition-colors ${config.id === selectedConfigId ? 'border-[var(--primary)] bg-[var(--accent-subtle)]' : 'border-[var(--border-default)] hover:bg-[var(--bg-muted)]'}`}>
              <div className="flex items-center justify-between gap-3"><span className="text-xs font-semibold text-[var(--primary)]">{config.subject}</span><span className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]"><Clock className="h-3.5 w-3.5" />{Math.round(config.total_duration_secs / 60)} min</span></div><h3 className="mt-3 text-base font-semibold">{config.title}</h3><p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">{parseTopicTags(config.topics).join(' / ')}</p>
            </button>)}</div>}
          </section>
          <section className="readiness-note rounded-[20px] p-6 sm:p-7"><h2 className="text-lg">A few things to know</h2><ul className="mt-4 space-y-4 text-sm leading-relaxed"><li className="flex gap-3"><Clock className="mt-0.5 h-4 w-4 shrink-0" /><span>Your viva lasts {Math.round((selectedConfig?.total_duration_secs || 900) / 60)} minutes. The timer stays visible throughout.</span></li><li className="flex gap-3"><BookOpen className="mt-0.5 h-4 w-4 shrink-0" /><span>Explain your thinking. It’s okay to say “I don’t know” and move on.</span></li><li className="flex gap-3"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /><span>Audio and transcripts are saved so faculty can review your marks fairly.</span></li></ul></section>
        </div>
        <section className="academic-dossier p-6 sm:p-7"><div className="mb-5 flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#ffeddd] text-sm font-bold text-[#a95b25]">2</span><h2 className="text-lg">Check your audio</h2></div><MicCheck onReadyChange={setHardwareReady} />
          <div className="mt-6 border-t border-[var(--border-subtle)] pt-6"><label htmlFor="exam-consent" className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed"><input id="exam-consent" type="checkbox" checked={consentGiven} onChange={e => setConsentGiven(e.target.checked)} className="mt-1 h-4 w-4 shrink-0" /><span>I agree to the viva rules and consent to audio recording and transcription for assessment and faculty review.</span></label>
          {submitError && <p role="alert" className="mt-4 text-sm text-[var(--status-danger)]">{submitError}</p>}
          <button onClick={handleStartExam} disabled={!canStart} className="btn-primary mt-6 w-full">{submitting ? 'Opening your viva…' : 'Enter Live Examination Room'}<ArrowRight className="h-4 w-4" /></button><p className="mt-3 text-center text-xs text-[var(--text-muted)]">Your timer starts when you enter the viva.</p></div>
        </section>
      </div>
    </div>
  );
}
