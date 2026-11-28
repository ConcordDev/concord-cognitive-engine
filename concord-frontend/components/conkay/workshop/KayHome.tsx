'use client';

/**
 * KayHome — ConKay, conversation first. Kay fills the screen: one plain
 * box, what she does in everyday words, and the conversation. When she
 * builds something you asked for (a part, a 3D model, a design) the
 * Workshop opens beside the conversation; it is always one click away.
 *
 * Starters either go straight to Kay (a complete ask) or drop a sentence
 * start into the box for you to finish (ends with a space).
 */

import Link from 'next/link';
import { Boxes, Brain, Hammer, Search, User } from 'lucide-react';
import { DEMO_SIGNUP_HREF } from '@/lib/conkay/demo-api';
import { VoiceComposer } from '../workspace/VoiceComposer';
import { KayLog } from './KayLog';
import type { WorkshopController } from './useWorkshopController';

interface Starter { label: string; text: string }
const GROUPS: Array<{ title: string; icon: typeof Brain; line: string; starters: Starter[] }> = [
  {
    title: 'Think it through', icon: Brain, line: 'A straight opinion, with the reasons and the next step.',
    starters: [
      { label: 'Get an honest take on an idea', text: 'Give me your honest take on this idea: ' },
      { label: 'Help me decide', text: 'Help me decide between ' },
      { label: 'Explain something simply', text: 'Explain like I’m new to it: ' },
    ],
  },
  {
    title: 'Look it up', icon: Search, line: 'Current facts, prices and news, with links.',
    starters: [
      { label: 'Latest news on…', text: 'What’s the latest news on ' },
      { label: 'Compare options', text: 'Compare the best options for ' },
    ],
  },
  {
    title: 'Make something', icon: Hammer, line: 'Parts it checks with real math, 3D models, pictures, songs.',
    starters: [
      { label: 'Design a shelf bracket', text: 'Design an aluminium shelf bracket that holds 200 N, safety factor 2' },
      { label: 'A 3D model of…', text: 'Make a 3D model of ' },
      { label: 'A lo-fi song', text: 'Make me a lo-fi song' },
    ],
  },
  {
    title: 'Your stuff', icon: User, line: 'Your tasks, schedule, notes and saved work in Concord.',
    starters: [
      { label: 'My week', text: 'What’s on my schedule this week?' },
      { label: 'Remind me to…', text: 'Remind me to ' },
      { label: 'Find my notes on…', text: 'Find my notes about ' },
    ],
  },
];

export function KayHome({ c, onSend, onDraft, draft, onOpenWorkshop }: {
  c: WorkshopController;
  onSend: (text: string) => void;
  onDraft: (text: string) => void;
  draft: { id: number; text: string } | null;
  onOpenWorkshop: () => void;
}) {
  const pick = (s: Starter) => (s.text.endsWith(' ') ? onDraft(s.text) : onSend(s.text));
  const welcome = (
    <div className="mx-auto max-w-2xl px-1 py-4" data-testid="kay-welcome">
      <h1 className="text-[26px] font-semibold leading-tight text-[color:var(--ws-text)]">Hi, I’m Kay.</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-[color:var(--ws-muted)]">
        Tell me what you’re working on. I’ll think it through with you and tell you what I really think, look things up when the facts matter, and build things when you need them.
      </p>
      {c.guest && (
        <p className="mt-3 rounded-lg border border-[color:var(--ws-line)] px-3 py-2 text-[13px] text-[color:var(--ws-muted)]">
          Talking with me needs an account. <Link href={DEMO_SIGNUP_HREF} className="text-[color:var(--ws-arc)] underline underline-offset-2">Sign up free</Link> — or try the Workshop as a guest.
        </p>
      )}
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {GROUPS.map((g) => (
          <section key={g.title} className="rounded-xl border border-[color:var(--ws-line)] bg-white/[0.02] p-3.5" aria-label={g.title}>
            <h2 className="flex items-center gap-2 text-[14px] font-semibold text-[color:var(--ws-text)]"><g.icon className="h-4 w-4 text-[color:var(--ws-arc)]" aria-hidden /> {g.title}</h2>
            <p className="mt-0.5 text-[12.5px] text-[color:var(--ws-muted)]">{g.line}</p>
            <ul className="mt-2.5 flex flex-wrap gap-1.5">
              {g.starters.map((s) => (
                <li key={s.label}>
                  <button type="button" onClick={() => pick(s)} disabled={c.busy}
                    className="rounded-full border border-[color:var(--ws-line-strong)] px-3 py-1 text-[12.5px] text-[color:var(--ws-text)] transition-colors hover:border-[color:var(--ws-arc)] hover:bg-[color:var(--ws-arc-soft)] disabled:opacity-50"
                    data-testid="kay-starter">
                    {s.label}{s.text.endsWith(' ') && !s.label.endsWith('…') ? '…' : ''}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center px-2 pb-2 sm:px-4" data-testid="kay-home">
      <div className="flex w-full max-w-3xl items-center justify-between gap-2 py-2">
        <div className="flex items-center gap-2">
          <span className="ws-glow-text text-[15px] font-semibold tracking-[0.32em] text-[color:var(--ws-arc)]">CONKAY</span>
        </div>
        <button type="button" onClick={onOpenWorkshop}
          className="flex items-center gap-1.5 rounded-full border border-[color:var(--ws-line-strong)] px-3 py-1.5 text-[12.5px] text-[color:var(--ws-text)] transition-colors hover:bg-[color:var(--ws-arc-soft)]"
          data-testid="open-workshop">
          <Boxes className="h-4 w-4" aria-hidden /> Open the Workshop
        </button>
      </div>
      <div className="flex min-h-0 w-full max-w-3xl flex-1 flex-col">
        <KayLog c={c} variant="home" empty={welcome} />
      </div>
      <div className="w-full max-w-3xl pt-2">
        <VoiceComposer variant="workshop" busy={c.busy} onSend={onSend} speakText={c.speak} draft={draft}
          placeholder="Ask Kay anything — an idea to pressure-test, a question, something to make"
          hint="Type, or tap the ring and talk. Enter sends." />
      </div>
    </div>
  );
}

export default KayHome;
