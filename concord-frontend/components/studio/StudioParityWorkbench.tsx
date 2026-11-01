'use client';

/**
 * The Studio lens's second surface: the parity workbench.
 *
 * The rebuilt DAW (daw/StudioApp) calls only the project/library macros; the
 * ~57 parity macros (clips, MIDI, automation, drum/FX racks, MIDI map, scenes,
 * sends, tempo, markers, takes, presets, collab, stems/import-export) and their
 * panels were mounted nowhere (studio-capability-map.md, "Reachability
 * finding"). This mounts them: the project actions (create / track / effect /
 * render / share) and the Session workbench, opened on the Arrangement
 * Sketch (Section Marker + Audio Pin). One PipingProvider wraps both so a
 * project created in the actions shows up in the workbench picker at once.
 */

import { PipingProvider } from '@/components/panel-polish';
import { StudioActionPanel } from '@/components/studio/StudioActionPanel';
import { DawWorkbenchSection } from '@/components/studio/DawWorkbenchSection';

export function StudioParityWorkbench() {
  return (
    <div data-testid="studio-parity-workbench" className="mx-auto max-w-6xl space-y-6 p-4 text-gray-100">
      <PipingProvider>
        <DawWorkbenchSection initialTab="arrangement" />
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-violet-300">Studio session</h2>
          <StudioActionPanel />
        </section>
      </PipingProvider>
    </div>
  );
}

export default StudioParityWorkbench;
