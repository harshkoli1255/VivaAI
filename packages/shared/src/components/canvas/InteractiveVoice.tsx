'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { AudioLines, Brain, Mic } from 'lucide-react';

const Sphere = dynamic(() => import('./AcousticSphere').then(module => module.AcousticSphere), {
  ssr: false,
  loading: () => <div className="voice-core" aria-label="Loading interactive voice preview">{[14, 24, 42, 60, 36, 50, 26, 14].map((height, index) => <span key={index} style={{ height }} />)}</div>,
});
const modes = [
  { state: 'listening', label: 'Listen', icon: Mic },
  { state: 'thinking', label: 'Think', icon: Brain },
  { state: 'speaking', label: 'Speak', icon: AudioLines },
] as const;

export function InteractiveVoice() {
  const [state, setState] = useState<'listening' | 'thinking' | 'speaking'>('listening');
  return <div className="relative z-10">
    <div className="voice-stage my-2"><Sphere size={260} state={state} audioLevel={0.35} theme="dark" interactive /><div aria-hidden="true" className="voice-bubble voice-bubble-left pointer-events-none">What would you do differently?</div><div aria-hidden="true" className="voice-bubble voice-bubble-right pointer-events-none">Let me explain my thinking…</div></div>
    <div className="mb-5 flex justify-center gap-2" role="group" aria-label="Interactive examiner preview">
      {modes.map(({ state: next, label, icon: Icon }) => <button key={next} type="button" aria-pressed={state === next} onClick={() => setState(next)} className={`inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 text-xs font-medium transition-colors ${state === next ? 'border-blue-200/40 bg-blue-200/20 text-white' : 'border-white/10 bg-white/5 text-blue-200 hover:bg-white/10'}`}><Icon className="h-3.5 w-3.5" />{label}</button>)}
    </div>
    <p className="mb-5 text-center text-[11px] text-blue-200">Interactive preview. Choose a state or move your pointer.</p>
  </div>;
}
