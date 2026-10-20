'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store';
import { useTheme } from '@/components/providers/ThemeProvider';
import { AcousticVisualizer } from '@/components/canvas/AcousticVisualizer';
import { getFacultyPortalUrl } from '@/lib/utils';
import {
  ArrowRight,
  ShieldCheck,
  Mic,
  Clock,
  CheckCircle2,
  Volume2,
  FileCheck,
  ExternalLink,
  Sparkles,
} from 'lucide-react';

const EXAMINATION_STAGES = [
  {
    num: '01',
    time: '0:00 – 1:00',
    title: 'Candidate Calibration',
    summary: 'Hardware confirmation, pace calibration, and candidate background confirmation.',
    rule: 'Non-scored phase. Establishes speech clarity baseline.',
  },
  {
    num: '02',
    time: '1:00 – 5:00',
    title: 'Core Fundamentals',
    summary: 'Direct definitions, invariant principles, and core theoretical foundations from syllabus.',
    rule: 'Partial answers receive 1 guiding hint; advances cleanly when answered.',
  },
  {
    num: '03',
    time: '5:00 – 10:00',
    title: 'Architectural Depth',
    summary: 'Internal mechanisms, failure modes, caching behaviors, and trade-off rationales.',
    rule: 'Adaptive depth: strong answers trigger higher-tier probing questions.',
  },
  {
    num: '04',
    time: '10:00 – 13:00',
    title: 'Applied Problem Scenario',
    summary: 'Real-world system debugging, distributed race conditions, or architecture design.',
    rule: 'Evaluates practical engineering reasoning under realistic constraints.',
  },
  {
    num: '05',
    time: '13:00 – 14:30',
    title: 'Candidate Synthesis',
    summary: 'Student summarizes key trade-offs and provides closing technical reflections.',
    rule: 'Measures synthesis, clarity of thought, and technical communication.',
  },
  {
    num: '06',
    time: '14:30 – 15:00',
    title: 'Scoring & Audit Lock',
    summary: 'Strict 15-minute hard stop. Generates 5-dimension rubric marks with turn citations.',
    rule: 'Session permanently sealed; ready for immediate faculty review.',
  },
];

export default function HomePage() {
  const router = useRouter();
  const { isAuthenticated, user } = useAuthStore();
  const { theme } = useTheme();
  const facultyPortalUrl = getFacultyPortalUrl();

  const [activeStage, setActiveStage] = useState(1);
  const [demoState, setDemoState] = useState<'idle' | 'speaking' | 'listening' | 'thinking'>('speaking');
  const [demoAudioLevel, setDemoAudioLevel] = useState(0.5);

  const launchDemo = (role: 'student' | 'faculty') => {
    if (role === 'student') {
      router.push(isAuthenticated && user?.role === 'student' ? '/interview' : '/login');
    } else {
      // Cross-origin portal handoff; the destination requires its own sign-in.
      window.location.assign(facultyPortalUrl);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-[var(--bg-page)] text-[var(--text-primary)] transition-colors">
      {/* Editorial Hero Section */}
      <section className="border-b border-[var(--border-default)] bg-[var(--bg-card)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-20">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
            {/* Left Column: Clear Purpose & Quick Actions */}
            <div className="lg:col-span-7 space-y-6">
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded bg-[var(--bg-muted)] border border-[var(--border-default)] text-xs text-[var(--text-secondary)] font-mono">
                <span className="w-2 h-2 rounded-full bg-emerald-600 dark:bg-teal-400" />
                <span>ONLINE ORAL EXAM PORTAL</span>
              </div>

              <div className="space-y-4">
                <h1 className="font-editorial text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-[var(--text-primary)] leading-[1.12]">
                  Standardized technical viva examinations, conducted by voice.
                </h1>
                <p className="text-base sm:text-lg text-[var(--text-secondary)] leading-relaxed max-w-2xl">
                  VivaAI makes oral exams simple and fair for university courses.
                  Students speak their answers naturally; teachers review full transcripts, audio, and grades.
                </p>
              </div>

              {/* Distinct Plain-Language Role Gateways */}
              <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <button
                  onClick={() => launchDemo('student')}
                  className="btn-primary text-sm px-6 font-semibold flex items-center justify-center gap-2"
                >
                  <Mic className="w-4 h-4" />
                  <span>Start Student Viva</span>
                  <ArrowRight className="w-4 h-4 ml-1" />
                </button>

                <button
                  onClick={() => launchDemo('faculty')}
                  className="btn-secondary text-sm px-6 font-semibold flex items-center justify-center gap-2"
                >
                  <ShieldCheck className="w-4 h-4 text-emerald-800 dark:text-teal-400" />
                  <span>Faculty & Teacher Portal</span>
                </button>

                <Link
                  href="/login"
                  className="btn-ghost text-xs text-[var(--text-secondary)] text-center sm:text-left py-2 px-3"
                >
                  Sign in with University ID
                </Link>
              </div>

              {/* Institutional Assurances Strip */}
              <div className="pt-6 border-t border-[var(--border-subtle)] grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs text-[var(--text-secondary)]">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-emerald-700 dark:text-teal-400 shrink-0" />
                  <span>Timed sessions</span>
                </div>
                <div className="flex items-center gap-2">
                  <Volume2 className="w-4 h-4 text-emerald-700 dark:text-teal-400 shrink-0" />
                  <span>Spoken conversation</span>
                </div>
                <div className="flex items-center gap-2">
                  <FileCheck className="w-4 h-4 text-emerald-700 dark:text-teal-400 shrink-0" />
                  <span>Recorded answers</span>
                </div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-700 dark:text-teal-400 shrink-0" />
                  <span>Teacher score review</span>
                </div>
              </div>
            </div>

            {/* Right Column: Live Voice Activity Preview */}
            <div className="lg:col-span-5 flex flex-col items-center">
              <div className="academic-dossier w-full p-6 space-y-4">
                <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-600 dark:bg-teal-400 animate-pulse" />
                    <span className="font-mono text-xs font-semibold text-[var(--text-primary)]">
                      LIVE VOICE STATUS
                    </span>
                  </div>
                  <span className="font-mono text-[11px] text-[var(--text-muted)]">
                    AUDIO PREVIEW
                  </span>
                </div>

                {/* 3D Voice Display Canvas */}
                <div className="flex flex-col items-center justify-center py-2 relative min-h-[290px]">
                  <AcousticVisualizer
                    state={demoState}
                    audioLevel={demoAudioLevel}
                    size={270}
                    theme={theme}
                  />
                  <div className="mt-2 text-center">
                    <span className="inline-block px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-[var(--accent-subtle)] text-[var(--primary)] border border-[var(--border-default)]">
                      Status: {demoState.toUpperCase()} • Mic level: {Math.round(demoAudioLevel * 100)}%
                    </span>
                  </div>
                </div>

                {/* Interactive Controls to Test Voice States */}
                <div className="pt-3 border-t border-[var(--border-subtle)] space-y-3">
                  <div className="text-[11px] text-[var(--text-muted)] flex items-center justify-between">
                    <span>Try microphone states:</span>
                    <span className="font-mono text-[10px]">Click to test</span>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {(['idle', 'speaking', 'listening', 'thinking'] as const).map((st) => (
                      <button
                        key={st}
                        type="button"
                        aria-pressed={demoState === st}
                        onClick={() => {
                          setDemoState(st);
                          if (st === 'listening') setDemoAudioLevel(0.75);
                          else if (st === 'speaking') setDemoAudioLevel(0.6);
                          else setDemoAudioLevel(0.2);
                        }}
                        className={`py-1.5 px-2 rounded text-[11px] font-medium font-mono capitalize transition-all min-h-[38px] ${
                          demoState === st
                            ? 'bg-[var(--primary)] text-[var(--primary-fg)] font-semibold shadow-xs'
                            : 'bg-[var(--bg-muted)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] border border-[var(--border-subtle)]'
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Structured Examination Protocol Ribbon (Replacing 6-card grid!) */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 lg:py-20 w-full space-y-8">
        <div className="max-w-2xl space-y-2">
          <span className="text-xs font-mono font-semibold text-[var(--primary)] uppercase tracking-wider">
            Assessment format
          </span>
          <h2 className="font-editorial text-2xl sm:text-3xl font-bold text-[var(--text-primary)]">
            Six stages in this example 15-minute assessment.
          </h2>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
            Review the assessment stages and timing shown for this example before beginning a viva.
          </p>
        </div>

        {/* Cohesive Stepped Ledger Ribbon */}
        <div className="academic-dossier overflow-hidden">
          {/* Horizontal Stage Selector on Large Screens / Stacked on Mobile */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 border-b border-[var(--border-default)] divide-x divide-[var(--border-subtle)] bg-[var(--bg-muted)]">
            {EXAMINATION_STAGES.map((stage, idx) => (
              <button
                key={stage.num}
                type="button"
                aria-pressed={activeStage === idx}
                onClick={() => setActiveStage(idx)}
                className={`p-3.5 text-left transition-colors min-h-[64px] flex flex-col justify-between ${
                  activeStage === idx
                    ? 'bg-[var(--bg-card)] border-b-2 border-b-[var(--primary)]'
                    : 'hover:bg-[var(--bg-card-hover)]'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="font-mono text-xs font-bold text-[var(--primary)]">
                    {stage.num}
                  </span>
                  <span className="text-[10px] font-mono text-[var(--text-muted)]">
                    {stage.time}
                  </span>
                </div>
                <div className="text-xs font-semibold text-[var(--text-primary)] truncate mt-1">
                  {stage.title}
                </div>
              </button>
            ))}
          </div>

          {/* Active Stage Detailed Ledger */}
          <div className="p-6 sm:p-8 bg-[var(--bg-card)] space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-4">
              <div>
                <span className="font-mono text-xs text-[var(--text-muted)]">
                  PHASE {EXAMINATION_STAGES[activeStage].num} DETAILS • {EXAMINATION_STAGES[activeStage].time}
                </span>
                <h3 className="font-editorial text-xl font-bold text-[var(--text-primary)] mt-0.5">
                  {EXAMINATION_STAGES[activeStage].title}
                </h3>
              </div>
              <span className="self-start sm:self-auto px-2.5 py-1 rounded text-xs font-mono font-medium bg-[var(--bg-muted)] text-[var(--text-secondary)] border border-[var(--border-default)]">
                Assessment stage
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-1 text-sm">
              <div className="space-y-1.5">
                <span className="font-semibold text-xs text-[var(--text-secondary)] uppercase tracking-wider block">
                  What You Will Do
                </span>
                <p className="text-[var(--text-primary)] leading-relaxed">
                  {EXAMINATION_STAGES[activeStage].summary}
                </p>
              </div>

              <div className="space-y-1.5">
                <span className="font-semibold text-xs text-[var(--text-secondary)] uppercase tracking-wider block">
                  How the Examiner Guides You
                </span>
                <p className="text-[var(--text-secondary)] leading-relaxed flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-teal-400 shrink-0 mt-0.5" />
                  <span>{EXAMINATION_STAGES[activeStage].rule}</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Clear Purpose: Student Simplicity & Faculty Tools */}
      <section className="border-t border-b border-[var(--border-default)] bg-[var(--bg-card)] py-14 lg:py-20 transition-colors">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
          <div className="max-w-2xl space-y-2">
            <span className="text-xs font-mono font-semibold text-[var(--primary)] uppercase tracking-wider inline-flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              Simple & Fair
            </span>
            <h2 className="font-editorial text-2xl sm:text-3xl lg:text-4xl font-bold text-[var(--text-primary)] tracking-tight">
              Designed for students and instructors.
            </h2>
            <p className="text-sm sm:text-base text-[var(--text-secondary)] leading-relaxed">
              Oral exams made easy: a calm, quiet testing room for the student,
              and clear transcripts, audio recordings, and grading tools for the instructor.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-stretch">
            {/* Candidate Experience Card */}
            <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 sm:p-8 flex flex-col justify-between h-full shadow-sm hover:border-[var(--primary)]/40 hover:shadow-md transition-all relative overflow-hidden group">
              {/* Subtle ambient corner glow */}
              <div className="pointer-events-none absolute -right-12 -top-12 h-36 w-36 rounded-full bg-teal-500/10 blur-2xl" />

              <div>
                <div className="flex items-center gap-3.5 border-b border-[var(--border-subtle)] pb-4">
                  <div className="w-10 h-10 rounded-xl bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20 flex items-center justify-center font-bold shrink-0">
                    <Mic className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-editorial text-xl font-bold text-[var(--text-primary)]">
                      For Students
                    </h3>
                    <span className="text-xs text-[var(--text-muted)]">Calm, clear, and distraction-free</span>
                  </div>
                </div>

                {/* 3 Matched Feature Cardlets */}
                <div className="space-y-3.5 my-6">
                  <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-muted)]/30 p-4 transition-colors hover:border-[var(--border-default)] hover:bg-[var(--bg-muted)]/50">
                    <div className="flex items-center gap-2.5 mb-1.5">
                      <span className="font-mono text-[11px] font-bold text-teal-600 dark:text-teal-400 bg-teal-500/10 px-1.5 py-0.5 rounded border border-teal-500/20">
                        01
                      </span>
                      <h4 className="text-xs sm:text-sm font-bold text-[var(--text-primary)]">
                        Pre-Flight Audio Check
                      </h4>
                    </div>
                    <p className="text-xs text-[var(--text-secondary)] leading-relaxed pl-7">
                      Fast microphone calibration, sound test, and simple hardware readiness check before you begin.
                    </p>
                  </div>

                  <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-muted)]/30 p-4 transition-colors hover:border-[var(--border-default)] hover:bg-[var(--bg-muted)]/50">
                    <div className="flex items-center gap-2.5 mb-1.5">
                      <span className="font-mono text-[11px] font-bold text-teal-600 dark:text-teal-400 bg-teal-500/10 px-1.5 py-0.5 rounded border border-teal-500/20">
                        02
                      </span>
                      <h4 className="text-xs sm:text-sm font-bold text-[var(--text-primary)]">
                        Clean Voice Exam Room
                      </h4>
                    </div>
                    <p className="text-xs text-[var(--text-secondary)] leading-relaxed pl-7">
                      Natural conversation with a clear voice display, optional live captions, and an on-screen pace timer.
                    </p>
                  </div>

                  <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-muted)]/30 p-4 transition-colors hover:border-[var(--border-default)] hover:bg-[var(--bg-muted)]/50">
                    <div className="flex items-center gap-2.5 mb-1.5">
                      <span className="font-mono text-[11px] font-bold text-teal-600 dark:text-teal-400 bg-teal-500/10 px-1.5 py-0.5 rounded border border-teal-500/20">
                        03
                      </span>
                      <h4 className="text-xs sm:text-sm font-bold text-[var(--text-primary)]">
                        Multi-Rubric Evaluation
                      </h4>
                    </div>
                    <p className="text-xs text-[var(--text-secondary)] leading-relaxed pl-7">
                      Objective feedback breakdown across Core Knowledge, Technical Depth, Reasoning, and Oral Delivery.
                    </p>
                  </div>
                </div>
              </div>

              {/* Action CTA Button */}
              <div className="pt-2">
                <button
                  onClick={() => launchDemo('student')}
                  className="btn-primary w-full text-xs font-semibold justify-center py-2.5 gap-2 shadow-sm"
                >
                  <span>Open Student Portal</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Faculty & Instructor Card */}
            <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 sm:p-8 flex flex-col justify-between h-full shadow-sm hover:border-[var(--primary)]/40 hover:shadow-md transition-all relative overflow-hidden group">
              {/* Subtle ambient corner glow */}
              <div className="pointer-events-none absolute -right-12 -top-12 h-36 w-36 rounded-full bg-indigo-500/10 blur-2xl" />

              <div>
                <div className="flex items-center gap-3.5 border-b border-[var(--border-subtle)] pb-4">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 flex items-center justify-center font-bold shrink-0">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-editorial text-xl font-bold text-[var(--text-primary)]">
                      For Instructors & Faculty
                    </h3>
                    <span className="text-xs text-[var(--text-muted)]">Grading, audio reviews, and course tools</span>
                  </div>
                </div>

                {/* 3 Matched Feature Cardlets */}
                <div className="space-y-3.5 my-6">
                  <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-muted)]/30 p-4 transition-colors hover:border-[var(--border-default)] hover:bg-[var(--bg-muted)]/50">
                    <div className="flex items-center gap-2.5 mb-1.5">
                      <span className="font-mono text-[11px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20">
                        01
                      </span>
                      <h4 className="text-xs sm:text-sm font-bold text-[var(--text-primary)]">
                        Streamlined Exam Setup
                      </h4>
                    </div>
                    <p className="text-xs text-[var(--text-secondary)] leading-relaxed pl-7">
                      Define course topics, choose question pools, set adaptive difficulty profiles, and adjust grading criteria.
                    </p>
                  </div>

                  <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-muted)]/30 p-4 transition-colors hover:border-[var(--border-default)] hover:bg-[var(--bg-muted)]/50">
                    <div className="flex items-center gap-2.5 mb-1.5">
                      <span className="font-mono text-[11px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20">
                        02
                      </span>
                      <h4 className="text-xs sm:text-sm font-bold text-[var(--text-primary)]">
                        Listen to Recorded Answers
                      </h4>
                    </div>
                    <p className="text-xs text-[var(--text-secondary)] leading-relaxed pl-7">
                      Review word-level transcripts and listen to synchronized audio waveforms for any candidate response.
                    </p>
                  </div>

                  <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-muted)]/30 p-4 transition-colors hover:border-[var(--border-default)] hover:bg-[var(--bg-muted)]/50">
                    <div className="flex items-center gap-2.5 mb-1.5">
                      <span className="font-mono text-[11px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20">
                        03
                      </span>
                      <h4 className="text-xs sm:text-sm font-bold text-[var(--text-primary)]">
                        Evidence-Based Adjustments
                      </h4>
                    </div>
                    <p className="text-xs text-[var(--text-secondary)] leading-relaxed pl-7">
                      Validate AI rubric suggestions and adjust any score with faculty audit notes, citations, and gradebook export.
                    </p>
                  </div>
                </div>
              </div>

              {/* Action CTA Button */}
              <div className="pt-2">
                <button
                  onClick={() => launchDemo('faculty')}
                  className="btn-secondary w-full text-xs font-semibold justify-center py-2.5 gap-2 border border-[var(--border-default)] hover:border-[var(--primary)]/40 shadow-sm"
                >
                  <span>Open Faculty Portal</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Example Academic Module */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 lg:py-20 w-full">
        <div className="academic-dossier p-6 sm:p-8 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--border-subtle)] pb-5">
            <div>
              <span className="text-xs font-mono text-[var(--primary)] uppercase tracking-wider">
                Example module
              </span>
              <h2 className="font-editorial text-2xl font-bold text-[var(--text-primary)] mt-1">
                Distributed Systems & Database Internals
              </h2>
            </div>
            <span className="self-start sm:self-auto px-3 py-1 rounded text-xs font-mono font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-800">
              Illustrative content
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div>
              <span className="text-[var(--text-muted)] block">Format</span>
              <span className="font-semibold text-[var(--text-primary)]">15-Minute Spoken Viva</span>
            </div>
            <div>
              <span className="text-[var(--text-muted)] block">Cohort Level</span>
              <span className="font-semibold text-[var(--text-primary)]">Example topics</span>
            </div>
            <div>
              <span className="text-[var(--text-muted)] block">Grading Standard</span>
              <span className="font-semibold text-[var(--text-primary)]">Faculty-configured rubric</span>
            </div>
            <div>
              <span className="text-[var(--text-muted)] block">Examiner Voice</span>
              <span className="font-semibold text-[var(--text-primary)]">Browser audio output</span>
            </div>
          </div>

          <div className="text-xs space-y-2 bg-[var(--bg-muted)] p-4 rounded border border-[var(--border-default)]">
            <span className="font-semibold text-[var(--text-primary)] block">Syllabus Scope Under Assessment:</span>
            <p className="text-[var(--text-secondary)] font-mono text-[11px] leading-relaxed">
              Raft Consensus protocol (leader election, log replication, commit safety), Write-Ahead Logging (WAL) internals, Two-Phase Commit (2PC), Multi-Version Concurrency Control (MVCC), and distributed network partition handling.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
            <p className="text-xs text-[var(--text-muted)]">
              This example is for preview only. Your scheduled exams appear after you sign in.
            </p>
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <a href={facultyPortalUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary text-xs flex-1 sm:flex-initial">
                Faculty portal
              </a>
              <button
                onClick={() => launchDemo('student')}
                className="btn-primary text-xs flex-1 sm:flex-initial"
              >
                Start Viva Exam
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Academic Footer */}
      <footer className="border-t border-[var(--border-default)] bg-[var(--bg-card)] mt-auto py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[var(--text-muted)]">
          <div className="flex items-center gap-2">
            <span className="font-editorial font-bold text-sm text-[var(--text-primary)]">VivaAI</span>
            <span>— University Oral Examination Platform</span>
          </div>
          <div>
            A focused workspace for voice-based assessment and faculty review.
          </div>
        </div>
      </footer>
    </div>
  );
}
