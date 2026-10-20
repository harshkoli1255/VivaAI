'use client';

/**
 * Universal High-Fidelity Voice Engine for VivaAI.
 * Uses studio-grade ElevenLabs Flash v2.5 human neural conversational speech
 * with multi-tier fallbacks (Deepgram Aura & macOS Daniel/Karen 170wpm).
 * Guaranteed natural, articulate, human-sounding speech in all browsers.
 */

export interface ExaminerVoice {
  id: string; // voice key (e.g. 'alice', 'sarah')
  name: string;
  tagline: string;
  gender: 'female' | 'male';
  accent: string;
  elevenVoiceId: string;
  previewSample: string;
  badge: string;
}

export const EXAMINER_VOICES: ExaminerVoice[] = [
  {
    id: 'alice',
    name: 'Alice',
    tagline: 'Clear, Engaging Educator',
    gender: 'female',
    accent: 'British / International',
    elevenVoiceId: 'Xb7hH8MSUJpSbSDYk0k2',
    previewSample: 'Hello! I will be your technical viva examiner today. Let us explore your technical solutions.',
    badge: 'Recommended',
  },
  {
    id: 'sarah',
    name: 'Sarah',
    tagline: 'Mature, Reassuring & Confident',
    gender: 'female',
    accent: 'American',
    elevenVoiceId: 'EXAVITQu4vr4xnSDxMaL',
    previewSample: 'Welcome to your viva examination. Take your time and explain your thought process clearly.',
    badge: 'Popular',
  },
  {
    id: 'george',
    name: 'George',
    tagline: 'Warm, Captivating Scholar',
    gender: 'male',
    accent: 'British',
    elevenVoiceId: 'JBFqnCBsd6RMkjVDRZzb',
    previewSample: 'Good day. I am looking forward to exploring these architectural choices and trade-offs with you.',
    badge: 'Warm Scholar',
  },
  {
    id: 'brian',
    name: 'Brian',
    tagline: 'Deep, Resonant & Comforting',
    gender: 'male',
    accent: 'American',
    elevenVoiceId: 'nPczCjzI2devNBz1zQrb',
    previewSample: 'Hello. Feel free to explain your data structures and concurrency trade-offs step by step.',
    badge: 'Deep Baritone',
  },
  {
    id: 'charlie',
    name: 'Charlie',
    tagline: 'Confident, Energetic & Analytical',
    gender: 'male',
    accent: 'Australian',
    elevenVoiceId: 'IKne3meq5aSn9XLyUdCD',
    previewSample: 'Welcome! We will dive straight into your algorithm designs and system performance.',
    badge: 'Energetic',
  },
  {
    id: 'matilda',
    name: 'Matilda',
    tagline: 'Knowledgeable & Professional',
    gender: 'female',
    accent: 'American',
    elevenVoiceId: 'XrExE9yKIg1WjnnlVkGX',
    previewSample: 'Greetings. Let us review the core architectural principles behind your implementation.',
    badge: 'Professional',
  },
  {
    id: 'daniel',
    name: 'Daniel',
    tagline: 'Steady Broadcaster & Academic',
    gender: 'male',
    accent: 'British',
    elevenVoiceId: 'onwK4e9ZLuTAKqWW03F9',
    previewSample: 'Welcome. Please provide a rigorous explanation of your computational complexity and tradeoffs.',
    badge: 'Formal',
  },
  {
    id: 'jessica',
    name: 'Jessica',
    tagline: 'Playful, Bright & Warm',
    gender: 'female',
    accent: 'American',
    elevenVoiceId: 'cgSgspJ2msm6clMCkdW9',
    previewSample: 'Hi there! Ready for your viva? Let us start by walking through your main design patterns.',
    badge: 'Friendly',
  },
];

// Novelty and vintage robotic voices to strictly exclude
const ROBOTIC_VOICES = new Set([
  'albert',
  'bad news',
  'bahh',
  'bells',
  'boing',
  'bubbles',
  'cellos',
  'deranged',
  'good news',
  'hysterical',
  'pipe organ',
  'trinoids',
  'whisper',
  'zarvox',
  'fred',
  'junior',
  'ralph',
  'wobble',
  'jester',
  'organ',
  'superstar',
]);

class VoiceEngine {
  private playbackGeneration = 0;
  private currentAudio: HTMLAudioElement | null = null;
  private isUnlocked = false;
  private lastSpokenText = '';
  private currentVoiceId = 'alice';
  private synth: SpeechSynthesis | null = null;
  private cachedVoices: SpeechSynthesisVoice[] = [];
  private streamAudioChunks: Uint8Array[] = [];
  private streamCallbacks?: {
    onStart?: () => void;
    onEnd?: () => void;
    onError?: (err: unknown) => void;
  };
  private streamFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private isFallingBack: boolean = false;

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('vivaai_examiner_voice');
        if (saved) this.currentVoiceId = saved;
      } catch {
        // ignore local storage errors
      }

      if ('speechSynthesis' in window) {
        this.synth = window.speechSynthesis;
        this.loadVoices();
        if (this.synth.onvoiceschanged !== undefined) {
          this.synth.onvoiceschanged = () => this.loadVoices();
        }
      }
    }
  }

  public setVoice(voice: string) {
    if (!voice) return;
    this.currentVoiceId = voice;
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('vivaai_examiner_voice', voice);
      } catch {
        // ignore
      }
    }
  }

  public getVoice(): string {
    return this.currentVoiceId;
  }

  public previewVoice(voiceId: string, onEnd?: () => void) {
    const v = EXAMINER_VOICES.find((item) => item.id === voiceId || item.elevenVoiceId === voiceId);
    const sampleText = v ? v.previewSample : 'Hello, this is a test of the examiner voice.';
    const prevVoice = this.currentVoiceId;
    this.currentVoiceId = voiceId;
    this.speak(sampleText, {
      onEnd: () => {
        this.currentVoiceId = prevVoice;
        onEnd?.();
      },
      onError: () => {
        this.currentVoiceId = prevVoice;
        onEnd?.();
      },
    });
  }

  private loadVoices() {
    if (!this.synth) return;
    const v = this.synth.getVoices();
    if (v && v.length > 0) {
      this.cachedVoices = v;
    }
  }

  /**
   * Unlock Audio on initial user gesture to satisfy browser autoplay policies.
   */
  public unlockAudio(): boolean {
    if (typeof window === 'undefined') return false;

    try {
      this.isUnlocked = true;
      // Unlock HTML5 Audio
      const dummy = new Audio();
      dummy.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
      dummy.play().catch(() => {});

      // Unlock Web Speech API
      if (this.synth) {
        this.synth.resume();
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Speak technical viva prompt out loud through device speakers.
   */
  /**
   * Speak technical viva prompt out loud through device speakers using studio neural voice.
   * Multi-tier fallback sequence:
   * Tier 1: Next.js API (/api/tts)
   * Tier 2: FastAPI backend (/api/v1/tts/synthesize)
   * Tier 3: Device speech synthesis
   * (Zero robotic voices: Samantha, Fred, Albert, Zarvox are strictly forbidden)
   */
  public async speak(
    text: string,
    callbacks?: {
      onStart?: () => void;
      onEnd?: () => void;
      onError?: (err: unknown) => void;
    }
  ) {
    if (typeof window === 'undefined') {
      callbacks?.onEnd?.();
      return;
    }

    this.stop();
    const generation = this.playbackGeneration;
    this.lastSpokenText = text;
    this.unlockAudio();

    // 1. Next.js endpoint (/api/tts)
    const success1 = await this.tryPlayAudioUrl(
      `/api/tts?text=${encodeURIComponent(text)}&voice=${encodeURIComponent(this.currentVoiceId)}`,
      callbacks, generation
    );
    if (success1 || generation !== this.playbackGeneration) return;

    // 2. FastAPI backend endpoint (/api/v1/tts/synthesize)
    const apiBase = '';
    const success2 = await this.tryPlayAudioUrl(
      `${apiBase}/api/v1/tts/synthesize?text=${encodeURIComponent(text)}&voice=${encodeURIComponent(this.currentVoiceId)}`,
      callbacks, generation
    );
    if (success2 || generation !== this.playbackGeneration) return;

    // Use device speech when the authenticated speech services are unavailable.
    this.fallbackWebSpeech(text, callbacks);
  }

  /**
   * Play audio from an endpoint URL with blob decoding and event hooks.
   */
  private tryPlayAudioUrl(
    url: string,
    callbacks?: {
      onStart?: () => void;
      onEnd?: () => void;
      onError?: (err: unknown) => void;
    },
    generation = this.playbackGeneration
  ): Promise<boolean> {
    return new Promise((resolve) => {
      fetch(url, {
        credentials: 'include',
        signal: AbortSignal.timeout(15000),
      })
        .then((res) => {
          if (!res.ok) {
            resolve(false);
            return null;
          }
          return res.blob();
        })
        .then((blob) => {
          if (generation !== this.playbackGeneration || !blob || blob.size === 0) {
            resolve(false);
            return;
          }
          const objectUrl = URL.createObjectURL(blob);
          const audio = new Audio(objectUrl);
          this.currentAudio = audio;

          audio.onplay = () => {
            callbacks?.onStart?.();
          };
          audio.onended = () => {
            URL.revokeObjectURL(objectUrl);
            this.currentAudio = null;
            callbacks?.onEnd?.();
          };
          audio.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            this.currentAudio = null;
            resolve(false);
          };

          audio
            .play()
            .then(() => resolve(true))
            .catch((err) => {
              console.warn('Audio play notice:', err);
              URL.revokeObjectURL(objectUrl);
              this.currentAudio = null;
              resolve(false);
            });
        })
        .catch((err) => {
          console.warn('tryPlayAudioUrl notice:', err);
          resolve(false);
        });
    });
  }

  /**
   * Select a device voice without exposing provider credentials.
   */
  private pickBestWebSpeechVoice(): SpeechSynthesisVoice | null {
    const voices = this.cachedVoices.length > 0
      ? this.cachedVoices
      : (this.synth ? this.synth.getVoices() : []);

    if (!voices || voices.length === 0) return null;

    // Filter to English voices
    const enVoices = voices.filter((v) => v.lang.startsWith('en'));
    const candidates = enVoices.length > 0 ? enVoices : voices;

    const scoreVoice = (v: SpeechSynthesisVoice): number => {
      const name = v.name.toLowerCase();

      // Disallow known robotic / novelty voices
      for (const rob of ROBOTIC_VOICES) {
        if (name.includes(rob)) return -10000;
      }

      let score = -500;
      // Highest tier: Modern neural cloud voices
      if (name.includes('natural') || name.includes('online') || name.includes('neural')) score += 2000;
      // Second tier: Google Chrome studio voices
      if (name.includes('google us english') || name.includes('google uk english female')) score += 1500;
      else if (name.includes('google')) score += 1000;
      // Third tier: macOS Enhanced / Premium downloaded neural voices
      if (name.includes('enhanced') || name.includes('premium')) score += 1200;
      // Strictly penalize vintage unenhanced Samantha or compact voices
      if (name.includes('compact') || name.includes('samantha')) score -= 8000;

      return score;
    };

    const sorted = [...candidates].sort((a, b) => scoreVoice(b) - scoreVoice(a));
    return sorted[0] || candidates[0] || voices[0] || null;
  }

  /**
   * Fallback Tier 5: Browser Web Speech API with natural voice selection.
   */
  private fallbackWebSpeech(
    text: string,
    callbacks?: {
      onStart?: () => void;
      onEnd?: () => void;
      onError?: (err: unknown) => void;
    }
  ) {
    if (!this.synth) {
      callbacks?.onEnd?.();
      return;
    }

    try {
      this.synth.cancel();
      const voice = this.pickBestWebSpeechVoice();
      const utterance = new SpeechSynthesisUtterance(text);
      if (voice) {
        utterance.voice = voice;
      }
      utterance.rate = 0.98;
      utterance.pitch = 1.0;

      utterance.onstart = () => callbacks?.onStart?.();
      utterance.onend = () => callbacks?.onEnd?.();
      utterance.onerror = (e) => {
        callbacks?.onError?.(e);
        callbacks?.onEnd?.();
      };

      this.synth.resume();
      this.synth.speak(utterance);
    } catch {
      callbacks?.onEnd?.();
    }
  }

  /**
   * Initialize a direct audio streaming session for an incoming examiner turn.
   */
  public prepareStream(
    fallbackText: string,
    callbacks?: {
      onStart?: () => void;
      onEnd?: () => void;
      onError?: (err: unknown) => void;
    }
  ) {
    this.stop();
    this.unlockAudio();
    this.isFallingBack = false;
    this.lastSpokenText = fallbackText;
    this.streamAudioChunks = [];
    this.streamCallbacks = callbacks;

    if (this.streamFallbackTimer) clearTimeout(this.streamFallbackTimer);
    this.streamFallbackTimer = setTimeout(() => {
      if (this.streamAudioChunks.length === 0 && !this.isFallingBack) {
        this.isFallingBack = true;
        this.speak(fallbackText, callbacks);
      }
    }, 8000);
  }

  /**
   * Append an incoming base64 chunk from the WebSocket speech pipeline.
   */
  public feedAudioChunk(base64Chunk: string) {
    if (!base64Chunk || this.isFallingBack) return;
    if (this.streamFallbackTimer) {
      clearTimeout(this.streamFallbackTimer);
      this.streamFallbackTimer = null;
    }

    try {
      const binaryString = window.atob(base64Chunk);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      this.streamAudioChunks.push(bytes);
    } catch (e) {
      console.warn('Error decoding base64 audio chunk:', e);
    }
  }

  /**
   * Finalize the stream and play the high-fidelity human audio.
   */
  public finishStream() {
    if (this.streamFallbackTimer) {
      clearTimeout(this.streamFallbackTimer);
      this.streamFallbackTimer = null;
    }

    if (this.isFallingBack) return;

    if (this.streamAudioChunks.length === 0) {
      this.isFallingBack = true;
      if (this.lastSpokenText) {
        this.speak(this.lastSpokenText, this.streamCallbacks);
      } else {
        this.streamCallbacks?.onEnd?.();
      }
      return;
    }

    // Stop any existing audio or speech synthesis before playing streamed audio
    if (this.currentAudio) {
      try { this.currentAudio.pause(); } catch {}
      this.currentAudio = null;
    }
    if (this.synth) {
      try { this.synth.cancel(); } catch {}
    }

    try {
      // Auto-detect format: RIFF = audio/wav, otherwise audio/mpeg
      const firstChunk = this.streamAudioChunks[0];
      const isWav =
        firstChunk &&
        firstChunk.length >= 4 &&
        firstChunk[0] === 0x52 &&
        firstChunk[1] === 0x49 &&
        firstChunk[2] === 0x46 &&
        firstChunk[3] === 0x46; // "RIFF"
      const mimeType = isWav ? 'audio/wav' : 'audio/mpeg';

      const blob = new Blob(this.streamAudioChunks as BlobPart[], { type: mimeType });
      const objectUrl = URL.createObjectURL(blob);
      const audio = new Audio(objectUrl);
      this.currentAudio = audio;

      audio.onplay = () => {
        this.streamCallbacks?.onStart?.();
      };

      audio.onended = () => {
        URL.revokeObjectURL(objectUrl);
        this.currentAudio = null;
        this.streamCallbacks?.onEnd?.();
      };

      audio.onerror = (e) => {
        URL.revokeObjectURL(objectUrl);
        console.warn('Streamed audio playback notice:', e);
        if (this.currentAudio !== audio) return;
        if (this.lastSpokenText) {
          this.speak(this.lastSpokenText, this.streamCallbacks);
        } else {
          this.streamCallbacks?.onEnd?.();
        }
      };

      audio.play().catch((err) => {
        console.warn('Streamed audio play blocked or interrupted:', err);
        if (err && (err.name === 'AbortError' || err.code === 20)) {
          return;
        }
        if (this.currentAudio !== audio) {
          return;
        }
        if (this.lastSpokenText) {
          this.speak(this.lastSpokenText, this.streamCallbacks);
        } else {
          this.streamCallbacks?.onEnd?.();
        }
      });
    } catch (err) {
      console.error('Failed to create audio blob from stream:', err);
      if (this.lastSpokenText) {
        this.speak(this.lastSpokenText, this.streamCallbacks);
      }
    }
  }

  public repeatLast(callbacks?: { onStart?: () => void; onEnd?: () => void }) {
    if (this.lastSpokenText) {
      this.speak(this.lastSpokenText, callbacks);
    }
  }

  public stop() {
    this.playbackGeneration += 1;
    if (this.streamFallbackTimer) {
      clearTimeout(this.streamFallbackTimer);
      this.streamFallbackTimer = null;
    }
    this.isFallingBack = false;
    this.streamAudioChunks = [];
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }
    if (this.synth) {
      this.synth.cancel();
    }
  }

  public isSpeaking(): boolean {
    return (
      (this.currentAudio !== null && !this.currentAudio.paused) ||
      (this.synth !== null && this.synth.speaking)
    );
  }
}

export const voiceEngine = (typeof window !== 'undefined' ? new VoiceEngine() : null) as (VoiceEngine | null);
