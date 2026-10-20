'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  Sparkles,
  Check,
  Play,
  Square,
  ShieldCheck,
} from 'lucide-react';
import { EXAMINER_VOICES, ExaminerVoice, voiceEngine } from '@/lib/speech';

interface VoiceSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedVoiceId: string;
  onSelectVoice: (voiceId: string) => void;
}

export function VoiceSelectorModal({
  isOpen,
  onClose,
  selectedVoiceId,
  onSelectVoice,
}: VoiceSelectorModalProps) {
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [testText, setTestText] = useState<string>('Hello! I am your AI viva examiner today. Let us explore your technical solutions.');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        voiceEngine?.stop();
        setPlayingVoiceId(null);
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handlePlayPreview = (voice: ExaminerVoice) => {
    if (playingVoiceId === voice.id) {
      voiceEngine?.stop();
      setPlayingVoiceId(null);
      return;
    }

    voiceEngine?.stop();
    setPlayingVoiceId(voice.id);
    const prevVoice = voiceEngine?.getVoice() || 'alice';
    voiceEngine?.setVoice(voice.id);

    voiceEngine?.speak(testText || voice.previewSample, {
      onEnd: () => {
        setPlayingVoiceId(null);
        voiceEngine?.setVoice(selectedVoiceId || prevVoice);
      },
      onError: () => {
        setPlayingVoiceId(null);
        voiceEngine?.setVoice(selectedVoiceId || prevVoice);
      },
    });
  };

  const handleSelect = (voiceId: string) => {
    voiceEngine?.stop();
    setPlayingVoiceId(null);
    voiceEngine?.setVoice(voiceId);
    onSelectVoice(voiceId);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="w-full max-w-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="voice-selector-title"
      >
        {/* Header */}
        <div className="px-5 sm:px-6 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between gap-4 bg-[var(--bg-muted)]/30">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shadow-xs">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="voice-selector-title" className="text-base sm:text-lg font-bold text-[var(--text-primary)] tracking-tight">
                  Examiner Voice Persona
                </h2>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  ElevenLabs Studio
                </span>
              </div>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Choose the tone, cadence, and vocal persona for your oral technical examination.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              voiceEngine?.stop();
              setPlayingVoiceId(null);
              onClose();
            }}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-muted)] transition-colors cursor-pointer"
            aria-label="Close voice selector"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Voice Card Grid */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {EXAMINER_VOICES.map((voice) => {
              const isSelected = selectedVoiceId === voice.id;
              const isPlaying = playingVoiceId === voice.id;

              return (
                <div
                  key={voice.id}
                  onClick={() => handleSelect(voice.id)}
                  className={`group relative p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                    isSelected
                      ? 'bg-emerald-500/[0.08] dark:bg-emerald-500/[0.12] border-emerald-500 ring-2 ring-emerald-500/20 shadow-md'
                      : 'bg-[var(--bg-card)] hover:bg-[var(--bg-muted)]/50 border-[var(--border-subtle)] hover:border-emerald-500/40'
                  }`}
                >
                  <div>
                    {/* Top row: Name & Badge */}
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-[var(--text-primary)] flex items-center gap-1.5">
                          {voice.name}
                          {isSelected && (
                            <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-500 text-white text-[10px]">
                              <Check className="w-2.5 h-2.5 stroke-[3]" />
                            </span>
                          )}
                        </span>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-[var(--bg-muted)] text-[var(--text-secondary)] border border-[var(--border-subtle)]">
                        {voice.badge}
                      </span>
                    </div>

                    {/* Tagline */}
                    <p className="text-xs text-[var(--text-secondary)] font-medium leading-relaxed">
                      {voice.tagline}
                    </p>

                    {/* Accent pill */}
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-[10px] font-mono text-[var(--text-muted)] bg-[var(--bg-page)] px-2 py-0.5 rounded border border-[var(--border-subtle)]">
                        {voice.gender === 'female' ? 'Female' : 'Male'} · {voice.accent}
                      </span>
                    </div>
                  </div>

                  {/* Actions Bottom Bar */}
                  <div className="mt-3 pt-2.5 border-t border-[var(--border-subtle)]/60 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePlayPreview(voice);
                      }}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                        isPlaying
                          ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30'
                          : 'bg-[var(--bg-muted)] hover:bg-emerald-500/10 text-[var(--text-primary)] hover:text-emerald-700 dark:hover:text-emerald-300 border border-[var(--border-subtle)]'
                      }`}
                      title="Preview this voice"
                    >
                      {isPlaying ? (
                        <>
                          <Square className="w-3 h-3 fill-current" />
                          <span>Stop</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3 h-3 fill-current" />
                          <span>Listen</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelect(voice.id);
                      }}
                      className={`text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                        isSelected
                          ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-500/10'
                          : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      {isSelected ? 'Active Voice' : 'Select'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Test sentence customizer */}
          <div className="mt-4 p-3 rounded-xl bg-[var(--bg-muted)]/40 border border-[var(--border-subtle)] flex flex-col sm:flex-row items-center gap-2 text-xs">
            <span className="text-[var(--text-muted)] shrink-0 font-medium">Test Prompt:</span>
            <input
              type="text"
              value={testText}
              onChange={(e) => setTestText(e.target.value)}
              className="flex-1 w-full bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg px-2.5 py-1 text-xs text-[var(--text-primary)] focus:outline-none focus:border-emerald-500"
              placeholder="Type anything to test the voice..."
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 sm:px-6 py-3 border-t border-[var(--border-subtle)] bg-[var(--bg-muted)]/20 flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 text-[var(--text-muted)] font-mono text-[11px]">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-teal-400" />
            <span>Studio Voice Output Calibrated</span>
          </div>

          <button
            type="button"
            onClick={() => {
              voiceEngine?.stop();
              setPlayingVoiceId(null);
              onClose();
            }}
            className="px-4 py-1.5 rounded-lg font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors cursor-pointer shadow-xs"
          >
            Apply & Done
          </button>
        </div>
      </div>
    </div>
  );
}
