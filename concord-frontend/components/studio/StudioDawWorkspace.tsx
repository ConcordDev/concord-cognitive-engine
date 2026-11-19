'use client';

/**
 * Studio lens entry: the Booth. One song, three rooms (Write · Produce · Mix)
 * in components/studio/daw/Editor.tsx, themed by components/studio/booth.
 * Loaded client-only: it owns an AudioContext and the microphone.
 */

import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import LensAgentFab from '@/components/lens/LensAgentFab';
import { boothFontVars } from './booth/boothFonts';
import './booth/booth.css';

const StudioApp = dynamic(() => import('./daw/StudioApp').then((m) => m.StudioApp), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-[var(--bo-muted)]" role="status" aria-label="Opening the booth">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  ),
});

export function StudioDawWorkspace() {
  return (
    <div className={`booth ${boothFontVars} relative flex h-full min-h-[560px] w-full flex-col overflow-hidden`} data-lens="studio">
      <div className="min-h-0 flex-1">
        <StudioApp />
      </div>
      <LensAgentFab
        lensId="studio"
        lensPrompt="You're inside Concord Studio, a recording booth and DAW with three rooms: Write (record, comp, tune vocals, song sections), Produce (instruments, beats, piano roll, devices, groove) and Mix (console, inserts, mastering, controllers, export). Only help with music: songwriting, arrangement, sound design, mixing and mastering."
      />
    </div>
  );
}

export default StudioDawWorkspace;
