'use client';

import { useEffect, useRef, useState } from 'react';
import { api, sessionsApi, getApiErrorMessage } from '@/lib/api';

export interface SpeechDraft {
  text: string;
  confidence: number;
  receipt: string;
  words: { word: string; punctuated_word?: string; confidence: number }[];
}

export function SpeechReviewCapture({ sessionId, disabled, initialText = '', onStart, onDraft, onBusy }: {
  sessionId: string; disabled: boolean; initialText?: string; onStart: () => void;
  onDraft: (draft: SpeechDraft) => void; onBusy: (busy: boolean) => void;
}) {
  const [state, setState] = useState<'idle' | 'connecting' | 'recording' | 'transcribing' | 'failed'>('idle');
  const [error, setError] = useState('');
  const [interim, setInterim] = useState('');
  const [hasClip, setHasClip] = useState(false);
  const [language, setLanguage] = useState('en');
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audio = useRef<Blob | null>(null);
  const questionId = useRef<string | null>(null);
  const active = useRef(true);
  const generation = useRef(0);
  const callbacks = useRef({ onDraft, onBusy });
  useEffect(() => { callbacks.current = { onDraft, onBusy }; }, [onDraft, onBusy]);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      if (timer.current) clearTimeout(timer.current);
      if (recorder.current) recorder.current.onstop = null;
      if (recorder.current?.state === 'recording') recorder.current.stop();
      socket.current?.close();
      stream.current?.getTracks().forEach(track => track.stop());
    };
  }, []);

  async function transcribe(blob: Blob) {
    setState('transcribing'); callbacks.current.onBusy(true);
    const attempt = ++generation.current;
    try {
      const response = await api.post<SpeechDraft>(`/sessions/${sessionId}/speech-draft`, blob,
        { headers: { 'Content-Type': blob.type || 'audio/webm' },
          params: { ...(questionId.current ? { question_turn_id: questionId.current } : {}), language } });
      if (!active.current || attempt !== generation.current) return;
      callbacks.current.onDraft({ ...response.data, text: [initialText.trim(), response.data.text].filter(Boolean).join(' ') });
      audio.current = null; setHasClip(false); setError(''); setState('idle');
    } catch (cause) {
      if (active.current && attempt === generation.current) {
        setError(getApiErrorMessage(cause, 'Transcription failed. Retry the saved clip or type your answer.'));
        setState('failed');
      }
    } finally {
      if (active.current && attempt === generation.current) callbacks.current.onBusy(false);
    }
  }

  async function start() {
    if (disabled || ['connecting', 'transcribing', 'recording'].includes(state)) return;
    setError(''); setInterim(''); audio.current = null; setHasClip(false);
    callbacks.current.onBusy(true); setState('connecting');
    const attempt = ++generation.current;
    const prefix = initialText.trim();
    let accepted = false;
    let finished = false;
    let sending = Promise.resolve();
    const valid = () => active.current && attempt === generation.current;
    const fail = (message: string) => {
      if (!valid() || finished) return;
      finished = true;
      if (timer.current) clearTimeout(timer.current);
      setError(message); setState('failed'); callbacks.current.onBusy(false);
      if (recorder.current?.state === 'recording') recorder.current.stop();
      stream.current?.getTracks().forEach(track => track.stop());
      socket.current?.close();
    };
    try {
      onStart();
      const turns = await api.get<{ id: string; speaker: string }[]>(`/transcript/${sessionId}`);
      questionId.current = turns.data.filter(turn => turn.speaker === 'ai').at(-1)?.id || null;
      const ticket = (await sessionsApi.getWsTicket(sessionId)).data;
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (!valid()) { stream.current.getTracks().forEach(track => track.stop()); return; }
      const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(value => MediaRecorder.isTypeSupported(value));
      const capture = new MediaRecorder(stream.current, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 32000 });
      recorder.current = capture;
      const chunks: Blob[] = [];
      const base = (ticket.ws_url || process.env.NEXT_PUBLIC_WS_URL || window.location.origin)
        .replace(/^http:/, 'ws:').replace(/^https:/, 'wss:').replace(/\/$/, '');
      const ws = new WebSocket(`${base}/ws/speech/${sessionId}?ticket=${encodeURIComponent(ticket.ticket)}`);
      socket.current = ws;
      timer.current = setTimeout(() => fail('Voice connection timed out. Retry or type your answer.'), 12000);
      capture.ondataavailable = event => {
        if (!event.data.size) return;
        chunks.push(event.data);
        sending = sending.then(async () => {
          const bytes = await event.data.arrayBuffer();
          if (!valid() || finished) return;
          if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 256 * 1024) {
            fail('Voice connection is too slow. Retry your saved clip or type your answer.'); return;
          }
          ws.send(bytes);
        }).catch(() => fail('Audio could not be sent. Retry your saved clip or type your answer.'));
      };
      capture.onerror = () => fail('Voice recording failed. Retry or type your answer.');
      capture.onstop = () => {
        stream.current?.getTracks().forEach(track => track.stop());
        if (!valid()) return;
        audio.current = new Blob(chunks, { type: capture.mimeType }); setHasClip(true);
        if (!finished) {
          if (timer.current) clearTimeout(timer.current);
          setState('transcribing');
          timer.current = setTimeout(() => fail('Voice finalization timed out. Retry the saved clip.'), 15000);
          void sending.then(() => { if (!finished && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'stop' })); });
        }
      };
      ws.onopen = () => { if (valid()) ws.send(JSON.stringify({ type: 'start', language, question_turn_id: questionId.current })); else ws.close(); };
      ws.onmessage = event => {
        if (!valid() || finished) return;
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'ready' && !accepted) {
            accepted = true;
            if (timer.current) clearTimeout(timer.current);
            capture.start(250); setState('recording');
            timer.current = setTimeout(() => { if (capture.state === 'recording') capture.stop(); }, 90000);
          } else if (data.type === 'interim') {
            setInterim([prefix, data.text].filter(Boolean).join(' '));
          } else if (data.type === 'draft') {
            finished = true; if (timer.current) clearTimeout(timer.current);
            callbacks.current.onDraft({ ...data, text: [prefix, data.text].filter(Boolean).join(' ') }); callbacks.current.onBusy(false);
            audio.current = null; setHasClip(false); setState('idle'); setInterim(''); ws.close();
          } else if (data.type === 'error') fail(data.message);
        } catch { fail('Voice service returned an invalid response. Retry or type your answer.'); }
      };
      ws.onerror = () => fail('Live voice connection failed. Retry your saved clip or type your answer.');
      ws.onclose = () => { if (!finished) fail('Live voice disconnected. Retry your saved clip or type your answer.'); };
    } catch (cause) { fail(getApiErrorMessage(cause, 'Microphone unavailable. You can type your answer.')); }
  }

  const busy = ['connecting', 'recording', 'transcribing'].includes(state);
  return <div className="text-xs text-[var(--text-secondary)]">
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className="btn-secondary px-3 py-2" disabled={state === 'connecting' || state === 'transcribing' || (disabled && state !== 'recording')}
        onClick={() => state === 'recording' ? recorder.current?.stop() : void start()}>
        {state === 'recording' ? 'Stop & review transcript' : state === 'connecting' ? 'Connecting live speech…' : state === 'transcribing' ? 'Finishing transcript…' : initialText.trim() ? 'Continue live transcription' : 'Start live transcription'}
      </button>
      <label className="flex items-center gap-2">Speech language<select aria-label="Speech language" className="form-select !w-auto !py-2" value={language} disabled={busy} onChange={event => setLanguage(event.target.value)}><option value="en">English</option><option value="hi">Hindi</option><option value="multi">Hinglish / mixed</option></select></label>
    </div>
    <p role="status" className="mt-2">{state === 'recording' ? 'Transcribing live — up to 90 seconds. Stop, review and submit when ready.' : 'Your words appear as you speak. You choose when to submit.'}</p>
    {interim && <p aria-label="Live transcript" className="mt-3 rounded-xl bg-[var(--bg-muted)] p-3 leading-relaxed">{interim}</p>}
    {error && <p role="alert" className="mt-2">{error} {hasClip && <button type="button" className="underline" disabled={disabled || state !== 'failed'} onClick={() => audio.current && void transcribe(audio.current)}>Retry saved clip</button>}</p>}
  </div>;
}
