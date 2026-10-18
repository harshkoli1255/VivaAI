'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Subtitles, Volume2, Mic, Eye, EyeOff } from 'lucide-react';
import { formatTime } from '@/lib/utils';

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
  const [showSubtitles, setShowSubtitles] = useState<boolean>(false);
  const [showHistory, setShowHistory] = useState<boolean>(false);

  return (
    <div className="w-full max-w-2xl mx-auto space-y-2 select-none">
      {/* Subtitles & Audio Status Bar */}
      <div className="flex items-center justify-between px-2 text-xs text-slate-400">
        <div className="flex items-center gap-2 font-mono text-[11px]">
          <span
            className={`w-2 h-2 rounded-full ${
              activeSpeaker === 'ai' ? 'bg-sky-400 animate-pulse' : 'bg-emerald-400 animate-pulse'
            }`}
          />
          <span className="font-semibold text-slate-300">
            {activeSpeaker === 'ai' ? 'Examiner Voice Active (Listen)' : 'Candidate Voice Active'}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowSubtitles(!showSubtitles)}
            className="flex items-center gap-1.5 text-[11px] font-mono hover:text-white transition-colors"
            title="Toggle optional text subtitles"
          >
            <Subtitles className={`w-3.5 h-3.5 ${showSubtitles ? 'text-sky-400' : 'text-slate-500'}`} />
            <span>Subtitles: {showSubtitles ? 'On' : 'Off'}</span>
          </button>

          {recentHistory.length > 0 && (
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="flex items-center gap-1 text-[11px] font-mono hover:text-white transition-colors text-slate-400"
            >
              <span>{recentHistory.length} Turns</span>
              {showHistory ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          )}
        </div>
      </div>

      {/* Optional Subtitles / Closed Captions Display */}
      {showSubtitles && (
        <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 backdrop-blur-md shadow-lg transition-all animate-fade-in">
          <div className="text-[10px] font-mono text-slate-500 uppercase tracking-wider mb-1 flex items-center justify-between">
            <span>{activeSpeaker === 'ai' ? 'Examiner Spoken Audio Subtitle' : 'Candidate Audio Subtitle'}</span>
            <span className="text-[9px] text-sky-400 font-mono">CC Active</span>
          </div>
          <p className="text-xs sm:text-sm text-slate-200 leading-relaxed font-mono">
            {currentText || '...'}
          </p>
        </div>
      )}

      {/* Verbatim History Drawer */}
      {showHistory && recentHistory.length > 0 && (
        <div className="glass-panel p-4 max-h-56 overflow-y-auto space-y-2 border border-slate-800">
          <div className="text-[10px] font-mono text-slate-500 uppercase tracking-wider pb-1 border-b border-slate-800">
            Transcript Ledger ({recentHistory.length} Recorded Oral Turns):
          </div>
          {recentHistory.map((item, idx) => (
            <div
              key={idx}
              className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800/80 space-y-0.5 text-xs font-mono"
            >
              <div className="flex items-center justify-between text-[10px]">
                <span className={`font-bold flex items-center gap-1 ${
                  item.speaker === 'ai' ? 'text-sky-400' : 'text-emerald-400'
                }`}>
                  {item.speaker === 'ai' ? <Volume2 className="w-3 h-3" /> : <Mic className="w-3 h-3" />}
                  {item.speaker === 'ai' ? 'Examiner' : 'Candidate'} [Turn #{idx + 1}]
                </span>
                <span className="text-slate-500 text-[10px]">
                  {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              </div>
              <p className="text-slate-300 leading-relaxed text-[11px] pl-4">
                {item.text}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
