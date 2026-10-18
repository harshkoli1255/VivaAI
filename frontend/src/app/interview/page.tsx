'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store';
import { configsApi, sessionsApi } from '@/lib/api';
import { MicCheck } from '@/components/interview/MicCheck';
import {
  Mic,
  ShieldCheck,
  Clock,
  BookOpen,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
  Lock,
  Layers,
  Sparkles,
  Info,
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
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      localStorage.setItem('vivaai_token', 'demo_student_token_stu001');
      localStorage.setItem('vivaai_user', JSON.stringify(demoStudent));
    }
  }, [isAuthenticated, setAuth]);

  // Load Viva Configurations from API
  useEffect(() => {
    async function loadConfigs() {
      try {
        setLoading(true);
        const res = await configsApi.list();
        const data = res.data?.items || res.data || [];
        if (data.length > 0) {
          setConfigs(data);
          setSelectedConfigId(data[0].id);
        } else {
          // Provide default academic module
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
      } finally {
        setLoading(false);
      }
    }
    loadConfigs();
  }, []);

  const handleStartExam = async () => {
    if (!selectedConfigId || !consentGiven) return;
    setSubmitting(true);
    setError(null);

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
    } catch (err: any) {
      console.warn('Session creation fallback to local session ID:', err);
      // Fallback local session ID if network is disconnected
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('vivaai_direct_start', 'true');
      }
      const fallbackId = '00000000-0000-0000-0000-000000000099';
      router.push(`/interview/${fallbackId}`);
    } finally {
      setSubmitting(false);
    }
  };

  const selectedConfig = configs.find((c) => c.id === selectedConfigId);

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-950 py-10 px-4 sm:px-6">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/20">
            <Mic className="w-3.5 h-3.5" />
            <span>Pre-Examination Check & Calibration Terminal</span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white">
            Candidate Oral Viva Preparation
          </h1>
          <p className="text-sm text-slate-400">
            Candidate: <span className="font-semibold text-slate-200">{user?.name || 'Alex Chen'}</span> (ID: <span className="font-mono text-sky-400">{user?.student_id || 'STU001'}</span>). Please complete all 3 calibration steps before entering the examination chamber.
          </p>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
          {/* Left Column: Module Selection & Consent */}
          <div className="md:col-span-7 space-y-6">
            {/* Step 1: Module Selection */}
            <div className="glass-panel p-6 space-y-4 border border-slate-800">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2 text-sm font-bold text-white">
                  <span className="w-6 h-6 rounded-full bg-sky-500 text-white flex items-center justify-center text-xs font-mono">
                    1
                  </span>
                  Select Examination Syllabus
                </div>
                <span className="text-xs font-mono text-slate-400">
                  {configs.length} Module{configs.length > 1 ? 's' : ''} Active
                </span>
              </div>

              {loading ? (
                <div className="p-8 text-center text-xs text-slate-500 animate-pulse">
                  Loading syllabus registry...
                </div>
              ) : (
                <div className="space-y-3">
                  {configs.map((config) => (
                    <label
                      key={config.id}
                      onClick={() => setSelectedConfigId(config.id)}
                      className={`block p-4 rounded-xl border cursor-pointer transition-all ${
                        selectedConfigId === config.id
                          ? 'bg-sky-500/10 border-sky-500 shadow-md shadow-sky-500/10'
                          : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-bold text-sky-400">
                          {config.course_code}
                        </span>
                        <span className="flex items-center gap-1 text-[11px] font-mono text-slate-400">
                          <Clock className="w-3 h-3 text-slate-400" />
                          {config.duration_minutes || 15} Minutes
                        </span>
                      </div>
                      <h4 className="text-sm font-bold text-white mt-1">
                        {config.title}
                      </h4>
                      <p className="text-xs text-slate-400 mt-1 line-clamp-2">
                        {config.syllabus}
                      </p>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Step 2: Protocol Consent */}
            <div className="glass-panel p-6 space-y-4 border border-slate-800">
              <div className="flex items-center gap-2 text-sm font-bold text-white border-b border-slate-800 pb-3">
                <span className="w-6 h-6 rounded-full bg-sky-500 text-white flex items-center justify-center text-xs font-mono">
                  2
                </span>
                Examination Regulations & Integrity Agreement
              </div>

              <div className="bg-slate-900/80 rounded-xl p-4 space-y-2.5 text-xs text-slate-300">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Deterministic 15:00 Hard Stop:</strong> The examination terminates automatically at 15:00 with zero overtime bias.
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Non-Punitive Skip Allowed:</strong> If you are unfamiliar with a topic, you can click &quot;Pass / I don&apos;t know&quot; to advance without penalty.
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Verbatim Transcript Audit:</strong> Audio is transcribed in real-time. Turn-level citations are reviewed by faculty examiners.
                  </span>
                </div>
              </div>

              <label className="flex items-center gap-3 p-3 rounded-xl bg-slate-900 border border-slate-800 cursor-pointer hover:border-slate-700 transition-colors">
                <input
                  type="checkbox"
                  checked={consentGiven}
                  onChange={(e) => setConsentGiven(e.target.checked)}
                  className="w-4 h-4 rounded text-sky-500 focus:ring-sky-500 bg-slate-950 border-slate-700"
                />
                <span className="text-xs text-slate-200 font-medium">
                  I understand the 15-minute examination protocol and consent to verbatim oral transcription.
                </span>
              </label>
            </div>
          </div>

          {/* Right Column: Audio Hardware Calibration */}
          <div className="md:col-span-5 space-y-6">
            <div className="glass-panel p-6 space-y-4 border border-slate-800">
              <div className="flex items-center gap-2 text-sm font-bold text-white border-b border-slate-800 pb-3">
                <span className="w-6 h-6 rounded-full bg-sky-500 text-white flex items-center justify-center text-xs font-mono">
                  3
                </span>
                Hardware Audio Calibration
              </div>

              <MicCheck onReadyChange={setHardwareReady} />
            </div>

            {/* Launch Action Card */}
            <div className="premium-card p-6 space-y-4 bg-gradient-to-b from-slate-900 to-slate-950 border-slate-800">
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-white">
                  Ready to Enter Oral Examination?
                </h4>
                <p className="text-xs text-slate-400">
                  Once started, the 15-minute timer begins. Please speak clearly into your microphone.
                </p>
              </div>

              <button
                onClick={handleStartExam}
                disabled={!selectedConfigId || !consentGiven || submitting}
                className="w-full btn-primary py-3 text-sm font-bold shadow-lg shadow-sky-600/30 flex items-center justify-center gap-2"
              >
                {submitting ? (
                  'Initializing Viva Chamber...'
                ) : (
                  <>
                    <span>Enter Viva Chamber Now</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>

              {!consentGiven && (
                <div className="text-[11px] text-amber-400 text-center font-medium">
                  * Please check the integrity agreement to proceed
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
