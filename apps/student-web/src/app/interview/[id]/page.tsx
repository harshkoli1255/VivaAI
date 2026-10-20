'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  HelpCircle,
  ShieldCheck,
  CheckCircle2,
  PhoneOff,
  ArrowRight,
  Volume1,
  Terminal,
  Sun,
  Moon,
  Sparkles,
  Radio,
  Code2,
  RotateCcw,
} from 'lucide-react';
import { useAuthStore } from '@/store';
import { useTheme } from '@/components/providers/ThemeProvider';
import { VoiceOrb, OrbState } from '@/components/interview/VoiceOrb';
import { CountdownRing } from '@/components/interview/CountdownRing';
import { CodeScratchpad } from '@/components/interview/CodeScratchpad';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/providers/ToastProvider';
import { VoiceSelectorModal } from '@/components/interview/VoiceSelectorModal';
import { EXAMINER_VOICES, voiceEngine } from '@/lib/speech';
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
  const { theme, toggle: toggleTheme } = useTheme();
  const [showTurnHistory, setShowTurnHistory] = useState<boolean>(false);

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
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isAudioOutputMuted, setIsAudioOutputMuted] = useState<boolean>(false);
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [micError, setMicError] = useState<string | null>(null);
  const [showEndModal, setShowEndModal] = useState<boolean>(false);
  const [showVoiceModal, setShowVoiceModal] = useState<boolean>(false);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>(() => voiceEngine?.getVoice() || 'alice');
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const finishingRef = useRef(false);
  const serverEndedRef = useRef(false);
  const selectedVoiceRef = useRef(selectedVoiceId);
  const outputMutedRef = useRef(isAudioOutputMuted);
  useEffect(() => { selectedVoiceRef.current = selectedVoiceId; }, [selectedVoiceId]);
  useEffect(() => { outputMutedRef.current = isAudioOutputMuted; }, [isAudioOutputMuted]);

  const handleSelectVoice = useCallback((vid: string) => {
    setSelectedVoiceId(vid);
    voiceEngine?.setVoice(vid);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'set_voice', voice: vid }));
    }
  }, []);
  const [textInput, setTextInput] = useState<string>('');
  const [speechDraft, setSpeechDraft] = useState<SpeechDraft | null>(null);
  const [cloudBusy, setCloudBusy] = useState(false);
  const cloudBusyRef = useRef(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [, setIsTextMode] = useState<boolean>(false);
  const [isScratchpadOpen, setIsScratchpadOpen] = useState<boolean>(false);
  const [fallbackTurnIndex, setFallbackTurnIndex] = useState<number>(0);
  const fallbackStartedRef = useRef(false);

  const [isSpeechActive, setIsSpeechActive] = useState<boolean>(false);
  const [examinerStatus, setExaminerStatus] = useState<string | null>(null);
  const [showCaptions, setShowCaptions] = useState<boolean>(true);
  const isListeningRef = useRef(false);
  const isCompletedRef = useRef(isCompleted);
  useEffect(() => { isCompletedRef.current = isCompleted; }, [isCompleted]);

  // Conversational Turn-Taking (Auto-submit spoken answer on natural silence pause - OFF by default)
  const [isAutoSendEnabled, setIsAutoSendEnabled] = useState<boolean>(false);
  const [autoSubmitCountdown, setAutoSubmitCountdown] = useState<number | null>(null);
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
  const accumulatedFinalTextRef = useRef<string>('');
  const sessionFinalTextRef = useRef<string>('');

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
        setTextInput(sessionStorage.getItem(`vivaai_draft_${sessionId}`) || '');
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
      // Restart after each utterance and accumulate final text in onend.
      // Chrome's continuous track mode can omit words between partial results.
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      isListeningRef.current = true;
      setIsSpeechActive(true);

      recognition.onstart = () => {
        if (!isListeningRef.current || isCompletedRef.current) {
          recognition.abort();
          return;
        }
        isListeningRef.current = true;
        setIsSpeechActive(true);
        setOrbState('listening');
        setActiveSpeaker('student');
      };

      recognition.onresult = (event) => {
        if (!isListeningRef.current || isCompletedRef.current) return;
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
        sessionFinalTextRef.current = currentFinal;

        const currentSpokenText = (
          (accumulatedFinalTextRef.current ? accumulatedFinalTextRef.current + ' ' : '') +
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
        setIsSpeechActive(false);
        // Safely accumulate final speech before restart so words are never lost
        if (sessionFinalTextRef.current) {
          accumulatedFinalTextRef.current = (
            (accumulatedFinalTextRef.current ? accumulatedFinalTextRef.current + ' ' : '') +
            sessionFinalTextRef.current
          ).trim();
          sessionFinalTextRef.current = '';
        }
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
      if (audioTrack) recognition.start(audioTrack);
      else recognition.start();
      recognitionRef.current = recognition;
    } catch (err) {
      console.warn('Speech recognition start notice:', err);
      isListeningRef.current = false;
      setIsSpeechActive(false);
      setMicError('Voice input could not start. Check your microphone and tap to retry, or type your answer.');
    } finally {
      recognitionStartingRef.current = false;
    }
  }, [clearSilenceTimer]);

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
  }, [isAudioOutputMuted]);

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
        if (sessionStorage.getItem('vivaai_text_only') === 'true') return;
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access is not supported in this browser.');
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return; }
        micStreamRef.current = stream;
        setMicError(null);

        try {
          if (typeof MediaRecorder !== 'undefined') {
            durableRecorderRef.current = new DurableRecorder(stream, sessionId, elapsedRef.current, setRecordingStatus);
          } else {
            setRecordingStatus('Recording is unavailable in this browser. Please use a supported browser or typed answers.');
          }
        } catch (error) {
          setRecordingStatus(error instanceof Error ? error.message : 'Recording could not start.');
        }

        const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new AudioContextClass();
        audioContextRef.current = ctx;

        const source = ctx.createMediaStreamSource(stream);
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
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') audioContextRef.current.close();
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
          baseWs = 'ws://127.0.0.1:8000';
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
              setHistory(data.turns);
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
    setTextInput('');
    candidateTextRef.current = '';
    accumulatedFinalTextRef.current = '';
    sessionFinalTextRef.current = '';
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
              Enter Live Oral Viva Room
            </h1>
            <p className="text-xs sm:text-sm text-[var(--text-secondary)] leading-relaxed">
              Click below to enable audio and connect to your scheduled viva session.
            </p>
          </div>

          {/* Examiner Voice Preview Selector */}
          <div className="p-3 rounded-xl bg-[var(--bg-muted)]/60 border border-[var(--border-subtle)] flex items-center justify-between gap-3 text-left">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
                <Sparkles className="w-4 h-4 text-amber-500" />
              </div>
              <div>
                <div className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-wider">Examiner Voice (ElevenLabs)</div>
                <div className="text-xs font-semibold text-[var(--text-primary)]">
                  {EXAMINER_VOICES.find((v) => v.id === selectedVoiceId)?.name || 'Alice'} · <span className="text-[var(--text-secondary)] font-normal">{EXAMINER_VOICES.find((v) => v.id === selectedVoiceId)?.tagline}</span>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowVoiceModal(true)}
              className="px-2.5 py-1 text-xs font-medium rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)] text-emerald-700 dark:text-emerald-400 cursor-pointer transition-colors shadow-2xs shrink-0"
            >
              Choose Voice
            </button>
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
            Your browser will request microphone access. You can type if speech recognition is unavailable.
          </p>
        </div>

        <VoiceSelectorModal
          isOpen={showVoiceModal}
          onClose={() => setShowVoiceModal(false)}
          selectedVoiceId={selectedVoiceId}
          onSelectVoice={handleSelectVoice}
        />
      </div>
    );
  }

  // ── Live Distraction-Free Viva Room ─────────────────
  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text-primary)] flex flex-col justify-between transition-colors relative selection:bg-emerald-500/20 selection:text-emerald-800 dark:selection:text-emerald-300">
      {/* Ambient Acoustic Lighting Background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute -top-[20%] left-1/2 -translate-x-1/2 w-[900px] h-[550px] rounded-full bg-emerald-500/[0.04] dark:bg-emerald-500/[0.08] blur-[120px]" />
        <div className="absolute top-[35%] -left-[10%] w-[600px] h-[450px] rounded-full bg-teal-500/[0.03] dark:bg-teal-500/[0.06] blur-[110px]" />
        <div className="absolute top-[35%] -right-[10%] w-[600px] h-[450px] rounded-full bg-blue-500/[0.03] dark:bg-blue-500/[0.05] blur-[110px]" />
      </div>

      {/* Top Header Bar */}
      <header className="sticky top-0 z-40 backdrop-blur-md bg-[var(--bg-card)]/80 border-b border-[var(--border-subtle)] px-4 sm:px-6 py-2.5 transition-all">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
          {/* Brand Identity & Session Live Status */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border border-emerald-500/25 flex items-center justify-center font-editorial font-bold text-base shadow-xs">
              V
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-xs sm:text-sm tracking-tight text-[var(--text-primary)]">
                  VivaAI Oral Studio
                </span>
                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium border ${
                  isConnected
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                    : isLocalDemo
                    ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30'
                    : 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/30'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    isConnected ? 'bg-emerald-500 animate-pulse' : isLocalDemo ? 'bg-amber-500' : 'bg-zinc-400'
                  }`} />
                  {isConnected ? 'Live Connected' : isLocalDemo ? 'Practice Mode' : isConnecting ? 'Connecting...' : 'Offline'}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)] font-mono">
                <ShieldCheck className="w-3 h-3 text-emerald-600 dark:text-teal-400" />
                <span>Candidate interview</span>
              </div>
            </div>
          </div>

          {/* Center Candidate Dossier Badge */}
          <div className="hidden md:flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--bg-muted)]/60 border border-[var(--border-subtle)] text-xs">
            <div className="w-5 h-5 rounded-full bg-[var(--primary)] text-white text-[10px] font-bold flex items-center justify-center">
              {user.name?.charAt(0) || 'C'}
            </div>
            <span className="font-medium text-[var(--text-primary)]">{user.name}</span>
            <span className="text-[var(--text-muted)] font-mono text-[11px]">({user.student_id || '1RM25CI019'})</span>
          </div>

          {/* Right Action Tools: Dark/Light Mode & Safe End Exam */}
          <div className="flex items-center gap-2">
            {/* Examiner Voice Selector */}
            <button
              type="button"
              onClick={() => setShowVoiceModal(true)}
              className="h-8 px-2.5 rounded-lg flex items-center gap-1.5 border border-[var(--border-subtle)] bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)] text-[var(--text-secondary)] hover:text-emerald-700 dark:hover:text-emerald-400 transition-colors cursor-pointer text-xs font-medium shadow-2xs"
              title="Change AI Examiner Voice (ElevenLabs)"
              aria-label="Change AI Examiner Voice"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span className="hidden sm:inline">Voice:</span>
              <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                {EXAMINER_VOICES.find((v) => v.id === selectedVoiceId)?.name || 'Alice'}
              </span>
            </button>

            <button
              type="button"
              onClick={toggleTheme}
              className="w-8 h-8 rounded-lg flex items-center justify-center border border-[var(--border-subtle)] bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)] text-[var(--text-secondary)] transition-colors cursor-pointer"
              title={theme === 'dark' ? 'Switch to daylight theme' : 'Switch to midnight dark theme'}
              aria-label="Toggle visual theme"
            >
              {theme === 'dark' ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-slate-600" />}
            </button>

            <button
              type="button"
              onClick={() => setShowEndModal(true)}
              aria-label="End Viva Early"
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-red-700 dark:text-red-400 border border-red-200 dark:border-red-900/60 bg-red-50/50 dark:bg-red-950/20 hover:bg-red-100 dark:hover:bg-red-950/50 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <PhoneOff className="w-3 h-3" />
              <span className="hidden sm:inline">End Viva Early</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Focus Stage */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-4 sm:py-6 flex flex-col items-center justify-center space-y-4 sm:space-y-5 z-10">
        <p role="status" data-testid="recording-status" className="text-xs text-[var(--text-secondary)]">{recordingStatus}</p>
        {connectionError && (
          <div role={isLocalDemo ? 'status' : 'alert'} className="w-full max-w-3xl rounded-xl border border-red-500/25 bg-red-500/10 dark:bg-red-950/25 p-3 text-xs text-red-700 dark:text-red-300 flex items-center justify-between gap-3 shadow-xs">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-500 shrink-0 animate-pulse" />
              <span className="font-medium">{connectionError}</span>
            </div>
            {!isLocalDemo && (
              <button
                type="button"
                onClick={() => setConnectionAttempt((attempt) => attempt + 1)}
                className="px-2.5 py-1 rounded bg-red-500/20 hover:bg-red-500/30 font-semibold shrink-0 cursor-pointer text-xs"
              >
                Reconnect
              </button>
            )}
          </div>
        )}

        {!isSpeechRecognitionSupported && (
          <p role="status" className="text-sm text-[var(--text-secondary)]">Speech recognition is unavailable. Type your answer below; it will be assessed in the same way.</p>
        )}
        {micError && (
          <div role="status" className="w-full max-w-3xl rounded-xl border border-amber-500/25 bg-amber-500/10 dark:bg-amber-950/25 p-3 text-xs text-amber-700 dark:text-amber-300 flex items-center justify-between gap-3 shadow-xs">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
              <span>{micError}</span>
            </div>
            <button
              type="button"
              onClick={toggleSpeechRecognition}
              className="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 font-semibold shrink-0 cursor-pointer text-xs"
            >
              Retry Mic
            </button>
          </div>
        )}

        {!connectionError && isConnecting && (
          <p role="status" className="w-full text-center text-xs text-[var(--text-muted)] font-mono animate-pulse">
            Connecting securely to calibrated examiner session…
          </p>
        )}

        {/* Phase Progression Stepper Bar (Responsive 5-Column Grid, Zero Scrollbar, Zero Cut-off) */}
        <div className="w-full max-w-3xl grid grid-cols-5 gap-1 sm:gap-2 p-1.5 rounded-2xl bg-[var(--bg-card)]/90 backdrop-blur-md border border-[var(--border-subtle)] shadow-xs">
          {VIVA_PHASES.map((p, idx) => {
            const isCurrent = currentPhase === p.key;
            const isCompletedPhase = VIVA_PHASES.findIndex((item) => item.key === currentPhase) > idx;
            return (
              <div
                key={p.key}
                className={`flex items-center justify-center gap-1.5 px-1 sm:px-2 py-1.5 rounded-xl transition-all select-none ${
                  isCurrent
                    ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 font-semibold border border-emerald-500/30 shadow-xs'
                    : isCompletedPhase
                    ? 'text-[var(--text-muted)] opacity-70 bg-[var(--bg-muted)]/20'
                    : 'text-[var(--text-muted)] opacity-50'
                }`}
                title={`${p.label} (${p.range})`}
              >
                <span className={`w-4 h-4 rounded-full text-[10px] font-mono flex items-center justify-center font-bold shrink-0 ${
                  isCurrent
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : isCompletedPhase
                    ? 'bg-[var(--border-strong)] text-[var(--bg-page)]'
                    : 'border border-[var(--border-default)]'
                }`}>
                  {isCompletedPhase ? '✓' : p.index}
                </span>
                <span className="text-xs font-sans tracking-tight truncate">
                  {p.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Unified Acoustic Hero Centerpiece Card */}
        <div className="w-full max-w-3xl rounded-2xl bg-[var(--bg-card)]/90 backdrop-blur-md border border-[var(--border-subtle)] p-5 sm:p-6 shadow-sm relative overflow-hidden">
          {/* Subtle Dynamic Ambient Lighting behind stage */}
          <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_60%_50%_at_50%_50%,rgba(16,185,129,0.06),transparent_80%)]" />

          <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-5 sm:gap-6">
            {/* Left: Compact Circular Countdown Timer */}
            <div className="flex flex-col items-center md:items-start shrink-0">
              <CountdownRing
                elapsedSeconds={elapsedSeconds}
                totalSeconds={totalDuration}
                currentPhase={currentPhase}
                size={105}
                showPhaseBadge={false}
              />
            </div>

            {/* Center: 3D Voice Resonance Orb & Dynamic Status Pill */}
            <div className="flex flex-col items-center justify-center flex-1 space-y-3">
              <div className="relative flex items-center justify-center">
                <VoiceOrb
                  state={orbState}
                  audioLevel={audioLevel}
                  size={150}
                  showStatusText={false}
                />
              </div>

              {/* Dynamic Acoustic State Pill */}
              <div className="flex items-center gap-2">
                <div className={`px-3 py-1 rounded-full text-xs font-medium flex items-center gap-2 shadow-xs transition-all ${
                  orbState === 'speaking'
                    ? 'bg-cyan-500/15 text-cyan-800 dark:text-cyan-300 border border-cyan-500/30'
                    : orbState === 'listening'
                    ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border border-emerald-500/30 ring-1 ring-emerald-500/20'
                    : orbState === 'thinking'
                    ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30'
                    : 'bg-[var(--bg-muted)] text-[var(--text-secondary)] border border-[var(--border-subtle)]'
                }`}>
                  <span className={`w-2 h-2 rounded-full ${
                    orbState === 'speaking'
                      ? 'bg-cyan-500 animate-pulse'
                      : orbState === 'listening'
                      ? 'bg-emerald-500 animate-ping'
                      : orbState === 'thinking'
                      ? 'bg-amber-500 animate-spin'
                      : 'bg-zinc-400'
                  }`} />
                  <span>
                    {examinerStatus
                      ? examinerStatus
                      : orbState === 'speaking'
                      ? 'Examiner Inquiring · Listen closely'
                      : orbState === 'listening'
                      ? 'Microphone Active · Speak your answer'
                      : orbState === 'thinking'
                      ? 'Synthesizing response...'
                      : 'Ready for response'}
                  </span>
                </div>
              </div>

              {/* Live Synchronized Closed Captions / Subtitles */}
              {showCaptions && orbState === 'speaking' && currentPromptText && (
                <div className="w-full max-w-xl mx-auto px-3.5 py-2 rounded-xl bg-[var(--bg-card)]/90 backdrop-blur-md border border-[var(--primary)]/20 shadow-xs flex items-center gap-2.5 text-xs text-[var(--text-secondary)]">
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-[var(--primary)]/10 text-[var(--primary)] shrink-0">CC</span>
                  <p className="line-clamp-2 italic leading-relaxed text-[var(--text-primary)] font-medium">"{currentPromptText}"</p>
                </div>
              )}
            </div>

            {/* Right: Live Dynamic Equalizer Bars & Voice Gauge */}
            <div className="flex flex-col items-center md:items-end justify-center shrink-0 space-y-2">
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[var(--bg-muted)]/50 border border-[var(--border-subtle)] text-[11px] font-mono text-[var(--text-muted)]">
                <Radio className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>Voice Signal</span>
              </div>

              {/* 10 Dancing Equalizer Bars */}
              <div className="flex items-end gap-1 h-8 px-2.5 py-1 rounded-lg bg-[var(--bg-muted)]/30 border border-[var(--border-subtle)]" title="Live audio input visualizer">
                {[4, 8, 14, 20, 28, 22, 16, 11, 7, 5].map((baseHeight, i) => {
                  const factor = Math.min(1, Math.max(0.15, (audioLevel / 50) * ((i % 3) + 0.8)));
                  const computedHeight = isSpeechActive
                    ? Math.max(4, Math.round(baseHeight * (0.3 + factor * 0.9)))
                    : 4;
                  return (
                    <div
                      key={i}
                      className={`w-1 rounded-full transition-all duration-75 ${
                        audioLevel > 18
                          ? 'bg-emerald-500 dark:bg-emerald-400'
                          : 'bg-[var(--border-strong)] opacity-60'
                      }`}
                      style={{ height: `${computedHeight}px` }}
                    />
                  );
                })}
              </div>

              <span className="text-[10px] font-mono text-[var(--text-muted)]">
                {audioLevel > 18 ? 'Signal detected' : isSpeechActive ? 'Listening...' : 'Muted'}
              </span>
            </div>
          </div>
        </div>

        {/* Current Question Statement Dossier Card */}
        <div className="w-full max-w-3xl rounded-2xl bg-[var(--bg-card)]/90 backdrop-blur-md border border-[var(--border-default)] shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-muted)]/40 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-xs uppercase tracking-wider text-[var(--primary)]">
                Examiner Question #{fallbackTurnIndex + 1}
              </span>
              <span className="text-[var(--text-muted)] font-mono text-[11px]">
                · Turn {history.length + 1}
              </span>
              {(activeSpeaker === 'ai' || (voiceEngine && voiceEngine.isSpeaking())) && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold text-[var(--primary)] bg-[var(--primary)]/10 animate-pulse">
                  <Volume2 className="w-2.5 h-2.5" />
                  <span>Speaking...</span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {(activeSpeaker === 'ai' || (voiceEngine && voiceEngine.isSpeaking())) ? (
                <>
                  <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20">
                    <ShieldCheck className="w-3 h-3" />
                    <span>Noise Shield Active</span>
                  </span>
                  <button
                    type="button"
                    onClick={handleManualInterruptAi}
                    className="px-2.5 py-1 rounded-lg text-xs font-semibold text-amber-700 dark:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 transition-all flex items-center gap-1.5 cursor-pointer"
                    title="Stop question audio and answer now"
                  >
                    <span>Answer Now</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    if (currentPromptText) {
                      speakQuestion(currentPromptText, false);
                    } else {
                      voiceEngine?.repeatLast();
                    }
                  }}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium text-[var(--primary)] hover:bg-[var(--primary)]/10 border border-transparent hover:border-[var(--primary)]/20 transition-all flex items-center gap-1.5 cursor-pointer"
                  title="Repeat question audio aloud"
                >
                  <Volume1 className="w-3.5 h-3.5" />
                  <span>Repeat Audio</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleSkipQuestion}
                className="px-2.5 py-1 rounded-lg text-xs font-medium text-amber-700 dark:text-amber-400 hover:bg-amber-500/10 border border-transparent hover:border-amber-500/20 transition-all flex items-center gap-1.5 cursor-pointer"
                title="Skip to next question with zero negative penalty"
              >
                <HelpCircle className="w-3.5 h-3.5" />
                <span>Skip this question</span>
              </button>
            </div>
          </div>

          <div className="p-5 sm:p-6">
            <p className="font-editorial text-xl sm:text-2xl font-serif text-[var(--text-primary)] leading-relaxed tracking-tight">
              {currentPromptText || "Preparing next calibrated syllabus inquiry..."}
            </p>
          </div>
        </div>

        {/* Master Candidate Response Studio */}
        <div className="w-full max-w-3xl rounded-2xl bg-[var(--bg-card)]/95 backdrop-blur-md border border-[var(--border-default)] shadow-md overflow-hidden transition-all focus-within:border-[var(--primary)] focus-within:ring-2 focus-within:ring-[var(--primary)]/20">
          {/* Console Header Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 px-4 sm:px-5 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-muted)]/30">
            {/* Left: Tap to Speak Toggle Button & Status */}
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <button
                type="button"
                onClick={toggleSpeechRecognition}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
                  isSpeechActive
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs animate-pulse ring-2 ring-emerald-500/30'
                    : 'bg-[var(--bg-card)] text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] border border-[var(--border-default)]'
                }`}
                title={isSpeechActive ? 'Microphone is active. Click to pause voice capture.' : 'Click to enable voice capture.'}
              >
                <Mic className={`w-3.5 h-3.5 ${isSpeechActive ? 'fill-current text-white' : 'text-emerald-700 dark:text-emerald-400'}`} />
                <span>{isSpeechActive ? 'Mic Listening...' : 'Tap to Speak'}</span>
              </button>

              <div className="flex items-center gap-2 font-mono text-[11px] text-[var(--text-muted)]">
                <div className="w-16 h-1.5 bg-[var(--border-subtle)] rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-75 rounded-full ${
                      audioLevel > 18 ? 'bg-emerald-500 shadow-xs' : 'bg-[var(--primary)]'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(6, audioLevel * 2))}%` }}
                  />
                </div>
                <span className={audioLevel > 18 ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : ''}>
                  {audioLevel > 18 ? 'Voice active' : isSpeechActive ? 'Listening' : 'Idle'}
                </span>
              </div>

              {/* Conversational Auto-Submit Countdown Badge */}
              {autoSubmitCountdown !== null && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-[11px] font-mono animate-pulse">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                  <span>Submitting in {autoSubmitCountdown}s</span>
                  <button
                    type="button"
                    onClick={clearSilenceTimer}
                    className="ml-1 px-1.5 py-0.5 rounded text-[10px] bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)] border border-[var(--border-subtle)] text-[var(--text-secondary)] cursor-pointer"
                    title="Pause auto-submission and keep speaking"
                  >
                    Pause
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSubmitCandidateAnswer(textInput || candidateSpeechText)}
                    className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-600 hover:bg-emerald-700 text-white font-semibold cursor-pointer"
                    title="Submit immediately"
                  >
                    Send Now
                  </button>
                </div>
              )}
            </div>

            {/* Right: Console Controls (Auto-Send toggle, Turn Ledger, Clear, Scratchpad) */}
            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  const nextVal = !isAutoSendEnabled;
                  setIsAutoSendEnabled(nextVal);
                  if (!nextVal) clearSilenceTimer();
                }}
                className={`px-2 py-1 rounded-md text-[11px] font-mono transition-colors flex items-center gap-1 cursor-pointer border ${
                  isAutoSendEnabled
                    ? 'border-emerald-500/30 text-emerald-700 dark:text-emerald-400 bg-emerald-500/10'
                    : 'border-[var(--border-subtle)] text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)]'
                }`}
                title="When ON, waits 5s of quiet after speaking to submit automatically. When OFF, you submit manually with zero rush."
              >
                <span>Auto-Send (5s): {isAutoSendEnabled ? 'ON' : 'OFF'}</span>
              </button>

              {history.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowTurnHistory(!showTurnHistory)}
                  className="px-2.5 py-1 rounded-md text-[11px] font-mono text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] border border-[var(--border-subtle)] transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <span>{history.length} Turns Ledger</span>
                  <span className="text-[9px]">{showTurnHistory ? '▲' : '▼'}</span>
                </button>
              )}

              {(textInput || candidateSpeechText) && (
                <button
                  type="button"
                  onClick={() => {
                    clearSilenceTimer();
                    setCandidateSpeechText('');
                    setTextInput('');
                    setSpeechDraft(null);
                    candidateTextRef.current = '';
                  }}
                  className="px-2 py-1 rounded-md text-[11px] text-[var(--text-muted)] hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors flex items-center gap-1 cursor-pointer"
                  title="Clear captured speech"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Clear</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setIsScratchpadOpen(true)}
                className="px-2.5 py-1 rounded-md text-[11px] font-medium text-[var(--primary)] hover:bg-[var(--primary)]/10 border border-[var(--border-subtle)] transition-colors flex items-center gap-1.5 cursor-pointer"
                title="Open live code editor and architecture canvas"
              >
                <Code2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Code Editor</span>
              </button>
            </div>
          </div>

          {/* Collapsible Verbatim Turn Ledger */}
          {showTurnHistory && history.length > 0 && (
            <div className="p-4 bg-[var(--bg-muted)]/50 border-b border-[var(--border-subtle)] max-h-48 overflow-y-auto space-y-2 text-xs">
              <div className="text-[11px] font-mono font-semibold text-[var(--text-muted)] uppercase tracking-wider flex items-center justify-between pb-1 border-b border-[var(--border-subtle)]">
                <span>Official Transcript Ledger</span>
                <span>{history.length} Recorded Exchanges</span>
              </div>
              {history.map((turn, i) => (
                <div key={i} className="p-2.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-1">
                  <div className="flex items-center justify-between font-mono text-[10px]">
                    <span className={turn.speaker === 'ai' ? 'text-blue-600 dark:text-blue-400 font-bold' : 'text-emerald-600 dark:text-emerald-400 font-bold'}>
                      {turn.speaker === 'ai' ? 'Examiner' : 'Candidate'} [Turn #{i + 1}]
                    </span>
                    <span className="text-[var(--text-muted)]">{new Date(turn.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                  </div>
                  <p className="text-[var(--text-secondary)] text-xs pl-2 border-l-2 border-[var(--border-subtle)]">{turn.text}</p>
                </div>
              ))}
            </div>
          )}

          <SpeechReviewCapture sessionId={sessionId} disabled={isCompleted || !!textInput.trim()}
            onBusy={(busy) => { cloudBusyRef.current = busy; setCloudBusy(busy); }}
            onStart={() => {
              isListeningRef.current = false;
              recognitionRef.current?.abort();
              setIsSpeechActive(false);
              voiceEngine?.stop();
              activeSpeechRef.current = null;
              wsRef.current?.send(JSON.stringify({ type: 'barge_in' }));
            }}
            onDraft={(draft) => {
              setSpeechDraft(draft); setTextInput(draft.text); setCandidateSpeechText(draft.text);
              candidateTextRef.current = draft.text;
            }} />
          {speechDraft && <div role="status" className="px-5 pt-3 text-xs text-[var(--text-secondary)]">
            Review the highlighted words, correct the answer below, then confirm submission.
            <p className="mt-2 leading-relaxed">{speechDraft.words.map((word, index) =>
              <span key={index} className={word.confidence < .8 ? 'bg-amber-500/20 underline decoration-dotted' : ''}
                title={word.confidence < .8 ? 'Recognition uncertain — please check this word' : undefined}>
                {word.punctuated_word || word.word}{' '}
              </span>)}</p>
          </div>}
          {/* Interactive Response Textarea */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              clearSilenceTimer();
              handleSubmitCandidateAnswer(textInput || candidateSpeechText);
            }}
          >
            <div className="p-4 sm:p-5">
              <textarea
                id="candidate-text-answer"
                aria-describedby="transcript-edit-help"
                name="candidateText"
                rows={4}
                placeholder="Speak your answer naturally or type your response here... (Speech will stream in live)"
                value={textInput}
                readOnly={cloudBusy}
                onChange={(e) => {
                  clearSilenceTimer();
                  setTextInput(e.target.value);
                  setCandidateSpeechText(e.target.value);
                  candidateTextRef.current = e.target.value;
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    clearSilenceTimer();
                    handleSubmitCandidateAnswer(textInput || candidateSpeechText);
                  }
                }}
                className="w-full bg-transparent text-sm sm:text-base text-[var(--text-primary)] border-none outline-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0 resize-none leading-relaxed placeholder:text-[var(--text-muted)] placeholder:text-sm font-sans no-focus-outline"
                style={{ outline: 'none', border: 'none', boxShadow: 'none' }}
              />
              <p id="transcript-edit-help" className="mt-2 text-xs text-[var(--text-secondary)]">
                Review technical terms and edit any transcription mistakes before submitting.
              </p>
            </div>

            {/* Console Footer Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 py-3 border-t border-[var(--border-subtle)] bg-[var(--bg-muted)]/40 text-xs">
              <div className="flex items-center gap-3 text-[11px] text-[var(--text-muted)] font-mono">
                <span>
                  {textInput.trim()
                    ? `${textInput.trim().split(/\s+/).filter(Boolean).length} words captured`
                    : 'Awaiting candidate oral input...'}
                </span>
                {textInput.trim().split(/\s+/).filter(Boolean).length > 0 && (
                  <>
                    <span className="opacity-60">·</span>
                    <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                      {textInput.trim().split(/\s+/).filter(Boolean).length >= 40 ? 'Thorough Formulation' : 'Response Formulating'}
                    </span>
                  </>
                )}
                <span className="hidden sm:inline opacity-60">·</span>
                <span className="hidden sm:inline opacity-75">
                  {isAutoSendEnabled ? 'Auto-send after 5s; unreviewed speech may need faculty review' : 'Manual mode: click Submit when finished or ⌘ + Enter'}
                </span>
              </div>

              <button
                type="submit"
                disabled={cloudBusy || !(textInput.trim() || candidateSpeechText.trim())}
                className="btn-primary text-xs px-5 py-2.5 rounded-lg flex items-center gap-2 shadow-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
              >
                <span>Confirm & Submit Answer</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </form>
        </div>
      </main>

      {/* Floating Bottom Studio Controls Dock */}
      <footer className="w-full border-t border-[var(--border-subtle)] bg-[var(--bg-card)]/80 backdrop-blur-md px-4 sm:px-6 py-2.5 z-20">
        <div className="max-w-5xl mx-auto flex items-center justify-between text-xs text-[var(--text-secondary)]">
          {/* Left Audio & Mode Toggles */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const nextMuted = !isMuted;
                setIsMuted(nextMuted);
                if (nextMuted && recognitionRef.current) {
                  recognitionRef.current.abort();
                } else if (!nextMuted) {
                  if (isListeningRef.current) {
                    startSpeechRecognition();
                  }
                }
              }}
              className={`px-3 py-1.5 rounded-lg border text-xs transition-colors flex items-center gap-1.5 min-h-[36px] cursor-pointer ${
                isMuted
                  ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 text-amber-800 dark:text-amber-300 font-semibold'
                  : 'border-[var(--border-subtle)] hover:bg-[var(--bg-muted)] text-[var(--text-primary)]'
              }`}
              title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
            >
              {isMuted ? <MicOff className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" /> : <Mic className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />}
              <span>{isMuted ? 'Mic Muted' : 'Mic Active'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const nextSpeakerMute = !isAudioOutputMuted;
                setIsAudioOutputMuted(nextSpeakerMute);
                if (nextSpeakerMute) voiceEngine?.stop();
              }}
              className={`px-3 py-1.5 rounded-lg border text-xs transition-colors flex items-center gap-1.5 min-h-[36px] cursor-pointer ${
                isAudioOutputMuted
                  ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 text-amber-800 dark:text-amber-300 font-semibold'
                  : 'border-[var(--border-subtle)] hover:bg-[var(--bg-muted)] text-[var(--text-primary)]'
              }`}
              title={isAudioOutputMuted ? 'Unmute examiner audio' : 'Mute examiner audio'}
            >
              {isAudioOutputMuted ? <VolumeX className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" /> : <Volume2 className="w-3.5 h-3.5" />}
              <span>{isAudioOutputMuted ? 'Speaker Muted' : 'Audio On'}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowVoiceModal(true)}
              className="px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] hover:bg-[var(--bg-muted)] text-[var(--text-primary)] text-xs transition-colors flex items-center gap-1.5 min-h-[36px] cursor-pointer"
              title="Select AI Examiner Voice (ElevenLabs)"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span>Voice: <strong className="font-semibold text-emerald-700 dark:text-emerald-400">{EXAMINER_VOICES.find((v) => v.id === selectedVoiceId)?.name || 'Alice'}</strong></span>
            </button>

            <button
              type="button"
              onClick={() => setIsScratchpadOpen(true)}
              className="px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] hover:bg-[var(--bg-muted)] text-[var(--text-primary)] text-xs transition-colors flex items-center gap-1.5 min-h-[36px] cursor-pointer"
              title="Open interactive technical code and architecture scratchpad"
            >
              <Terminal className="w-3.5 h-3.5 text-[var(--primary)]" />
              <span className="hidden sm:inline">Code Scratchpad</span>
            </button>
          </div>

          {/* Right Proctoring Status */}
          <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)] font-mono">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-700 dark:text-teal-400 shrink-0" />
            <span>Exam Session Monitored</span>
          </div>
        </div>
      </footer>

      {/* Interactive Live Technical Code Scratchpad Drawer */}
      <CodeScratchpad
        isOpen={isScratchpadOpen}
        onClose={() => setIsScratchpadOpen(false)}
        onSubmitCode={(codePayload: string) => {
          handleSubmitCandidateAnswer(codePayload);
          showToast('Code submission delivered to AI examiner.', 'success');
        }}
      />

      {/* Confirmation End Exam Modal */}
      <Modal
        isOpen={showEndModal}
        onClose={() => setShowEndModal(false)}
        title="Finish Exam Early?"
        description="Are you sure you want to finish and submit your oral exam now?"
        footer={
          <>
            <button
              type="button"
              className="btn-outline text-xs px-4 cursor-pointer"
              onClick={() => setShowEndModal(false)}
            >
              Continue Exam
            </button>
            <button
              type="button"
              className="btn-danger text-xs px-4 cursor-pointer"
              onClick={() => {
                setShowEndModal(false);
                handleFinishInterview();
              }}
            >
              Finish & Submit
            </button>
          </>
        }
      >
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
          Your answers recorded so far ({Math.floor(elapsedSeconds / 60)}m {elapsedSeconds % 60}s) will be submitted to your instructor for grading and review.
        </p>
      </Modal>

      {/* ElevenLabs Voice Selection Modal */}
      <VoiceSelectorModal
        isOpen={showVoiceModal}
        onClose={() => setShowVoiceModal(false)}
        selectedVoiceId={selectedVoiceId}
        onSelectVoice={(vid) => {
          handleSelectVoice(vid);
          showToast(
            `Examiner voice updated to ElevenLabs ${EXAMINER_VOICES.find((v) => v.id === vid)?.name || vid}`,
            'success'
          );
        }}
      />
    </div>
  );
}
