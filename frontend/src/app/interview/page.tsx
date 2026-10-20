'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store';
import { configsApi, sessionsApi } from '@/lib/api';
import { MicCheck } from '@/components/interview/MicCheck';
import { Badge } from '@/components/ui/Badge';
import {
  Mic,
  ShieldCheck,
  Clock,
  BookOpen,
  ArrowRight,
  CheckCircle2,
  Scale,
  FileText,
  User,
  AlertCircle,
} from 'lucide-react';

interface VivaConfig {
  id: string;
  course_code: string;
  title: string;
  duration_minutes: number;
  examiner_model: string;
  syllabus: string;
}

export default function InterviewSetupPage() {
  const router = useRouter();
  const { user, isAuthenticated, setAuth } = useAuthStore();

  const [configs, setConfigs] = useState<VivaConfig[]>([]);
  const [selectedConfigId, setSelectedConfigId] = useState<string>('');
  const [hardwareReady, setHardwareReady] = useState(false);
  const [consentGiven, setConsentGiven] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Auto-login fallback if user lands here unauthenticated
  useEffect(() => {
    if (!isAuthenticated) {
      const demoStudent = {
        id: '00000000-0000-0000-0000-000000000002',
        name: 'Alex Chen',
        role: 'student' as const,
        student_id: 'STU001',
        email: 'alex.chen@university.edu',
      };
      setAuth('demo_student_token_stu001', demoStudent);


    }
  }, [isAuthenticated, setAuth]);

  // Load Viva Configurations from API
  useEffect(() => {
    async function loadConfigs() {
      try {
        const res = await configsApi.list();
        const data = res.data?.items || res.data || [];
        if (data.length > 0) {
          setConfigs(data);
          setSelectedConfigId(data[0].id);
        } else {
          const defaultModule: VivaConfig = {
            id: '00000000-0000-0000-0000-000000000010',
            course_code: 'CS401',
            title: 'Distributed Systems & Database Internals',
            duration_minutes: 15,
            examiner_model: 'Oxford AI Viva Engine v2',
            syllabus: 'Raft consensus, WAL logging, 2-phase commit, MVCC, and network partitions.',
          };
          setConfigs([defaultModule]);
          setSelectedConfigId(defaultModule.id);
        }
      } catch (err) {
        console.warn('Config fetch notice, using fallback academic module:', err);
        const defaultModule: VivaConfig = {
          id: '00000000-0000-0000-0000-000000000010',
          course_code: 'CS401',
          title: 'Distributed Systems & Database Internals',
          duration_minutes: 15,
          examiner_model: 'Oxford AI Viva Engine v2',
          syllabus: 'Raft consensus, WAL logging, 2-phase commit, MVCC, and network partitions.',
        };
        setConfigs([defaultModule]);
        setSelectedConfigId(defaultModule.id);
      }
    }
    loadConfigs();
  }, []);

  const handleStartExam = async () => {
    if (!selectedConfigId || !consentGiven) return;
    setSubmitting(true);

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
        sessionStorage.setItem('vivaai_direct_start', 'true');
      }
      const session = res.data;
      router.push(`/interview/${session.id}`);
    } catch (err: unknown) {
      console.warn('Session creation fallback to local session ID:', err);
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('vivaai_direct_start', 'true');
      }
      const fallbackId = '00000000-0000-0000-0000-000000000099';
      router.push(`/interview/${fallbackId}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-[var(--bg-page)] text-[var(--text-primary)] py-8 sm:py-12 px-4 sm:px-6 lg:px-8 transition-colors">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header Ribbon */}
        <div className="border-b border-[var(--border-default)] pb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-semibold text-[var(--primary)] uppercase tracking-wider">
                Step 1 of 2: Pre-Flight Readiness
              </span>
              <span className="text-xs text-[var(--text-muted)]">• University Assessment Station</span>
            </div>
            <h1 className="font-editorial text-2xl sm:text-4xl font-bold tracking-tight text-[var(--text-primary)]">
              Oral Viva Examination Calibration
            </h1>
            <p className="text-xs sm:text-sm text-[var(--text-secondary)] max-w-2xl">
              Verify your registered academic course, calibrate microphone speech levels, and confirm your examination honor pledge before entering the live oral room.
            </p>
          </div>

          <div className="flex items-center gap-2 bg-[var(--bg-card)] border border-[var(--border-default)] p-2 rounded shrink-0">
            <div className="w-8 h-8 rounded bg-[var(--accent-subtle)] text-[var(--primary)] flex items-center justify-center font-bold">
              <User className="w-4 h-4" />
            </div>
            <div className="text-xs">
              <div className="font-semibold text-[var(--text-primary)]">{user?.name || 'Alex Chen'}</div>
              <div className="font-mono text-[11px] text-[var(--text-muted)]">ID: {user?.student_id || 'STU001'}</div>
            </div>
          </div>
        </div>

        {/* Two-Column Structured Academic Dossier */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: Exam Module & Academic Honor Protocol */}
          <div className="lg:col-span-6 space-y-6">
            {/* 1. Select Scheduled Examination Module */}
            <div className="academic-dossier p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-[var(--primary)]" />
                  <h2 className="text-sm font-bold text-[var(--text-primary)]">
                    1. Scheduled Examination Module
                  </h2>
                </div>
                <Badge variant="neutral">Course Syllabus</Badge>
              </div>

              <div className="space-y-3">
                {configs.map((c) => {
                  const isSelected = c.id === selectedConfigId;
                  return (
                    <div
                      key={c.id}
                      onClick={() => setSelectedConfigId(c.id)}
                      className={`p-4 rounded border cursor-pointer transition-all ${
                        isSelected
                          ? 'border-[var(--primary)] bg-[var(--accent-subtle)] ring-1 ring-[var(--primary)]/20'
                          : 'border-[var(--border-default)] bg-[var(--bg-card)] hover:border-[var(--border-strong)]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-xs text-[var(--primary)]">
                              {c.course_code}
                            </span>
                            <h3 className="text-sm font-bold text-[var(--text-primary)]">
                              {c.title}
                            </h3>
                          </div>
                          <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                            {c.syllabus}
                          </p>
                        </div>
                        <Badge variant="neutral">
                          <Clock className="w-3 h-3 mr-1" />
                          {c.duration_minutes || 15} Mins
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 2. University Examination Honor Code & Policies */}
            <div className="academic-dossier p-5 space-y-3">
              <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] pb-3">
                <ShieldCheck className="w-4 h-4 text-[var(--primary)]" />
                <h2 className="text-sm font-bold text-[var(--text-primary)]">
                  Academic Standards & Protocol
                </h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-[var(--text-secondary)] pt-1">
                <div className="flex items-start gap-2">
                  <Clock className="w-3.5 h-3.5 text-[var(--primary)] shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-[var(--text-primary)] block">15-Minute Clock</span>
                    Strict server-timed stages ensure identical pacing for all candidates.
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Scale className="w-3.5 h-3.5 text-[var(--primary)] shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-[var(--text-primary)] block">Zero-Penalty Advance</span>
                    State &quot;I don&apos;t know&quot; clearly to proceed without negative penalties.
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <FileText className="w-3.5 h-3.5 text-[var(--primary)] shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-[var(--text-primary)] block">Verbatim Auditing</span>
                    Audio and transcript are archived for faculty review and sovereign grading.
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <ShieldCheck className="w-3.5 h-3.5 text-[var(--primary)] shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-[var(--text-primary)] block">Focus Proctoring</span>
                    Prolonged silences and background noise changes are noted in the session log.
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Audio Calibration & Consent Launchpad */}
          <div className="lg:col-span-6 space-y-6">
            {/* Audio Hardware Check */}
            <div className="academic-dossier p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
                <div className="flex items-center gap-2">
                  <Mic className="w-4 h-4 text-[var(--primary)]" />
                  <h2 className="text-sm font-bold text-[var(--text-primary)]">
                    2. Audio Readiness Calibration
                  </h2>
                </div>
                <Badge variant={hardwareReady ? 'success' : 'neutral'} dot={hardwareReady}>
                  {hardwareReady ? 'Audio Verified' : 'Check Required'}
                </Badge>
              </div>

              <MicCheck onReadyChange={setHardwareReady} />
            </div>

            {/* Candidate Honor Pledge & Entry Gateway */}
            <div className="academic-dossier p-5 space-y-5">
              <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] pb-3">
                <ShieldCheck className="w-4 h-4 text-[var(--primary)]" />
                <h2 className="text-sm font-bold text-[var(--text-primary)]">
                  3. Examination Honor Pledge & Start
                </h2>
              </div>

              {/* Consent Checkbox */}
              <label className="flex items-start gap-3 p-3.5 rounded bg-[var(--bg-muted)] border border-[var(--border-default)] cursor-pointer select-none">
                <input
                  id="exam-consent"
                  name="consent"
                  type="checkbox"
                  checked={consentGiven}
                  onChange={(e) => setConsentGiven(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-[var(--border-strong)] text-[var(--primary)] focus:ring-[var(--primary)] cursor-pointer"
                />
                <span className="text-xs text-[var(--text-primary)] leading-relaxed">
                  I certify that I am <strong className="text-[var(--text-primary)]">{user?.name || 'the registered candidate'}</strong> ({user?.student_id || 'STU001'}). I pledge to complete this viva independently without external assistance, and I consent to verbatim audio recording and transcript archiving for faculty review.
                </span>
              </label>

              {/* Status and Action Button */}
              <div className="space-y-3 pt-1">
                <div className="text-xs text-[var(--text-muted)] min-h-[20px]">
                  {!hardwareReady && (
                    <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      Complete the microphone and speaker checks above before starting.
                    </span>
                  )}
                  {hardwareReady && !consentGiven && (
                    <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      Check the honor pledge box above to unlock entry.
                    </span>
                  )}
                  {hardwareReady && consentGiven && (
                    <span className="text-emerald-700 dark:text-teal-400 font-semibold flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4" /> Ready. Click below to enter the live viva room.
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleStartExam}
                  disabled={!selectedConfigId || !consentGiven || submitting}
                  className="btn-primary w-full text-sm font-semibold justify-center py-3 min-h-[48px]"
                >
                  {submitting ? (
                    'Preparing Secure Room...'
                  ) : (
                    <>
                      <span>Enter Live Viva Room</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
