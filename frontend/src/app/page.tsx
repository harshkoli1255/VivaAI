'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store';
import {
  ArrowRight,
  ShieldCheck,
  Mic,
  FileText,
  Clock,
  Sparkles,
  CheckCircle2,
  BarChart3,
  Scale,
  Award,
  Layers,
  Volume2,
  Lock,
  ChevronRight,
  Play,
  User,
} from 'lucide-react';

export default function HomePage() {
  const router = useRouter();
  const { setAuth } = useAuthStore();
  const [isPlayingDemo, setIsPlayingDemo] = useState(false);

  const launchDemo = (role: 'student' | 'faculty') => {
    if (role === 'student') {
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
      router.push('/interview');
    } else {
      const demoFaculty = {
        id: '00000000-0000-0000-0000-000000000001',
        name: 'Dr. Priya Sharma',
        role: 'faculty' as const,
        email: 'priya.sharma@university.edu',
      };
      setAuth('demo_faculty_token_drpriya', demoFaculty);
      localStorage.setItem('vivaai_token', 'demo_faculty_token_drpriya');
      localStorage.setItem('vivaai_user', JSON.stringify(demoFaculty));
      router.push('/dashboard');
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-sky-500/30">
      {/* Background Ambient Glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[20%] w-[600px] h-[600px] bg-sky-600/10 rounded-full blur-[120px]" />
        <div className="absolute top-[30%] right-[10%] w-[500px] h-[500px] bg-indigo-600/10 rounded-full blur-[140px]" />
      </div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-12 sm:py-20 flex-1 space-y-24">
        {/* Hero Section */}
        <section className="space-y-8 text-center max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/20 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Deterministic 15-Minute Oral Examination Protocol · Release 2.4</span>
          </div>

          <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-white leading-[1.12]">
            Autonomous Oral Technical <br className="hidden sm:inline" />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-400 via-blue-400 to-indigo-400">
              Viva Voce Examination
            </span>
          </h1>

          <p className="text-lg sm:text-xl text-slate-300 max-w-3xl mx-auto font-normal leading-relaxed">
            VivaAI administers deterministic, auditable 15-minute technical oral examinations for university engineering cohorts. Powered by real-time speech processing, calibrated rubric grading, and verbatim turn-level citations with total faculty override authority.
          </p>

          {/* Action Gateways */}
          <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
            <Link
              href="/interview"
              className="btn-primary px-6 py-3 text-sm font-semibold shadow-xl shadow-sky-600/25"
            >
              <Mic className="w-4 h-4" />
              Candidate Viva Terminal
              <ArrowRight className="w-4 h-4" />
            </Link>

            <Link
              href="/dashboard"
              className="btn-secondary px-6 py-3 text-sm font-semibold hover:border-slate-600"
            >
              <ShieldCheck className="w-4 h-4 text-sky-400" />
              Faculty Assessment Registry
            </Link>

            <Link
              href="/login"
              className="btn-ghost px-4 py-3 text-xs font-mono text-slate-400 hover:text-white"
            >
              Demo Credentials Sign-In
            </Link>
          </div>
        </section>

        {/* Live Examination Simulator Preview Card */}
        <section className="max-w-5xl mx-auto">
          <div className="glass-panel p-6 sm:p-8 relative overflow-hidden border border-slate-800/90 shadow-2xl">
            <div className="flex items-center justify-between pb-6 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <span className="flex h-3 w-3 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
                </span>
                <div>
                  <h3 className="text-sm font-bold text-white tracking-wide">
                    LIVE VIVA SESSION · CS401 DISTRIBUTED SYSTEMS
                  </h3>
                  <p className="text-xs text-slate-400">
                    Candidate: Alex Chen (STU001) · Examiner Node: Oxford AI Rubric Engine
                  </p>
                </div>
              </div>

              {/* Time Remaining Pill */}
              <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-lg">
                <Clock className="w-3.5 h-3.5 text-sky-400" />
                <span className="font-mono text-xs font-bold text-slate-200">
                  09:42 REMAINING
                </span>
              </div>
            </div>

            {/* Split Screen Simulator */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-6">
              {/* Question & Acoustic Visualizer Column */}
              <div className="lg:col-span-7 space-y-5">
                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-sky-400 flex items-center gap-1.5">
                      <Volume2 className="w-4 h-4" />
                      EXAMINER QUESTION · PHASE 3 (APPLIED DEPTH)
                    </span>
                    <span className="font-mono text-[11px] text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                      TURN 04
                    </span>
                  </div>
                  <p className="text-sm sm:text-base font-medium text-slate-100 leading-relaxed">
                    &quot;Explain write-ahead logging (WAL) in database storage engines. How does it enforce the ACID durability contract when the operating system crashes before dirty buffers are flushed?&quot;
                  </p>
                </div>

                {/* Real-time Oscilloscope Bars */}
                <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-sky-500/20 text-sky-400 flex items-center justify-center font-bold">
                      <Mic className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-slate-200">
                        Candidate Audio Stream (WebRTC / Opus 48kHz)
                      </div>
                      <div className="text-[11px] text-emerald-400 font-mono">
                        Acoustic SNR: 24dB · Low Latency Active
                      </div>
                    </div>
                  </div>

                  {/* Oscilloscope Waveform */}
                  <div className="flex items-center gap-1 px-2">
                    <span className="wave-bar" />
                    <span className="wave-bar" />
                    <span className="wave-bar" />
                    <span className="wave-bar" />
                    <span className="wave-bar" />
                    <span className="wave-bar" />
                    <span className="wave-bar" />
                    <span className="wave-bar" />
                  </div>
                </div>

                {/* Candidate Verbatim Transcript Preview */}
                <div className="bg-slate-900/40 border border-slate-800/60 rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span className="font-semibold text-slate-300">Live Verbatim Recognition:</span>
                    <span className="text-[10px] font-mono text-emerald-400">CONFIDENCE 98.4%</span>
                  </div>
                  <p className="text-xs sm:text-sm text-slate-300 italic leading-relaxed">
                    &quot;WAL enforces the WAL protocol rule: log records describing a mutation must be fsynced to non-volatile disk before the corresponding dirty table pages in shared memory can be written to data files...&quot;
                  </p>
                </div>
              </div>

              {/* Real-time Rubric & Audit Scoring Column */}
              <div className="lg:col-span-5 bg-slate-900/80 border border-slate-800 rounded-xl p-5 flex flex-col justify-between space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                      Automated Rubric Citations
                    </span>
                    <span className="status-pill status-pill-success text-[10px]">
                      HIGH PRECISION
                    </span>
                  </div>

                  <div className="space-y-2.5">
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-300 font-medium">1. Conceptual Depth</span>
                        <span className="font-mono font-bold text-sky-400">9.4 / 10</span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-sky-500 rounded-full" style={{ width: '94%' }} />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-300 font-medium">2. Problem Solving</span>
                        <span className="font-mono font-bold text-sky-400">8.8 / 10</span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-sky-500 rounded-full" style={{ width: '88%' }} />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-300 font-medium">3. Architectural Trade-offs</span>
                        <span className="font-mono font-bold text-sky-400">9.1 / 10</span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-sky-500 rounded-full" style={{ width: '91%' }} />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-300 font-medium">4. Edge Case Handling</span>
                        <span className="font-mono font-bold text-sky-400">8.5 / 10</span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-sky-500 rounded-full" style={{ width: '85%' }} />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Audit Citation Box */}
                <div className="bg-slate-950/80 border border-slate-800 p-3 rounded-lg text-xs space-y-1.5">
                  <div className="flex items-center gap-1.5 text-sky-400 font-semibold text-[11px]">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    AUDIT LEDGER CITED EVIDENCE:
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Explicitly mentioned fsync flush sequence and checkpoint recovery mechanism (<span className="turn-citation">Turn 04</span>). Verified by faculty auditor.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 15-Minute Protocol Architecture */}
        <section className="space-y-6">
          <div className="text-center space-y-2 max-w-2xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
              The 15-Minute Viva Voce Protocol
            </h2>
            <p className="text-sm text-slate-400">
              Rigidly partitioned timing architecture ensures identical rigor and fair baseline calibration for every student.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="premium-card p-6 space-y-4">
              <div className="flex items-center justify-between">
                <span className="px-2.5 py-1 rounded bg-sky-500/10 text-sky-400 text-xs font-mono font-bold border border-sky-500/20">
                  PHASES 01–02
                </span>
                <span className="text-xs font-mono text-slate-400 font-semibold">
                  00:00 – 05:00
                </span>
              </div>
              <h3 className="text-base font-bold text-white">
                Warm-up & Core Fundamentals
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Establishes the candidate&apos;s speech baseline and tests foundational curriculum definitions. If the student stays silent for 15s, a polite hint is provided without penalty.
              </p>
              <ul className="text-xs text-slate-400 space-y-1.5 pt-2 border-t border-slate-800">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  Baseline speech cadence & volume calibration
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  Direct syllabus definition checks
                </li>
              </ul>
            </div>

            <div className="premium-card p-6 space-y-4">
              <div className="flex items-center justify-between">
                <span className="px-2.5 py-1 rounded bg-indigo-500/10 text-indigo-400 text-xs font-mono font-bold border border-indigo-500/20">
                  PHASES 03–04
                </span>
                <span className="text-xs font-mono text-slate-400 font-semibold">
                  05:00 – 12:00
                </span>
              </div>
              <h3 className="text-base font-bold text-white">
                Deep Architecture & Problem Solving
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Evaluates architectural trade-offs, internal mechanisms, and hands-on system failure modes. Examiner probes with adaptive follow-ups based on answer strength.
              </p>
              <ul className="text-xs text-slate-400 space-y-1.5 pt-2 border-t border-slate-800">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  Dynamic follow-ups on incomplete statements
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  90-second monologue cutoff with gentle refocus
                </li>
              </ul>
            </div>

            <div className="premium-card p-6 space-y-4">
              <div className="flex items-center justify-between">
                <span className="px-2.5 py-1 rounded bg-blue-500/10 text-blue-400 text-xs font-mono font-bold border border-blue-500/20">
                  PHASES 05–06
                </span>
                <span className="text-xs font-mono text-slate-400 font-semibold">
                  12:00 – 15:00
                </span>
              </div>
              <h3 className="text-base font-bold text-white">
                Edge Cases & Multi-Rubric Scoring
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Pushes boundaries on edge cases and failure modes. Enforces strict hard stop at 15:00. Asynchronous workers calculate weighted rubric scores with verbatim turn citations.
              </p>
              <ul className="text-xs text-slate-400 space-y-1.5 pt-2 border-t border-slate-800">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  Hard stop at 15:00 · Zero overtime bias
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  Verbatim Turn ID citations attached to scores
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* 5-Dimension Competency Matrix */}
        <section className="space-y-6">
          <div className="text-center space-y-2 max-w-2xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
              The 5-Dimension Competency Rubric
            </h2>
            <p className="text-sm text-slate-400">
              Every viva score is mathematically weighted across 5 standardized competency pillars.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {[
              {
                title: 'Conceptual Depth',
                weight: '25%',
                desc: 'Precision of definitions, absence of hallucinations, mastery of underlying mechanics.',
                icon: Layers,
              },
              {
                title: 'Problem Solving',
                weight: '25%',
                desc: 'Systematic reasoning when confronted with novel architecture problems and edge bugs.',
                icon: BarChart3,
              },
              {
                title: 'Communication',
                weight: '15%',
                desc: 'Conciseness, clarity of speech, ability to articulate complex abstractions quickly.',
                icon: Mic,
              },
              {
                title: 'Trade-off Analysis',
                weight: '20%',
                desc: 'Understanding latency vs throughput, consistency vs availability, memory vs CPU.',
                icon: Scale,
              },
              {
                title: 'Edge Case Awareness',
                weight: '15%',
                desc: 'Proactive recognition of race conditions, network partitions, and data loss windows.',
                icon: Award,
              },
            ].map((rubric, idx) => (
              <div key={idx} className="premium-card p-5 space-y-3 flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="w-8 h-8 rounded-lg bg-sky-500/10 text-sky-400 flex items-center justify-center font-bold">
                    <rubric.icon className="w-4 h-4" />
                  </div>
                  <h4 className="text-sm font-bold text-white">{rubric.title}</h4>
                  <p className="text-xs text-slate-400 leading-relaxed">{rubric.desc}</p>
                </div>
                <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                  <span className="text-[11px] text-slate-500 font-medium">Rubric Weight</span>
                  <span className="text-xs font-mono font-bold text-sky-400">{rubric.weight}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 1-Click Demo Profiles Section */}
        <section className="glass-panel p-8 sm:p-10 border border-slate-800">
          <div className="max-w-3xl mx-auto text-center space-y-4 mb-8">
            <h3 className="text-2xl font-bold text-white">
              Instant 1-Click Evaluation Launchpad
            </h3>
            <p className="text-sm text-slate-400">
              Jump straight into the candidate examination room or the chief examiner review dashboard with pre-configured mock credentials.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
            {/* Student Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4 hover:border-sky-500/40 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-sky-500/20 text-sky-400 flex items-center justify-center font-bold">
                    <User className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">Candidate: Alex Chen</h4>
                    <p className="text-xs font-mono text-slate-400">ID: STU001 · Computer Science</p>
                  </div>
                </div>
                <span className="status-pill status-pill-success text-[10px]">READY</span>
              </div>
              <p className="text-xs text-slate-300">
                Experience the 3-step candidate calibration wizard, live microphone audio test, and 15-minute voice viva chamber with examiner speech synthesis.
              </p>
              <button
                onClick={() => launchDemo('student')}
                className="w-full btn-primary text-xs py-2.5 font-semibold"
              >
                Launch Candidate Terminal (Alex Chen)
              </button>
            </div>

            {/* Faculty Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4 hover:border-indigo-500/40 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">Chief Examiner: Dr. Priya Sharma</h4>
                    <p className="text-xs text-slate-400">Department of Computer Science</p>
                  </div>
                </div>
                <span className="status-pill status-pill-neutral text-[10px]">FACULTY</span>
              </div>
              <p className="text-xs text-slate-300">
                Access the Assessment Registry, view candidate dossiers with interactive 5-dimension radar charts, audio transcript scrubbers, and mark override terminal.
              </p>
              <button
                onClick={() => launchDemo('faculty')}
                className="w-full btn-secondary text-xs py-2.5 font-semibold text-white bg-indigo-600 hover:bg-indigo-500 border-indigo-500/30"
              >
                Open Faculty Dashboard (Dr. Priya Sharma)
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-950 py-8 px-4 text-center text-xs text-slate-400">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-300">VivaAI</span>
            <span>· Standardized Autonomous Oral Examination System</span>
          </div>
          <div className="flex items-center gap-6">
            <Link href="/interview" className="hover:text-slate-200">Exam Room</Link>
            <Link href="/dashboard" className="hover:text-slate-200">Registry</Link>
            <Link href="/login" className="hover:text-slate-200">Auth Portal</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
