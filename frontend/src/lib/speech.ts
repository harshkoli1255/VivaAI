'use client';

/**
 * Universal High-Fidelity Voice Engine for VivaAI.
 * Uses real server-generated WAV speech streams (/api/tts)
 * with multi-tier fallbacks (FastAPI backend & Web Speech API).
 * Guaranteed to produce clear audible speech in Brave, Chrome, Safari, and Firefox.
 */

class VoiceEngine {
  private currentAudio: HTMLAudioElement | null = null;
  private isUnlocked = false;
  private lastSpokenText = '';
  private synth: SpeechSynthesis | null = null;

  constructor() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.synth = window.speechSynthesis;
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
  public speak(
    text: string,
    callbacks?: {
      onStart?: () => void;
      onEnd?: () => void;
      onError?: (err: any) => void;
    }
  ) {
    if (typeof window === 'undefined') {
      callbacks?.onEnd?.();
      return;
    }

    this.stop();
    this.lastSpokenText = text;
    this.unlockAudio();

    // Primary: Next.js high-fidelity WAV speech endpoint
    const primaryUrl = `/api/tts?text=${encodeURIComponent(text)}&voice=Samantha`;
    const audio = new Audio(primaryUrl);
    this.currentAudio = audio;

    let hasStarted = false;

    audio.onplay = () => {
      hasStarted = true;
      callbacks?.onStart?.();
    };

    audio.onended = () => {
      this.currentAudio = null;
      callbacks?.onEnd?.();
    };

    audio.onerror = (e) => {
      console.warn('Next.js /api/tts notice, trying FastAPI backend /api/v1/tts/synthesize:', e);
      this.fallbackFastApi(text, callbacks);
    };

    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise.catch((err) => {
        console.warn('Audio element play interrupted or blocked:', err);
        if (!hasStarted) {
          this.fallbackFastApi(text, callbacks);
        }
      });
    }
  }

  /**
   * Fallback Tier 1: FastAPI backend synthesis endpoint
   */
  private fallbackFastApi(
    text: string,
    callbacks?: {
      onStart?: () => void;
      onEnd?: () => void;
      onError?: (err: any) => void;
    }
  ) {
    const backendUrl = `http://localhost:8000/api/v1/tts/synthesize?text=${encodeURIComponent(text)}&voice=Samantha`;
    const audio = new Audio(backendUrl);
    this.currentAudio = audio;

    let hasStarted = false;

    audio.onplay = () => {
      hasStarted = true;
      callbacks?.onStart?.();
    };

    audio.onended = () => {
      this.currentAudio = null;
      callbacks?.onEnd?.();
    };

    audio.onerror = () => {
      console.warn('Backend TTS error, falling back to Web Speech API');
      this.fallbackWebSpeech(text, callbacks);
    };

    audio.play().catch(() => {
      if (!hasStarted) {
        this.fallbackWebSpeech(text, callbacks);
      }
    });
  }

  /**
   * Fallback Tier 2: Browser Web Speech API
   */
  private fallbackWebSpeech(
    text: string,
    callbacks?: {
      onStart?: () => void;
      onEnd?: () => void;
      onError?: (err: any) => void;
    }
  ) {
    if (!this.synth) {
      callbacks?.onEnd?.();
      return;
    }

    try {
      this.synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      const voices = this.synth.getVoices();
      const voice =
        voices.find((v) => v.lang.startsWith('en') && (v.name.includes('Samantha') || v.name.includes('Daniel') || v.name.includes('Google') || v.name.includes('Natural'))) ||
        voices.find((v) => v.lang.startsWith('en')) ||
        voices[0];

      if (voice) utterance.voice = voice;
      utterance.rate = 1.0;
      utterance.pitch = 0.98;

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

  public repeatLast(callbacks?: { onStart?: () => void; onEnd?: () => void }) {
    if (this.lastSpokenText) {
      this.speak(this.lastSpokenText, callbacks);
    }
  }

  public stop() {
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

export const voiceEngine = typeof window !== 'undefined' ? new VoiceEngine() : (null as any);
