'use client';

import React from 'react';
import { Volume2, Mic, Pause, Loader2, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { useTheme } from '@/components/providers/ThemeProvider';
import { AcousticVisualizer } from '@/components/canvas/AcousticVisualizer';

export type OrbState = 'idle' | 'speaking' | 'listening' | 'thinking' | 'error';

interface VoiceOrbProps {
  state: OrbState;
  audioLevel?: number; // 0 to 100
  size?: number;
  showStatusText?: boolean;
}

export function VoiceOrb({
  state = 'idle',
  audioLevel = 0,
  size = 180,
  showStatusText = true,
}: VoiceOrbProps) {
  const { theme } = useTheme();

  const stateConfig = {
    idle: {
      label: 'Ready to start',
      sublabel: 'Waiting for the examiner to begin',
      badgeVariant: 'neutral' as const,
      icon: Pause,
      color: 'text-stone-500 dark:text-stone-400',
    },
    speaking: {
      label: 'Examiner is speaking',
      sublabel: 'Listen to the question · You can interrupt at any time',
      badgeVariant: 'info' as const,
      icon: Volume2,
      color: 'text-emerald-700 dark:text-teal-400',
    },
    listening: {
      label: 'Microphone on · Listening to you',
      sublabel: 'Speak your answer naturally',
      badgeVariant: 'success' as const,
      icon: Mic,
      color: 'text-emerald-700 dark:text-teal-400',
    },
    thinking: {
      label: 'Examiner is thinking',
      sublabel: 'Reviewing your answer and preparing the next question',
      badgeVariant: 'warning' as const,
      icon: Loader2,
      color: 'text-amber-700 dark:text-amber-400',
    },
    error: {
      label: 'Connection paused',
      sublabel: 'Reconnecting audio channel...',
      badgeVariant: 'danger' as const,
      icon: AlertCircle,
      color: 'text-red-700 dark:text-red-400',
    },
  };

  const current = stateConfig[state] || stateConfig.idle;
  const normalizedLevel = Math.min(1, Math.max(0, audioLevel / 100));

  // If state is error, fallback to static warning indicator
  if (state === 'error') {
    return (
      <div className="flex flex-col items-center justify-center py-2 space-y-3" role="status" aria-live="polite">
        <div
          className="relative flex items-center justify-center rounded-full border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40"
          style={{ width: `${size}px`, height: `${size}px` }}
        >
          <AlertCircle className="w-10 h-10 text-red-600 dark:text-red-400" />
        </div>
        <div className="flex flex-col items-center text-center space-y-1">
          <Badge variant="danger" dot>{current.label}</Badge>
          <span className="text-xs text-[var(--text-muted)]">{current.sublabel}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-2 space-y-3" role="status" aria-live="polite">
      {/* Considered Three.js Acoustic Voice Resonance Engine */}
      <div
        className="relative flex items-center justify-center"
        style={{ width: `${size}px`, height: `${size}px` }}
      >
        {/* Luminous dynamic ambient aura */}
        <div
          className={`absolute inset-2 rounded-full blur-2xl transition-all duration-700 pointer-events-none opacity-50 dark:opacity-70 ${
            state === 'speaking'
              ? 'bg-blue-500/30 dark:bg-cyan-500/35 scale-110'
              : state === 'listening'
              ? 'bg-emerald-500/35 dark:bg-teal-400/40 scale-120 animate-pulse'
              : state === 'thinking'
              ? 'bg-amber-500/25 dark:bg-amber-400/25 scale-105'
              : 'bg-emerald-500/10 dark:bg-teal-900/15 scale-95'
          }`}
        />
        <AcousticVisualizer
          state={state as 'idle' | 'speaking' | 'listening' | 'thinking'}
          audioLevel={normalizedLevel}
          size={size}
          theme={theme}
        />
      </div>

      {/* Accessible HTML Status Information (optional) */}
      {showStatusText && (
        <div className="flex flex-col items-center text-center space-y-1">
          <Badge variant={current.badgeVariant} dot>
            {current.label}
          </Badge>
          <span className="text-xs text-[var(--text-muted)]">
            {current.sublabel}
          </span>
        </div>
      )}
    </div>
  );
}

export default VoiceOrb;
