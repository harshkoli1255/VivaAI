import { InteractiveVoice } from '@/components/canvas/InteractiveVoice';
import Link from 'next/link';
import { ArrowRight, AudioLines, BookOpen, Check, Clock3, FileText, GraduationCap, ShieldCheck } from 'lucide-react';

export function Welcome({ faculty = false }: { faculty?: boolean }) {
  return <div className="mx-auto max-w-7xl px-5 py-12 sm:px-8 sm:py-16">
    <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-20">
      <div className="max-w-xl">
        <div className="eyebrow mb-7"><GraduationCap aria-hidden="true" className="h-4 w-4" />The art of thinking aloud</div>
        <h1 className="whitespace-pre-line text-[clamp(2.6rem,4.5vw,4rem)] leading-[1.06] tracking-[-.055em]">{faculty ? `Less admin.
More understanding.` : `Your knowledge.
Your own words.`}</h1>
        <p className="mt-6 max-w-md text-base leading-relaxed text-[var(--text-secondary)] sm:text-lg">{faculty ? 'Create a technical viva, let the conversation unfold, and review every mark with the evidence beside it.' : 'A focused, 15-minute conversation with an AI examiner. Explain what you know, one question at a time.'}</p>
        <div className="mt-9 flex flex-wrap items-center gap-4"><Link href={faculty ? '/dashboard' : '/login'} className="btn-primary px-6">{faculty ? 'Open dashboard' : 'Get started'}<ArrowRight className="h-4 w-4" /></Link><span className="flex items-center gap-2 text-sm text-[var(--text-muted)]"><Clock3 className="h-4 w-4" />15 minutes. One clear result.</span></div>
      </div>
      <div className="voice-showcase p-6 sm:p-8">
        <div className="relative z-10 flex items-center justify-between"><span className="flex items-center gap-2 text-sm font-medium text-blue-100"><span className="h-1.5 w-1.5 rounded-full bg-[#b9e9d8]" />The conversation is the assessment</span><AudioLines className="h-4 w-4 text-blue-200" /></div>
        <InteractiveVoice />
        <div className="showcase-note"><p className="text-sm font-medium text-white">{faculty ? 'The full picture, behind every mark.' : 'A little space to think out loud.'}</p><p className="mt-2 text-sm leading-relaxed text-blue-200">{faculty ? 'Replay the conversation, follow the evidence, and make the final call.' : 'Questions that follow your thinking. Feedback that helps you move forward.'}</p></div>
        <div className="relative z-10 mt-5 flex items-center justify-between border-t border-white/10 pt-4 text-[11px] text-blue-200"><span className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />15-minute viva</span><span className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" />Recorded for review</span></div>
      </div>
    </div>
    <div className="mt-14 border-t border-[var(--border-default)] pt-8 sm:mt-20"><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><p className="eyebrow">{faculty ? 'From setup to final say' : 'A clear path through your viva'}</p><p className="text-xs text-[var(--text-muted)]">Three steps. One thoughtful assessment.</p></div><div className="grid gap-4 sm:grid-cols-3">
      {(faculty ? [
        { icon: BookOpen, title: 'Set up your viva', text: 'Choose topics, difficulty, and an approved question bank.', color: 'bg-[#e7edff] text-[#3558e8]' },
        { icon: FileText, title: 'Review the evidence', text: 'Audio, transcripts, and rubric scores in one place.', color: 'bg-[#e2f4ec] text-[#147257]' },
        { icon: Check, title: 'You have the final say', text: 'Adjust a mark with a reason and a clear audit trail.', color: 'bg-[#fff0e3] text-[#a95b25]' },
      ] : [
        { icon: BookOpen, title: 'Get ready', text: 'Choose your viva, check your audio, and read the rules.', color: 'bg-[#e7edff] text-[#3558e8]' },
        { icon: AudioLines, title: 'Have a conversation', text: 'Explain your thinking. The examiner adapts as you go.', color: 'bg-[#e2f4ec] text-[#147257]' },
        { icon: FileText, title: 'Learn from your feedback', text: 'View your marks and feedback after your viva.', color: 'bg-[#fff0e3] text-[#a95b25]' },
      ]).map(({ icon: Icon, title, text, color }, index) => <div key={title} className="journey-card"><div className="mb-6 flex items-center justify-between"><div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${color}`}><Icon aria-hidden="true" className="h-5 w-5" /></div><span className="journey-index">0{index + 1}</span></div><h2 className="text-base font-semibold">{title}</h2><p className="mt-2 max-w-xs text-sm leading-relaxed text-[var(--text-secondary)]">{text}</p></div>)}
    </div></div>
  </div>;
}
