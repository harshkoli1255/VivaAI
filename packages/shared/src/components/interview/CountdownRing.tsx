'use client';

import { useMemo } from 'react';
import { formatTime } from '@/lib/utils';
import { Clock } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';

interface CountdownRingProps {
  elapsedSeconds: number; // 0 to 900
  totalSeconds?: number;  // 900
  currentPhase?: string;  // 'warm_up' | 'fundamentals' | 'depth' | 'applied' | 'wrap_up' | 'scoring'
  size?: number;
  showPhaseBadge?: boolean;
}

const PHASES = [
  { key: 'warm_up', label: 'Warm-up', range: '0–1m', start: 0, end: 60 },
  { key: 'fundamentals', label: 'Fundamentals', range: '1–5m', start: 60, end: 300 },
  { key: 'depth', label: 'Depth', range: '5–10m', start: 300, end: 600 },
  { key: 'applied', label: 'Applied Problem', range: '10–13m', start: 600, end: 780 },
  { key: 'wrap_up', label: 'Wrap-up', range: '13–14.5m', start: 780, end: 870 },
  { key: 'scoring', label: 'Scoring', range: '14.5–15m', start: 870, end: 900 },
];

export function CountdownRing({
  elapsedSeconds,
  totalSeconds = 900,
  currentPhase,
  size = 130,
  showPhaseBadge = true,
}: CountdownRingProps) {
  const remaining = Math.max(0, totalSeconds - elapsedSeconds);
  const progressFraction = Math.min(1, Math.max(0, elapsedSeconds / totalSeconds));

  const strokeWidth = 6;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - progressFraction * circumference;

  const isLowTime = remaining <= 120 && remaining > 0;
  const isFinished = remaining === 0;

  const activePhase = useMemo(() => {
    if (currentPhase) {
      const found = PHASES.find((p) => p.key === currentPhase);
      if (found) return found;
    }
    return PHASES.find((p) => elapsedSeconds >= p.start && elapsedSeconds < p.end) || PHASES[PHASES.length - 1];
  }, [currentPhase, elapsedSeconds]);

  return (
    <div className="flex flex-col items-center select-none" aria-label={`Exam timer: ${formatTime(remaining)} remaining`}>
      <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
        {/* SVG Circular Track */}
        <svg width={size} height={size} className="rotate-[-90deg]">
          {/* Background Track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="transparent"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-[var(--border-subtle)]"
          />

          {/* Active Progress Arc */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="transparent"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className={`transition-all duration-300 ${
              isFinished
                ? 'text-emerald-600 dark:text-emerald-400'
                : isLowTime
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-blue-600 dark:text-blue-400'
            }`}
          />
        </svg>

        {/* Center Digital Clock readout */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-1">
          <Clock className={`w-3.5 h-3.5 mb-1 ${isLowTime ? 'text-amber-600 dark:text-amber-400' : 'text-[var(--text-muted)]'}`} />
          <span className={`text-xl sm:text-2xl font-bold font-mono tracking-tight leading-none ${isLowTime ? 'text-amber-600 dark:text-amber-400' : 'text-[var(--text-primary)]'}`}>
            {formatTime(remaining)}
          </span>
        </div>
      </div>

      {/* Subtitle placed cleanly outside the ring to eliminate track collision */}
      <span className="mt-2 text-[10px] uppercase font-mono tracking-wider text-[var(--text-muted)] font-medium">
        {isFinished ? 'Completed' : `${Math.round(totalSeconds / 60)}m Hard Stop`}
      </span>

      {/* Current Phase Badge & Segment Indicators (optional) */}
      {showPhaseBadge && (
        <>
          <div className="mt-3 flex items-center gap-1.5">
            <Badge variant={isLowTime ? 'warning' : 'info'} dot>
              <span className="font-semibold">{activePhase.label}</span>
              <span className="text-[10px] font-mono opacity-80">({activePhase.range})</span>
            </Badge>
          </div>

          <div className="mt-2 flex items-center gap-1.5">
            {PHASES.map((p) => {
              const isPassed = elapsedSeconds >= p.end;
              const isCurrent = activePhase.key === p.key;
              return (
                <div
                  key={p.key}
                  title={`${p.label} (${p.range})`}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    isCurrent
                      ? 'w-5 bg-blue-600 dark:bg-blue-400'
                      : isPassed
                      ? 'w-2.5 bg-[var(--text-muted)] opacity-60'
                      : 'w-2 bg-[var(--border-default)]'
                  }`}
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
