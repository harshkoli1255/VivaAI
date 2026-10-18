'use client';

import { motion } from 'framer-motion';
import { Volume2, Mic, Pause, Loader2, AlertCircle } from 'lucide-react';

export type OrbState = 'idle' | 'speaking' | 'listening' | 'thinking' | 'error';

interface VoiceOrbProps {
  state: OrbState;
  audioLevel?: number; // 0 to 100
  size?: number;
}

export function VoiceOrb({ state = 'idle', audioLevel = 0, size = 180 }: VoiceOrbProps) {
  const stateConfig = {
    idle: {
      label: 'Session Initialized',
      sublabel: 'Awaiting opening syllabus probe',
      pillClass: 'status-pill status-pill-neutral',
      icon: Pause,
      color: '#94a3b8',
      glow: 'rgba(148, 163, 184, 0.1)',
    },
    speaking: {
      label: 'Examiner Inquiring',
      sublabel: 'Listen attentively. Candidate barge-in active.',
      pillClass: 'status-pill status-pill-success',
      icon: Volume2,
      color: '#38bdf8',
      glow: 'rgba(56, 189, 248, 0.25)',
    },
    listening: {
      label: 'Microphone Active · Speaking',
      sublabel: 'State your technical answer clearly.',
      pillClass: 'status-pill status-pill-success',
      icon: Mic,
      color: '#10b981',
      glow: 'rgba(16, 185, 129, 0.25)',
    },
    thinking: {
      label: 'Evaluating Response',
      sublabel: 'Checking syllabus criteria and rubric evidence...',
      pillClass: 'status-pill status-pill-warning',
      icon: Loader2,
      color: '#f59e0b',
      glow: 'rgba(245, 158, 11, 0.25)',
    },
    error: {
      label: 'Audio Stream Interrupted',
      sublabel: 'Reconnecting audio pipeline...',
      pillClass: 'status-pill status-pill-danger',
      icon: AlertCircle,
      color: '#f43f5e',
      glow: 'rgba(244, 63, 94, 0.25)',
    },
  };

  const current = stateConfig[state] || stateConfig.idle;
  const IconComponent = current.icon;
  const normalizedLevel = Math.min(100, Math.max(0, audioLevel));

  return (
    <div className="flex flex-col items-center justify-center select-none py-2 space-y-4">
      {/* Concentric Acoustic Amplitude Ring */}
      <div
        className="relative flex items-center justify-center"
        style={{ width: `${size}px`, height: `${size}px` }}
      >
        {/* Dynamic Glowing Halo */}
        <div
          className="absolute inset-0 rounded-full transition-all duration-300 pointer-events-none"
          style={{
            transform: state === 'speaking' || state === 'listening'
              ? `scale(${1 + (normalizedLevel * 0.003)})`
              : 'scale(1)',
            boxShadow: `0 0 35px 5px ${current.glow}`,
            borderColor: current.color,
            borderWidth: '1px',
            opacity: 0.8,
          }}
        />

        {/* Outer Ring */}
        <div
          className="absolute inset-3 rounded-full border border-slate-800 transition-all duration-300"
          style={{
            transform: state === 'speaking' || state === 'listening'
              ? `scale(${1 + (normalizedLevel * 0.0015)})`
              : 'scale(1)',
          }}
        />

        {/* Center Acoustic Core */}
        <div
          className="relative z-10 w-28 h-28 rounded-full flex flex-col items-center justify-center border border-slate-700/80 bg-slate-900 shadow-2xl transition-all duration-200"
          style={{
            boxShadow: `0 10px 25px -5px ${current.glow}, inset 0 1px 0 rgba(255,255,255,0.1)`,
          }}
        >
          <IconComponent
            className={`w-7 h-7 ${state === 'thinking' ? 'animate-spin' : ''}`}
            style={{ color: current.color }}
          />

          {/* Equalizer Frequency Bars */}
          <div className="flex items-center gap-1 mt-2.5 h-5">
            {[0.3, 0.7, 1, 0.8, 0.4].map((multiplier, i) => (
              <div
                key={i}
                className="w-1 rounded-full transition-all duration-75"
                style={{
                  height: state === 'speaking' || state === 'listening'
                    ? `${Math.max(4, (normalizedLevel * multiplier * 0.18) + 4)}px`
                    : '4px',
                  backgroundColor: state === 'speaking' || state === 'listening'
                    ? current.color
                    : '#475569',
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* State Status Pill */}
      <div className="flex flex-col items-center text-center space-y-1">
        <span className={current.pillClass}>
          <span className="w-2 h-2 rounded-full bg-current animate-pulse" />
          {current.label}
        </span>
        <p className="text-xs text-slate-400 font-mono">
          {current.sublabel}
        </p>
      </div>
    </div>
  );
}
