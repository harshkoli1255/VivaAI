'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Subtitles, Volume2, Mic } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';

interface TranscriptItem {
  speaker: 'ai' | 'student';
  text: string;
  timestamp: number;
}

interface LiveCaptionsProps {
  currentText: string;
  activeSpeaker: 'ai' | 'student';
  recentHistory?: TranscriptItem[];
}

export function LiveCaptions({
  currentText,
  activeSpeaker = 'ai',
  recentHistory = [],
}: LiveCaptionsProps) {
  const [showSubtitles, setShowSubtitles] = useState<boolean>(true);
  const [showHistory, setShowHistory] = useState<boolean>(false);

  return (
    <div className="w-full max-w-2xl mx-auto space-y-2.5">
      {/* Subtitles & Status Bar */}
      <div className="flex items-center justify-between px-1 text-xs">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              activeSpeaker === 'ai'
                ? 'bg-blue-600 dark:bg-blue-400 animate-pulse'
                : 'bg-emerald-600 dark:bg-emerald-400 animate-pulse'
            }`}
          />
          <span className="font-medium text-[var(--text-secondary)] text-xs">
            {activeSpeaker === 'ai' ? 'Examiner audio channel active' : 'Candidate speech capturing'}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowSubtitles(!showSubtitles)}
            className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            title="Toggle closed captions display"
          >
            <Subtitles className={`w-3.5 h-3.5 ${showSubtitles ? 'text-blue-600 dark:text-blue-400' : ''}`} />
            <span>Captions: {showSubtitles ? 'On' : 'Off'}</span>
          </button>

          {recentHistory.length > 0 && (
            <button
              type="button"
              onClick={() => setShowHistory(!showHistory)}
              className="flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              <span>{recentHistory.length} Recorded Turns</span>
              {showHistory ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>

      {/* Closed Captions Box */}
      {showSubtitles && (
        <div className="p-4 rounded-lg bg-[var(--bg-card)] border border-[var(--border-default)] shadow-sm space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)] border-b border-[var(--border-subtle)] pb-1.5">
            <span className="font-semibold uppercase tracking-wider">
              {activeSpeaker === 'ai' ? 'Examiner Spoken Prompt' : 'Candidate Audio Transcript'}
            </span>
            <Badge variant="neutral">Live Caption</Badge>
          </div>
          <p className="text-sm text-[var(--text-primary)] leading-relaxed font-normal min-h-[1.5rem]">
            {currentText || 'Listening for speech input...'}
          </p>
        </div>
      )}

      {/* Verbatim Turn History Drawer */}
      {showHistory && recentHistory.length > 0 && (
        <div className="p-4 rounded-lg bg-[var(--bg-card)] border border-[var(--border-default)] shadow-sm max-h-56 overflow-y-auto space-y-2.5">
          <div className="text-xs font-semibold text-[var(--text-muted)] pb-1 border-b border-[var(--border-subtle)] flex items-center justify-between">
            <span>Official Examination Turn Ledger:</span>
            <span className="font-mono">{recentHistory.length} Turns</span>
          </div>
          {recentHistory.map((item, idx) => (
            <div
              key={idx}
              className="p-3 rounded-md bg-[var(--bg-muted)] border border-[var(--border-subtle)] space-y-1 text-xs"
            >
              <div className="flex items-center justify-between">
                <span className={`font-semibold flex items-center gap-1.5 ${
                  item.speaker === 'ai' ? 'text-blue-700 dark:text-blue-400' : 'text-emerald-700 dark:text-emerald-400'
                }`}>
                  {item.speaker === 'ai' ? <Volume2 className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                  {item.speaker === 'ai' ? 'Examiner' : 'Candidate'} [Turn #{idx + 1}]
                </span>
                <span className="text-[10px] font-mono text-[var(--text-muted)]">
                  {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              </div>
              <p className="text-[var(--text-secondary)] leading-relaxed text-xs pl-5">
                {item.text}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
