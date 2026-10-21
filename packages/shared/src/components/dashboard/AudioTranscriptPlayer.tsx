'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Volume2,
  User,
  Mic,
  Search,
  Copy,
  Check,
} from 'lucide-react';
import { formatTime, phaseLabel } from '@/lib/utils';
import { api, resolveApiUrl } from '@/lib/api';
import { Badge } from '@/components/ui/Badge';

export interface TranscriptTurn {
  id: string;
  turn_index: number;
  speaker: 'interviewer' | 'student' | 'ai' | 'candidate';
  text: string;
  timestamp_secs: number;
  phase?: string;
  answer_label?: string | null;
  stt_confidence?: number | null;
  answer_metadata?: { reviewed?: boolean; original_text?: string; corrected?: boolean } | null;
  classifier_confidence?: number | null;
}

function activityLabel(type: string) {
  return type === 'tab_switch' ? 'Tab switch' : type === 'long_silence' ? 'Extended silence' : type === 'multiple_voices' ? 'Multiple voices · review' : 'Session activity';
}

export interface ProctoringEvent {
  event_type: 'tab_switch' | 'long_silence' | string;
  timestamp_secs: number;
  question_id?: string | null;
  question_text?: string | null;
  phase?: string;
  message?: string;
}

interface AudioTranscriptPlayerProps {
  turns: TranscriptTurn[];
  audioUrl?: string | null;
  highlightedTurnId?: string | null;
  proctoringEvents?: ProctoringEvent[];
  onTurnClick?: (turn: TranscriptTurn) => void;
}

export function AudioTranscriptPlayer({
  turns = [],
  audioUrl,
  highlightedTurnId,
  proctoringEvents = [],
  onTurnClick,
}: AudioTranscriptPlayerProps) {
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [audioDuration, setAudioDuration] = useState<number>(0);
  const [audioError, setAudioError] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [speakerFilter, setSpeakerFilter] = useState<'all' | 'student' | 'interviewer' | 'graded'>('all');
  const [copiedTranscript, setCopiedTranscript] = useState(false);
  const [playingTurnId, setPlayingTurnId] = useState<string | null>(null);
  const [isSynthPlaying, setIsSynthPlaying] = useState<boolean>(false);

  const audioRef = useRef<HTMLAudioElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Auto-resolve relative audio URLs with API backend base URL
  const apiBase = resolveApiUrl();
  const recordingUrl = useMemo(() => {
    if (!audioUrl) return null;
    if (/^(https?:|blob:)/.test(audioUrl)) return audioUrl;
    return `${apiBase}${audioUrl.startsWith('/') ? '' : '/'}${audioUrl}`;
  }, [audioUrl, apiBase]);
  const [effectiveAudioUrl, setEffectiveAudioUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    async function loadAudio() {
      if (!recordingUrl) { setEffectiveAudioUrl(null); return; }
      try {
        if (recordingUrl.startsWith('blob:')) { setEffectiveAudioUrl(recordingUrl); return; }
        const response = await api.get<Blob>(recordingUrl.startsWith('/api/v1/') ? recordingUrl.slice('/api/v1'.length) : recordingUrl, { responseType: 'blob' });
        if (!active) return;
        objectUrl = URL.createObjectURL(response.data);
        setEffectiveAudioUrl(objectUrl);
        setAudioError(false);
      } catch {
        if (active) { setEffectiveAudioUrl(null); setAudioError(true); }
      }
    }
    void loadAudio();
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [recordingUrl]);

  const totalDuration = audioDuration || Math.max(1, Math.ceil((turns[turns.length - 1]?.timestamp_secs || 0) + 15));

  // Sync scrubber when external citation highlights a turn
  useEffect(() => {
    if (!highlightedTurnId) return;
    const match = turns.find(
      (turn) => turn.id === highlightedTurnId || `turn-${turn.id}` === highlightedTurnId
    );
    if (match) {
      if (audioRef.current) audioRef.current.currentTime = match.timestamp_secs;
    }
  }, [highlightedTurnId, turns]);

  // Adjust playback speed
  const changeSpeed = (rate: number) => {
    setPlaybackRate(rate);
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
  };

  const isAiSpeaker = (spk: string) => spk === 'interviewer' || spk === 'ai';
  const isCandidateSpeaker = (spk: string) => spk === 'student' || spk === 'candidate';

  const playWithSynth = (turn: TranscriptTurn) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(turn.text);
    utt.rate = playbackRate;
    const isAi = isAiSpeaker(turn.speaker);
    utt.pitch = isAi ? 1.05 : 0.95;

    setIsSynthPlaying(true);
    setPlayingTurnId(turn.id);
    utt.onend = () => {
      setIsSynthPlaying(false);
      setPlayingTurnId(null);
    };
    utt.onerror = () => {
      setIsSynthPlaying(false);
      setPlayingTurnId(null);
    };
    window.speechSynthesis.speak(utt);
  };

  const handlePlayTurn = (turn: TranscriptTurn) => {
    if (playingTurnId === turn.id && (isPlaying || isSynthPlaying)) {
      if (audioRef.current && !audioRef.current.paused) {
        audioRef.current.pause();
      }
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      setIsSynthPlaying(false);
      setIsPlaying(false);
      setPlayingTurnId(null);
      return;
    }

    setPlayingTurnId(turn.id);
    setCurrentTime(turn.timestamp_secs);
    onTurnClick?.(turn);

    if (effectiveAudioUrl && !audioError && audioRef.current) {
      audioRef.current.currentTime = turn.timestamp_secs;
      audioRef.current
        .play()
        .then(() => {
          setIsPlaying(true);
        })
        .catch(() => {
          playWithSynth(turn);
        });
    } else {
      playWithSynth(turn);
    }
  };

  const togglePlay = async () => {
    if (isSynthPlaying) {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      setIsSynthPlaying(false);
      setPlayingTurnId(null);
      return;
    }

    if (!audioRef.current || !effectiveAudioUrl || audioError) {
      const targetTurn = turns.find((t) => t.timestamp_secs >= currentTime) || turns[0];
      if (targetTurn) handlePlayTurn(targetTurn);
      return;
    }

    if (audioRef.current.paused) {
      try {
        await audioRef.current.play();
        setIsPlaying(true);
      } catch {
        setAudioError(true);
        const targetTurn = turns.find((t) => t.timestamp_secs >= currentTime) || turns[0];
        if (targetTurn) handlePlayTurn(targetTurn);
      }
    } else {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  };

  const jumpToTurn = (turn: TranscriptTurn) => {
    handlePlayTurn(turn);
  };

  const restartAudio = () => {
    setCurrentTime(0);
    setIsPlaying(false);
    setIsSynthPlaying(false);
    setPlayingTurnId(null);
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  };

  const seekTo = (value: number) => {
    const nextTime = Math.max(0, Math.min(totalDuration, value));
    setCurrentTime(nextTime);
    if (audioRef.current) audioRef.current.currentTime = nextTime;
  };

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seekTo(ratio * totalDuration);
  };

  const copyVerbatimText = async () => {
    const transcriptText = turns
      .map(
        (t) =>
          `[${formatTime(t.timestamp_secs)}] ${
            isAiSpeaker(t.speaker) ? 'Examiner' : 'Candidate'
          }: ${t.text}`
      )
      .join('\n\n');
    try {
      await navigator.clipboard.writeText(transcriptText);
      setCopiedTranscript(true);
      setTimeout(() => setCopiedTranscript(false), 2000);
    } catch {
      // Fallback
    }
  };

  // Filtered turns based on search query & speaker filter
  const filteredTurns = useMemo(() => {
    return turns.filter((turn) => {
      // Speaker filter
      if (speakerFilter === 'student' && !isCandidateSpeaker(turn.speaker)) return false;
      if (speakerFilter === 'interviewer' && !isAiSpeaker(turn.speaker)) return false;
      if (speakerFilter === 'graded' && !turn.answer_label) return false;

      // Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const textMatch = turn.text.toLowerCase().includes(query);
        const phaseMatch = turn.phase?.toLowerCase().includes(query);
        const labelMatch = turn.answer_label?.toLowerCase().includes(query);
        if (!textMatch && !phaseMatch && !labelMatch) return false;
      }
      return true;
    });
  }, [turns, speakerFilter, searchQuery]);

  // Determine which turn is active based on current playback time
  const activeTurnId = useMemo(() => {
    let currentId: string | null = null;
    for (let i = 0; i < turns.length; i++) {
      if (turns[i].timestamp_secs <= currentTime) {
        currentId = turns[i].id;
      } else {
        break;
      }
    }
    return currentId;
  }, [turns, currentTime]);

  // Synthetic waveform amplitude bars for visual scrubber
  const waveformBars = useMemo(() => {
    return [
      25, 45, 60, 30, 75, 90, 40, 65, 80, 50, 70, 95, 35, 60, 85, 40, 75, 55, 90,
      30, 45, 85, 70, 50, 65, 95, 80, 40, 60, 75, 35, 55, 90, 70, 45, 80, 65, 50,
      85, 60, 40, 70, 95, 50, 30, 65, 80, 45,
    ];
  }, []);

  return (
    <div className="space-y-4">
      {/* ── Audio Playback & Waveform Scrubber Console ── */}
      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] p-4 sm:p-5 space-y-4 shadow-sm">
        {/* Top Header Row */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-2 font-semibold text-[var(--text-primary)]">
            <Volume2 className="w-4 h-4 text-[var(--primary)]" />
            <span>Session recording</span>
            <Badge variant={effectiveAudioUrl && !audioError ? 'success' : 'neutral'} className="text-[10px] py-0 px-1.5">
              {effectiveAudioUrl && !audioError ? 'Saved recording' : 'Transcript available'}
            </Badge>
          </div>
          <div className="flex shrink-0 items-center gap-2 font-mono text-xs tabular-nums">
            <span className="font-bold text-[var(--primary)]">{formatTime(currentTime)}</span>
            <span className="text-[var(--text-muted)]">/</span>
            <span className="text-[var(--text-secondary)]">{formatTime(totalDuration)}</span>
          </div>
        </div>

        {effectiveAudioUrl && (
          <audio
            ref={audioRef}
            src={effectiveAudioUrl}
            className="sr-only"
            preload="metadata"
            onLoadedMetadata={(e) =>
              setAudioDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)
            }
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => {
              setIsPlaying(false);
              setPlayingTurnId(null);
            }}
            onError={() => setAudioError(true)}
          />
        )}

        {audioError && (
          <p role="alert" className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
            <Volume2 className="w-3.5 h-3.5" />
            <span>Recording unavailable. The transcript read-aloud below uses synthesized speech.</span>
          </p>
        )}

        {/* ── Interactive Waveform Timeline ── */}
        <div
          ref={timelineRef}
          role="slider"
          tabIndex={0}
          aria-label="Recording position"
          aria-valuemin={0}
          aria-valuemax={totalDuration}
          aria-valuenow={Math.min(currentTime, totalDuration)}
          aria-valuetext={`${formatTime(currentTime)} of ${formatTime(totalDuration)}`}
          onKeyDown={(event) => {
            const positions: Record<string, number> = { ArrowRight: currentTime + 5, ArrowLeft: currentTime - 5, Home: 0, End: totalDuration };
            if (event.key in positions) { event.preventDefault(); seekTo(Math.max(0, Math.min(totalDuration, positions[event.key]))); }
          }}
          onClick={handleTimelineClick}
          className="relative h-12 w-full bg-[var(--bg-muted)] rounded-lg border border-[var(--border-subtle)] p-2 cursor-pointer flex items-center justify-between gap-1 overflow-hidden group select-none"
          title="Click to seek anywhere in the examination recording"
        >
          {/* Progress Overlay */}
          <div
            className="absolute top-0 left-0 bottom-0 bg-[var(--accent-subtle)] border-r-2 border-[var(--primary)] pointer-events-none transition-all duration-75"
            style={{ width: `${Math.min(100, (currentTime / totalDuration) * 100)}%` }}
          />

          {/* Equalizer Waveform Bars */}
          {waveformBars.map((bar, i) => {
            const barProgress = (i / waveformBars.length) * 100;
            const currentProgress = (currentTime / totalDuration) * 100;
            const isPlayed = barProgress <= currentProgress;

            return (
              <div
                key={i}
                className="flex-1 rounded-full transition-colors duration-100 z-10"
                style={{
                  height: `${Math.max(6, Math.round((bar / 100) * 36))}px`,
                  backgroundColor: isPlayed ? 'var(--primary)' : 'var(--border-strong)',
                  opacity: isPlayed ? 0.9 : 0.35,
                }}
              />
            );
          })}

          {/* Correlated Proctoring Timeline Anomaly Pins */}
          {proctoringEvents.map((evt, idx) => {
            const leftPct = Math.max(1, Math.min(99, (evt.timestamp_secs / totalDuration) * 100));
            const isTabSwitch = evt.event_type === 'tab_switch';
            return (
              <div
                key={`proctor-pin-${idx}`}
                onClick={(e) => {
                  e.stopPropagation();
                  seekTo(evt.timestamp_secs);
                }}
                className={`absolute top-0 bottom-0 w-1.5 z-20 cursor-pointer hover:w-2.5 transition-all ${
                  isTabSwitch ? 'bg-rose-500' : 'bg-amber-400'
                }`}
                style={{ left: `${leftPct}%` }}
                title={`${activityLabel(evt.event_type)} at ${formatTime(evt.timestamp_secs)}${
                  evt.question_text ? ` during question: "${evt.question_text.slice(0, 40)}..."` : ''
                }`}
              >
                <div
                  className={`absolute -top-1 -left-1.5 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold text-white shadow-md border border-white/50 ${
                    isTabSwitch ? 'bg-rose-600' : 'bg-amber-500'
                  }`}
                >
                  {isTabSwitch ? '!' : '⏱'}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Correlated Proctoring Timeline Quick-Jump Strip ── */}
        {proctoringEvents.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs">
            <span className="font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
              Session activity ({proctoringEvents.length} events logged):
            </span>
            <div className="flex flex-wrap gap-1.5">
              {proctoringEvents.map((evt, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => seekTo(evt.timestamp_secs)}
                  className="px-2 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border-default)] hover:border-rose-500 text-[11px] font-mono flex items-center gap-1 transition-colors"
                  title="Click to jump to this point in the verbatim recording"
                >
                  <span className={evt.event_type === 'tab_switch' ? 'text-rose-600 dark:text-rose-400 font-bold' : 'text-amber-600 dark:text-amber-400 font-bold'}>
                    {activityLabel(evt.event_type)}
                  </span>
                  <span className="text-[var(--text-muted)]">@{formatTime(evt.timestamp_secs)}</span>
                  {evt.question_text && (
                    <span className="text-[var(--text-secondary)] truncate max-w-[130px] text-[10px]">
                      ({evt.question_text})
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Controls & Speed Strip ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1 border-t border-[var(--border-subtle)]">
          {/* Play / Pause / Rewind */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={togglePlay}
              className="btn-primary text-xs px-3.5 min-h-[38px] flex items-center gap-1.5 shadow-sm cursor-pointer"
              title="Play viva audio recording"
            >
              {isPlaying || isSynthPlaying ? (
                <Pause className="w-3.5 h-3.5 fill-current" />
              ) : (
                <Play className="w-3.5 h-3.5 fill-current" />
              )}
              <span>{isPlaying || isSynthPlaying ? 'Pause Audio' : 'Play Audio'}</span>
            </button>

            <button
              type="button"
              onClick={restartAudio}
              className="btn-secondary text-xs px-2.5 min-h-[38px]"
              title="Restart recording from beginning"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>

            {/* Speed Selector Pills */}
            <div className="flex items-center gap-1 bg-[var(--bg-muted)] p-1 rounded-lg border border-[var(--border-subtle)]">
              {[1, 1.25, 1.5, 2].map((rate) => (
                <button
                  key={rate}
                  type="button"
                  onClick={() => changeSpeed(rate)}
                  className={`min-h-9 min-w-9 px-2 py-1 text-[11px] font-mono rounded-md font-semibold transition-colors ${
                    playbackRate === rate
                      ? 'bg-[var(--primary)] text-[var(--primary-fg)] shadow-xs'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {rate}x
                </button>
              ))}
            </div>
          </div>

          {/* Copy Transcript Button */}
          <button
            type="button"
            onClick={copyVerbatimText}
            className="btn-secondary text-xs px-3 min-h-[38px] flex items-center gap-1.5"
            title="Copy full verbatim transcript to clipboard"
          >
            {copiedTranscript ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-emerald-600 dark:text-teal-300 font-semibold">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                <span>Copy Transcript</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── Search & Filter Controls ── */}
      <div className="flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-3 bg-[var(--bg-card)] p-3 rounded-lg border border-[var(--border-default)]">
        {/* Search Input */}
        <div className="relative min-w-0 flex-1">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search dialogue keywords (e.g., deadlock, mutex, LRU)..."
            aria-label="Search transcript"
            className="min-h-11 w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-[var(--bg-muted)] border border-[var(--border-subtle)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--primary)]"
          />
        </div>

        {/* Filter Chips */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <button
            type="button"
            onClick={() => setSpeakerFilter('all')}
            aria-pressed={speakerFilter === 'all'}
            className={`min-h-10 px-2.5 py-2 rounded-lg text-[11px] font-semibold transition-colors ${
              speakerFilter === 'all'
                ? 'bg-[var(--primary)] text-[var(--primary-fg)]'
                : 'bg-[var(--bg-muted)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]'
            }`}
          >
            All Turns ({turns.length})
          </button>
          <button
            type="button"
            onClick={() => setSpeakerFilter('student')}
            aria-pressed={speakerFilter === 'student'}
            className={`min-h-10 px-2.5 py-2 rounded-lg text-[11px] font-semibold transition-colors ${
              speakerFilter === 'student'
                ? 'bg-[var(--primary)] text-[var(--primary-fg)]'
                : 'bg-[var(--bg-muted)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]'
            }`}
          >
            Candidate ({turns.filter((t) => isCandidateSpeaker(t.speaker)).length})
          </button>
          <button
            type="button"
            onClick={() => setSpeakerFilter('interviewer')}
            aria-pressed={speakerFilter === 'interviewer'}
            className={`min-h-10 px-2.5 py-2 rounded-lg text-[11px] font-semibold transition-colors ${
              speakerFilter === 'interviewer'
                ? 'bg-[var(--primary)] text-[var(--primary-fg)]'
                : 'bg-[var(--bg-muted)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]'
            }`}
          >
            Examiner ({turns.filter((t) => isAiSpeaker(t.speaker)).length})
          </button>
          <button
            type="button"
            onClick={() => setSpeakerFilter('graded')}
            aria-pressed={speakerFilter === 'graded'}
            className={`min-h-10 px-2.5 py-2 rounded-lg text-[11px] font-semibold transition-colors ${
              speakerFilter === 'graded'
                ? 'bg-[var(--primary)] text-[var(--primary-fg)]'
                : 'bg-[var(--bg-muted)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]'
            }`}
          >
            Evaluated ({turns.filter((t) => t.answer_label).length})
          </button>
        </div>
      </div>

      {/* ── Verbatim Transcript Turns List ── */}
      <div className="max-h-[560px] space-y-3 overflow-y-auto pr-1">
        {turns.length > 0 && turns.filter((t) => isCandidateSpeaker(t.speaker)).length === 0 && (
          <div className="p-3.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2">
            <Mic className="w-4 h-4 text-amber-500 shrink-0" />
            <span>Candidate remained silent during this viva. Only examiner inquiries were recorded.</span>
          </div>
        )}

        {filteredTurns.length === 0 ? (
          <div className="p-10 text-center border border-dashed border-[var(--border-default)] rounded-xl space-y-2 bg-[var(--bg-card)]">
            <div className="w-10 h-10 rounded-full bg-[var(--bg-muted)] flex items-center justify-center mx-auto text-[var(--text-muted)]">
              <Search className="w-5 h-5" />
            </div>
            <p className="text-xs text-[var(--text-secondary)] font-medium">
              No transcript turns match your filter &quot;{searchQuery}&quot;.
            </p>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setSpeakerFilter('all');
              }}
              className="text-xs font-semibold text-[var(--primary)] underline"
            >
              Clear filters
            </button>
          </div>
        ) : (
          filteredTurns.map((turn) => {
            const isHighlighted = highlightedTurnId === turn.id;
            const isInterviewer = isAiSpeaker(turn.speaker);
            const isTurnPlaying =
              (activeTurnId === turn.id && isPlaying) ||
              (playingTurnId === turn.id && (isPlaying || isSynthPlaying));

            return (
              <div
                key={turn.id}
                id={turn.id.startsWith('turn-') ? turn.id : `turn-${turn.id}`}
                onClick={() => jumpToTurn(turn)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    jumpToTurn(turn);
                  }
                }}
                className={`w-full rounded-xl border p-4 text-left text-xs transition-all cursor-pointer relative group ${
                  isHighlighted
                    ? 'border-emerald-500 dark:border-teal-400 bg-emerald-500/[0.06] dark:bg-teal-500/[0.10] ring-1 ring-emerald-500/30 shadow-sm'
                    : isTurnPlaying
                    ? 'border-[var(--primary)] bg-[var(--accent-subtle)] shadow-xs'
                    : 'border-[var(--border-default)] bg-[var(--bg-card)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-card-hover)]'
                }`}
              >
                {/* Header Strip */}
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs mb-3 pb-3 border-b border-[var(--border-subtle)]">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span
                      className={`font-bold flex items-center gap-1.5 px-2 py-0.5 rounded text-xs ${
                        isInterviewer
                          ? 'text-[var(--primary)] bg-[var(--accent-subtle)] border border-[var(--primary)]/20'
                          : 'text-emerald-700 dark:text-teal-300 bg-emerald-500/10 border border-emerald-500/20'
                      }`}
                    >
                      {isInterviewer ? <Volume2 className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
                      <span>{isInterviewer ? 'Examiner' : 'Candidate'}</span>
                    </span>

                    <span className="font-mono text-[11px] text-[var(--text-muted)]">
                      Turn #{turn.turn_index + 1}
                    </span>

                    {turn.phase && (
                      <Badge variant="neutral" className="text-[10px] py-0 px-1.5 font-mono">
                        {phaseLabel(turn.phase)}
                      </Badge>
                    )}

                    {isTurnPlaying && (
                      <span className="flex items-center gap-1 text-[11px] font-semibold text-[var(--primary)] animate-pulse">
                        <Volume2 className="w-3 h-3" />
                        <span>Playing</span>
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {turn.answer_label && (
                      <Badge
                        variant={
                          turn.answer_label === 'strong'
                            ? 'success'
                            : turn.answer_label === 'partial'
                            ? 'warning'
                            : turn.answer_label === 'dont_know'
                            ? 'neutral'
                            : 'danger'
                        }
                      >
                        {turn.answer_label === 'strong'
                          ? 'Strong Answer'
                          : turn.answer_label === 'partial'
                          ? 'Partial (Hinted)'
                          : turn.answer_label === 'dont_know'
                          ? 'Skipped (No Penalty)'
                          : 'Off-Topic'}
                      </Badge>
                    )}

                    <span className="font-mono text-[11px] text-[var(--text-muted)] bg-[var(--bg-muted)] px-2 py-0.5 rounded border border-[var(--border-subtle)]">
                      {formatTime(turn.timestamp_secs)}
                    </span>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePlayTurn(turn);
                      }}
                      className={`flex min-h-9 items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
                        isTurnPlaying
                          ? 'bg-[var(--primary)] text-[var(--primary-fg)] shadow-xs'
                          : 'bg-[var(--bg-muted)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border-subtle)] border border-[var(--border-subtle)]'
                      }`}
                      title={isTurnPlaying ? 'Pause audio' : 'Play audio for this turn'}
                    >
                      {isTurnPlaying ? (
                        <>
                          <Pause className="w-3 h-3 fill-current" />
                          <span>Pause</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3 h-3 fill-current" />
                          <span>Play</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Associated Correlated Proctoring Anomaly Marker */}
                {proctoringEvents
                  .filter((evt) =>
                    (evt.question_id && (evt.question_id === turn.id || `turn-${evt.question_id}` === turn.id)) ||
                    Math.abs(evt.timestamp_secs - turn.timestamp_secs) <= 15
                  )
                  .map((evt, aIdx) => (
                    <div
                      key={aIdx}
                      className="mb-2 px-2.5 py-1.5 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-[11px] flex items-center justify-between"
                    >
                      <span className="flex items-center gap-1.5 font-semibold">
                        <span>{activityLabel(evt.event_type)}</span>
                        <span className="font-normal opacity-80 text-[10px]">— {evt.message || 'Activity recorded; review context'}</span>
                      </span>
                      <span className="font-mono text-[10px] font-bold">@{formatTime(evt.timestamp_secs)}</span>
                    </div>
                  ))}

                {/* Turn Dialogue Text */}
                <p className="whitespace-pre-wrap break-words text-sm text-[var(--text-primary)] leading-relaxed font-normal">
                  {turn.text}
                </p>
                {turn.answer_metadata?.reviewed && <p className="mt-2 text-xs text-[var(--text-muted)]">
                  Candidate reviewed this transcript{turn.answer_metadata.corrected ? ' and corrected the speech recognition' : ''}.
                </p>}
                {turn.answer_metadata?.corrected && <details className="mt-2 text-xs text-[var(--text-muted)]">
                  <summary>Original speech recognition</summary><p>{turn.answer_metadata.original_text}</p>
                </details>}

                {/* Subtle Hover Action Hint */}
                <div className="mt-2 pt-2 border-t border-[var(--border-subtle)]/60 flex items-center justify-between text-[11px] text-[var(--text-muted)] opacity-60 group-hover:opacity-100 transition-opacity">
                  <span className="flex items-center gap-1 font-mono">
                    <Play className="w-2.5 h-2.5 fill-current text-[var(--primary)]" />
                    <span>Click to seek audio to {formatTime(turn.timestamp_secs)}</span>
                  </span>
                  {turn.stt_confidence !== null && turn.stt_confidence !== undefined && (
                    <span className="font-mono text-[10px]">
                      Recognition confidence: {Math.round(turn.stt_confidence * 100)}%
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default AudioTranscriptPlayer;
