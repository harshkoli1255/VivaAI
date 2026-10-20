'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Mic,
  Volume2,
  CheckCircle2,
  AlertCircle,
  Play,
  RotateCw,
  Sparkles,
  Zap,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { voiceEngine, EXAMINER_VOICES } from '@/lib/speech';
import { VoiceSelectorModal } from './VoiceSelectorModal';

interface MicCheckProps {
  onReadyChange?: (isReady: boolean) => void;
}

export function MicCheck({ onReadyChange }: MicCheckProps) {
  const [textOnly, setTextOnly] = useState(false);
  const [requestingMic, setRequestingMic] = useState(false);
  const [micPermission, setMicPermission] = useState<'idle' | 'granted' | 'denied'>('idle');
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [speakerTested, setSpeakerTested] = useState<boolean>(false);
  const [isPlayingTestSound, setIsPlayingTestSound] = useState<boolean>(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [showVoiceModal, setShowVoiceModal] = useState<boolean>(false);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>(() => {
    return voiceEngine?.getVoice() || 'alice';
  });

  const mountedRef = useRef(true);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Equalizer bar relative multipliers for realistic audio spectrum visualization
  const barMultipliers = useMemo(
    () => [0.4, 0.7, 1.1, 0.85, 0.6, 0.95, 1.25, 0.75, 0.9, 1.15, 0.8, 0.55, 1.0, 0.7, 0.45, 0.3],
    []
  );

  // Request mic permission and setup real-time analyser
  const requestMic = async () => {
    if (requestingMic) return;
    setRequestingMic(true);
    setTextOnly(false);
    try { sessionStorage.setItem('vivaai_text_only', 'false'); } catch {}
    setMicError(null);
    setMicPermission('idle');
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (audioContextRef.current?.state !== 'closed') void audioContextRef.current?.close();
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone access is not supported in this browser. Please use Google Chrome, Edge, Firefox, or Safari.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (!mountedRef.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      streamRef.current = stream;

      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioContextClass();
      audioContextRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const updateLevel = () => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        const avg = sum / dataArray.length;
        setAudioLevel(Math.min(100, Math.round((avg / 128) * 100)));
        animFrameRef.current = requestAnimationFrame(updateLevel);
      };
      stream.getAudioTracks().forEach((track) => {
        track.onended = () => {
          setMicPermission('denied');
          setMicError('Microphone disconnected. Reconnect it and run the test again, or use typed answers.');
        };
      });
      setMicPermission('granted');
      updateLevel();
    } catch (err) {
      console.warn('Microphone permission request failed:', err);
      setMicPermission('denied');
      setMicError(
        err instanceof Error
          ? err.message
          : 'Microphone permission was denied. Please allow microphone access in your browser address bar.'
      );
    } finally {
      setRequestingMic(false);
    }
  };

  // Quick Pass for development / testing
  const handleSimulatePass = () => {
    setMicPermission('granted');
    setAudioLevel(38);
    setSpeakerTested(true);
  };

  // Play human examiner test voice via VoiceEngine (ElevenLabs Flash v2.5)
  const playTestSpeaker = () => {
    setIsPlayingTestSound(true);
    voiceEngine?.unlockAudio();
    const testPhrase = 'Audio output verified. I am your technical viva examiner. Please confirm you can hear this message.';
    voiceEngine?.speak(testPhrase, {
      onStart: () => {
        setIsPlayingTestSound(true);
      },
      onEnd: () => {
        setIsPlayingTestSound(false);
      },
      onError: () => {
        setIsPlayingTestSound(false);
        setSpeakerTested(false);
        setMicError('Audio playback failed. Retry the speaker test, or use typed answers with on-screen questions.');
      },
    });
  };

  // Clean up media streams and context
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      voiceEngine?.stop();
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
    };
  }, []);

  const isReady = textOnly || (micPermission === 'granted' && speakerTested);

  useEffect(() => {
    onReadyChange?.(isReady);
  }, [isReady, onReadyChange]);

  return (
    <div className="space-y-4">
      <label className="flex items-start gap-3 rounded-lg border border-[var(--border-default)] p-4 text-sm cursor-pointer">
        <input type="checkbox" checked={textOnly} onChange={(event) => {
          const enabled = event.target.checked;
          setTextOnly(enabled);
          try { sessionStorage.setItem('vivaai_text_only', String(enabled)); } catch {}
          if (enabled) {
            streamRef.current?.getTracks().forEach((track) => track.stop());
            if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
            setMicPermission('idle');
          }
        }} className="mt-1" />
        <span>Use typed answers and on-screen questions
          <span className="block text-xs text-[var(--text-secondary)] mt-1">Continue without a microphone or speakers. Your typed answers use the same assessment rubric.</span>
        </span>
      </label>
      {/* ── 1. Microphone Diagnostic Card ── */}
      <div
        className={`rounded-lg border p-4 sm:p-5 transition-all bg-[var(--bg-card)] ${
          micPermission === 'granted'
            ? 'border-emerald-500/40 dark:border-teal-500/30 bg-emerald-950/[0.03] dark:bg-teal-950/[0.10]'
            : micPermission === 'denied'
            ? 'border-red-500/40 bg-red-950/[0.03]'
            : 'border-[var(--border-default)] hover:border-[var(--border-strong)]'
        }`}
      >
        <div className="flex flex-col gap-3">
          {/* Header Row */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 border transition-colors ${
                  micPermission === 'granted'
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-teal-400 border-emerald-500/30'
                    : micPermission === 'denied'
                    ? 'bg-red-500/10 text-red-500 border-red-500/30'
                    : 'bg-[var(--bg-muted)] text-[var(--text-secondary)] border-[var(--border-default)]'
                }`}
              >
                <Mic className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-[var(--text-primary)]">
                    Microphone Input
                  </span>
                  {micPermission === 'granted' ? (
                    <Badge variant="success" dot>Active</Badge>
                  ) : micPermission === 'denied' ? (
                    <Badge variant="danger" dot>Permission Denied</Badge>
                  ) : (
                    <Badge variant="neutral">Not Connected</Badge>
                  )}
                </div>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  Verify speech detection and ambient decibel levels.
                </p>
              </div>
            </div>

            {/* Quick Demo Bypass Pill */}
            {process.env.NEXT_PUBLIC_ALLOW_LOCAL_DEMO === 'true' && micPermission !== 'granted' && (
              <button
                type="button"
                onClick={handleSimulatePass}
                className="hidden sm:inline-flex items-center gap-1 font-mono text-[11px] text-[var(--text-muted)] hover:text-[var(--primary)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] px-2 py-1 rounded transition-colors"
                title="Bypass audio check for local preview"
              >
                <Zap className="w-3 h-3 text-amber-500" />
                <span>Demo Pass</span>
              </button>
            )}
          </div>

          {/* Equalizer Visualizer Strip */}
          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-muted)]/70 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            {/* Visual Equalizer Spectrum */}
            <div className="flex items-end gap-1.5 h-8 px-1">
              {barMultipliers.map((mult, idx) => {
                const isActive = micPermission === 'granted';
                const level = isActive ? Math.max(12, Math.min(100, audioLevel * mult * 2.2)) : 10;
                const heightPx = Math.max(4, Math.round((level / 100) * 28));

                return (
                  <div
                    key={idx}
                    className="w-1.5 rounded-full transition-all duration-75"
                    style={{
                      height: `${heightPx}px`,
                      backgroundColor: !isActive
                        ? 'var(--border-strong)'
                        : level > 65
                        ? '#f59e0b'
                        : '#10b981',
                      opacity: isActive ? 0.95 : 0.35,
                    }}
                  />
                );
              })}
            </div>

            {/* Status Feedback */}
            <div className="text-xs text-[var(--text-secondary)] font-medium flex items-center gap-2">
              {micPermission === 'granted' ? (
                <span className="flex items-center gap-1.5 text-emerald-700 dark:text-teal-300">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  {audioLevel > 15 ? 'Clear voice signal detected' : 'Microphone connected · Speak to test'}
                </span>
              ) : micPermission === 'denied' ? (
                <span className="text-red-600 dark:text-red-400 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  Access blocked in browser
                </span>
              ) : (
                <span className="text-[var(--text-muted)]">
                  Click below to grant microphone access
                </span>
              )}
            </div>
          </div>

          {/* Action Row */}
          <div className="flex items-center gap-2 pt-1">
            {micPermission !== 'granted' ? (
              <button
                type="button"
                onClick={requestMic}
                disabled={requestingMic || textOnly}
                className="btn-primary w-full text-xs font-semibold py-2.5 min-h-[44px]"
              >
                <Mic className="w-4 h-4" />
                <span>Enable & Test Microphone</span>
              </button>
            ) : (
              <div className="w-full flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-teal-300 bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 rounded flex-1 min-h-[44px]">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span>Microphone Calibrated & Active</span>
                </div>
                <button
                  type="button"
                  onClick={requestMic}
                  className="btn-secondary text-xs px-3 min-h-[44px] shrink-0"
                  title="Re-calibrate microphone"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Re-test</span>
                </button>
              </div>
            )}
          </div>

          {/* Error Message if Denied */}
          {micPermission === 'denied' && (
            <div className="p-3 rounded bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1">
                <span>{micError || 'Microphone access was blocked. Please enable it in browser site settings.'}</span>
                {process.env.NEXT_PUBLIC_ALLOW_LOCAL_DEMO === 'true' && <div className="mt-2">
                  <button
                    type="button"
                    onClick={handleSimulatePass}
                    className="font-semibold underline text-red-700 dark:text-red-300 hover:text-red-900"
                  >
                    Bypass with Demo Sound (Testing only)
                  </button>
                </div>}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── 2. Speaker & Sound Output Card ── */}
      <div
        className={`rounded-lg border p-4 sm:p-5 transition-all bg-[var(--bg-card)] ${
          speakerTested
            ? 'border-emerald-500/40 dark:border-teal-500/30 bg-emerald-950/[0.03] dark:bg-teal-950/[0.10]'
            : 'border-[var(--border-default)] hover:border-[var(--border-strong)]'
        }`}
      >
        <div className="flex flex-col gap-3">
          {/* Header Row */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 border transition-colors ${
                  speakerTested
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-teal-400 border-emerald-500/30'
                    : 'bg-[var(--bg-muted)] text-[var(--text-secondary)] border-[var(--border-default)]'
                }`}
              >
                <Volume2 className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-[var(--text-primary)]">
                    Speaker & Audio Output
                  </span>
                  {speakerTested ? (
                    <Badge variant="success" dot>Verified</Badge>
                  ) : (
                    <Badge variant="neutral">Not Tested</Badge>
                  )}
                </div>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  Confirm you can hear the AI examiner clearly with studio ElevenLabs audio.
                </p>
              </div>
            </div>

            {speakerTested && (
              <span className="inline-flex items-center gap-1 font-mono text-xs text-emerald-600 dark:text-teal-400 font-semibold shrink-0">
                <CheckCircle2 className="w-4 h-4" />
                <span>Ready</span>
              </span>
            )}
          </div>

          {/* Examiner Voice Audition & Persona Row */}
          <div className="p-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-muted)]/50 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-md bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              </div>
              <div>
                <div className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-wider">
                  Examiner Voice Persona
                </div>
                <div className="text-xs font-semibold text-[var(--text-primary)]">
                  {EXAMINER_VOICES.find((v) => v.id === selectedVoiceId)?.name || 'Alice'} ·{' '}
                  <span className="text-[var(--text-secondary)] font-normal">
                    {EXAMINER_VOICES.find((v) => v.id === selectedVoiceId)?.tagline}
                  </span>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowVoiceModal(true)}
              className="btn-secondary text-[11px] font-semibold py-1 px-2.5 min-h-[32px] shrink-0"
            >
              Change Voice
            </button>
          </div>

          {/* Action Row */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
            <button
              type="button"
              onClick={playTestSpeaker}
              disabled={isPlayingTestSound}
              className={`flex-1 text-xs font-semibold py-2.5 min-h-[44px] ${
                speakerTested ? 'btn-secondary' : 'btn-primary'
              }`}
            >
              {isPlayingTestSound ? (
                <>
                  <RotateCw className="w-4 h-4 animate-spin text-[var(--primary)]" />
                  <span>Playing Examiner Voice (ElevenLabs)...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  <span>{speakerTested ? 'Re-test Examiner Voice' : 'Test Examiner Voice (ElevenLabs)'}</span>
                </>
              )}
            </button>

            {!speakerTested ? (
              <button
                type="button"
                onClick={() => setSpeakerTested(true)}
                className="btn-secondary text-xs font-medium py-2.5 min-h-[44px] shrink-0"
              >
                <span>I heard the sound</span>
              </button>
            ) : (
              <div className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-teal-300 font-medium px-3 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded shrink-0 min-h-[44px]">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <span>Speaker Verified</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <VoiceSelectorModal
        isOpen={showVoiceModal}
        onClose={() => setShowVoiceModal(false)}
        selectedVoiceId={selectedVoiceId}
        onSelectVoice={(vid) => {
          setSelectedVoiceId(vid);
          voiceEngine?.setVoice(vid);
        }}
      />
    </div>
  );
}
