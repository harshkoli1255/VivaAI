'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { AudioLines, Mic, Volume2, VolumeX, CheckCircle2, ArrowRight, RotateCcw } from 'lucide-react';
import { useAuthStore } from '@/store';
import type { OrbState } from '@/components/interview/VoiceOrb';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/providers/ToastProvider';
import { voiceEngine } from '@/lib/speech';
import { sessionsApi } from '@/lib/api';
import { getFacultyPortalUrl } from '@/lib/utils';
import { SpeechReviewCapture, SpeechDraft } from '@/components/interview/SpeechReviewCapture';
import { DurableRecorder, syncRecording } from '@/lib/recording';

const VIVA_PHASES = [
  { key: 'warm_up', label: 'Warm-up', index: '01', range: '0–1m' },
  { key: 'fundamentals', label: 'Fundamentals', index: '02', range: '1–5m' },
  { key: 'depth', label: 'Deep Dive', index: '03', range: '5–10m' },
  { key: 'applied', label: 'Applied Problem', index: '04', range: '10–13m' },
  { key: 'wrap_up', label: 'Wrap-up', index: '05', range: '13–15m' },
];

interface TranscriptItem {
  speaker: 'ai' | 'student';
  text: string;
  timestamp: number;
}

interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onresult: ((event: {
    resultIndex: number;
    results: {
      length: number;
      [index: number]: {
        isFinal: boolean;
        length: number;
        [index: number]: { transcript: string };
      };
    };
  }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start: (audioTrack?: MediaStreamTrack) => void;
  stop: () => void;
  abort: () => void;
}

const FALLBACK_EXAM_TURNS = [
  {
    phase: 'warm_up',
    question: "Welcome to your oral technical viva examination. I am your examiner today, and we will evaluate your systems programming, database internals, and concurrency fundamentals. To begin: briefly describe your hands-on background building distributed systems.",
  },
  {
    phase: 'fundamentals',
    question: "Let's examine core concurrency fundamentals: What are the four Coffman conditions necessary for a system deadlock to occur, and how does enforcing a strict lock acquisition hierarchy prevent circular wait?",
  },
  {
    phase: 'fundamentals',
    question: "Compare user-level green threads with kernel-level threads. What are the context-switch CPU overheads and cache invalidation trade-offs between them?",
  },
  {
    phase: 'depth',
    question: "Now let's explore database storage engines: Explain Write-Ahead Logging in PostgreSQL. How does it maintain the ACID durability guarantee across an unexpected operating system panic?",
  },
  {
    phase: 'applied',
    question: "Consider an applied concurrency scenario: You have a distributed bounded queue with multiple concurrent producer and consumer workers. How do you design it with mutexes and condition variables to eliminate lost wakeups and spurious wakeups?",
  },
  {
    phase: 'wrap_up',
    question: "To conclude your viva: In modern multi-core NUMA architectures, what are the primary throughput and latency trade-offs between spinlocks and sleeping futexes under extreme lock contention?",
  },
];
const ALLOW_LOCAL_DEMO = process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_MOCK_MODE === 'true';

function isAcousticEcho(spokenText: string, promptText: string): boolean {
  if (!promptText || !spokenText) return false;
  const cleanSpoken = spokenText.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();
  const cleanPrompt = promptText.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();
  if (!cleanSpoken) return true;
  if (cleanPrompt.includes(cleanSpoken) && cleanSpoken.length >= 4) return true;
  const promptWords = new Set(cleanPrompt.split(/\s+/).filter((w) => w.length > 2));
  const spokenWords = cleanSpoken.split(/\s+/).filter((w) => w.length > 2);
  if (spokenWords.length === 0) return true;
  let matches = 0;
  for (const w of spokenWords) {
    if (promptWords.has(w)) matches++;
  }
  return matches / spokenWords.length >= 0.5;
}

export default function LiveInterviewPage() {
  const params = useParams();
  const sessionId = params?.id as string;
  const router = useRouter();
  const { user, isAuthenticated, hasHydrated } = useAuthStore();
  const { showToast } = useToast();

  // State
  const [hasStartedAudio, setHasStartedAudio] = useState(false);
  const [orbState, setOrbState] = useState<OrbState>('idle');
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [totalDuration, setTotalDuration] = useState<number>(900);
  const [currentPhase, setCurrentPhase] = useState<string>('warm_up');
  const [currentPromptText, setCurrentPromptText] = useState<string>('');
  const currentPromptTextRef = useRef<string>('');
  useEffect(() => { currentPromptTextRef.current = currentPromptText; }, [currentPromptText]);
  const [candidateSpeechText, setCandidateSpeechText] = useState<string>('');
  const [isSpeechRecognitionSupported, setIsSpeechRecognitionSupported] = useState<boolean>(true);
  const [activeSpeaker, setActiveSpeaker] = useState<'ai' | 'student'>('ai');
  const [history, setHistory] = useState<TranscriptItem[]>([]);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isLocalDemo, setIsLocalDemo] = useState(false);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isMuted] = useState<boolean>(false);
  const [isAudioOutputMuted, setIsAudioOutputMuted] = useState<boolean>(false);
  const [, setAudioLevel] = useState<number>(0);
  const [micError, setMicError] = useState<string | null>(null);
  const [showEndModal, setShowEndModal] = useState<boolean>(false);
  const [selectedVoiceId] = useState<string>(() => voiceEngine?.getVoice() || 'alice');
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const finishingRef = useRef(false);
  const serverEndedRef = useRef(false);
  const selectedVoiceRef = useRef(selectedVoiceId);
  const outputMutedRef = useRef(isAudioOutputMuted);
  useEffect(() => { selectedVoiceRef.current = selectedVoiceId; }, [selectedVoiceId]);
  useEffect(() => { outputMutedRef.current = isAudioOutputMuted; }, [isAudioOutputMuted]);

  const [textInput, setTextInput] = useState<string>('');
  const [codeDraft, setCodeDraft] = useState('');
  const withCode = (text: string) => codeDraft.trim() ? `${text}\n\nCode snippet (not executed):\n${codeDraft}` : text;
  const [speechDraft, setSpeechDraft] = useState<SpeechDraft | null>(null);
  const [speechCaptureVersion, setSpeechCaptureVersion] = useState(0);
  const candidateInputRef = useRef<HTMLTextAreaElement>(null);
  const [cloudBusy, setCloudBusy] = useState(false);
  const cloudBusyRef = useRef(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [, setIsTextMode] = useState<boolean>(false);
  const [fallbackTurnIndex, setFallbackTurnIndex] = useState<number>(0);
  const fallbackStartedRef = useRef(false);

  const [isSpeechActive, setIsSpeechActive] = useState<boolean>(false);
  const [examinerStatus, setExaminerStatus] = useState<string | null>(null);
  const isListeningRef = useRef(false);
  const isCompletedRef = useRef(isCompleted);
  useEffect(() => { isCompletedRef.current = isCompleted; }, [isCompleted]);

  // Conversational Turn-Taking (Auto-submit spoken answer on natural silence pause - OFF by default)
  const [isAutoSendEnabled] = useState<boolean>(false);
  const [, setAutoSubmitCountdown] = useState<number | null>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const candidateTextRef = useRef<string>('');
  const isAutoSendEnabledRef = useRef<boolean>(false);
  useEffect(() => { isAutoSendEnabledRef.current = isAutoSendEnabled; }, [isAutoSendEnabled]);

  // Audio recording & VAD refs for robust turn-taking and archiving
  const durableRecorderRef = useRef<DurableRecorder | null>(null);
  const [recordingStatus, setRecordingStatus] = useState('Recording has not started');
  const [sessionClockReady, setSessionClockReady] = useState(false);
  const elapsedRef = useRef(0);
  const activeSpeechRef = useRef<string | null>(null);
  const isStudentSpeakingVADRef = useRef<boolean>(false);
  const lastCandidateVocalTimeRef = useRef<number>(0);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setAutoSubmitCountdown(null);
  }, []);

  const pendingAnswerRef = useRef<{ type: string; text: string; answer_id: string; timestamp: number; speech_receipt?: string } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const speechStreamRef = useRef<MediaStream | null>(null);
  const recognitionStartingRef = useRef(false);
  const animFrameRef = useRef<number | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const recognitionRetriesRef = useRef(0);
  const recognitionRestartRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMutedRef = useRef(isMuted);
  const showToastRef = useRef(showToast);
  const activeSpeakerRef = useRef(activeSpeaker);
  const handleSubmitCandidateAnswerRef = useRef<(text: string, reviewed?: boolean) => void>(() => {});
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
  useEffect(() => { showToastRef.current = showToast; }, [showToast]);
  useEffect(() => { activeSpeakerRef.current = activeSpeaker; }, [activeSpeaker]);

  useEffect(() => {
    if (!hasHydrated) return;
    if (!isAuthenticated) router.replace('/login');
    else if (user?.role !== 'student') {
      // Cross-origin portal handoff: local storage credentials are not shared between apps.
      window.location.assign(`${getFacultyPortalUrl()}/login`);
    }
  }, [hasHydrated, isAuthenticated, user?.role, router]);

  useEffect(() => {
    let active = true;
    sessionsApi.get(sessionId).then((response) => {
      if (!active) return;
      const session = response.data;
      const configuredDuration = session?.viva_config?.total_duration_secs;
      if (typeof configuredDuration === 'number' && configuredDuration > 0) setTotalDuration(configuredDuration);
      setElapsedSeconds(session.elapsed_secs || 0);
      setCurrentPhase(session.current_phase || 'warm_up');
      if (['completed', 'flagged'].includes(session.status)) {
        isCompletedRef.current = true;
        setIsCompleted(true);
      }
      if (!session.consent_given) {
        setConnectionError('Recording consent is required. Return to check-in before joining.');
        return;
      }
      try {
        const savedText = sessionStorage.getItem(`vivaai_draft_${sessionId}`) || '';
        candidateTextRef.current = savedText;
        setCandidateSpeechText(savedText);
        setTextInput(savedText);
        setCodeDraft(sessionStorage.getItem(`vivaai_code_${sessionId}`) || '');
        const savedSpeech = sessionStorage.getItem(`vivaai_speech_draft_${sessionId}`);
        if (savedSpeech) {
          const draft = JSON.parse(savedSpeech);
          if (draft && typeof draft.text === 'string' && typeof draft.receipt === 'string' && Array.isArray(draft.words)) setSpeechDraft(draft);
        }
      } catch {}
      setDraftLoaded(true);
      setSessionLoaded(true);
      try {
        if (sessionStorage.getItem('vivaai_direct_start') === 'true') setHasStartedAudio(true);
      } catch {}
    }).catch(() => {
      if (active) setConnectionError('Could not load your examination. Check your connection and retry.');
    });
    return () => { active = false; };
  }, [sessionId, connectionAttempt]);

  useEffect(() => {
    if (!draftLoaded) return;
    try {
      if (codeDraft) sessionStorage.setItem(`vivaai_code_${sessionId}`, codeDraft);
      else sessionStorage.removeItem(`vivaai_code_${sessionId}`);
    } catch {}
  }, [sessionId, codeDraft, draftLoaded]);

  // Keep an unsent answer in this tab so a reload cannot silently erase it.
  useEffect(() => {
    if (!draftLoaded) return;
    try {
      if (textInput.trim()) sessionStorage.setItem(`vivaai_draft_${sessionId}`, textInput);
      else sessionStorage.removeItem(`vivaai_draft_${sessionId}`);
    } catch {}
  }, [sessionId, textInput, draftLoaded]);

  useEffect(() => {
    if (!draftLoaded) return;
    try {
      if (speechDraft) sessionStorage.setItem(`vivaai_speech_draft_${sessionId}`, JSON.stringify(speechDraft));
      else sessionStorage.removeItem(`vivaai_speech_draft_${sessionId}`);
    } catch {}
  }, [sessionId, speechDraft, draftLoaded]);
  useEffect(() => {
    if (!hasStartedAudio || isCompleted) return;
    const protectExam = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', protectExam);
    return () => window.removeEventListener('beforeunload', protectExam);
  }, [hasStartedAudio, isCompleted]);

  const startSpeechRecognitionRef = useRef<() => void>(() => {});
  // Speech Recognition capture (STT) with auto-restart on silent timeouts & conversational pause auto-submit
  const startSpeechRecognition = useCallback(async () => {
    if (cloudBusyRef.current) return;
    if (typeof window === 'undefined' || isMutedRef.current || isCompletedRef.current || !isListeningRef.current) return;
    if (recognitionStartingRef.current) return;
    if (recognitionRestartRef.current) clearTimeout(recognitionRestartRef.current);
    recognitionRestartRef.current = null;
    const windowSpeech = window as unknown as {
      SpeechRecognition?: new () => BrowserSpeechRecognition;
      webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
    };
    const SpeechRecognitionClass =
      windowSpeech.SpeechRecognition ||
      windowSpeech.webkitSpeechRecognition;
    if (!SpeechRecognitionClass) {
      isListeningRef.current = false;
      setIsSpeechRecognitionSupported(false);
      setIsTextMode(true);
      return;
    }

    try {
      recognitionStartingRef.current = true;
      // Recognition applies its own speech processing. Feed it the selected
      // microphone without the recording stream's additional noise filtering.
      if (!speechStreamRef.current?.getAudioTracks().some((track) => track.readyState === 'live')) {
        const deviceId = micStreamRef.current?.getAudioTracks()[0]?.getSettings().deviceId;
        const stream = await navigator.mediaDevices.getUserMedia({ audio: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          echoCancellation: false, noiseSuppression: false, autoGainControl: false,
        } });
        if (!isListeningRef.current || isMutedRef.current || isCompletedRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        speechStreamRef.current = stream;
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.onstart = null;
          recognitionRef.current.onresult = null;
          recognitionRef.current.onerror = null;
          recognitionRef.current.onend = null;
          recognitionRef.current.abort();
        } catch {}
        recognitionRef.current = null;
      }

      const recognition = new SpeechRecognitionClass();
      // Each recognition instance appends only to the visible draft at its start.
      // Browser results are cumulative within an instance, so never append them
      // to the previous result or a separate hidden speech history.
      const draftBeforeSpeech = candidateTextRef.current.trim();
      // Restart after each utterance.
      // Chrome's continuous track mode can omit words between partial results.
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      isListeningRef.current = true;
      setIsSpeechActive(true);

      recognition.onstart = () => {
        if (recognitionRef.current !== recognition || !isListeningRef.current || isCompletedRef.current) {
          recognition.abort();
          return;
        }
        isListeningRef.current = true;
        setIsSpeechActive(true);
        setOrbState('listening');
        setActiveSpeaker('student');
      };

      recognition.onresult = (event) => {
        if (recognitionRef.current !== recognition || !isListeningRef.current || isCompletedRef.current) return;
        recognitionRetriesRef.current = 0;
        let currentFinal = '';
        let interim = '';

        for (let i = 0; i < event.results.length; ++i) {
          const item = event.results[i];
          if (item && item[0]) {
            if (item.isFinal) {
              currentFinal += item[0].transcript + ' ';
            } else {
              interim += item[0].transcript;
            }
          }
        }

        const currentSpokenText = (
          (draftBeforeSpeech ? draftBeforeSpeech + ' ' : '') +
          currentFinal +
          interim
        ).trim();

        if (currentSpokenText) {
          const isAiSpeakingNow =
            voiceEngine?.isSpeaking() || activeSpeakerRef.current === 'ai';

          // While AI examiner is speaking the question aloud:
          if (isAiSpeakingNow) {
            // Check if audio is acoustic feedback echo from laptop speakers reading the question
            const isEcho = isAcousticEcho(currentSpokenText, currentPromptTextRef.current);
            const wordCount = currentSpokenText.split(/\s+/).filter(Boolean).length;

            // Reject echo and short noises (coughs, throat clearing, 1-2 words)
            // AI questions must NOT be cut off by ambient sounds!
            if (isEcho || wordCount < 3) {
              return;
            }

            // Only deliberate candidate speech with >= 3 distinct non-echo words can interrupt
            voiceEngine?.stop();
            setActiveSpeaker('student');
            setOrbState('listening');
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: 'barge_in' }));
            }
          }

          candidateTextRef.current = currentSpokenText;
          setCandidateSpeechText(currentSpokenText);
          setTextInput(currentSpokenText);
          setOrbState('listening');

          // Candidate is actively speaking: clear any existing auto-submit countdown!
          clearSilenceTimer();

          // Conversational Turn-Taking: Auto-submit only on substantial silence pause (5s) if candidate spoke >= 4 words
          if (isAutoSendEnabledRef.current && !isMutedRef.current && !isCompletedRef.current) {
            const wordCount = currentSpokenText.split(/\s+/).filter(Boolean).length;
            if (wordCount >= 4) {
              let remainingSecs = 5;
              setAutoSubmitCountdown(remainingSecs);

              countdownIntervalRef.current = setInterval(() => {
                remainingSecs -= 1;
                if (remainingSecs > 0) {
                  setAutoSubmitCountdown(remainingSecs);
                } else {
                  if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
                  countdownIntervalRef.current = null;
                }
              }, 1000);

              silenceTimerRef.current = setTimeout(() => {
                clearSilenceTimer();
                const textToSend = candidateTextRef.current.trim();
                if (textToSend && isListeningRef.current) {
                  handleSubmitCandidateAnswerRef.current(textToSend, false);
                }
              }, 5200);
            }
          }
        }
      };

      recognition.onerror = (e) => {
        if (recognitionRef.current !== recognition) return;
        console.warn('Speech recognition notice:', e?.error);
        if (e.error === 'no-speech') {
          recognitionRetriesRef.current += 1;
          if (recognitionRetriesRef.current >= 3) {
            isListeningRef.current = false;
            setIsSpeechActive(false);
            setMicError('No speech detected. Check your microphone and tap to retry, or type your answer.');
          }
          return;
        }
        if (['network', 'language-not-supported', 'audio-capture'].includes(e.error)) {
          isListeningRef.current = false;
          setIsSpeechActive(false);
          setIsTextMode(true);
          setMicError(e.error === 'network'
            ? 'Chrome speech recognition could not connect. Your draft is saved. Retry voice input or type your answer.'
            : 'Voice capture is unavailable. Check your microphone and browser language, or type your answer.');
          return;
        }
        if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(e?.error)) {
          isListeningRef.current = false;
          setIsTextMode(true);
        }
        if (e?.error === 'not-allowed') {
          setIsSpeechActive(false);
          setMicError('Microphone permission blocked by browser. Click the site settings lock in your address bar to Allow Microphone, or use text mode.');
        } else if (e?.error === 'service-not-allowed') {
          setIsSpeechRecognitionSupported(false);
          setIsSpeechActive(false);
        } else if (e?.error === 'no-speech' || e?.error === 'audio-capture') {
          // Natural pause in speech; onend will seamlessly restart
        }
      };

      recognition.onend = () => {
        if (recognitionRef.current !== recognition) return;
        recognitionRef.current = null;
        setIsSpeechActive(false);
        // The visible draft already includes the latest final/interim result.
        // Automatic restarts take a fresh snapshot of that draft.
        // If the candidate is still active and unmuted, safely restart with fresh instance
        if (isListeningRef.current && !isMutedRef.current && !isCompletedRef.current) {
          recognitionRestartRef.current = setTimeout(() => {
            if (isListeningRef.current && !isMutedRef.current && !isCompletedRef.current) {
              try {
                startSpeechRecognitionRef.current();
              } catch {
                // Ignore if already starting or active
              }
            }
          }, Math.min(2000, 300 * (recognitionRetriesRef.current + 1)));
        }
      };

      // Use the same selected microphone as recording and the input meter.
      // Calling start() without a track can select a different default device.
      const audioTrack = speechStreamRef.current?.getAudioTracks().find((track) => track.readyState === 'live');
      recognitionRef.current = recognition;
      if (audioTrack) recognition.start(audioTrack);
      else recognition.start();
    } catch (err) {
      console.warn('Speech recognition start notice:', err);
      isListeningRef.current = false;
      setIsSpeechActive(false);
      setMicError('Voice input could not start. Check your microphone and tap to retry, or type your answer.');
    } finally {
      recognitionStartingRef.current = false;
    }
  }, [clearSilenceTimer]);

  const editCandidateDraft = (text: string) => {
    clearSilenceTimer();
    // Manual corrections are authoritative. Retire the old recognizer before
    // changing the draft so late browser results cannot undo an edit.
    isListeningRef.current = false;
    if (recognitionRestartRef.current) clearTimeout(recognitionRestartRef.current);
    recognitionRestartRef.current = null;
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try { recognition.abort(); } catch {}
    }
    setIsSpeechActive(false);
    candidateTextRef.current = text;
    setCandidateSpeechText(text);
    setTextInput(text);
  };

  const clearCandidateAnswer = () => {
    editCandidateDraft('');
    setCodeDraft('');
    setSpeechDraft(null);
    setSpeechCaptureVersion(version => version + 1);
    setMicError(null);
    try {
      sessionStorage.removeItem(`vivaai_draft_${sessionId}`);
      sessionStorage.removeItem(`vivaai_code_${sessionId}`);
      sessionStorage.removeItem(`vivaai_speech_draft_${sessionId}`);
    } catch {}
    candidateInputRef.current?.focus();
    showToast('Answer cleared. You can start again.', 'info');
  };

  const toggleSpeechRecognition = () => {
    if (recognitionRestartRef.current) clearTimeout(recognitionRestartRef.current);
    recognitionRestartRef.current = null;
    if (isSpeechActive) {
      isListeningRef.current = false;
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
      }
      setIsSpeechActive(false);
    } else {
      recognitionRetriesRef.current = 0;
      isListeningRef.current = true;
      setMicError(null);
      startSpeechRecognition();
    }
  };

  useEffect(() => () => {
    isListeningRef.current = false;
    if (recognitionRestartRef.current) clearTimeout(recognitionRestartRef.current);
    recognitionRef.current?.abort();
    speechStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  // Audible text-to-speech helper using dedicated voice engine with stream support
  const speakQuestion = useCallback((text: string, isStream = false) => {
    if (isAudioOutputMuted) {
      setActiveSpeaker('student');
      setOrbState('idle');
      return;
    }
    setOrbState('speaking');
    setActiveSpeaker('ai');

    const callbacks = {
      onStart: () => {
        setOrbState('speaking');
        setActiveSpeaker('ai');
      },
      onEnd: () => {
        setOrbState('idle');
        setActiveSpeaker('student');
        // Mic remains OFF by default — candidate taps "Tap to Speak" when ready
      },
      onError: (err: unknown) => {
        console.warn('Voice speak notice:', err);
        showToast('Examiner audio is unavailable. Read the question on screen or repeat it to retry.', 'warning');
        setOrbState('idle');
        setActiveSpeaker('student');
        // Mic remains OFF by default — candidate taps "Tap to Speak" when ready
      },
    };

    if (isStream) {
      voiceEngine?.prepareStream(text, callbacks);
    } else {
      voiceEngine?.speak(text, callbacks);
    }
  }, [isAudioOutputMuted, showToast]);

  const uploadSessionAudioRecording = useCallback(async () => {
    try {
      if (durableRecorderRef.current) await durableRecorderRef.current.stop();
      else await syncRecording(sessionId);
      setRecordingStatus('Recording: saved');
    } catch (error) {
      showToast('Your answers are saved. Recording fragments are preserved on this device; reconnect and retry submission.', 'error');
      throw error;
    }
  }, [sessionId, showToast]);

  useEffect(() => {
    if (!sessionLoaded) return;
    void syncRecording(sessionId).catch(() => setRecordingStatus('Recording fragments are saved on this device and waiting to sync.'));
  }, [sessionId, sessionLoaded]);

  const handleFinishInterview = useCallback(async (serverConfirmed = false) => {
    if (serverConfirmed) serverEndedRef.current = true;
    if (finishingRef.current || isCompletedRef.current) return;
    finishingRef.current = true;
    isListeningRef.current = false;
    recognitionRef.current?.abort();
    clearSilenceTimer();
    voiceEngine?.stop();
    try {
      if (!serverEndedRef.current && !isLocalDemo) {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'end_session' }));
          // Completion is confirmed by the server after the transcript is stored.
          return;
        }
        await sessionsApi.end(sessionId);
      }
      await uploadSessionAudioRecording();
      isCompletedRef.current = true;
      setIsCompleted(true);
      setIsConnected(false);
    } catch {
      setConnectionError('Submission could not be confirmed. Your draft is preserved. Retry ending the interview.');
    } finally {
      finishingRef.current = false;
    }
  }, [sessionId, uploadSessionAudioRecording, clearSilenceTimer, isLocalDemo]);

  // Advance question in fallback sequence
  const advanceFallbackQuestion = useCallback((nextIdx: number) => {
    // If live WebSocket is active, do not trigger local fallback question
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      return;
    }
    setIsLocalDemo(true);
    if (nextIdx >= FALLBACK_EXAM_TURNS.length) {
      handleFinishInterview();
      return;
    }
    const turn = FALLBACK_EXAM_TURNS[nextIdx];
    setCurrentPhase(turn.phase);
    setCurrentPromptText(turn.question);
    setCandidateSpeechText('');
    setActiveSpeaker('ai');
    setOrbState('speaking');
    setHistory((prev) => {
      const nextHistory = [
        ...prev,
        { speaker: 'ai' as const, text: turn.question, timestamp: Date.now() },
      ];
      try {
        sessionStorage.setItem(`vivaai_turns_${sessionId}`, JSON.stringify(nextHistory));
      } catch {}
      return nextHistory;
    });
    speakQuestion(turn.question);
    setFallbackTurnIndex(nextIdx);
  }, [speakQuestion, handleFinishInterview, sessionId]);

  const speakQuestionRef = useRef(speakQuestion);
  const handleFinishInterviewRef = useRef(handleFinishInterview);
  const advanceFallbackQuestionRef = useRef(advanceFallbackQuestion);
  useEffect(() => { speakQuestionRef.current = speakQuestion; }, [speakQuestion]);
  useEffect(() => { handleFinishInterviewRef.current = handleFinishInterview; }, [handleFinishInterview]);
  useEffect(() => { advanceFallbackQuestionRef.current = advanceFallbackQuestion; }, [advanceFallbackQuestion]);
  useEffect(() => { startSpeechRecognitionRef.current = startSpeechRecognition; }, [startSpeechRecognition]);

  // User gesture activation to satisfy browser autoplay policy
  const handleActivateAndJoin = () => {
    voiceEngine?.unlockAudio();
    setHasStartedAudio(true);
    showToast('Connecting to your viva session…', 'info');
  };

  // Auto-start if navigated directly from calibration
  useEffect(() => {
    if (hasStartedAudio) {
      if (typeof window !== 'undefined') {
        try { sessionStorage.removeItem('vivaai_direct_start'); } catch {}
      }
      voiceEngine?.unlockAudio();
    }
  }, [hasStartedAudio]);

  // Tab switch detection (auditable proctoring log)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'tab_switch' }));
        }
        showToast('You left the viva tab. Return to the examination when ready.', 'warning');
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [showToast]);

  // Count only once the server connection is live, or when explicit local demo mode is active.
  useEffect(() => {
    if (!hasStartedAudio || isCompleted || (!isConnected && !isLocalDemo)) return;

    timerRef.current = setInterval(() => {
      setElapsedSeconds((prev) => Math.min(totalDuration, prev + 1));
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [hasStartedAudio, isConnected, isLocalDemo, totalDuration, isCompleted]);

  // Microphone audio level monitoring
  useEffect(() => {
    if (!hasStartedAudio || !sessionLoaded || !sessionClockReady || isCompleted) return;
    let cancelled = false;

    async function initMicLevel() {
      try {
        const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new AudioContextClass();
        audioContextRef.current = ctx;
        await ctx.resume();
        if (cancelled) { await ctx.close(); return; }
        const mix = ctx.createMediaStreamDestination();
        voiceEngine?.setRecordingBus(ctx, mix);
        if (typeof MediaRecorder === 'undefined') throw new Error('Recording is unavailable in this browser. Please use a supported browser.');
        durableRecorderRef.current = new DurableRecorder(mix.stream, sessionId, elapsedRef.current, setRecordingStatus, "conversation");
        // Typed sessions still archive the examiner's played speech without
        // asking for microphone permission. A rejected microphone never stops AI capture.
        if (sessionStorage.getItem('vivaai_text_only') === 'true') return;
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access is not supported in this browser.');
        const stream = await navigator.mediaDevices.getUserMedia({ audio: {
          echoCancellation: true, noiseSuppression: true, autoGainControl: true,
        } });
        if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return; }
        micStreamRef.current = stream;
        setMicError(null);
        const source = ctx.createMediaStreamSource(stream);
        source.connect(mix);

        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const checkLevel = () => {
          if (isMutedRef.current) {
            setAudioLevel(0);
          } else {
            analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
            const avg = sum / dataArray.length;
            const computedLevel = Math.min(100, Math.round((avg / 128) * 100));
            setAudioLevel(computedLevel);

            const isAiCurrentlySpeaking =
              voiceEngine?.isSpeaking() || activeSpeakerRef.current === 'ai';

            // While AI is speaking, mic level reflects speaker playback + ambient room sounds.
            // Raw microphone sound energy MUST NEVER cut off or stop the AI question!
            if (isAiCurrentlySpeaking) {
              animFrameRef.current = requestAnimationFrame(checkLevel);
              return;
            }

            // Candidate turn: check for genuine vocal activity
            // Threshold of 24 rejects quiet ambient room hiss / computer fan noise
            if (computedLevel > 24) {
              // Active voice sound detected: immediately cancel any pending auto-submit countdown!
              if (silenceTimerRef.current) {
                clearSilenceTimer();
              }

              // Notify backend that student is actively speaking so backend does not prompt silence
              if (!isStudentSpeakingVADRef.current) {
                isStudentSpeakingVADRef.current = true;
                if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                  wsRef.current.send(JSON.stringify({ type: 'vad_start' }));
                }
              }
              lastCandidateVocalTimeRef.current = Date.now();
            } else {
              // Quiet period: if candidate was speaking and paused for > 2.5s, send vad_end
              if (isStudentSpeakingVADRef.current && Date.now() - lastCandidateVocalTimeRef.current > 2500) {
                isStudentSpeakingVADRef.current = false;
                if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                  wsRef.current.send(JSON.stringify({ type: 'vad_end' }));
                }
              }
            }
          }
          animFrameRef.current = requestAnimationFrame(checkLevel);
        };
        checkLevel();
      } catch (err) {
        setAudioLevel(0);
        setMicError(err instanceof Error ? err.message : 'Microphone access is blocked. Enable it in your browser settings.');
        setIsTextMode(true);
        setIsSpeechRecognitionSupported(false);
      }
    }
    initMicLevel();

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (micStreamRef.current) micStreamRef.current.getTracks().forEach((t) => t.stop());
      if (audioContextRef.current) {
        voiceEngine?.clearRecordingBus(audioContextRef.current);
        const context = audioContextRef.current;
        void durableRecorderRef.current?.stop().finally(() => { if (context.state !== 'closed') void context.close(); }).catch(() => {});
      }
      cancelled = true;
      void durableRecorderRef.current?.stop().catch(() => {});
      isListeningRef.current = false;
      if (recognitionRef.current) recognitionRef.current.abort();
    };
  }, [hasStartedAudio, sessionLoaded, sessionClockReady, isCompleted, clearSilenceTimer, sessionId]);

  // Initialize WebSocket connection via secure ticket
  useEffect(() => {
    if (!hasStartedAudio || !sessionLoaded || isCompleted) return;

    let isCancelled = false;
    let ws: WebSocket | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let opened = false;

    const connectionFailed = (message: string) => {
      if (isCancelled || isCompletedRef.current) return;
      setIsConnected(false);
      setIsConnecting(false);
      setConnectionError(ALLOW_LOCAL_DEMO
        ? 'Demo mode is active. This practice session is local and will not be saved to the faculty registry.'
        : message);
      if (ALLOW_LOCAL_DEMO && !opened && !fallbackStartedRef.current) {
        if (fallbackTimer) clearTimeout(fallbackTimer);
        fallbackTimer = setTimeout(() => {
          if (!isCancelled && !fallbackStartedRef.current && !opened && (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN)) {
            fallbackStartedRef.current = true;
            advanceFallbackQuestionRef.current(0);
          }
        }, 2500);
      }
    };

    let pingInterval: ReturnType<typeof setInterval> | null = null;

    const connectWs = async () => {
      setIsConnecting(true);
      setConnectionError(null);
      try {
        const ticketResponse = await sessionsApi.getWsTicket(sessionId);
        if (!ticketResponse.data?.ticket) throw new Error('Could not obtain a secure session connection.');

        if (isCancelled) return;

        const isLocalHost = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
        let baseWs = ticketResponse.data?.ws_url || process.env.NEXT_PUBLIC_WS_URL || (isLocalHost ? 'ws://127.0.0.1:8000' : 'wss://vivaai-848e.onrender.com');
        if (isLocalHost) {
          baseWs = baseWs.replace(/^http:\/\//, 'ws://').replace(/^https:\/\//, 'wss://');
        } else {
          baseWs = baseWs.replace(/^ws:\/\//, 'wss://').replace(/^http:\/\//, 'wss://').replace(/^https:\/\//, 'wss://');
          if (baseWs.includes('localhost') || baseWs.includes('127.0.0.1') || baseWs.includes('trycloudflare.com')) {
            const configuredWs = process.env.NEXT_PUBLIC_WS_URL;
            if (configuredWs && !configuredWs.includes('trycloudflare.com') && !configuredWs.includes('localhost')) {
              baseWs = configuredWs.replace(/^ws:\/\//, 'wss://').replace(/^http:\/\//, 'wss://').replace(/^https:\/\//, 'wss://');
            } else {
              baseWs = 'wss://vivaai-848e.onrender.com';
            }
          }
        }
        const wsUrl = `${baseWs}/ws/interview/${sessionId}?ticket=${encodeURIComponent(ticketResponse.data.ticket)}&voice=${encodeURIComponent(selectedVoiceRef.current)}`;
        ws = new WebSocket(wsUrl);
        wsRef.current = ws;
        ws.onopen = () => {
          if (!isCancelled) {
            opened = true;
            setIsConnected(true);
            setIsConnecting(false);
            setConnectionError(null);
            if (fallbackTimer) {
              clearTimeout(fallbackTimer);
              fallbackTimer = null;
            }
            if (fallbackStartedRef.current) {
              voiceEngine?.stop();
              fallbackStartedRef.current = false;
            }
            setIsLocalDemo(false);
            // Re-send an unacknowledged answer using the same ID; the server deduplicates it.
            try {
              const stored = sessionStorage.getItem(`vivaai_pending_${sessionId}`);
              if (stored) pendingAnswerRef.current = JSON.parse(stored);
            } catch {}
            if (pendingAnswerRef.current) ws?.send(JSON.stringify(pendingAnswerRef.current));

            // Active keepalive heartbeat every 15s to maintain persistent socket
            pingInterval = setInterval(() => {
              if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'ping' }));
              }
            }, 15000);
          }
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (['state', 'tick', 'pong'].includes(data.type)) {
              if (typeof data.elapsed === 'number') {
                elapsedRef.current = data.elapsed;
                setElapsedSeconds(Math.floor(data.elapsed));
                if (data.type === 'state') setSessionClockReady(true);
              }
              if (data.phase) setCurrentPhase(data.phase);
            } else if (data.type === 'answer_received') {
              if (data.answer_id === pendingAnswerRef.current?.answer_id) {
                pendingAnswerRef.current = null;
                try { sessionStorage.removeItem(`vivaai_pending_${sessionId}`); } catch {}
              }
            } else if (data.type === 'session_restored') {
              const turns: TranscriptItem[] = (data.turns || []).map(
                (turn: TranscriptItem | (Omit<TranscriptItem, 'speaker'> & { speaker: 'interviewer' })) => ({
                  ...turn,
                  speaker: turn.speaker === 'interviewer' ? 'ai' : turn.speaker,
                }),
              );
              setHistory(turns);
              const aiTurns = turns.filter((turn) => turn.speaker === 'ai');
              const lastAiTurn = aiTurns[aiTurns.length - 1];
              if (lastAiTurn?.text) {
                setCurrentPromptText(lastAiTurn.text);
              }
              if (aiTurns.length > 0) {
                setFallbackTurnIndex(Math.max(0, aiTurns.length - 1));
              }
              const lastTurn = turns[turns.length - 1];
              if (lastTurn?.speaker === 'ai') {
                setActiveSpeaker('ai');
              } else if (lastTurn?.speaker === 'student') {
                setActiveSpeaker('student');
                setOrbState('idle');
              }
            } else if (data.type === 'answer_saved_previous_question') {
              setOrbState('idle'); setActiveSpeaker('student');
              showToast(data.message, 'info');
            } else if (data.type === 'answer_rejected') {
              const rejected = pendingAnswerRef.current;
              if (rejected && rejected.answer_id === data.answer_id) {
                setTextInput(rejected.text); setCandidateSpeechText(rejected.text);
                candidateTextRef.current = rejected.text;
                setSpeechDraft(null); pendingAnswerRef.current = null;
                try { sessionStorage.removeItem(`vivaai_pending_${sessionId}`); } catch {}
              }
              showToast(data.message || 'Please review and resubmit your saved answer.', 'warning');
            } else if (data.type === 'error') {
              setConnectionError(data.message || 'The examiner encountered an error. Please reconnect.');
            } else if (data.type === 'answer_time_limit') {
              isListeningRef.current = false;
              recognitionRef.current?.stop();
              setIsSpeechActive(false);
              showToast(data.message || 'Please finish this answer and continue.', 'warning');
            } else if (data.type === 'audio') {
              // Direct Audio Stream Chunk from ElevenLabs
              if ((!data.speech_id || data.speech_id === activeSpeechRef.current) && !outputMutedRef.current) {
                voiceEngine?.feedAudioChunk(data.data);
              }
            } else if (data.type === 'ai_done_speaking') {
              if (data.speech_id && data.speech_id !== activeSpeechRef.current) return;
              if (!outputMutedRef.current) {
                voiceEngine?.finishStream();
              } else {
                setActiveSpeaker('student');
                setOrbState('idle');
                // Mic remains OFF by default — candidate taps "Tap to Speak" when ready
              }
            } else if (data.type === 'examiner_thinking') {
              setOrbState('thinking');
              setActiveSpeaker('ai');
              setExaminerStatus(data.message || 'Examiner is evaluating your response...');
            } else if (data.type === 'question' || data.type === 'ai_speaking') {
              setExaminerStatus(null);
              activeSpeechRef.current = data.speech_id || null;
              setCurrentPhase((prev) => data.phase || prev);
              setCurrentPromptText(data.text);
              setActiveSpeaker('ai');
              setHistory((prev) => {
                const last = prev[prev.length - 1];
                if (last && last.speaker === 'ai' && last.text === data.text) return prev;
                return [
                  ...prev,
                  { speaker: 'ai', text: data.text, timestamp: Date.now() },
                ];
              });
              speakQuestionRef.current(data.text, true);
            } else if (data.type === 'ai_interrupted') {
              if (data.speech_id && data.speech_id !== activeSpeechRef.current) return;
              activeSpeechRef.current = null;
              // Real-Time Barge-In event confirmed by server
              voiceEngine?.stop();
              setActiveSpeaker('student');
              setOrbState('idle');
              // Mic remains OFF by default — candidate taps "Tap to Speak" when ready
            } else if (data.type === 'phase_change') {
              setCurrentPhase(data.phase);
              showToast(`Advanced to ${data.phase.replace('_', ' ')} phase`, 'info');
            } else if (data.type === 'silence_prompt') {
              showToast(data.message || 'Take your time to structure your thoughts.', 'info');
            } else if (data.type === 'session_completed' || data.type === 'interview_ended') {
              void handleFinishInterviewRef.current(true);
            }
          } catch (e) {
            console.warn('WS message parse notice:', e);
          }
        };

        ws.onerror = () => {
          connectionFailed('The live examiner connection failed. Check your network and retry.');
        };

        ws.onclose = (event) => {
          if (pingInterval) clearInterval(pingInterval);
          voiceEngine?.stop();
          if (!isCancelled) connectionFailed(event.reason || 'The live examiner connection was interrupted. Reconnect before continuing.');
        };
      } catch {
        connectionFailed('The live examiner connection could not be started. Check your connection and retry.');
      }
    };

    connectWs();

    return () => {
      isCancelled = true;
      if (pingInterval) clearInterval(pingInterval);
      if (fallbackTimer) clearTimeout(fallbackTimer);
      if (ws) ws.close();
    };
  }, [hasStartedAudio, sessionId, connectionAttempt, showToast, sessionLoaded, isCompleted]);

  // Submit candidate answer (either spoken or typed)
  const handleSubmitCandidateAnswer = useCallback((answerText: string, reviewed = true) => {
    if (!answerText.trim() || isCompletedRef.current || cloudBusyRef.current) return;

    clearSilenceTimer();
    // Explicit submission interrupts the examiner, including slow cloud speech.
    // Ignore any audio chunks already in flight for the interrupted utterance.
    activeSpeechRef.current = null;
    voiceEngine?.stop();

    isListeningRef.current = false;
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }
    setIsSpeechActive(false);

    if (isStudentSpeakingVADRef.current) {
      isStudentSpeakingVADRef.current = false;
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'vad_end' }));
      }
    }

    const studentTurnText = answerText.trim();
    const socketOpen = wsRef.current?.readyState === WebSocket.OPEN;
    if (!socketOpen && !isLocalDemo) {
      setConnectionError('Your answer was not sent. Reconnect to the live examiner before continuing.');
      showToast('Your answer has not been submitted. Reconnect before continuing.', 'error');
      return;
    }

    setHistory((prev) => {
      const nextHistory = [
        ...prev,
        { speaker: 'student' as const, text: studentTurnText, timestamp: Date.now() },
      ];
      try {
        sessionStorage.setItem(`vivaai_turns_${sessionId}`, JSON.stringify(nextHistory));
      } catch {}
      return nextHistory;
    });

    const pendingAnswer = { type: 'candidate_answer', text: studentTurnText, answer_id: crypto.randomUUID(), timestamp: elapsedSeconds, submission_mode: reviewed ? 'confirmed' : 'automatic_speech', ...(speechDraft ? { speech_receipt: speechDraft.receipt } : {}) };
    setSpeechDraft(null);
    if (socketOpen) {
      pendingAnswerRef.current = pendingAnswer;
      try { sessionStorage.setItem(`vivaai_pending_${sessionId}`, JSON.stringify(pendingAnswer)); } catch {}
    }
    setCandidateSpeechText('');
    setCodeDraft('');
    setTextInput('');
    candidateTextRef.current = '';
    activeSpeakerRef.current = 'ai';
    setOrbState('thinking');
    setActiveSpeaker('ai');

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify(pendingAnswer)
      );
    } else if (isLocalDemo) {
      setTimeout(() => {
        advanceFallbackQuestion(fallbackTurnIndex + 1);
      }, 1400);
    }
  }, [clearSilenceTimer, isLocalDemo, sessionId, elapsedSeconds, advanceFallbackQuestion, fallbackTurnIndex, showToast, speechDraft]);

  useEffect(() => {
    handleSubmitCandidateAnswerRef.current = handleSubmitCandidateAnswer;
  }, [handleSubmitCandidateAnswer]);

  const handleSkipQuestion = () => {
    handleSubmitCandidateAnswer("I am not certain about this topic, please move on to the next question.");
  };

  const handleManualInterruptAi = useCallback(() => {
    activeSpeechRef.current = null;
    voiceEngine?.stop();
    setActiveSpeaker('student');
    setOrbState('listening');
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'barge_in' }));
    }
    showToast('Examiner paused. You may answer now.', 'info');
  }, [showToast]);

  if (!hasHydrated || !isAuthenticated || user?.role !== 'student') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-page)] px-4 text-sm text-[var(--text-secondary)]">
        <div className="flex items-center gap-3">
          <div className="w-4 h-4 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
          <span>Verifying student exam session...</span>
        </div>
      </div>
    );
  }

  // ── Post-Viva Concluded View ────────────────────────
  if (isCompleted) {
    return (
      <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text-primary)] flex items-center justify-center p-4 sm:p-6 transition-colors">
        <div className="w-full max-w-lg space-y-6">
          <div className="academic-dossier text-center p-6 sm:p-8 space-y-6">
            <div className="w-14 h-14 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 flex items-center justify-center mx-auto border border-emerald-300 dark:border-emerald-800">
              <CheckCircle2 className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <Badge variant={isLocalDemo ? 'warning' : 'success'} dot>{isLocalDemo ? 'Practice session ended' : 'Viva session ended'}</Badge>
              <h1 className="font-editorial text-2xl font-bold text-[var(--text-primary)]">
                {isLocalDemo ? 'Practice session complete' : 'Your viva has ended'}
              </h1>
              <p className="text-xs sm:text-sm text-[var(--text-secondary)] leading-relaxed">
                {isLocalDemo
                  ? 'This local practice session was not saved to the faculty registry.'
                  : 'Your faculty team can review the session after processing is complete.'}
              </p>
            </div>

            <div className="p-4 rounded bg-[var(--bg-muted)] border border-[var(--border-default)] grid grid-cols-2 gap-3 text-xs text-left">
              <div>
                <span className="text-[var(--text-muted)] block">Candidate</span>
                <span className="font-semibold text-[var(--text-primary)]">{user.name}</span>
              </div>
              <div>
                <span className="text-[var(--text-muted)] block">Student ID</span>
                <span className="font-mono font-semibold text-[var(--text-primary)]">{user.student_id || '—'}</span>
              </div>
              <div>
                <span className="text-[var(--text-muted)] block">Session Duration</span>
                <span className="font-semibold text-[var(--text-primary)]">{Math.floor(elapsedSeconds / 60)}m {elapsedSeconds % 60}s</span>
              </div>
              <div>
                <span className="text-[var(--text-muted)] block">Conversation turns</span>
                <span className="font-semibold text-[var(--text-primary)]">{history.length}</span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <Link href="/sessions" className="btn-primary flex-1 justify-center text-xs font-semibold">
                View my interviews and feedback
                <ArrowRight className="w-4 h-4 ml-1" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Pre-Activation Gate (User gesture for audio autoplay) ──
  if (!hasStartedAudio) {
    return (
      <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text-primary)] flex items-center justify-center p-4 sm:p-6 transition-colors">
        <div className="academic-dossier max-w-md w-full p-6 sm:p-8 text-center space-y-6">
          <div className="w-12 h-12 rounded bg-[var(--accent-subtle)] text-[var(--primary)] flex items-center justify-center mx-auto border border-[var(--border-default)]">
            <Volume2 className="w-6 h-6" />
          </div>

          <div className="space-y-2">
            <Badge variant="info">Examiner Ready</Badge>
            <h1 className="font-editorial text-2xl font-bold text-[var(--text-primary)]">
              Continue your viva
            </h1>
            <p className="text-xs sm:text-sm text-[var(--text-secondary)] leading-relaxed">
              Enable audio to reconnect to your viva. Your saved answers will be restored.
            </p>
          </div>

          <button
            type="button"
            onClick={handleActivateAndJoin}
            className="btn-primary w-full text-sm font-semibold justify-center py-3 min-h-[48px]"
          >
            <Mic className="w-4 h-4" />
            <span>Begin Oral Examination</span>
          </button>

          <p className="text-[11px] text-[var(--text-muted)] font-mono">
            You can speak or type your answers.
          </p>
        </div>


      </div>
    );
  }

  const remaining = Math.max(0, totalDuration - elapsedSeconds);
  const phaseLabel = VIVA_PHASES.find(phase => phase.key === currentPhase)?.label || 'Finishing up';
  return <div className="min-h-screen bg-[var(--bg-page)]">
    <header className="border-b border-[var(--border-subtle)] bg-[var(--bg-card)]"><div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-5 sm:px-8">
      <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-[var(--primary)] text-[var(--primary-fg)]"><AudioLines className="h-6 w-6" /></span><div><span className="text-base font-bold">Your viva</span><p className="mt-0.5 text-xs text-[var(--text-muted)]">{user.name}</p></div></div>
      <div className="flex items-center gap-3 sm:gap-5"><Badge variant={isConnected ? 'success' : 'warning'} dot>{isConnected ? 'Live Connected' : isLocalDemo ? 'Practice mode' : isConnecting ? 'Connecting…' : 'Offline'}</Badge><button aria-label="End Viva Early" onClick={() => setShowEndModal(true)} className="min-h-11 rounded-xl px-3 text-sm font-medium text-[var(--status-danger)] hover:bg-[var(--status-danger-bg)]">End viva</button></div>
    </div></header>
    <div className="mx-auto max-w-5xl px-5 py-5 sm:px-8 sm:py-6">
      <div className="mb-5 flex items-center justify-between gap-4"><div><p className="text-sm font-medium text-[var(--primary)]">{phaseLabel}</p><p role="status" data-testid="recording-status" className="mt-1 text-xs text-[var(--text-muted)]">{recordingStatus}</p></div><div aria-label={`Exam timer: ${Math.floor(remaining / 60)} minutes ${remaining % 60} seconds remaining`} className={`rounded-2xl px-5 py-3 text-right ${remaining <= 120 ? 'bg-[var(--status-warning-bg)] text-[var(--status-warning)]' : 'bg-[var(--bg-card)]'}`}><span className="text-2xl font-semibold tabular-nums tracking-tight">{Math.floor(remaining / 60).toString().padStart(2,'0')}:{(remaining % 60).toString().padStart(2,'0')}</span><span className="ml-2 text-xs text-[var(--text-muted)]">left</span></div></div>
      <div className="phase-track mb-6 flex gap-1.5" aria-label="Viva progress">{VIVA_PHASES.map((phase,index) => <div key={phase.key} title={phase.label} className={`h-1.5 flex-1 rounded-full ${index <= VIVA_PHASES.findIndex(p => p.key === currentPhase) ? 'bg-[var(--primary)]' : 'bg-[var(--border-default)]'}`} />)}</div>
      {connectionError && <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[var(--status-danger-bg)] p-4 text-sm text-[var(--status-danger)]"><span>{connectionError}</span>{!isLocalDemo && <button className="btn-secondary" onClick={() => setConnectionAttempt(n => n + 1)}>Reconnect</button>}</div>}
      {micError && <div role="status" className="mb-5 rounded-xl bg-[var(--status-warning-bg)] p-4 text-sm text-[var(--status-warning)]">{micError}<button onClick={toggleSpeechRecognition} className="ml-3 underline">Retry microphone</button></div>}
      {!isSpeechRecognitionSupported && <p role="status" className="mb-5 text-sm text-[var(--text-secondary)]">Live speech recognition is unavailable. Use live cloud transcription or type below.</p>}
      <section className="examiner-panel overflow-hidden" data-speaking={orbState === 'speaking'}>
        <div className="flex items-center gap-3 px-6 pt-6 sm:px-8"><span className="examiner-avatar"><AudioLines className="h-5 w-5" /></span><div><h1 className="text-sm font-semibold !text-white">Your examiner</h1><p role="status" className="mt-0.5 text-xs text-[var(--text-muted)]">{examinerStatus || (orbState === 'speaking' ? 'Speaking — listen to the question' : orbState === 'thinking' ? 'Preparing your next question…' : 'Ready to listen')}</p></div></div>
        <div className="px-6 py-5 sm:px-8"><p className="relative z-10 max-w-3xl text-xl font-medium leading-relaxed tracking-tight text-white sm:text-2xl">{currentPromptText || 'Your first question is on its way…'}</p></div>
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] px-5 py-3 sm:px-7"><button className="btn-ghost !text-xs" onClick={() => { if (!isAudioOutputMuted) voiceEngine?.repeatLast(); }}><Volume2 className="h-4 w-4" />Repeat question</button>{orbState === 'speaking' && <button className="btn-ghost !text-xs" onClick={handleManualInterruptAi}>I’m ready to answer</button>}<button className="btn-ghost ml-auto !text-xs" onClick={handleSkipQuestion}>Skip this question</button></div>
      </section>
      <section className="academic-dossier answer-panel mt-6 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-6 sm:px-8"><div className="flex items-center gap-3"><h2 className="text-base font-semibold">Your answer</h2><button type="button" onClick={clearCandidateAnswer} disabled={cloudBusy || !(textInput || candidateSpeechText || speechDraft || codeDraft)} className="clear-answer-control" title="Clear this draft and start again"><RotateCcw className="h-3.5 w-3.5" /><span>Clear answer</span></button></div><button onClick={toggleSpeechRecognition} disabled={cloudBusy} aria-pressed={isSpeechActive} className={`flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-medium ${isSpeechActive ? 'bg-[var(--status-success-bg)] text-[var(--status-success)]' : 'bg-[var(--accent-subtle)] text-[var(--primary)]'}`}><Mic className="h-4 w-4" />{isSpeechActive ? 'Listening — pause' : 'Speak your answer'}</button></div>
        <div className="px-6 pt-4 sm:px-8"><SpeechReviewCapture key={speechCaptureVersion} sessionId={sessionId} disabled={isCompleted} initialText={textInput} onBusy={busy => { cloudBusyRef.current = busy; setCloudBusy(busy); }} onStart={() => { isListeningRef.current = false; recognitionRef.current?.abort(); setIsSpeechActive(false); voiceEngine?.stop(); activeSpeechRef.current = null; wsRef.current?.send(JSON.stringify({ type: 'barge_in' })); }} onDraft={draft => { setSpeechDraft(draft); setTextInput(draft.text); setCandidateSpeechText(draft.text); candidateTextRef.current = draft.text; }} /></div>
        {speechDraft && <div role="status" className="mx-6 mt-4 rounded-xl bg-[var(--status-warning-bg)] p-4 text-xs leading-relaxed sm:mx-8"><p className="mb-2 font-medium">Check highlighted words before submitting.</p>{speechDraft.words.map((word,index) => <span key={index} className={word.confidence < .8 ? 'bg-amber-300/40 underline decoration-dotted' : ''}>{word.punctuated_word || word.word}{' '}</span>)}</div>}
        <form onSubmit={e => { e.preventDefault(); clearSilenceTimer(); handleSubmitCandidateAnswer(withCode(textInput || candidateSpeechText)); }}>
          <div className="px-6 py-5 sm:px-8"><label htmlFor="candidate-text-answer" className="sr-only">Your answer</label><textarea ref={candidateInputRef} id="candidate-text-answer" aria-describedby="transcript-edit-help" rows={3} placeholder="Speak or type your answer here…" value={textInput} readOnly={cloudBusy} onChange={e => editCandidateDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); clearSilenceTimer(); handleSubmitCandidateAnswer(withCode(textInput || candidateSpeechText)); } }} className="w-full resize-y rounded-xl border border-[var(--border-default)] bg-[var(--bg-page)] p-4 text-base leading-relaxed placeholder:text-[var(--text-muted)] focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-subtle)]" /><p id="transcript-edit-help" className="mt-3 text-xs text-[var(--text-muted)]">Review and edit your transcript before submitting. Editing pauses listening; resume to continue from your changes.</p></div>
          <details className="mx-6 mb-5 rounded-xl border border-[var(--border-subtle)] p-4 sm:mx-8">
            <summary className="cursor-pointer text-sm font-medium">Add a code snippet (optional)</summary>
            <label htmlFor="candidate-code" className="mt-3 block text-xs text-[var(--text-secondary)]">Share a short example and explain it in your answer. Code is saved as text and never executed.</label>
            <textarea id="candidate-code" value={codeDraft} maxLength={8000} readOnly={cloudBusy} onChange={event => setCodeDraft(event.target.value)} rows={5} spellCheck={false} className="mt-3 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-page)] p-3 font-mono text-sm" />
          </details>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] px-6 py-4 sm:px-8"><button type="button" onClick={() => { const muted=!isAudioOutputMuted; setIsAudioOutputMuted(muted); if(muted) voiceEngine?.stop(); }} aria-pressed={isAudioOutputMuted} className="flex min-h-11 items-center gap-2 text-xs text-[var(--text-secondary)]">{isAudioOutputMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}{isAudioOutputMuted ? 'Examiner audio off' : 'Examiner audio on'}</button><button type="submit" disabled={cloudBusy || !(textInput.trim() || candidateSpeechText.trim())} className="btn-primary">Confirm & Submit Answer<ArrowRight className="h-4 w-4" /></button></div>
        </form>
      </section>
      {history.length > 0 && <details className="mt-6 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] px-6 py-4"><summary className="cursor-pointer text-sm font-medium">Conversation transcript <span className="ml-2 text-xs text-[var(--text-muted)]">{history.length} turns</span></summary><div className="mt-4 max-h-64 space-y-4 overflow-auto">{history.map((turn,index) => <div key={index}><p className="text-xs font-semibold text-[var(--primary)]">{turn.speaker === 'ai' ? 'Examiner' : 'You'}</p><p className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">{turn.text}</p></div>)}</div></details>}
    </div>
    <Modal isOpen={showEndModal} onClose={() => setShowEndModal(false)} title="Finish your viva?" description="You can continue answering or submit what you have so far." footer={<><button className="btn-secondary" onClick={() => setShowEndModal(false)}>Continue viva</button><button className="btn-danger" onClick={() => { setShowEndModal(false); handleFinishInterview(); }}>Finish & Submit</button></>}><p className="text-sm leading-relaxed text-[var(--text-secondary)]">Your saved answers will be sent for assessment. You won’t be able to add more answers after submitting.</p></Modal>
  </div>;
}
