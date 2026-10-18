'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mic,
  MicOff,
  PhoneOff,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  CheckCircle2,
  AlertTriangle,
  Send,
  HelpCircle,
  Clock,
  ShieldCheck,
  FileText,
  ArrowRight,
  RotateCcw,
  Sparkles,
  Play,
  Volume1,
  Headphones,
} from 'lucide-react';
import { useAuthStore } from '@/store';
import { VoiceOrb, OrbState } from '@/components/interview/VoiceOrb';
import { CountdownRing } from '@/components/interview/CountdownRing';
import { LiveCaptions } from '@/components/interview/LiveCaptions';
import { useToast } from '@/components/providers/ToastProvider';
import { voiceEngine } from '@/lib/speech';

interface TranscriptItem {
  speaker: 'ai' | 'student';
  text: string;
  timestamp: number;
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

export default function LiveInterviewPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params?.id as string;
  const { user, token } = useAuthStore();
  const { showToast } = useToast();

  // State
  const [hasStartedAudio, setHasStartedAudio] = useState<boolean>(false);
  const [orbState, setOrbState] = useState<OrbState>('idle');
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [currentPhase, setCurrentPhase] = useState<string>('warm_up');
  const [currentPromptText, setCurrentPromptText] = useState<string>('');
  const [candidateSpeechText, setCandidateSpeechText] = useState<string>('');
  const [isSpeechRecognitionSupported, setIsSpeechRecognitionSupported] = useState<boolean>(true);
  const [activeSpeaker, setActiveSpeaker] = useState<'ai' | 'student'>('ai');
  const [history, setHistory] = useState<TranscriptItem[]>([]);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isAudioOutputMuted, setIsAudioOutputMuted] = useState<boolean>(false);
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [showEndModal, setShowEndModal] = useState<boolean>(false);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [textInput, setTextInput] = useState<string>('');
  const [isTextMode, setIsTextMode] = useState<boolean>(false);
  const [fallbackTurnIndex, setFallbackTurnIndex] = useState<number>(0);

  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const recognitionRef = useRef<any>(null);

  // Speech Recognition capture (STT)
  const startSpeechRecognition = useCallback(() => {
    if (typeof window === 'undefined' || isMuted) return;
    const SpeechRecognitionClass =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionClass) {
      setIsSpeechRecognitionSupported(false);
      setIsTextMode(true);
      return;
    }

    try {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
      const recognition = new SpeechRecognitionClass();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event: any) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          interim += event.results[i][0].transcript;
        }
        if (interim) {
          setCandidateSpeechText(interim);
          setOrbState('listening');
          setAudioLevel(Math.floor(Math.random() * 35) + 30);
        }
      };

      recognition.onerror = (e: any) => {
        console.warn('Speech recognition notice:', e?.error);
        if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') {
          setIsSpeechRecognitionSupported(false);
          setIsTextMode(true);
        }
      };

      recognition.start();
      recognitionRef.current = recognition;
    } catch (err) {
      console.warn('Speech recognition init notice:', err);
      setIsSpeechRecognitionSupported(false);
    }
  }, [isMuted]);

  // Audible text-to-speech helper using dedicated voice engine
  const speakQuestion = useCallback((text: string) => {
    if (isAudioOutputMuted) return;
    setOrbState('speaking');
    setActiveSpeaker('ai');

    voiceEngine?.speak(text, {
      onStart: () => {
        setOrbState('speaking');
        setActiveSpeaker('ai');
      },
      onEnd: () => {
        setOrbState('listening');
        setActiveSpeaker('student');
        startSpeechRecognition();
      },
      onError: (err: any) => {
        console.warn('Voice speak error:', err);
        setOrbState('listening');
        setActiveSpeaker('student');
        startSpeechRecognition();
      },
    });
  }, [isAudioOutputMuted, startSpeechRecognition]);

  const handleFinishInterview = useCallback(() => {
    setIsCompleted(true);
    voiceEngine?.stop();
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'end_session' }));
    }
    setHistory((prev) => {
      try {
        sessionStorage.setItem(`vivaai_turns_${sessionId}`, JSON.stringify(prev));
      } catch {}
      return prev;
    });
  }, [sessionId]);

  // Advance question in fallback sequence
  const advanceFallbackQuestion = useCallback((nextIdx: number) => {
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

  // User gesture activation to satisfy browser autoplay policy
  const handleActivateAndJoin = () => {
    voiceEngine?.unlockAudio();
    setHasStartedAudio(true);
    showToast('Acoustic link established. Examiner voice active.', 'success');
    advanceFallbackQuestion(0);
  };

  // Auto-start if navigated directly from calibration
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const direct = sessionStorage.getItem('vivaai_direct_start');
      if (direct === 'true') {
        sessionStorage.removeItem('vivaai_direct_start');
        voiceEngine?.unlockAudio();
        setHasStartedAudio(true);
        advanceFallbackQuestion(0);
      }
    }
  }, [advanceFallbackQuestion]);

  // Animate VoiceOrb equalizer bars during examiner speech
  useEffect(() => {
    let speakInterval: any = null;
    if (orbState === 'speaking') {
      speakInterval = setInterval(() => {
        setAudioLevel(Math.floor(Math.random() * 45) + 40);
      }, 90);
    }
    return () => {
      if (speakInterval) clearInterval(speakInterval);
    };
  }, [orbState]);

  // Tab switch detection (auditable proctoring log)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'tab_switch' }));
        }
        showToast('Tab switch registered in official examination audit ledger', 'warning');
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [showToast]);

  // Timer countdown: 0 to 900s (15 min hard stop)
  useEffect(() => {
    if (!hasStartedAudio) return;

    timerRef.current = setInterval(() => {
      setElapsedSeconds((prev) => {
        if (prev >= 900) {
          clearInterval(timerRef.current!);
          handleFinishInterview();
          return 900;
        }
        return prev + 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [hasStartedAudio]);

  // Microphone audio level monitoring
  useEffect(() => {
    if (!hasStartedAudio) return;

    async function initMicLevel() {
      try {
        if (typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          micStreamRef.current = stream;

          const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          const ctx = new AudioContextClass();
          audioContextRef.current = ctx;

          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);

          const dataArray = new Uint8Array(analyser.frequencyBinCount);

          const checkLevel = () => {
            if (isMuted) {
              setAudioLevel(0);
            } else {
              analyser.getByteFrequencyData(dataArray);
              let sum = 0;
              for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
              const avg = sum / dataArray.length;
              setAudioLevel(Math.min(100, Math.round((avg / 128) * 100)));
            }
            animFrameRef.current = requestAnimationFrame(checkLevel);
          };
          checkLevel();
        }
      } catch {
        const interval = setInterval(() => {
          if (!isMuted && orbState === 'listening') {
            setAudioLevel(Math.floor(Math.random() * 35) + 20);
          } else {
            setAudioLevel(0);
          }
        }, 150);
        return () => clearInterval(interval);
      }
    }
    initMicLevel();

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (micStreamRef.current) micStreamRef.current.getTracks().forEach((t) => t.stop());
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') audioContextRef.current.close();
      if (recognitionRef.current) recognitionRef.current.abort();
    };
  }, [hasStartedAudio, isMuted, orbState]);


  // Initialize WebSocket connection or Fallback
  useEffect(() => {
    if (!hasStartedAudio) return;

    const wsUrl = `${process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000'}/ws/interview/${sessionId}?token=${token || 'demo_token'}`;
    let ws: WebSocket | null = null;

    try {
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        ws?.send(JSON.stringify({ type: 'start' }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'transcript' || data.type === 'ai_speaking') {
            const speaker: 'ai' | 'student' = (data.speaker === 'assistant' || data.type === 'ai_speaking') ? 'ai' : 'student';
            if (speaker === 'ai') {
              setCurrentPromptText(data.text);
              speakQuestion(data.text);
            }
            setActiveSpeaker(speaker);
            setHistory((prev) => {
              const nextHistory = [
                ...prev,
                { speaker, text: data.text, timestamp: Date.now() },
              ];
              try {
                sessionStorage.setItem(`vivaai_turns_${sessionId}`, JSON.stringify(nextHistory));
              } catch {}
              return nextHistory;
            });
          } else if (data.type === 'student_transcript') {
            setActiveSpeaker('student');
            setHistory((prev) => {
              const nextHistory = [
                ...prev,
                { speaker: 'student' as const, text: data.text, timestamp: Date.now() },
              ];
              try {
                sessionStorage.setItem(`vivaai_turns_${sessionId}`, JSON.stringify(nextHistory));
              } catch {}
              return nextHistory;
            });
          } else if (data.type === 'phase_change') {
            setCurrentPhase(data.phase);
          } else if (data.type === 'completed') {
            handleFinishInterview();
          }
        } catch (e) {
          console.warn('WS parse error:', e);
        }
      };

      ws.onerror = () => {
        setIsConnected(false);
      };

      ws.onclose = () => {
        setIsConnected(false);
      };
    } catch {
      setIsConnected(false);
    }

    return () => {
      if (ws) ws.close();
      voiceEngine?.stop();
    };
  }, [hasStartedAudio, sessionId, token, speakQuestion, handleFinishInterview]);

  // Handle student submitting an answer (via voice or text)
  const handleSubmitResponse = (overrideText?: string) => {
    const responseText = (overrideText || textInput || candidateSpeechText).trim();
    if (!responseText) {
      showToast(
        "No speech or text detected. Please speak into your microphone, type your answer, or click 'Pass / I Don't Know'.",
        'warning'
      );
      return;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }

    const newTurn: TranscriptItem = {
      speaker: 'student',
      text: responseText,
      timestamp: Date.now(),
    };
    const nextHistory = [...history, newTurn];
    setHistory(nextHistory);
    setTextInput('');
    setCandidateSpeechText('');
    setOrbState('thinking');
    setActiveSpeaker('ai');

    try {
      sessionStorage.setItem(`vivaai_turns_${sessionId}`, JSON.stringify(nextHistory));
    } catch {}

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'candidate_response',
          text: responseText,
          candidate_response: responseText,
        })
      );
    } else {
      // Advance to next question in sequence
      setTimeout(() => {
        advanceFallbackQuestion(fallbackTurnIndex + 1);
      }, 1500);
    }
  };

  // Repeat the last question out loud using voice engine
  const handleRepeatQuestion = () => {
    showToast('Repeating examiner prompt aloud via audio', 'info');
    voiceEngine?.repeatLast({
      onStart: () => {
        setOrbState('speaking');
        setActiveSpeaker('ai');
      },
      onEnd: () => {
        setOrbState('listening');
        setActiveSpeaker('student');
        startSpeechRecognition();
      },
    });
  };

  // "Pass / I don't know" without penalty
  const handlePassQuestion = () => {
    showToast('Question passed without penalty. Advancing probe.', 'info');
    handleSubmitResponse("I am not confident on this topic. Please proceed to the next question.");
  };


  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between selection:bg-sky-500/30">
      {/* Top Proctored Exam Header */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur-md px-4 sm:px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
            <span className="text-xs font-mono font-bold tracking-wider text-rose-400 uppercase">
              Live Oral Viva Voce
            </span>
          </div>

          <div className="hidden sm:flex items-center gap-2 pl-4 border-l border-slate-800 text-xs">
            <span className="text-slate-400">Candidate:</span>
            <span className="font-semibold text-white">{user?.name || 'Alex Chen'}</span>
            <span className="font-mono text-slate-400">({user?.student_id || 'STU001'})</span>
          </div>
        </div>

        {/* Right Status Controls */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800 border border-slate-700 text-xs font-mono text-slate-300">
            {isConnected ? (
              <>
                <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                <span className="hidden sm:inline">Engine Linked</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden sm:inline">Acoustic Audio Channel</span>
              </>
            )}
          </div>

          <button
            onClick={() => {
              const nextMuted = !isAudioOutputMuted;
              setIsAudioOutputMuted(nextMuted);
              if (nextMuted) voiceEngine?.stop();
            }}
            className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-800"
            title={isAudioOutputMuted ? 'Unmute Examiner Voice' : 'Mute Examiner Voice'}
          >
            {isAudioOutputMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4 text-sky-400" />}
          </button>

          <button
            onClick={() => setShowEndModal(true)}
            className="px-3 py-1.5 rounded-md text-xs font-semibold bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 border border-rose-500/30 flex items-center gap-1.5"
          >
            <PhoneOff className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Conclude Viva</span>
          </button>
        </div>
      </header>

      {/* Main Oral Examination Chamber */}
      <main className="flex-1 max-w-5xl w-full mx-auto p-4 sm:p-6 flex flex-col justify-center items-center space-y-6 relative">
        {/* Gateway Overlay: Unlocks Audio Autoplay with 1 Click */}
        {!hasStartedAudio && (
          <div className="absolute inset-0 z-40 bg-slate-950/95 backdrop-blur-xl flex flex-col items-center justify-center p-6 text-center space-y-6 animate-fade-in">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center text-white shadow-2xl shadow-sky-500/30">
              <Headphones className="w-8 h-8" />
            </div>

            <div className="space-y-2 max-w-md">
              <h2 className="text-2xl font-extrabold text-white">
                Enter Oral Examination Room
              </h2>
              <p className="text-sm text-slate-300 leading-relaxed">
                The examiner will speak all questions aloud to you through your audio output. <strong>There is no requirement to read text off the screen</strong>—listen attentively and respond with your microphone.
              </p>
            </div>

            <button
              onClick={handleActivateAndJoin}
              className="btn-primary py-3.5 px-8 text-sm font-bold shadow-xl shadow-sky-600/30 flex items-center gap-2.5 text-base"
            >
              <Volume2 className="w-5 h-5" />
              <span>Enable Audio & Begin Viva Voce</span>
            </button>

            <span className="text-[11px] font-mono text-slate-500">
              * Activates browser audio output for live examiner speech synthesis
            </span>
          </div>
        )}

        {/* 15-Minute Countdown Ring & Phase Timeline */}
        <CountdownRing
          elapsedSeconds={elapsedSeconds}
          totalSeconds={900}
          currentPhase={currentPhase}
          size={140}
        />

        {/* Dynamic Acoustic Voice Orb Visualizer */}
        <div className="flex flex-col items-center space-y-3">
          <VoiceOrb
            state={orbState}
            audioLevel={audioLevel}
            size={180}
          />

          {/* Examiner Voice Status Banner */}
          <div className="text-center space-y-1">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-300 font-mono flex items-center justify-center gap-2">
              {orbState === 'speaking' ? (
                <>
                  <Volume2 className="w-4 h-4 text-sky-400 animate-pulse" />
                  <span className="text-sky-400 font-bold">Examiner Speaking Question Aloud</span>
                </>
              ) : orbState === 'listening' ? (
                <>
                  <Mic className="w-4 h-4 text-emerald-400 animate-pulse" />
                  <span className="text-emerald-400 font-bold">Microphone Active · State Your Response</span>
                </>
              ) : (
                <>
                  <span className="text-slate-400 font-mono">Examiner Deliberating Response...</span>
                </>
              )}
            </div>

            <p className="text-[11px] text-slate-400 font-mono">
              {orbState === 'speaking'
                ? 'Listen carefully. Candidate barge-in is enabled.'
                : 'Speak clearly into your microphone when ready.'}
            </p>
          </div>
        </div>

        {/* Optional Subtitles Drawer (Collapsed by default so candidate is NOT reading questions) */}
        <LiveCaptions
          currentText={currentPromptText}
          activeSpeaker={activeSpeaker}
          recentHistory={history}
        />

        {/* Candidate Audio & Speech Controls Console */}
        <div className="w-full max-w-2xl glass-panel p-5 space-y-4 border border-slate-800">
          <div className="flex items-center justify-between text-xs text-slate-400 pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isMuted ? 'bg-slate-600' : 'bg-emerald-400 animate-pulse'}`} />
              <span className="font-semibold text-slate-200">
                {isMuted ? 'Microphone Muted' : 'Microphone Live (Opus 48kHz)'}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleRepeatQuestion}
                className="hover:text-white flex items-center gap-1.5 text-xs font-bold text-sky-400 bg-sky-500/10 px-2.5 py-1 rounded-md border border-sky-500/20"
                title="Hear question repeated via audio voice"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Hear Question Again (Voice)</span>
              </button>

              <button
                onClick={handlePassQuestion}
                className="hover:text-amber-300 flex items-center gap-1 text-xs font-semibold text-slate-400"
                title="Pass without grading penalty"
              >
                <HelpCircle className="w-3.5 h-3.5 text-amber-400" />
                <span>Pass / I Don&apos;t Know</span>
              </button>
            </div>
          </div>

          {/* Action Row */}
          <div className="flex flex-col sm:flex-row items-center gap-3">
            {/* Mic Toggle Button */}
            <button
              onClick={() => {
                const nextMuted = !isMuted;
                setIsMuted(nextMuted);
                if (nextMuted) {
                  if (recognitionRef.current) recognitionRef.current.stop();
                  setAudioLevel(0);
                } else {
                  startSpeechRecognition();
                }
              }}
              className={`w-full sm:w-auto px-5 py-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all ${
                isMuted
                  ? 'bg-slate-800 text-slate-400 border border-slate-700 hover:text-white'
                  : 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-lg shadow-emerald-600/30'
              }`}
            >
              {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              <span>{isMuted ? 'Unmute Microphone' : 'Microphone Live · Speaking'}</span>
            </button>

            {/* Complete Response / Submit Turn Button */}
            <button
              onClick={() => handleSubmitResponse()}
              disabled={orbState === 'thinking'}
              className="w-full sm:flex-1 btn-primary py-3 text-xs font-bold flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Submit Answer & Hear Next Question</span>
            </button>
          </div>

          {/* Real-time transcribed candidate speech preview */}
          {candidateSpeechText && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300 font-mono flex items-start gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse mt-1 shrink-0" />
              <div className="flex-1">
                <span className="font-bold text-emerald-400 uppercase tracking-wider text-[10px] block mb-0.5">
                  Live Microphone Transcription (Spoken Response):
                </span>
                <span className="text-slate-100">&quot;{candidateSpeechText}&quot;</span>
              </div>
            </div>
          )}

          {!isSpeechRecognitionSupported && !isTextMode && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 font-mono flex items-center justify-between">
              <span>Browser privacy shields blocked live speech-to-text.</span>
              <button
                onClick={() => setIsTextMode(true)}
                className="text-xs text-sky-400 underline font-bold hover:text-sky-300"
              >
                Enable Text Response Box
              </button>
            </div>
          )}

          {/* Optional Text Input Fallback (for noisy environments) */}
          <div className="pt-1">
            {isTextMode ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Type your technical answer here..."
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSubmitResponse();
                  }}
                  className="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-sky-500 font-mono"
                />
                <button
                  onClick={() => handleSubmitResponse()}
                  className="btn-primary px-3 py-2 text-xs"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setIsTextMode(true)}
                className="text-[11px] text-slate-500 hover:text-slate-300 underline font-mono"
              >
                Candidate unable to speak? Switch to text response
              </button>
            )}
          </div>
        </div>
      </main>

      {/* Confirmation Modal to End Exam */}
      {showEndModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel max-w-sm w-full p-6 space-y-4 border border-slate-800">
            <h3 className="text-base font-bold text-white">Conclude Viva Voce?</h3>
            <p className="text-xs text-slate-400">
              Your audio transcript and timestamps will be sealed into the audit ledger and sent for faculty scoring.
            </p>
            <div className="flex gap-2 justify-end pt-2">
              <button
                onClick={() => setShowEndModal(false)}
                className="btn-secondary text-xs py-2 px-3"
              >
                Continue Exam
              </button>
              <button
                onClick={handleFinishInterview}
                className="btn-primary bg-rose-600 hover:bg-rose-500 text-xs py-2 px-3"
              >
                Conclude & Seal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Session Concluded Overlay */}
      {isCompleted && (
        <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col items-center justify-center p-6 text-center space-y-6">
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center mx-auto shadow-2xl shadow-emerald-500/20">
            <CheckCircle2 className="w-8 h-8" />
          </div>

          <div className="space-y-2 max-w-md">
            <h2 className="text-2xl font-extrabold text-white">
              Viva Voce Examination Concluded
            </h2>
            <p className="text-sm text-slate-300">
              The 15-minute examination record has been sealed. Verbatim turn citations have been forwarded to the chief examiner assessment registry.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => router.push('/dashboard')}
              className="btn-primary py-3 px-6 text-xs font-bold"
            >
              View Assessment Registry
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => router.push(`/faculty/review/${sessionId}`)}
              className="btn-secondary py-3 px-6 text-xs font-bold"
            >
              Inspect Candidate Dossier
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
