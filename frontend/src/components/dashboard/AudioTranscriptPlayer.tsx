'use client';

import { useState, useRef, useEffect } from 'react';
import { Play, Pause, RotateCcw, Volume2, User, Mic, Clock, Quote, Sparkles } from 'lucide-react';
import { formatTime } from '@/lib/utils';

export interface TranscriptTurn {
  id: string;
  turn_index: number;
  speaker: 'interviewer' | 'student';
  text: string;
  timestamp_secs: number;
  phase?: string;
  answer_label?: string | null;
  stt_confidence?: number | null;
}

interface AudioTranscriptPlayerProps {
  turns: TranscriptTurn[];
  audioUrl?: string | null;
  highlightedTurnId?: string | null;
  onTurnClick?: (turn: TranscriptTurn) => void;
}

export function AudioTranscriptPlayer({
  turns = [],
  audioUrl,
  highlightedTurnId,
  onTurnClick,
}: AudioTranscriptPlayerProps) {
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);

  // Compute total duration from last turn or 15 minutes default
  const totalDuration = turns.length > 0
    ? Math.max(900, Math.ceil(turns[turns.length - 1].timestamp_secs + 15))
    : 900;

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isPlaying) {
      interval = setInterval(() => {
        setCurrentTime((prev) => {
          if (prev >= totalDuration) {
            setIsPlaying(false);
            return 0;
          }
          return prev + 1;
        });
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isPlaying, totalDuration]);

  const togglePlay = () => {
    setIsPlaying(!isPlaying);
  };

  const jumpToTurn = (turn: TranscriptTurn) => {
    setCurrentTime(turn.timestamp_secs);
    setIsPlaying(true);
    onTurnClick?.(turn);
  };

  const restartAudio = () => {
    setCurrentTime(0);
    setIsPlaying(false);
  };

  return (
    <div className="space-y-4">
      {/* Audio Playback Controls Header */}
      <div className="glass-panel p-4 space-y-3 border border-slate-800">
        <div className="flex items-center justify-between text-xs font-mono">
          <div className="flex items-center gap-2 text-white font-semibold">
            <Volume2 className="w-4 h-4 text-sky-400" />
            <span>Synchronized Hearing Audio (Opus Master)</span>
          </div>
          <span className="text-slate-400 font-mono">
            {formatTime(currentTime)} / {formatTime(totalDuration)}
          </span>
        </div>

        {/* Progress Bar / Scrub */}
        <div
          className="relative w-full h-2.5 bg-slate-900 border border-slate-800 rounded-full overflow-hidden cursor-pointer"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const frac = (e.clientX - rect.left) / rect.width;
            setCurrentTime(Math.round(frac * totalDuration));
          }}
        >
          <div
            className="h-full bg-gradient-to-r from-sky-500 to-indigo-500 rounded-full transition-all duration-100"
            style={{ width: `${Math.min(100, (currentTime / totalDuration) * 100)}%` }}
          />
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-2">
            <button
              onClick={togglePlay}
              className="btn-primary py-1.5 px-3.5 text-xs font-semibold"
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span>{isPlaying ? 'Pause Playback' : 'Play Hearing Audio'}</span>
            </button>
            <button
              onClick={restartAudio}
              className="btn-secondary py-1.5 px-2.5 text-xs"
              title="Rewind to start"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>

          <span className="text-[11px] font-mono text-slate-400 hidden sm:inline">
            Click any turn below to scrub audio & inspect citation
          </span>
        </div>
      </div>

      {/* Verbatim Transcript Turn List */}
      <div className="glass-panel p-4 max-h-[480px] overflow-y-auto space-y-3 border border-slate-800">
        {turns.length > 0 && turns.filter((t) => t.speaker === 'student').length === 0 && (
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300 font-mono flex items-center gap-2">
            <Mic className="w-4 h-4 text-amber-400 shrink-0" />
            <span>Candidate remained silent during this examination. Only examiner questions are logged below.</span>
          </div>
        )}

        {turns.length === 0 ? (
          <div className="py-12 px-6 text-center border border-dashed border-slate-800 rounded-xl space-y-3">
            <div className="w-12 h-12 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto text-slate-500">
              <Mic className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h4 className="text-sm font-semibold text-slate-200">No Oral Statements Recorded</h4>
              <p className="text-xs text-slate-400 font-mono max-w-sm mx-auto">
                Candidate was silent throughout this examination session. No audio answers were captured or submitted.
              </p>
            </div>
          </div>
        ) : (
          turns.map((turn) => {
          const isTurnActive =
            currentTime >= turn.timestamp_secs &&
            currentTime < turn.timestamp_secs + 20;
          const isCited =
            highlightedTurnId === turn.id ||
            highlightedTurnId === `turn-${turn.turn_index + 1}` ||
            highlightedTurnId === `t-${turn.turn_index + 1}`;

          return (
            <div
              key={turn.id}
              onClick={() => jumpToTurn(turn)}
              className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                isTurnActive
                  ? 'bg-sky-500/10 border-sky-500 shadow-md shadow-sky-500/10'
                  : isCited
                  ? 'bg-amber-500/10 border-amber-500 shadow-md shadow-amber-500/10'
                  : 'bg-slate-900/80 border-slate-800/80 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between text-xs font-mono mb-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`font-bold uppercase tracking-wider text-[11px] flex items-center gap-1 ${
                      turn.speaker === 'interviewer'
                        ? 'text-sky-400'
                        : 'text-emerald-400'
                    }`}
                  >
                    {turn.speaker === 'interviewer' ? <Volume2 className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                    {turn.speaker === 'interviewer' ? 'Examiner' : 'Candidate'}
                  </span>
                  <span className="text-[10px] text-slate-400 font-bold bg-slate-800 px-1.5 py-0.5 rounded">
                    [Turn #{turn.turn_index + 1}]
                  </span>
                  {turn.phase && (
                    <span className="text-[10px] text-slate-400 font-mono">
                      · {turn.phase}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono">
                  {turn.answer_label && (
                    <span
                      className={`status-pill text-[9px] py-0 px-2 ${
                        turn.answer_label === 'strong'
                          ? 'status-pill-success'
                          : turn.answer_label === 'dont_know'
                          ? 'status-pill-danger'
                          : 'status-pill-warning'
                      }`}
                    >
                      {turn.answer_label}
                    </span>
                  )}
                  <span>{formatTime(turn.timestamp_secs)}</span>
                </div>
              </div>

              <p className="text-xs sm:text-sm text-slate-200 leading-relaxed font-mono">
                {turn.text}
              </p>
            </div>
          );
        }))}
      </div>
    </div>
  );
}
