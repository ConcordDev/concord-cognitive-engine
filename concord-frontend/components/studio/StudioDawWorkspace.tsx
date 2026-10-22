'use client';

/**
 * Studio lens entry. The editor lives in components/studio/daw/* (split
 * per pane; the audio clock never re-renders React). Loaded client-only:
 * it owns an AudioContext and the microphone.
 */

import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import LensAgentFab from '@/components/lens/LensAgentFab';

const StudioApp = dynamic(() => import('./daw/StudioApp').then((m) => m.StudioApp), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-[#0c0c11] text-zinc-500">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  ),
});

export function StudioDawWorkspace() {
  return (
    <div className="relative h-full min-h-[560px] w-full overflow-hidden bg-[#0c0c11]" data-lens="studio">
      <StudioApp />
      <LensAgentFab
        lensId="studio"
        lensPrompt="You're inside Concord Studio, a music production DAW: recording, MIDI instruments, drums, mixing and mastering. Only help with music: songwriting, arrangement, sound design, mixing and mastering."
      />
    </div>
  );
}

export default StudioDawWorkspace;
