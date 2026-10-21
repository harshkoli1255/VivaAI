'use client';

import { useState, useEffect, useRef } from 'react';
import { Mic, Volume2, CheckCircle2, Play } from 'lucide-react';
import { voiceEngine } from '@/lib/speech';

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
  const mountedRef = useRef(true);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number | null>(null);

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

  return <div className="space-y-5">
    {!textOnly && <>
      <div className="rounded-2xl border border-[var(--border-default)] p-4">
        <div className="mb-3 flex items-center gap-3"><Mic className="h-5 w-5 text-[var(--primary)]" /><div><h3 className="text-sm font-semibold">Microphone</h3><p className="mt-1 text-xs text-[var(--text-secondary)]">Allow access, then say a few words.</p></div></div>
        {micPermission === 'granted' ? <><p role="status" className="text-sm font-medium text-[var(--status-success)]">Microphone ready</p><div role="meter" aria-label="Microphone level" aria-valuenow={audioLevel} aria-valuemin={0} aria-valuemax={100} className="my-3 h-2 overflow-hidden rounded-full bg-[var(--bg-muted)]"><div className="h-full rounded-full bg-[var(--status-success)] transition-all" style={{ width: `${audioLevel}%` }} /></div><button onClick={requestMic} className="text-xs font-medium text-[var(--primary)]">Test again</button></> : <button onClick={requestMic} disabled={requestingMic} className="btn-secondary w-full"><Mic className="h-4 w-4" />{requestingMic ? 'Connecting…' : 'Enable microphone'}</button>}
        {micError && <p role="alert" className="mt-3 text-xs leading-relaxed text-[var(--status-danger)]">{micError}</p>}
      </div>
      <div className="rounded-2xl border border-[var(--border-default)] p-4"><div className="mb-4 flex items-center gap-3"><Volume2 className="h-5 w-5 text-[var(--primary)]" /><div><h3 className="text-sm font-semibold">Sound</h3><p className="mt-1 text-xs text-[var(--text-secondary)]">Make sure you can hear your examiner.</p></div></div><div className="flex flex-wrap gap-2"><button onClick={playTestSpeaker} disabled={isPlayingTestSound} className="btn-secondary flex-1"><Play className="h-4 w-4" />{isPlayingTestSound ? 'Playing…' : 'Test sound'}</button>{speakerTested ? <span className="flex items-center gap-2 px-3 text-sm text-[var(--status-success)]"><CheckCircle2 className="h-4 w-4" />Sound ready</span> : <button onClick={() => setSpeakerTested(true)} className="btn-secondary">I heard the sound</button>}</div></div>
    </>}
    <label className="flex cursor-pointer items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={textOnly} onChange={e => { const enabled=e.target.checked; setTextOnly(enabled); try { sessionStorage.setItem('vivaai_text_only', String(enabled)); } catch {} if (enabled) { streamRef.current?.getTracks().forEach(t => t.stop()); if(animFrameRef.current) cancelAnimationFrame(animFrameRef.current); setMicPermission('idle'); } }} /><span>Use typed answers and on-screen questions<span className="mt-1 block text-xs leading-relaxed text-[var(--text-muted)]">No microphone or speakers needed. The same rubric applies.</span></span></label>
  </div>;
}
