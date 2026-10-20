'use client';

import { useEffect, useRef, useState } from 'react';
import { api, getApiErrorMessage } from '@/lib/api';

export interface SpeechDraft {
  text: string;
  confidence: number;
  receipt: string;
  words: { word: string; punctuated_word?: string; confidence: number }[];
}

export function SpeechReviewCapture({ sessionId, disabled, onStart, onDraft, onBusy }: {
  sessionId: string; disabled: boolean; onStart: () => void;
  onDraft: (draft: SpeechDraft) => void; onBusy: (busy: boolean) => void;
}) {
  const [state, setState] = useState<'idle' | 'recording' | 'transcribing' | 'failed'>('idle');
  const [error, setError] = useState('');
  const [hasClip, setHasClip] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audio = useRef<Blob | null>(null);
  const questionId = useRef<string | null>(null);
  const active = useRef(true);
  const callbacks = useRef({ onDraft, onBusy });
  useEffect(() => { callbacks.current = { onDraft, onBusy }; }, [onDraft, onBusy]);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      if (timer.current) clearTimeout(timer.current);
      if (recorder.current) recorder.current.onstop = null;
      if (recorder.current?.state === 'recording') recorder.current.stop();
      stream.current?.getTracks().forEach(track => track.stop());
    };
  }, []);

  async function transcribe(blob: Blob) {
    setState('transcribing');
    callbacks.current.onBusy(true);
    try {
      const response = await api.post<SpeechDraft>(`/sessions/${sessionId}/speech-draft`, blob,
        { headers: { 'Content-Type': blob.type || 'audio/webm' },
          params: questionId.current ? { question_turn_id: questionId.current } : {} });
      if (!active.current) return;
      callbacks.current.onDraft(response.data);
      audio.current = null;
      setHasClip(false);
      setState('idle');
    } catch (cause) {
      if (active.current) {
        setError(getApiErrorMessage(cause, 'Transcription failed. Retry the saved clip or type your answer.'));
        setState('failed');
      }
    } finally {
      if (active.current) callbacks.current.onBusy(false);
    }
  }

  async function start() {
    if (disabled || state === 'transcribing') return;
    setError('');
    audio.current = null; setHasClip(false);
    callbacks.current.onBusy(true);
    try {
      onStart();
      const turns = await api.get<{ id: string; speaker: string }[]>(`/transcript/${sessionId}`);
      questionId.current = turns.data.filter(turn => turn.speaker === 'ai').at(-1)?.id || null;
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (!active.current) { stream.current.getTracks().forEach(track => track.stop()); return; }
      const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus']
        .find(value => MediaRecorder.isTypeSupported(value));
      const capture = new MediaRecorder(stream.current, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 32000 });
      recorder.current = capture;
      const chunks: Blob[] = [];
      capture.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      capture.onerror = () => {
        setError('Voice recording failed. Your interview recording continues; retry or type your answer.');
        setState('failed'); callbacks.current.onBusy(false);
        stream.current?.getTracks().forEach(track => track.stop());
      };
      capture.onstop = () => {
        if (timer.current) clearTimeout(timer.current);
        stream.current?.getTracks().forEach(track => track.stop());
        const blob = new Blob(chunks, { type: capture.mimeType });
        audio.current = blob;
        setHasClip(true);
        if (active.current) void transcribe(blob);
      };
      capture.start(250);
      setState('recording');
      timer.current = setTimeout(() => { if (capture.state === 'recording') capture.stop(); }, 90000);
    } catch (cause) {
      stream.current?.getTracks().forEach(track => track.stop());
      setError(getApiErrorMessage(cause, 'Microphone unavailable. You can type your answer.'));
      setState('failed'); callbacks.current.onBusy(false);
    }
  }

  return <div className="px-4 pt-4 sm:px-5 text-xs text-[var(--text-secondary)]">
    <button type="button" className="btn-secondary px-3 py-2" disabled={state === 'transcribing' || (disabled && state !== 'recording')}
      onClick={() => state === 'recording' ? recorder.current?.stop() : void start()}>
      {state === 'recording' ? 'Stop & review transcript' : state === 'transcribing' ? 'Transcribing your answer…' : 'Record with enhanced speech'}
    </button>
    <p role="status" className="mt-2">{state === 'recording' ? 'Recording answer — up to 90 seconds. Stop when finished; review before submitting.'
      : 'Enhanced speech uses your syllabus vocabulary. Start with an empty answer, then review the transcript.'}</p>
    {error && <p role="alert" className="mt-2">{error} {hasClip && <button type="button" className="underline" disabled={disabled || state !== 'failed'} onClick={() => audio.current && void transcribe(audio.current)}>Retry saved clip</button>}</p>}
  </div>;
}
