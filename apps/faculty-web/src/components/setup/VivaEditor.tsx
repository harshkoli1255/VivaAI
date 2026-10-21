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
  Plus,
  Sparkles,
  AlertCircle,
  FileText,
} from 'lucide-react';
import { useAuthStore } from '@/store';
import { configsApi, getApiErrorMessage } from '@/lib/api';
import { getStudentPortalUrl } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';
import { useToast } from '@/components/providers/ToastProvider';

interface QuestionItem {
  id: string;
  text: string;
  phase: string;
  topic: string;
  difficulty: string;
  status: 'pending' | 'approved' | 'rejected';
  is_ai_generated?: boolean;
  expected_keywords?: string[];
  follow_up_hints?: string[];
}

export default function VivaEditor({ configId, duplicate = false }: { configId?: string; duplicate?: boolean }) {
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
  const [loadError, setLoadError] = useState('');
  const [published, setPublished] = useState(false);
  const [loaded, setLoaded] = useState(!configId);
  const [updatedAt, setUpdatedAt] = useState('');
  const [revision, setRevision] = useState(1);
  const [phaseTimings, setPhaseTimings] = useState<Record<string, { start: number; end: number }> | undefined>();
  const [draftNotice, setDraftNotice] = useState('');
  const [enrollmentOpen, setEnrollmentOpen] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);


  // Step 1: Viva metadata
  const [title, setTitle] = useState<string>('');
  const [courseCode, setCourseCode] = useState<string>('');
  const [subject, setSubject] = useState<string>('');
  const [difficulty, setDifficulty] = useState<string>('medium');
  const [totalMinutes, setTotalMinutes] = useState<number>(15);

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

  const draftKey = `vivaai_setup_${user?.id || 'faculty'}_${configId || 'new'}_${duplicate ? 'copy' : 'edit'}`;
  useEffect(() => {
    if (!hasHydrated || !isAuthenticated || user?.role !== 'faculty') return;
    let active = true;
    async function load() {
      try {
        const remote: Record<string, unknown> = configId ? (await configsApi.get(configId)).data : await Promise.resolve({});
        if (!active) return;
        if (remote.superseded_by_id && !duplicate) {
          setLoadError('A newer version exists. Open the latest viva from your dashboard, or duplicate this historical version.');
          return;
        }
        setUpdatedAt(String(remote.updated_at || ''));
        setRevision(Number(remote.revision || 1));
        if (configId) {
          setTitle((duplicate ? 'Copy of ' : '') + String(remote.title || ''));
          setSubject(String(remote.subject || '')); setCourseCode(String(remote.course_code || ''));
          setDifficulty(String(remote.difficulty || 'medium')); setTotalMinutes(Number(remote.total_duration_secs || 900) / 60);
          setSyllabusText(Array.isArray(remote.topics) ? remote.topics.join('\n') : '');
          setQuestions(Array.isArray(remote.questions) ? remote.questions : []);
          setRubricWeights(remote.rubric_weights as typeof rubricWeights);
          setPhaseTimings(remote.phase_timings as typeof phaseTimings);
          setEnrollmentOpen(duplicate ? true : Boolean(remote.is_active));
        }
        try {
          const raw = sessionStorage.getItem(draftKey);
          if (raw) {
            const saved = JSON.parse(raw);
            if (saved.updatedAt === String(remote.updated_at || '')) {
              setTitle(saved.title); setCourseCode(saved.courseCode); setSubject(saved.subject);
              setDifficulty(saved.difficulty); setTotalMinutes(saved.totalMinutes); setSyllabusText(saved.syllabusText);
              setQuestions(saved.questions); setRubricWeights(saved.rubricWeights); setStep(saved.step);
              setEnrollmentOpen(saved.enrollmentOpen ?? true);
              setDraftNotice('Unsaved edits restored in this tab. Publish when you are ready.');
            } else setDraftNotice('This viva changed since your last draft. The latest published version has been loaded.');
          }
        } catch { /* Drafts are optional when session storage is disabled. */ }
        setLoaded(true);
      } catch (error) { if (active) setLoadError(getApiErrorMessage(error, 'Could not load the viva. Please retry.')); }
    }
    void load();
    return () => { active = false; };
    // The editor loads once per route/version; subsequent state changes are drafts.
  }, [configId, duplicate, draftKey, hasHydrated, isAuthenticated, user?.role, loadAttempt]);

  useEffect(() => {
    if (!loaded || isSubmitting || published) return;
    const timer = window.setTimeout(() => {
      const draft = JSON.stringify({ updatedAt, title, courseCode, subject, difficulty, totalMinutes, syllabusText, questions, rubricWeights, step, enrollmentOpen });
      try { sessionStorage.setItem(draftKey, draft); } catch { /* Keep the editable form usable. */ }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [loaded, isSubmitting, published, updatedAt, title, courseCode, subject, difficulty, totalMinutes, syllabusText, questions, rubricWeights, step, enrollmentOpen, draftKey]);

  const importQuestions = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('Question banks must be under 2 MB.');
      const parsed = JSON.parse(await file.text());
      const rows = Array.isArray(parsed) ? parsed : parsed.questions;
      if (!Array.isArray(rows) || !rows.length || rows.length > 1000) throw new Error('Use a JSON array with 1–1000 questions, each with text and phase.');
      const incoming = rows.map((row, index): QuestionItem => {
        if (typeof row?.text !== 'string' || !row.text.trim() || row.text.length > 1024) throw new Error(`Question ${index + 1} needs text of 1–1024 characters.`);
        if (!['warm_up','fundamentals','depth','applied','wrap_up'].includes(row.phase)) throw new Error(`Question ${index + 1} has an unsupported phase.`);
        return { id: crypto.randomUUID(), text: row.text.trim(), phase: row.phase, topic: typeof row.topic === 'string' ? row.topic : '',
          difficulty: ['easy','medium','hard'].includes(row.difficulty) ? row.difficulty : difficulty, status: 'pending', is_ai_generated: Boolean(row.is_ai_generated),
          expected_keywords: Array.isArray(row.expected_keywords) ? row.expected_keywords : [], follow_up_hints: Array.isArray(row.follow_up_hints) ? row.follow_up_hints : [] };
      });
      if (questions.length + incoming.length > 1000) throw new Error('A viva can contain at most 1000 questions.');
      setQuestions(current => [...current, ...incoming]); setStep(3);
      showToast(`${incoming.length} questions imported. Review and approve them before publishing.`, 'success');
    } catch (error) { showToast(getApiErrorMessage(error, 'Could not read the JSON bank.'), 'error'); }
  };

  const totalWeight = Object.values(rubricWeights).reduce((a, b) => a + b, 0);

  const handleGenerateQuestions = async () => {
    if (!syllabusText.trim()) {
      showToast('Please enter syllabus units, topics, or course outline first.', 'warning');
      return;
    }
    setIsGeneratingQuestions(true);
    showToast('Generating questions from your syllabus…', 'info');

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
    if (isSubmitting || published) return;
    if (totalWeight !== 100) {
      showToast('Rubric weights must total exactly 100% before publishing.', 'warning');
      return;
    }

    if (!title.trim() || !(subject || courseCode).trim()) { showToast('Add a title and subject in Details before publishing.', 'warning'); setStep(1); return; }
    if (!questions.some(q => q.status === 'approved')) { showToast('Approve at least one question before publishing.', 'warning'); setStep(3); return; }
    if (questions.some(q => !q.text.trim() || q.text.length > 1024)) { showToast('Every question needs 1–1024 characters of text.', 'warning'); setStep(3); return; }
    setIsSubmitting(true);
    try {
      const payload = {
        title,
        subject: subject || courseCode,
        topics: syllabusText.split('\n').filter(Boolean),
        difficulty: difficulty.toLowerCase(),
        total_duration_secs: totalMinutes * 60,
        rubric_weights: rubricWeights,
        questions,
        course_code: courseCode.trim(),
        is_active: enrollmentOpen,
        ...(phaseTimings && Object.values(phaseTimings).some(timing => timing.end === totalMinutes * 60) ? { phase_timings: phaseTimings } : {}),
      };
      if (configId && !duplicate) await configsApi.publishVersion(configId, { ...payload, expected_updated_at: updatedAt });
      else await configsApi.create(payload);
      setPublished(true);
      try { sessionStorage.removeItem(draftKey); } catch { /* Optional draft storage. */ }
      showToast(configId && !duplicate ? 'New version published. Existing interviews keep their original settings.' : 'Viva created and saved.', 'success');
      router.push('/dashboard');
    } catch (err: unknown) {
      const message = getApiErrorMessage(err, 'Could not save the viva. Your edits are preserved in this tab.');
      showToast(message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const stepTitles = [
    'Details',
    'Topics',
    'Questions',
    'Rubric',
  ];

  if (!hasHydrated || !isAuthenticated || user?.role !== 'faculty') {
    return (
      <div className="min-h-screen bg-[var(--bg-page)] p-8 flex items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-[var(--text-muted)]">
          <div className="w-4 h-4 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
          <span>Authenticating faculty access...</span>
        </div>
      </div>
    );
  }

  if (loadError) return <div className="mx-auto max-w-3xl px-5 py-12"><Link href="/dashboard" className="text-sm text-[var(--primary)]">← Back to dashboard</Link><div role="alert" className="academic-dossier mt-6 p-6"><p>{loadError}</p><button className="btn-secondary mt-4" onClick={() => { setLoadError(''); setLoaded(false); setLoadAttempt(value => value + 1); }}>Retry loading</button></div></div>;
  if (!loaded) return <p role="status" className="p-10 text-center">Loading viva editor…</p>;

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-[var(--bg-page)] text-[var(--text-primary)] py-8 sm:py-10 px-4 sm:px-6 lg:px-8 transition-colors">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Top Header */}
        <div className="border-b border-[var(--border-default)] pb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="space-y-2">
            <Link
              href="/dashboard"
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] flex items-center gap-1.5 min-h-[36px]"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to dashboard</span>
            </Link>
            <p className="eyebrow !mt-4">Faculty · Assessment studio</p>
            <h1 className="font-editorial text-2xl sm:text-4xl font-bold tracking-tight text-[var(--text-primary)]">
              {configId ? duplicate ? 'Duplicate viva' : 'Edit viva' : 'Create a viva'}
            </h1>
            <p className="text-xs sm:text-sm text-[var(--text-secondary)]">
              Set exam details, add syllabus topics, approve questions, and choose grading criteria.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--text-secondary)]"><p>{configId && !duplicate ? `Version ${revision} · Publishing saves a new version. Existing interviews stay unchanged.` : 'Your draft is saved in this browser tab as you work.'}</p>{draftNotice && <p role="status" className="text-[var(--primary)]">{draftNotice}</p>}</div>
        <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={enrollmentOpen} onChange={event => setEnrollmentOpen(event.target.checked)} />Open to new student interviews after saving</label>

        <nav aria-label="Viva setup progress" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[1, 2, 3, 4].map((s) => (
            <button key={s} type="button" onClick={() => setStep(s as 1 | 2 | 3 | 4)} aria-current={step === s ? 'step' : undefined} className="setup-step">
              <span className="setup-step-number">{String(s).padStart(2, '0')}</span>
              <span className="min-w-0 text-sm font-semibold leading-snug text-[var(--text-primary)]">{stepTitles[s - 1]}</span>
            </button>
          ))}
        </nav>

        {/* ── STEP 1: Viva details ──────────────── */}
        {step === 1 && (
          <div className="academic-dossier p-5 sm:p-8 space-y-7">
            <div className="border-b border-[var(--border-subtle)] pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="font-editorial text-xl font-bold text-[var(--text-primary)]">
                  Viva details
                </h2>
                <p className="text-xs text-[var(--text-secondary)] mt-1">
                  Enter the course code, exam title, difficulty level, and total duration.
                </p>
              </div>
              <button
                type="button"
                onClick={handleLoadCurriculumTemplate}
                className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5 self-start sm:self-auto border border-[var(--status-success-border)] text-[var(--status-success)] hover:bg-[var(--status-success-bg)]"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Use sample syllabus</span>
              </button>
            </div>

            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="setup-course-code" className="text-xs font-semibold text-[var(--text-secondary)] block mb-2">
                    Course Code
                  </label>
                  <input
                    id="setup-course-code"
                    name="courseCode"
                    type="text"
                    value={courseCode}
                    onChange={(e) => setCourseCode(e.target.value)}
                    placeholder="e.g. CS302"
                    className="form-input font-mono uppercase text-sm"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="setup-subject" className="text-xs font-semibold text-[var(--text-secondary)] block mb-2">
                    Academic Subject / Department
                  </label>
                  <input
                    id="setup-subject"
                    name="subject"
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="e.g. Computer Science & Engineering"
                    className="form-input text-sm"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="setup-title" className="text-xs font-semibold text-[var(--text-secondary)] block mb-2">
                  Examination Title
                </label>
                <input
                  id="setup-title"
                  name="title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Operating Systems & Concurrency Technical Viva"
                  className="form-input text-sm"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <label htmlFor="setup-difficulty" className="text-xs font-semibold text-[var(--text-secondary)] block mb-2">
                    Difficulty Profile
                  </label>
                  <select
                    id="setup-difficulty"
                    name="difficulty"
                    value={difficulty}
                    onChange={(e) => setDifficulty(e.target.value)}
                    className="form-select text-sm"
                  >
                    <option value="easy">Introductory Undergraduate</option>
                    <option value="medium">Intermediate Senior</option>
                    <option value="hard">Advanced Honors / Masters</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="setup-duration" className="text-xs font-semibold text-[var(--text-secondary)] block mb-2">
                    Allocated Duration
                  </label>
                  <select
                    id="setup-duration"
                    name="duration"
                    value={totalMinutes}
                    onChange={(e) => setTotalMinutes(Number(e.target.value))}
                    className="form-select text-sm"
                  >
                    <option value={15}>15 minutes (Standard viva format)</option>{totalMinutes !== 15 && <option value={totalMinutes}>{totalMinutes} minutes (existing duration)</option>}
                  </select>
                </div>
              </div>

            </div>

            <div className="form-actions">
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
          <div className="academic-dossier p-5 sm:p-8 space-y-7">
            <div className="border-b border-[var(--border-subtle)] pb-4">
              <h2 className="font-editorial text-xl font-bold text-[var(--text-primary)]">
                2. Course Syllabus & Questions
              </h2>
              <p className="text-xs text-[var(--text-secondary)] mt-1">
                Paste your course syllabus or key topics below. VivaAI will suggest questions based on these topics.
              </p>
            </div>

            <div className="space-y-5">
              <div>
                <label htmlFor="setup-syllabus" className="text-xs font-semibold text-[var(--text-secondary)] block mb-2">
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

            <div className="form-actions">
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
                <span>Questions ({questions.length})</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3: Question Review Ledger ─────────────── */}
        {step === 3 && (
          <div className="academic-dossier p-5 sm:p-8 space-y-7">
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

            <div className="space-y-5">
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
                    className="form-input text-sm flex-1 min-w-0"
                  />
                  <select
                    id="new-question-phase"
                    name="newQuestionPhase"
                    value={newQuestionPhase}
                    onChange={(e) => setNewQuestionPhase(e.target.value)}
                    className="form-select text-sm w-full sm:w-48 shrink-0"
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

              <label className="flex flex-wrap items-center gap-3 text-sm font-medium">Import question bank (JSON)<input type="file" accept=".json,application/json" className="max-w-full text-xs" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void importQuestions(file); }} /></label>

              {/* Questions List */}
              <div className="space-y-3">
                {questions.length === 0 ? (
                  <div className="py-12 text-center rounded-xl border border-dashed border-[var(--border-default)] bg-[var(--bg-muted)]/20 p-6 space-y-2">
                    <FileText className="w-8 h-8 mx-auto text-[var(--text-muted)] opacity-40 mb-1" />
                    <p className="text-xs font-semibold text-[var(--text-primary)]">No examination questions in ledger</p>
                    <p className="text-[11px] text-[var(--text-muted)] max-w-sm mx-auto">
                      Add custom questions above, generate questions automatically from your syllabus in Step 2, or click &ldquo;Use sample syllabus&rdquo; in Step 1.
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
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
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

                      <label className="sr-only" htmlFor={`question-text-${q.id}`}>Question {idx + 1} text</label>
                      <textarea id={`question-text-${q.id}`} className="form-textarea !min-h-24 text-sm" value={q.text} maxLength={1024} onChange={event => setQuestions(current => current.map(item => item.id === q.id ? { ...item, text: event.target.value } : item))} />
                      <details className="text-xs"><summary className="min-h-9 cursor-pointer py-2 text-[var(--primary)]">Question settings</summary><div className="mt-3 grid gap-3 sm:grid-cols-3">
                        <label>Phase<select aria-label={`Question ${idx + 1} phase`} className="form-select mt-2" value={q.phase} onChange={event => setQuestions(current => current.map(item => item.id === q.id ? { ...item, phase: event.target.value } : item))}>{['warm_up','fundamentals','depth','applied','wrap_up'].map(phase => <option key={phase} value={phase}>{phase.replaceAll('_',' ')}</option>)}</select></label>
                        <label>Topic<input aria-label={`Question ${idx + 1} topic`} className="form-input mt-2" value={q.topic} maxLength={256} onChange={event => setQuestions(current => current.map(item => item.id === q.id ? { ...item, topic: event.target.value } : item))} /></label>
                        <label>Difficulty<select aria-label={`Question ${idx + 1} difficulty`} className="form-select mt-2" value={q.difficulty} onChange={event => setQuestions(current => current.map(item => item.id === q.id ? { ...item, difficulty: event.target.value } : item))}>{['easy','medium','hard'].map(level => <option key={level}>{level}</option>)}</select></label>
                      </div></details>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="form-actions">
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
          <div className="academic-dossier p-5 sm:p-8 space-y-7">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-4">
              <div>
                <h2 className="font-editorial text-xl font-bold text-[var(--text-primary)]">
                  4. Rubric Weights
                </h2>
                <p className="text-xs text-[var(--text-secondary)] mt-1">
                  Set the percentage weight for each of the 5 grading areas. The total must equal 100%.
                </p>
              </div>
              <Badge variant={totalWeight === 100 ? 'success' : 'danger'}>
                Total Weight: {totalWeight}% {totalWeight === 100 ? '✓' : '(Must equal 100%)'}
              </Badge>
            </div>

            <div className="space-y-5">
              {[
                { id: 'rubric-conceptual', key: 'conceptual', label: 'Core Concepts & Theory', desc: 'Understanding of foundational theory and exact syllabus terminology.' },
                { id: 'rubric-depth', key: 'depth_reasoning', label: 'Technical Depth & Reasoning', desc: 'Ability to explain trade-offs, internal mechanics, and failure modes.' },
                { id: 'rubric-problem', key: 'problem_solving', label: 'Problem Solving & Scenarios', desc: 'Applying engineering principles to debugging or applied concurrency.' },
                { id: 'rubric-practical', key: 'practical_project', label: 'Practical & Real-World Application', desc: 'Knowledge of real libraries, operating system primitives, and APIs.' },
                { id: 'rubric-communication', key: 'communication', label: 'Communication & Articulation', desc: 'Clear, concise spoken answers and structured thinking.' },
              ].map((item) => {
                const val = rubricWeights[item.key as keyof typeof rubricWeights];
                return (
                  <div key={item.key} className="space-y-1.5 p-4 rounded-xl border border-[var(--border-default)] bg-[var(--bg-muted)]">
                    <div className="flex flex-col items-start justify-between gap-4 text-xs sm:flex-row sm:items-center">
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

            <div className="form-actions">
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
                <span>{isSubmitting ? 'Saving viva…' : configId && !duplicate ? 'Publish new version' : 'Publish Viva Examination'}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
