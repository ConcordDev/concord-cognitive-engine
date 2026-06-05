'use client';

// concord-frontend/components/conkay/ConKayHud.tsx
//
// The floating ConKay status chip — name + live state label + voice control.
// Shared by the 2D fallback surface and the 3D backdrop so there's one HUD.

import { Mic, Volume2, VolumeX, Loader2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ConKayState } from './conkay-persona';
import { CONKAY_NAME } from './conkay-persona';

export const CONKAY_STATE_LABEL: Record<ConKayState, string> = {
  idle: 'Listening for you',
  listening: 'Listening…',
  processing: 'Thinking…',
  presenting: 'Here it is',
  acting: 'Working…',
};
export const CONKAY_STATE_COLOR: Record<ConKayState, string> = {
  idle: '#22d3ee', listening: '#34d399', processing: '#a855f7', presenting: '#00d4ff', acting: '#fbbf24',
};

export function ConKayHud({
  state, muted, onToggleMute, listening, speaking, voiceSupported, className,
}: {
  state: ConKayState;
  muted: boolean;
  onToggleMute: () => void;
  listening: boolean;
  speaking: boolean;
  voiceSupported: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-2 rounded-full border border-cyan-400/25 bg-lattice-void/70 px-3 py-1.5 backdrop-blur-md', className)}>
      <Sparkles className="h-3.5 w-3.5 text-cyan-300" />
      <span className="text-[12px] font-semibold tracking-wide text-cyan-100">{CONKAY_NAME}</span>
      <span className="flex items-center gap-1 text-[11px]" style={{ color: CONKAY_STATE_COLOR[state] }}>
        {state === 'processing' || state === 'acting' ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
        {CONKAY_STATE_LABEL[state]}
      </span>
      {voiceSupported && (
        <button onClick={onToggleMute} title={muted ? 'Unmute voice' : 'Mute voice'}
          className="ml-1 grid h-6 w-6 place-items-center rounded-full hover:bg-white/10">
          {muted ? <VolumeX className="h-3.5 w-3.5 text-zinc-400" />
            : speaking ? <Volume2 className="h-3.5 w-3.5 text-cyan-300" />
            : listening ? <Mic className="h-3.5 w-3.5 text-emerald-300" />
            : <Volume2 className="h-3.5 w-3.5 text-zinc-300" />}
        </button>
      )}
    </div>
  );
}

export default ConKayHud;
