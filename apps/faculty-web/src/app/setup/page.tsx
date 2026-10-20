'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  XCircle,
  Trash2,
  Save,
  Check,
  Plus,
  Sparkles,
  AlertCircle,
  FileText,
  Play,
  Square,
} from 'lucide-react';
import { useAuthStore } from '@/store';
import { configsApi } from '@/lib/api';
import { getStudentPortalUrl } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';
import { useToast } from '@/components/providers/ToastProvider';
import { EXAMINER_VOICES, voiceEngine } from '@/lib/speech';

interface QuestionItem {
  id: string;
  text: string;
  phase: string;
  topic: string;
  difficulty: string;
  status: 'pending' | 'approved' | 'rejected';
}

export default function FacultySetupPage() {
  const router = useRouter();
  const { user, isAuthenticated, hasHydrated } = useAuthStore();
  const { showToast } = useToast();

  useEffect(() => {
    if (!hasHydrated) return;
    if (!isAuthenticated) {
      router.replace('/login');
    } else if (user?.role !== 'faculty') {
      window.location.assign(`${getStudentPortalUrl()}/login`);
    }
  }, [hasHydrated, isAuthenticated, user?.role, router]);

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Step 1: Viva metadata
  const [title, setTitle] = useState<string>('');
  const [courseCode, setCourseCode] = useState<string>('');
  const [subject, setSubject] = useState<string>('');
  const [difficulty, setDifficulty] = useState<string>('medium');
  const [totalMinutes, setTotalMinutes] = useState<number>(15);
  const [examinerVoice, setExaminerVoice] = useState<string>('alice');
  const [previewPlayingVoice, setPreviewPlayingVoice] = useState<string | null>(null);

  // Step 2 & 3: Questions & Syllabus
  const [syllabusText, setSyllabusText] = useState<string>('');
  const [isGeneratingQuestions, setIsGeneratingQuestions] = useState<boolean>(false);
  const [newQuestionText, setNewQuestionText] = useState<string>('');
  const [newQuestionPhase, setNewQuestionPhase] = useState<string>('fundamentals');
  const [questions, setQuestions] = useState<QuestionItem[]>([]);

  const handleLoadCurriculumTemplate = () => {
    setTitle('Operating Systems & Concurrency Viva');
    setCourseCode('CS302');
    setSubject('Computer Science & Engineering');
    setSyllabusText(
      'Unit 1: Process management, CPU scheduling algorithms, mutexes and semaphores.\nUnit 2: Deadlocks, Coffman conditions, Banker algorithm.\nUnit 3: Virtual memory, page replacement algorithms (LRU, FIFO).'
    );
    setQuestions([
      {
        id: 'tmpl-1',
        text: 'What are the four necessary Coffman conditions for a deadlock to occur in an operating system?',
        phase: 'fundamentals',
        topic: 'Deadlocks',
        difficulty: 'medium',
        status: 'approved',
      },
      {
        id: 'tmpl-2',
        text: 'Explain the working of Dijkstra’s Banker’s Algorithm for deadlock avoidance.',
        phase: 'depth',
        topic: 'Deadlocks',
        difficulty: 'hard',
        status: 'approved',
      },
      {
        id: 'tmpl-3',
        text: 'Compare counting semaphores with binary semaphores in concurrent programming.',
        phase: 'fundamentals',
        topic: 'Synchronization',
        difficulty: 'medium',
        status: 'approved',
      },
      {
        id: 'tmpl-4',
        text: 'How does the translation lookaside buffer (TLB) accelerate virtual-to-physical address translation?',
        phase: 'applied',
        topic: 'Virtual Memory',
        difficulty: 'hard',
        status: 'approved',
      },
    ]);
    showToast('Operating Systems starter curriculum template loaded.', 'info');
  };

  // Step 4: Rubric Weights
  const [rubricWeights, setRubricWeights] = useState({
    conceptual: 30,
    depth_reasoning: 25,
    problem_solving: 20,
    practical_project: 15,
    communication: 10,
  });

  const totalWeight = Object.values(rubricWeights).reduce((a, b) => a + b, 0);

  const handleGenerateQuestions = async () => {
    if (!syllabusText.trim()) {
      showToast('Please enter syllabus units, topics, or course outline first.', 'warning');
      return;
    }
    setIsGeneratingQuestions(true);
    showToast('Generating viva questions from syllabus using Groq AI...', 'info');

    try {
      const res = await configsApi.generatePreviewQuestions({
        syllabus: syllabusText,
        subject: subject || courseCode || title || 'Computer Science',
        difficulty: difficulty.toLowerCase(),
        count: 6,
      });

      const generated = res.data?.questions || [];
      if (generated.length > 0) {
        setQuestions((prev) => {
          const existingTexts = new Set(prev.map((q) => q.text.toLowerCase()));
          const newItems = generated.filter((g) => !existingTexts.has(g.text.toLowerCase()));
          return [...prev, ...newItems];
        });
        showToast(`Generated ${generated.length} viva questions across syllabus phases!`, 'success');
        setStep(3);
      } else {
        showToast('No questions were generated. Please check your syllabus input.', 'warning');
      }
    } catch (err: unknown) {
      console.error('Error generating questions:', err);
      showToast('Could not generate questions via AI. Please check your backend connection.', 'error');
    } finally {
      setIsGeneratingQuestions(false);
    }
  };

  const handleAddCustomQuestion = () => {
    if (!newQuestionText.trim()) return;
    const newItem: QuestionItem = {
      id: `custom-${Date.now()}`,
      text: newQuestionText.trim(),
      phase: newQuestionPhase,
      topic: 'General',
      difficulty: 'medium',
      status: 'approved',
    };
    setQuestions((prev) => [...prev, newItem]);
    setNewQuestionText('');
    showToast('Custom examination question added.', 'success');
  };

  const handleUpdateStatus = (id: string, newStatus: 'approved' | 'rejected') => {
    setQuestions((prev) =>
      prev.map((q) => (q.id === id ? { ...q, status: newStatus } : q))
    );
  };

  const handleDeleteQuestion = (id: string) => {
    setQuestions((prev) => prev.filter((q) => q.id !== id));
  };

  const handlePublish = async () => {
    if (totalWeight !== 100) {
      showToast('Rubric weights must total exactly 100% before publishing.', 'warning');
      return;
    }

    setIsSubmitting(true);
    try {
      const approvedQuestions = questions.filter((q) => q.status === 'approved');
      await configsApi.create({
        title,
        subject: subject || courseCode,
        topics: syllabusText.split('\n').filter(Boolean),
        difficulty: difficulty.toLowerCase(),
        total_duration_secs: totalMinutes * 60,
        rubric_weights: rubricWeights,
        questions: approvedQuestions,
      });
      showToast('Viva examination successfully configured and published to cohort!', 'success');
      router.push('/dashboard');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Could not save the viva configuration. Check your connection and try again.';
      showToast(message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const stepTitles = [
    'Exam Details',
    'Syllabus Topics',
    'Review Questions',
    'Grading Rubric',
  ];

  if (!hasHydrated || !isAuthenticated || user?.role !== 'faculty') {
    return (
      <div className="min-h-screen bg-[var(--bg-canvas)] p-8 flex items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-[var(--text-muted)]">
          <div className="w-4 h-4 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
          <span>Authenticating faculty access...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-[var(--bg-page)] text-[var(--text-primary)] py-8 sm:py-10 px-4 sm:px-6 lg:px-8 transition-colors">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Top Header */}
        <div className="border-b border-[var(--border-default)] pb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="space-y-1.5">
            <Link
              href="/dashboard"
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] flex items-center gap-1.5 min-h-[36px]"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Return to Assessment Registry</span>
            </Link>
            <h1 className="font-editorial text-2xl sm:text-4xl font-bold tracking-tight text-[var(--text-primary)]">
              Create & Configure Viva Exam
            </h1>
            <p className="text-xs sm:text-sm text-[var(--text-secondary)]">
              Set exam details, add syllabus topics, approve questions, and choose grading criteria.
            </p>
          </div>
        </div>

        {/* 4-Step Progress Stepper */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[1, 2, 3, 4].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStep(s as 1 | 2 | 3 | 4)}
              className={`p-3 rounded border text-left transition-all min-h-[56px] flex flex-col justify-between ${
                step === s
                  ? 'border-[var(--primary)] bg-[var(--accent-subtle)] ring-1 ring-[var(--primary)]/20'
                  : step > s
                  ? 'border-[var(--border-default)] bg-[var(--bg-card)]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-muted)] opacity-60'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-xs font-bold text-[var(--primary)]">
                  STEP {s}
                </span>
                {step > s && <Check className="w-3.5 h-3.5 text-emerald-700 dark:text-teal-400" />}
              </div>
              <span className="text-xs font-semibold text-[var(--text-primary)] block truncate">
                {stepTitles[s - 1]}
              </span>
            </button>
          ))}
        </div>

        {/* ── STEP 1: Examination Metadata ──────────────── */}
        {step === 1 && (
          <div className="academic-dossier p-6 space-y-6">
            <div className="border-b border-[var(--border-subtle)] pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="font-editorial text-xl font-bold text-[var(--text-primary)]">
                  1. Basic Exam Information
                </h2>
                <p className="text-xs text-[var(--text-secondary)] mt-1">
                  Enter the course code, exam title, difficulty level, and total duration.
                </p>
              </div>
              <button
                type="button"
                onClick={handleLoadCurriculumTemplate}
                className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5 self-start sm:self-auto border border-teal-500/30 text-teal-400 hover:bg-teal-500/10"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Load Sample Curriculum</span>
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="setup-course-code" className="text-xs font-semibold text-[var(--text-secondary)] block mb-1">
                    Course Code
                  </label>
                  <input
                    id="setup-course-code"
                    name="courseCode"
                    type="text"
                    value={courseCode}
                    onChange={(e) => setCourseCode(e.target.value)}
                    placeholder="e.g. CS302"
                    className="form-input font-mono uppercase text-xs"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="setup-subject" className="text-xs font-semibold text-[var(--text-secondary)] block mb-1">
                    Academic Subject / Department
                  </label>
                  <input
                    id="setup-subject"
                    name="subject"
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="e.g. Computer Science & Engineering"
                    className="form-input text-xs"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="setup-title" className="text-xs font-semibold text-[var(--text-secondary)] block mb-1">
                  Examination Title
                </label>
                <input
                  id="setup-title"
                  name="title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Operating Systems & Concurrency Technical Viva"
                  className="form-input text-xs"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="setup-difficulty" className="text-xs font-semibold text-[var(--text-secondary)] block mb-1">
                    Difficulty Profile
                  </label>
                  <select
                    id="setup-difficulty"
                    name="difficulty"
                    value={difficulty}
                    onChange={(e) => setDifficulty(e.target.value)}
                    className="form-select text-xs"
                  >
                    <option value="easy">Introductory Undergraduate</option>
                    <option value="medium">Intermediate Senior</option>
                    <option value="hard">Advanced Honors / Masters</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="setup-duration" className="text-xs font-semibold text-[var(--text-secondary)] block mb-1">
                    Allocated Duration
                  </label>
                  <select
                    id="setup-duration"
                    name="duration"
                    value={totalMinutes}
                    onChange={(e) => setTotalMinutes(Number(e.target.value))}
                    className="form-select text-xs"
                  >
                    <option value={10}>10 minutes (Quick assessment)</option>
                    <option value={15}>15 minutes (Standard viva format)</option>
                    <option value={20}>20 minutes (In-depth assessment)</option>
                    <option value={30}>30 minutes (Comprehensive exam)</option>
                  </select>
                </div>
              </div>

              {/* AI Examiner Vocal Persona (ElevenLabs) */}
              <div className="pt-2 border-t border-[var(--border-subtle)]/70">
                <div className="flex items-center justify-between mb-2.5">
                  <div>
                    <label className="text-xs font-semibold text-[var(--text-secondary)] block">
                      AI Examiner Vocal Persona (ElevenLabs)
                    </label>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      Select the vocal delivery and tone for this exam. Candidates can also calibrate their preferred persona.
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-[10px] font-mono font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/25">
                    <Sparkles className="w-3 h-3 text-amber-500" />
                    ElevenLabs Neural Speech
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {EXAMINER_VOICES.map((v) => {
                    const isSelected = examinerVoice === v.id;
                    const isPlaying = previewPlayingVoice === v.id;
                    return (
                      <div
                        key={v.id}
                        onClick={() => {
                          setExaminerVoice(v.id);
                          voiceEngine?.setVoice(v.id);
                        }}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                          isSelected
                            ? 'border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500/25 shadow-xs'
                            : 'border-[var(--border-subtle)] bg-[var(--bg-card)] hover:border-emerald-500/30 hover:bg-[var(--bg-muted)]/50'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-semibold text-xs text-[var(--text-primary)] flex items-center gap-1">
                              {v.name}
                              {isSelected && <Check className="w-3 h-3 text-emerald-500 stroke-[3]" />}
                            </span>
                            <span className="text-[9px] font-mono text-[var(--text-muted)]">{v.accent.split('/')[0].trim()}</span>
                          </div>
                          <p className="text-[11px] text-[var(--text-secondary)] line-clamp-1">{v.tagline}</p>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isPlaying) {
                              voiceEngine?.stop();
                              setPreviewPlayingVoice(null);
                            } else {
                              voiceEngine?.stop();
                              setPreviewPlayingVoice(v.id);
                              voiceEngine?.setVoice(v.id);
                              voiceEngine?.speak(v.previewSample, {
                                onEnd: () => setPreviewPlayingVoice(null),
                                onError: () => setPreviewPlayingVoice(null),
                              });
                            }
                          }}
                          className={`mt-2.5 pt-2 border-t border-[var(--border-subtle)] text-[10px] font-medium flex items-center gap-1 cursor-pointer transition-colors ${
                            isPlaying
                              ? 'text-amber-600 dark:text-amber-400 font-semibold'
                              : 'text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300'
                          }`}
                        >
                          {isPlaying ? <Square className="w-2.5 h-2.5 fill-current" /> : <Play className="w-2.5 h-2.5 fill-current" />}
                          <span>{isPlaying ? 'Stop' : 'Listen Preview'}</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-[var(--border-subtle)] flex items-center justify-between">
              <span className="text-xs text-[var(--text-muted)]">
                Next: Enter syllabus topics for question generation.
              </span>
              <button
                type="button"
                onClick={() => setStep(2)}
                className="btn-primary text-xs px-5"
              >
                <span>Next: Add Syllabus</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 2: Syllabus Input & Question Generation ── */}
        {step === 2 && (
          <div className="academic-dossier p-6 space-y-6">
            <div className="border-b border-[var(--border-subtle)] pb-4">
              <h2 className="font-editorial text-xl font-bold text-[var(--text-primary)]">
                2. Course Syllabus & Questions
              </h2>
              <p className="text-xs text-[var(--text-secondary)] mt-1">
                Paste your course syllabus or key topics below. VivaAI will suggest questions based on these topics.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label htmlFor="setup-syllabus" className="text-xs font-semibold text-[var(--text-secondary)] block mb-1">
                  Syllabus Units & Topics
                </label>
                <textarea
                  id="setup-syllabus"
                  name="syllabus"
                  rows={6}
                  value={syllabusText}
                  onChange={(e) => setSyllabusText(e.target.value)}
                  placeholder="Enter curriculum units or learning outcomes..."
                  className="form-textarea font-mono text-xs leading-relaxed"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded bg-[var(--bg-muted)] border border-[var(--border-default)]">
                <div className="space-y-0.5">
                  <span className="text-xs font-semibold text-[var(--text-primary)] block">
                    Generate Questions from Syllabus
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">
                    Creates questions covering basics, in-depth concepts, and practical scenarios.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleGenerateQuestions}
                  disabled={isGeneratingQuestions}
                  className="btn-secondary text-xs px-3.5 flex items-center gap-2"
                >
                  <Sparkles className="w-3.5 h-3.5 text-emerald-700 dark:text-teal-400" />
                  <span>{isGeneratingQuestions ? 'Generating Questions...' : 'Generate Questions'}</span>
                </button>
              </div>
            </div>

            <div className="pt-4 border-t border-[var(--border-subtle)] flex items-center justify-between">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="btn-outline text-xs px-4"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back</span>
              </button>
              <button
                type="button"
                onClick={() => setStep(3)}
                className="btn-primary text-xs px-5"
              >
                <span>Review Questions ({questions.length})</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3: Question Review Ledger ─────────────── */}
        {step === 3 && (
          <div className="academic-dossier p-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-4">
              <div>
                <h2 className="font-editorial text-xl font-bold text-[var(--text-primary)]">
                  3. Review & Approve Questions ({questions.length} Items)
                </h2>
                <p className="text-xs text-[var(--text-secondary)] mt-1">
                  Review, approve, or remove questions for this exam. Only approved questions will be asked.
                </p>
              </div>
              <Badge variant="info">
                {questions.filter((q) => q.status === 'approved').length} Approved
              </Badge>
            </div>

            <div className="space-y-4">
              {/* Add Custom Question Form */}
              <div className="p-4 rounded border border-[var(--border-default)] bg-[var(--bg-muted)] space-y-2">
                <span className="text-xs font-semibold text-[var(--text-primary)] block">
                  Add Your Own Question:
                </span>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    id="new-question-text"
                    name="newQuestionText"
                    type="text"
                    placeholder="Enter question text..."
                    value={newQuestionText}
                    onChange={(e) => setNewQuestionText(e.target.value)}
                    className="form-input text-xs flex-1 min-w-0"
                  />
                  <select
                    id="new-question-phase"
                    name="newQuestionPhase"
                    value={newQuestionPhase}
                    onChange={(e) => setNewQuestionPhase(e.target.value)}
                    className="form-select text-xs w-full sm:w-48 shrink-0"
                    style={{ maxWidth: '220px' }}
                  >
                    <option value="warm_up">Phase 1: Warm-up</option>
                    <option value="fundamentals">Phase 2: Fundamentals</option>
                    <option value="depth">Phase 3: Depth</option>
                    <option value="applied">Phase 4: Applied</option>
                    <option value="wrap_up">Phase 5: Wrap-up</option>
                  </select>
                  <button
                    type="button"
                    onClick={handleAddCustomQuestion}
                    disabled={!newQuestionText.trim()}
                    className="btn-primary text-xs px-4 shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add</span>
                  </button>
                </div>
              </div>

              {/* Questions List */}
              <div className="space-y-3">
                {questions.length === 0 ? (
                  <div className="py-12 text-center rounded-xl border border-dashed border-[var(--border-default)] bg-[var(--bg-muted)]/20 p-6 space-y-2">
                    <FileText className="w-8 h-8 mx-auto text-[var(--text-muted)] opacity-40 mb-1" />
                    <p className="text-xs font-semibold text-[var(--text-primary)]">No examination questions in ledger</p>
                    <p className="text-[11px] text-[var(--text-muted)] max-w-sm mx-auto">
                      Add custom questions above, generate questions automatically from your syllabus in Step 2, or click &ldquo;Load Sample Curriculum&rdquo; in Step 1.
                    </p>
                  </div>
                ) : (
                  questions.map((q, idx) => (
                    <div
                      key={q.id}
                      className={`p-4 rounded border text-xs space-y-2 transition-all ${
                        q.status === 'approved'
                          ? 'border-[var(--border-default)] bg-[var(--bg-card)]'
                          : q.status === 'rejected'
                          ? 'border-red-300 dark:border-red-900 bg-red-50/40 dark:bg-red-950/20 opacity-60'
                          : 'border-amber-300 dark:border-amber-900 bg-amber-50/40 dark:bg-amber-950/20'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-[var(--text-muted)]">
                            #{idx + 1}
                          </span>
                          <Badge variant="neutral">
                            Phase: {q.phase}
                          </Badge>
                          <Badge variant={q.status === 'approved' ? 'success' : q.status === 'rejected' ? 'danger' : 'warning'}>
                            {q.status}
                          </Badge>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleUpdateStatus(q.id, 'approved')}
                            className={`w-9 h-9 flex items-center justify-center rounded transition-colors ${
                              q.status === 'approved'
                                ? 'text-emerald-800 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/60'
                                : 'text-[var(--text-muted)] hover:text-emerald-700'
                            }`}
                            title="Approve Question"
                          >
                            <CheckCircle className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleUpdateStatus(q.id, 'rejected')}
                            className={`w-9 h-9 flex items-center justify-center rounded transition-colors ${
                              q.status === 'rejected'
                                ? 'text-red-800 dark:text-red-300 bg-red-100 dark:bg-red-950/60'
                                : 'text-[var(--text-muted)] hover:text-red-700'
                            }`}
                            title="Reject Question"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteQuestion(q.id)}
                            className="w-9 h-9 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-red-700 transition-colors"
                            title="Delete Question"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <p className="text-sm font-medium text-[var(--text-primary)] leading-relaxed">
                        {q.text}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="pt-4 border-t border-[var(--border-subtle)] flex items-center justify-between">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="btn-outline text-xs px-4"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back</span>
              </button>
              <button
                type="button"
                onClick={() => setStep(4)}
                className="btn-primary text-xs px-5"
              >
                <span>Next: Set Rubric Weights</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 4: Rubric Weight Calibration ──────────── */}
        {step === 4 && (
          <div className="academic-dossier p-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-4">
              <div>
                <h2 className="font-editorial text-xl font-bold text-[var(--text-primary)]">
                  4. Grading Rubric Weights
                </h2>
                <p className="text-xs text-[var(--text-secondary)] mt-1">
                  Set the percentage weight for each of the 5 grading areas. The total must equal 100%.
                </p>
              </div>
              <Badge variant={totalWeight === 100 ? 'success' : 'danger'}>
                Total Weight: {totalWeight}% {totalWeight === 100 ? '✓' : '(Must equal 100%)'}
              </Badge>
            </div>

            <div className="space-y-4">
              {[
                { id: 'rubric-conceptual', key: 'conceptual', label: 'Core Concepts & Theory', desc: 'Understanding of foundational theory and exact syllabus terminology.' },
                { id: 'rubric-depth', key: 'depth_reasoning', label: 'Technical Depth & Reasoning', desc: 'Ability to explain trade-offs, internal mechanics, and failure modes.' },
                { id: 'rubric-problem', key: 'problem_solving', label: 'Problem Solving & Scenarios', desc: 'Applying engineering principles to debugging or applied concurrency.' },
                { id: 'rubric-practical', key: 'practical_project', label: 'Practical & Real-World Application', desc: 'Knowledge of real libraries, operating system primitives, and APIs.' },
                { id: 'rubric-communication', key: 'communication', label: 'Communication & Articulation', desc: 'Clear, concise spoken answers and structured thinking.' },
              ].map((item) => {
                const val = rubricWeights[item.key as keyof typeof rubricWeights];
                return (
                  <div key={item.key} className="space-y-1.5 p-3.5 rounded border border-[var(--border-default)] bg-[var(--bg-muted)]">
                    <div className="flex items-center justify-between text-xs">
                      <div>
                        <label htmlFor={item.id} className="font-bold text-[var(--text-primary)] block cursor-pointer">
                          {item.label}
                        </label>
                        <span className="text-[11px] text-[var(--text-muted)]">
                          {item.desc}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <input
                          id={item.id}
                          name={item.key}
                          type="number"
                          min={0}
                          max={100}
                          value={val}
                          onChange={(e) => {
                            const num = parseInt(e.target.value) || 0;
                            setRubricWeights((prev) => ({ ...prev, [item.key]: num }));
                          }}
                          className="form-input w-20 text-right font-mono font-bold text-xs py-1 px-2"
                        />
                        <span className="text-xs text-[var(--text-muted)] font-mono">%</span>
                      </div>
                    </div>
                  </div>
                );
              })}

              {totalWeight !== 100 && (
                <div className="p-3.5 rounded bg-[var(--status-danger-bg)] border border-[var(--status-danger-border)] text-[var(--status-danger)] text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>The sum of all rubric weights is currently {totalWeight}%. Please adjust weights so the sum equals exactly 100%.</span>
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-[var(--border-subtle)] flex items-center justify-between">
              <button
                type="button"
                onClick={() => setStep(3)}
                className="btn-outline text-xs px-4"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back</span>
              </button>
              <button
                type="button"
                onClick={handlePublish}
                disabled={totalWeight !== 100 || isSubmitting}
                className="btn-primary text-xs px-5"
              >
                <Save className="w-4 h-4" />
                <span>{isSubmitting ? 'Publishing Module...' : 'Publish Viva Examination'}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
