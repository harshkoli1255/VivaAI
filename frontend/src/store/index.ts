import { create } from 'zustand';

interface User {
  id: string;
  name: string;
  role: 'student' | 'faculty' | 'admin';
  student_id?: string;
  email?: string;
}

interface AuthState {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
  hasHydrated: boolean;
  setAuth: (token: string, user: User) => void;
  logout: () => void;
  setHasHydrated: (val: boolean) => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  token: null, user: null, isAuthenticated: false, hasHydrated: false,
  setAuth: (_token, user) => set({ token: null, user, isAuthenticated: true, hasHydrated: true }),
  logout: () => set({ token: null, user: null, isAuthenticated: false, hasHydrated: true }),
  setHasHydrated: (hasHydrated) => set({ hasHydrated }),
}));

// Interview state (ephemeral — not persisted)
interface InterviewState {
  sessionId: string | null;
  phase: string;
  elapsed: number;
  remaining: number;
  isActive: boolean;
  orbState: 'idle' | 'speaking' | 'listening' | 'thinking' | 'error';
  captions: string;
  liveTranscript: Array<{ speaker: 'ai' | 'student'; text: string; timestamp: number }>;
  setSessionId: (id: string) => void;
  setPhase: (phase: string) => void;
  setElapsed: (secs: number) => void;
  setRemaining: (secs: number) => void;
  setActive: (active: boolean) => void;
  setOrbState: (state: InterviewState['orbState']) => void;
  setCaptions: (text: string) => void;
  addTranscriptLine: (line: { speaker: 'ai' | 'student'; text: string; timestamp: number }) => void;
  reset: () => void;
}

export const useInterviewStore = create<InterviewState>((set) => ({
  sessionId: null,
  phase: 'warm_up',
  elapsed: 0,
  remaining: 900,
  isActive: false,
  orbState: 'idle',
  captions: '',
  liveTranscript: [],

  setSessionId: (id) => set({ sessionId: id }),
  setPhase: (phase) => set({ phase }),
  setElapsed: (elapsed) => set({ elapsed }),
  setRemaining: (remaining) => set({ remaining }),
  setActive: (isActive) => set({ isActive }),
  setOrbState: (orbState) => set({ orbState }),
  setCaptions: (captions) => set({ captions }),
  addTranscriptLine: (line) =>
    set((state) => ({ liveTranscript: [...state.liveTranscript, line] })),
  reset: () => set({
    sessionId: null, phase: 'warm_up', elapsed: 0, remaining: 900,
    isActive: false, orbState: 'idle', captions: '', liveTranscript: [],
  }),
}));
