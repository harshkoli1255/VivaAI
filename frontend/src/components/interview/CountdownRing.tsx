'use client';

import { useMemo } from 'react';
import { formatTime } from '@/lib/utils';
import { Clock, CheckCircle2 } from 'lucide-react';

interface CountdownRingProps {
  elapsedSeconds: number; // 0 to 900
  totalSeconds?: number;  // 900
  currentPhase?: string;  // 'warm_up' | 'fundamentals' | 'depth' | 'applied' | 'wrap_up' | 'scoring'
  size?: number;
}

const PHASES = [
  { key: 'warm_up', label: 'Warm-up', range: '0-1m', start: 0, end: 60 },
  { key: 'fundamentals', label: 'Fundamentals', range: '1-5m', start: 60, end: 300 },
  { key: 'depth', label: 'Depth', range: '5-10m', start: 300, end: 600 },
  { key: 'applied', label: 'Applied Problem', range: '10-13m', start: 600, end: 780 },
  { key: 'wrap_up', label: 'Wrap-up', range: '13-14.5m', start: 780, end: 870 },
  { key: 'scoring', label: 'Scoring', range: '14.5-15m', start: 870, end: 900 },
];

export function CountdownRing({
  elapsedSeconds,
  totalSeconds = 900,
  currentPhase,
  size = 140,
}: CountdownRingProps) {
  const remaining = Math.max(0, totalSeconds - elapsedSeconds);
  const progressFraction = Math.min(1, Math.max(0, elapsedSeconds / totalSeconds));

  const strokeWidth = 7;
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
    <div className="flex flex-col items-center select-none">
      <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
        {/* SVG Circular Progress */}
        <svg width={size} height={size} className="rotate-[-90deg]">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="transparent"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-slate-800"
          />

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
            className={`transition-all duration-500 ${
              isFinished
                ? 'text-emerald-400'
                : isLowTime
                ? 'text-rose-500 animate-pulse'
                : 'text-sky-400'
            }`}
          />
        </svg>

        {/* Center Countdown Display */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <Clock className={`w-4 h-4 mb-0.5 ${isLowTime ? 'text-rose-400 animate-bounce' : 'text-sky-400'}`} />
          <span className={`text-2xl font-bold font-mono tracking-tight ${isLowTime ? 'text-rose-400' : 'text-white'}`}>
            {formatTime(remaining)}
          </span>
          <span className="text-[10px] uppercase font-mono tracking-wider text-slate-400">
            {isFinished ? 'Completed' : '15:00 Stop'}
          </span>
        </div>
      </div>

      {/* Phase progress timeline indicator */}
      <div className="mt-3 flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 shadow-sm">
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-xs font-semibold text-slate-200">
          {activePhase.label}
        </span>
        <span className="text-[11px] font-mono text-slate-400">
          {activePhase.range}
        </span>
      </div>

      {/* Structured phase dots bar */}
      <div className="mt-2.5 flex items-center gap-1.5">
        {PHASES.map((p) => {
          const isPassed = elapsedSeconds >= p.end;
          const isCurrent = activePhase.key === p.key;
          return (
            <div
              key={p.key}
              title={`${p.label} (${p.range})`}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                isCurrent
                  ? 'w-6 bg-sky-400 shadow-sm shadow-sky-400/50'
                  : isPassed
                  ? 'w-3 bg-slate-600'
                  : 'w-2 bg-slate-800'
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}
