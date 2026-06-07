'use client';

// components/conkay/ConKayWorkStatus.tsx
//
// ConKay's "you can see it working" surface — the JARVIS work-animation language,
// grounded in the modern agent-UI step pattern: a counter-rotating arc-reactor
// core + a live status line (shimmering while busy) + a vertical step spine where
// each phase appears → runs → resolves (✓). Driven by ConKay's phase; honors
// prefers-reduced-motion via the global CSS guard.

import { Check, X } from 'lucide-react';
import type { ConKayState } from './conkay-persona';

export type WorkStepState = 'pending' | 'active' | 'done' | 'error';
export interface WorkStep { id: string; label: string; state: WorkStepState }

// The arc-reactor: nested counter-rotating rings + a breathing core. The whole
// thing brightens with ConKay's energy (idle → acting).
function ArcReactor({ phase }: { phase: ConKayState }) {
  const energy = phase === 'processing' || phase === 'acting' ? 'opacity-100'
    : phase === 'presenting' ? 'opacity-90'
      : phase === 'listening' ? 'opacity-80' : 'opacity-50';
  return (
    <div className={`relative h-9 w-9 shrink-0 ${energy}`} aria-hidden>
      <div className="absolute inset-0 rounded-full border border-cyan-400/40 ck-ring"
        style={{ borderTopColor: 'transparent', borderRightColor: 'transparent' }} />
      <div className="absolute inset-[5px] rounded-full border border-fuchsia-400/40 ck-ring-rev"
        style={{ borderBottomColor: 'transparent', borderLeftColor: 'transparent' }} />
      <div className="absolute inset-[12px] rounded-full bg-cyan-300/80 ck-core shadow-[0_0_10px_2px_rgba(34,211,238,0.7)]" />
    </div>
  );
}

function StepDot({ state }: { state: WorkStepState }) {
  if (state === 'done') return <span className="grid h-4 w-4 place-items-center rounded-full bg-emerald-400/20 text-emerald-300"><Check className="h-3 w-3" /></span>;
  if (state === 'error') return <span className="grid h-4 w-4 place-items-center rounded-full bg-rose-400/20 text-rose-300"><X className="h-3 w-3" /></span>;
  if (state === 'active') return <span className="block h-4 w-4 rounded-full border border-cyan-400/40 border-t-cyan-300 ck-ring" />;
  return <span className="block h-4 w-4 rounded-full border border-cyan-400/15" />;
}

export function ConKayWorkStatus({ phase, status, steps, active }: {
  phase: ConKayState;
  status: string;
  steps: WorkStep[];
  active: boolean;
}) {
  if (!active && steps.length === 0) return null;
  return (
    <div className="ck-reveal mx-auto my-2 max-w-2xl rounded-2xl border border-cyan-400/20 bg-black/40 px-4 py-3 backdrop-blur">
      <div className="flex items-center gap-3">
        <ArcReactor phase={phase} />
        <span className={active ? 'ck-shimmer text-sm font-medium' : 'text-sm text-cyan-200/70'}>
          {status || (active ? 'Working…' : 'Done')}
        </span>
      </div>
      {steps.length > 0 && (
        <ol className="mt-3 space-y-1.5 border-l border-cyan-400/10 pl-3">
          {steps.map((s) => (
            <li key={s.id} className="ck-step flex items-center gap-2.5 text-[12px]">
              <StepDot state={s.state} />
              <span className={
                s.state === 'done' ? 'text-cyan-100/60'
                  : s.state === 'active' ? 'text-cyan-100'
                    : s.state === 'error' ? 'text-rose-200'
                      : 'text-cyan-100/35'}>
                {s.label}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default ConKayWorkStatus;
