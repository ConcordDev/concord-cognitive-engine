'use client';

/**
 * Studio lens entry. The editor lives in components/studio/daw/* (split
 * per pane; the audio clock never re-renders React). Loaded client-only:
 * it owns an AudioContext and the microphone.
 */

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import LensAgentFab from '@/components/lens/LensAgentFab';
import { cn } from '@/lib/utils';

const StudioApp = dynamic(() => import('./daw/StudioApp').then((m) => m.StudioApp), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-[#0c0c11] text-zinc-500">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  ),
});

// The parity workbench is the second Studio surface: ~57 macros whose panels were mounted nowhere
// since the DAW rebuild (see StudioParityWorkbench). Loaded on first open only.
const StudioParityWorkbench = dynamic(() => import('./StudioParityWorkbench').then((m) => m.StudioParityWorkbench), {
  ssr: false,
  loading: () => (
    <div className="flex h-40 items-center justify-center text-zinc-500">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  ),
});

type Surface = 'daw' | 'workbench';

export function StudioDawWorkspace() {
  const [surface, setSurface] = useState<Surface>('daw');
  // Once opened the workbench stays mounted (hidden when away) so its pickers and panels keep their state.
  const [workbenchOpened, setWorkbenchOpened] = useState(false);
  const pick = (s: Surface) => { setSurface(s); if (s === 'workbench') setWorkbenchOpened(true); };
  const tab = (id: Surface, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={surface === id}
      data-testid={`studio-surface-${id}`}
      onClick={() => pick(id)}
      className={cn(
        'rounded-full px-3 py-1 text-xs transition-colors',
        surface === id ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
      )}
    >
      {label}
    </button>
  );
  return (
    <div className="relative flex h-full min-h-[560px] w-full flex-col overflow-hidden bg-[#0c0c11]" data-lens="studio">
      <div role="tablist" aria-label="Studio surfaces" data-testid="studio-surface-switch" className="flex shrink-0 items-center gap-1 border-b border-white/5 px-3 py-1.5">
        {tab('daw', 'DAW')}
        {tab('workbench', 'Parity workbench')}
      </div>
      <div className={cn('min-h-0 flex-1', surface !== 'daw' && 'hidden')} data-testid="studio-surface-daw-panel">
        <StudioApp />
      </div>
      {workbenchOpened && (
        <div className={cn('min-h-0 flex-1 overflow-y-auto', surface !== 'workbench' && 'hidden')} role="tabpanel" data-testid="studio-surface-workbench-panel">
          <StudioParityWorkbench />
        </div>
      )}
      <LensAgentFab
        lensId="studio"
        lensPrompt="You're inside Concord Studio, a music production DAW: recording, MIDI instruments, drums, mixing and mastering. Only help with music: songwriting, arrangement, sound design, mixing and mastering."
      />
    </div>
  );
}

export default StudioDawWorkspace;
