export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatScore(score: number | null | undefined): string {
  if (score == null) return '—';
  return `${score.toFixed(1)}`;
}

export function scoreColor(score: number): string {
  if (score >= 75) return 'text-emerald-600 dark:text-emerald-400';
  if (score >= 50) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

export function statusBadgeClass(status: string): string {
  const map: Record<string, string> = {
    completed: 'badge-success',
    in_progress: 'badge-accent',
    flagged: 'badge-danger',
    scheduled: 'badge-muted',
    aborted: 'badge-danger',
  };
  return map[status] || 'badge-muted';
}

export function phaseLabel(phase: string): string {
  const map: Record<string, string> = {
    warm_up: 'Warm-Up',
    fundamentals: 'Fundamentals',
    depth: 'Depth',
    applied: 'Applied',
    wrap_up: 'Wrap-Up',
    scoring: 'Scoring',
    completed: 'Completed',
  };
  return map[phase] || phase;
}

export function phaseColor(phase: string): string {
  const map: Record<string, string> = {
    warm_up: 'text-sky-500',
    fundamentals: 'text-violet-500',
    depth: 'text-indigo-500',
    applied: 'text-amber-500',
    wrap_up: 'text-teal-500',
    scoring: 'text-slate-500',
    completed: 'text-emerald-500',
  };
  return map[phase] || 'text-slate-500';
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Let the browser start consuming the object URL before releasing it.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function getFacultyPortalUrl(): string {
  if (typeof window !== 'undefined') {
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (!isLocal) {
      const envUrl = process.env.NEXT_PUBLIC_FACULTY_URL;
      if (envUrl && !envUrl.includes('localhost') && !envUrl.includes('127.0.0.1')) {
        return envUrl.replace(/\/$/, '');
      }
      return 'https://viva-ai-8asv.vercel.app';
    }
  }
  return process.env.NEXT_PUBLIC_FACULTY_URL || 'http://localhost:3001';
}

export function getStudentPortalUrl(): string {
  if (typeof window !== 'undefined') {
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (!isLocal) {
      const envUrl = process.env.NEXT_PUBLIC_STUDENT_URL;
      if (envUrl && !envUrl.includes('localhost') && !envUrl.includes('127.0.0.1')) {
        return envUrl.replace(/\/$/, '');
      }
      return 'https://viva-ai-delta.vercel.app';
    }
  }
  return process.env.NEXT_PUBLIC_STUDENT_URL || 'http://localhost:3000';
}

