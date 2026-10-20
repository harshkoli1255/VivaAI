'use client';

import React, { useState } from 'react';
import {
  X,
  Copy,
  Check,
  RotateCcw,
  Terminal,
} from 'lucide-react';

interface CodeScratchpadProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmitCode: (codePayload: string) => void;
  disabled?: boolean;
}

const TEMPLATES: Record<string, string> = {
  python: `# Write your technical implementation or algorithm here
def solve():
    # Candidate logic
    pass
`,
  sql: `-- Write your SQL query or schema definition here
SELECT 
    department_id,
    COUNT(*) as total_candidates,
    AVG(salary) as average_comp
FROM employees
GROUP BY department_id
HAVING COUNT(*) > 1;
`,
  cpp: `// Write your C++ concurrency or systems code here
#include <iostream>
#include <mutex>
#include <condition_variable>

class BoundedQueue {
    // Thread-safe synchronization primitives
};
`,
  pseudocode: `// Architecture / High-Level Algorithm
Algorithm ProcessRequest(data):
    1. Validate input tokens
    2. Query cache or read-replica
    3. If cache miss, fetch from primary WAL
    4. Return verified payload
`,
};

export function CodeScratchpad({
  isOpen,
  onClose,
  onSubmitCode,
  disabled = false,
}: CodeScratchpadProps) {
  const [language, setLanguage] = useState<'python' | 'sql' | 'cpp' | 'pseudocode'>('python');
  const [code, setCode] = useState<string>(TEMPLATES.python);
  const [note, setNote] = useState<string>('');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleLanguageChange = (newLang: 'python' | 'sql' | 'cpp' | 'pseudocode') => {
    setLanguage(newLang);
    if (!code || Object.values(TEMPLATES).includes(code)) {
      setCode(TEMPLATES[newLang]);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const handleReset = () => {
    setCode(TEMPLATES[language]);
  };

  const handleSubmit = () => {
    if (!code.trim()) return;
    const formatted = `[CANDIDATE CODE SUBMISSION - ${language.toUpperCase()}]\n\`\`\`${language}\n${code.trim()}\n\`\`\`${
      note.trim() ? `\nCandidate Note: ${note.trim()}` : ''
    }`;
    onSubmitCode(formatted);
    onClose();
  };

  const lineCount = code.split('\n').length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="scratchpad-heading"
      className="fixed inset-y-0 right-0 z-50 w-full sm:max-w-xl md:max-w-2xl bg-[var(--bg-card)] border-l border-[var(--border-default)] shadow-2xl flex flex-col transition-all duration-300 ease-in-out"
    >
      {/* Header Bar */}
      <div className="px-5 py-4 border-b border-[var(--border-default)] flex items-center justify-between bg-[var(--bg-muted)]/50">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[var(--accent-subtle)] border border-[var(--primary)]/20 text-[var(--primary)] flex items-center justify-center">
            <Terminal className="w-4 h-4" />
          </div>
          <div>
            <h2 id="scratchpad-heading" className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
              <span>Technical Code Scratchpad</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--accent-subtle)] text-[var(--primary)] border border-[var(--primary)]/20">
                LIVE
              </span>
            </h2>
            <p className="text-[11px] text-[var(--text-muted)]">
              Draft algorithms, schemas, or systems pseudocode for the AI examiner.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-muted)] transition-colors"
          title="Close scratchpad"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Language Bar & Actions */}
      <div className="px-5 py-2.5 border-b border-[var(--border-subtle)] flex items-center justify-between gap-2 bg-[var(--bg-page)] text-xs">
        <div className="flex items-center gap-1.5">
          {(['python', 'sql', 'cpp', 'pseudocode'] as const).map((lang) => (
            <button
              key={lang}
              type="button"
              onClick={() => handleLanguageChange(lang)}
              className={`px-2.5 py-1 rounded text-[11px] font-mono font-semibold transition-colors uppercase ${
                language === lang
                  ? 'bg-[var(--primary)] text-white shadow-xs'
                  : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border-default)] hover:bg-[var(--bg-muted)]'
              }`}
            >
              {lang === 'cpp' ? 'C++' : lang}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleCopy}
            className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-colors text-[11px] flex items-center gap-1"
            title="Copy code"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-colors text-[11px] flex items-center gap-1"
            title="Reset template"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Reset</span>
          </button>
        </div>
      </div>

      {/* Editor Main Canvas */}
      <div className="flex-1 flex overflow-hidden bg-slate-950 text-slate-100 font-mono text-xs">
        {/* Line numbers gutter */}
        <div className="py-3 px-2 text-right text-slate-600 select-none border-r border-slate-800 bg-slate-950/80 min-w-[36px]">
          {Array.from({ length: Math.max(lineCount, 12) }, (_, i) => (
            <div key={i + 1} className="leading-6">
              {i + 1}
            </div>
          ))}
        </div>

        {/* Textarea Code Input */}
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          spellCheck={false}
          className="flex-1 p-3 bg-transparent text-slate-100 focus:outline-none resize-none leading-6 font-mono overflow-auto placeholder-slate-600"
          placeholder="Type or paste your code snippet here..."
        />
      </div>

      {/* Optional Note & Submission Footer */}
      <div className="p-4 border-t border-[var(--border-default)] bg-[var(--bg-card)] space-y-3">
        <div>
          <label htmlFor="scratchpad-note" className="block text-[11px] font-semibold text-[var(--text-secondary)] mb-1">
            Optional Commentary / Architectural Walkthrough:
          </label>
          <input
            id="scratchpad-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Optimized with monotonic counter to prevent race condition..."
            className="w-full text-xs px-3 py-2 rounded border border-[var(--border-default)] bg-[var(--bg-page)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--primary)]"
          />
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="text-[11px] text-[var(--text-muted)]">
            Pressing submit shares this code block directly with the AI examiner.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-outline text-xs px-3 py-2 min-h-[38px]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={disabled || !code.trim()}
              className="btn-primary text-xs px-4 py-2 min-h-[38px] flex items-center gap-1.5 font-bold shadow-sm"
            >
              <SendIcon className="w-3.5 h-3.5" />
              <span>Submit Code to Examiner</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SendIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
      {...props}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3 21l18-9L3 3l3 9zm0 0h11" />
    </svg>
  );
}
export default CodeScratchpad;
