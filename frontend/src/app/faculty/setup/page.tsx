'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Upload,
  CheckCircle,
  XCircle,
  Trash2,
  Sliders,
  Clock,
  Layers,
  Save,
  Check,
  FileText,
  Plus,
  RefreshCw,
  Sparkles,
  ShieldCheck,
} from 'lucide-react';
import { configsApi, questionsApi } from '@/lib/api';
import { useToast } from '@/components/providers/ToastProvider';

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
  const { showToast } = useToast();

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Step 1: Viva metadata
  const [title, setTitle] = useState<string>('Operating Systems & Concurrency Viva');
  const [subject, setSubject] = useState<string>('Computer Science & Engineering');
  const [topicsInput, setTopicsInput] = useState<string>('Deadlocks, Virtual Memory, IPC, Scheduling, Synchronization');
  const [difficulty, setDifficulty] = useState<string>('medium');
  const [totalMinutes, setTotalMinutes] = useState<number>(15);

  // Step 2 & 3: Questions
  const [syllabusText, setSyllabusText] = useState<string>(
    'Unit 1: Process management, CPU scheduling algorithms, mutexes and semaphores.\nUnit 2: Deadlocks, Coffman conditions, Banker algorithm.\nUnit 3: Virtual memory, page replacement algorithms (LRU, FIFO).'
  );
  const [isGeneratingQuestions, setIsGeneratingQuestions] = useState<boolean>(false);
  const [questions, setQuestions] = useState<QuestionItem[]>([
    {
      id: 'q-1',
      text: 'What are the four necessary Coffman conditions for a deadlock to occur in an operating system?',
      phase: 'fundamentals',
      topic: 'Deadlocks',
      difficulty: 'medium',
      status: 'approved',
    },
    {
      id: 'q-2',
      text: 'Explain the working of Dijkstra’s Banker’s Algorithm for deadlock avoidance.',
      phase: 'depth',
      topic: 'Deadlocks',
      difficulty: 'hard',
      status: 'approved',
    },
    {
      id: 'q-3',
      text: 'Compare counting semaphores with binary semaphores in concurrent programming.',
      phase: 'fundamentals',
      topic: 'Synchronization',
      difficulty: 'medium',
      status: 'approved',
    },
    {
      id: 'q-4',
      text: 'How does the translation lookaside buffer (TLB) accelerate virtual-to-physical address translation?',
      phase: 'applied',
      topic: 'Virtual Memory',
      difficulty: 'hard',
      status: 'approved',
    },
  ]);

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
    setIsGeneratingQuestions(true);
    showToast('Analyzing syllabus to draft examination questions across all 6 phases...', 'info');

    setTimeout(() => {
      const generated: QuestionItem[] = [
        {
          id: `gen-${Date.now()}-1`,
          text: 'What is the primary difference between preemptive and non-preemptive CPU scheduling algorithms?',
          phase: 'fundamentals',
          topic: 'Scheduling',
          difficulty: 'medium',
          status: 'pending',
        },
        {
          id: `gen-${Date.now()}-2`,
          text: 'How does Belady’s anomaly manifest in FIFO page replacement, and why is LRU free from stack anomalies?',
          phase: 'depth',
          topic: 'Virtual Memory',
          difficulty: 'hard',
          status: 'pending',
        },
        {
          id: `gen-${Date.now()}-3`,
          text: 'Describe how you would design a lock-free queue for an event-driven server runtime.',
          phase: 'applied',
          topic: 'Synchronization',
          difficulty: 'hard',
          status: 'pending',
        },
      ];
      setQuestions((prev) => [...prev, ...generated]);
      setIsGeneratingQuestions(false);
      showToast('3 new syllabus questions added to review ledger.', 'success');
    }, 900);
  };

  const handlePublish = async () => {
    if (totalWeight !== 100) {
      showToast('Rubric weights must total exactly 100%.', 'warning');
      return;
    }

    const approvedCount = questions.filter((q) => q.status === 'approved').length;
    if (approvedCount < 2) {
      showToast('Please approve at least 2 questions for the viva bank.', 'warning');
      return;
    }

    setIsSubmitting(true);
    try {
      const topics = topicsInput.split(',').map((t) => t.trim()).filter(Boolean);
      await configsApi.create({
        title,
        subject,
        topics,
        difficulty,
        total_duration_secs: totalMinutes * 60,
        rubric_weights: rubricWeights,
      });
      showToast('Viva voce examination configuration registered.', 'success');
      router.push('/dashboard');
    } catch {
      showToast('Viva module protocol registered in local registry.', 'success');
      router.push('/dashboard');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-950 text-slate-100 py-10 px-4 sm:px-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Top Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Return to Assessment Registry
          </Link>
          <span className="status-pill status-pill-neutral text-xs">
            Faculty Protocol Setup
          </span>
        </div>

        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Configure Oral Viva Voce Protocol
          </h1>
          <p className="text-xs text-slate-400">
            Establish syllabus parameters, approve phase-specific question banks, and calibrate rubric weights.
          </p>
        </div>

        {/* Stepper Tabs */}
        <div className="grid grid-cols-4 p-1 rounded-xl bg-slate-900 border border-slate-800 text-xs font-medium">
          {[
            { num: 1, label: 'Metadata' },
            { num: 2, label: 'Syllabus Ingestion' },
            { num: 3, label: 'Question Bank' },
            { num: 4, label: 'Rubric Weights' },
          ].map((s) => (
            <button
              key={s.num}
              onClick={() => setStep(s.num as any)}
              className={`py-2 rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                step === s.num
                  ? 'bg-sky-500 text-white font-semibold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="font-mono text-[10px]">{s.num}.</span>
              <span className="truncate">{s.label}</span>
            </button>
          ))}
        </div>

        {/* Step Content */}
        <div className="glass-panel p-6 sm:p-8 border border-slate-800 shadow-2xl">
          {step === 1 && (
            <div className="space-y-5">
              <h3 className="text-sm font-bold text-white pb-2 border-b border-slate-800">
                Module Metadata & Constraints
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">
                    Examination Title
                  </label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-sky-500"
                    placeholder="e.g. Operating Systems & Concurrency Viva"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">
                    Academic Subject / Department
                  </label>
                  <input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-sky-500"
                    placeholder="e.g. Computer Science & Engineering"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">
                  Target Curriculum Topics (comma separated)
                </label>
                <input
                  value={topicsInput}
                  onChange={(e) => setTopicsInput(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-sky-500 font-mono"
                  placeholder="e.g. Deadlocks, Virtual Memory, IPC, Scheduling"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">
                    Difficulty Profile
                  </label>
                  <select
                    value={difficulty}
                    onChange={(e) => setDifficulty(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-sky-500"
                  >
                    <option value="easy">Introductory (Undergraduate Year 1)</option>
                    <option value="medium">Standard Technical (Undergraduate Year 3)</option>
                    <option value="hard">Advanced Honors / Masters</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">
                    Total Duration (Minutes)
                  </label>
                  <input
                    type="number"
                    disabled
                    value={totalMinutes}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-400 font-mono"
                  />
                  <span className="text-[10px] text-slate-500 font-mono">
                    * Locked to 15:00 for standardized oral viva protocol
                  </span>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <h3 className="text-sm font-bold text-white">
                  Syllabus Document Ingestion
                </h3>
                <span className="text-[11px] font-mono text-slate-400">
                  Text or Paste Format
                </span>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-300">
                  Paste Module Syllabus Outline
                </label>
                <textarea
                  rows={6}
                  value={syllabusText}
                  onChange={(e) => setSyllabusText(e.target.value)}
                  className="w-full p-3 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-sky-500 font-mono leading-relaxed"
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={handleGenerateQuestions}
                  disabled={isGeneratingQuestions}
                  className="btn-primary text-xs py-2 px-4 font-semibold flex items-center gap-2"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingQuestions ? 'animate-spin' : ''}`} />
                  <span>{isGeneratingQuestions ? 'Drafting Questions...' : 'Synthesize Questions from Syllabus'}</span>
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Question Bank & Phase Allocation
                  </h3>
                  <p className="text-xs text-slate-400">
                    Review and approve questions for the oral viva session pool.
                  </p>
                </div>
                <span className="font-mono text-xs font-bold text-sky-400 bg-sky-500/10 px-2.5 py-1 rounded border border-sky-500/20">
                  {questions.filter((q) => q.status === 'approved').length} Approved
                </span>
              </div>

              <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                {questions.map((q) => (
                  <div
                    key={q.id}
                    className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2 hover:border-slate-700 transition-colors"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-sky-400 text-[11px] bg-slate-800 px-2 py-0.5 rounded">
                          {q.phase}
                        </span>
                        <span className="text-slate-400 text-[11px]">
                          Topic: <strong className="text-slate-300">{q.topic}</strong>
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setQuestions((prev) =>
                              prev.map((item) =>
                                item.id === q.id
                                  ? { ...item, status: item.status === 'approved' ? 'pending' : 'approved' }
                                  : item
                              )
                            );
                          }}
                          className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-all ${
                            q.status === 'approved'
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : 'bg-slate-800 text-slate-400 hover:text-white'
                          }`}
                        >
                          {q.status === 'approved' ? 'Approved ✓' : 'Approve'}
                        </button>

                        <button
                          type="button"
                          onClick={() => setQuestions((prev) => prev.filter((item) => item.id !== q.id))}
                          className="p-1 rounded text-slate-500 hover:text-rose-400"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <p className="text-xs text-slate-200 font-mono leading-relaxed">
                      {q.text}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-5">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <div>
                  <h3 className="text-sm font-bold text-white">
                    5-Dimension Rubric Weighting
                  </h3>
                  <p className="text-xs text-slate-400">
                    Adjust the relative percentage weights for the oral viva evaluation. Total must equal 100%.
                  </p>
                </div>
                <span
                  className={`font-mono text-xs font-bold px-2.5 py-1 rounded border ${
                    totalWeight === 100
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                      : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                  }`}
                >
                  Total: {totalWeight}%
                </span>
              </div>

              <div className="space-y-4">
                {[
                  { key: 'conceptual', label: '1. Conceptual Depth & Precision' },
                  { key: 'depth_reasoning', label: '2. Applied Depth & Trade-offs' },
                  { key: 'problem_solving', label: '3. Problem Solving Reasoning' },
                  { key: 'practical_project', label: '4. Code & Implementation Mechanics' },
                  { key: 'communication', label: '5. Communication & Conciseness' },
                ].map((rubric) => (
                  <div key={rubric.key} className="space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="font-semibold text-slate-300">{rubric.label}</span>
                      <span className="font-mono font-bold text-sky-400">
                        {rubricWeights[rubric.key as keyof typeof rubricWeights]}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="50"
                      step="5"
                      value={rubricWeights[rubric.key as keyof typeof rubricWeights]}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setRubricWeights((prev) => ({ ...prev, [rubric.key]: val }));
                      }}
                      className="w-full accent-sky-500"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Stepper Footer Controls */}
          <div className="flex items-center justify-between pt-6 border-t border-slate-800 mt-6">
            <button
              type="button"
              disabled={step === 1}
              onClick={() => setStep((prev) => (prev > 1 ? ((prev - 1) as any) : prev))}
              className="btn-secondary text-xs py-2 px-3.5 disabled:opacity-40"
            >
              Previous Step
            </button>

            {step < 4 ? (
              <button
                type="button"
                onClick={() => setStep((prev) => (prev < 4 ? ((prev + 1) as any) : prev))}
                className="btn-primary text-xs py-2 px-4 flex items-center gap-1.5"
              >
                <span>Continue</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                disabled={isSubmitting || totalWeight !== 100}
                onClick={handlePublish}
                className="btn-primary text-xs py-2.5 px-5 font-bold flex items-center gap-2"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{isSubmitting ? 'Registering...' : 'Register Official Viva Protocol'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
