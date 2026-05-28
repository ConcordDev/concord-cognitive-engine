'use client';
// Phase DA2 stub → DC4 fills in. Karaoke microphone capture + resolve.
import { StationOverlayShell } from './_StationOverlayShell';
import type { OverlayProps } from './StationInteractionRouter';

export function KaraokeMicrophone({ building, worldId, onClose }: OverlayProps) {
  return (
    <StationOverlayShell
      title={building.name || 'Karaoke booth'}
      subtitle={`karaoke_booth · ${worldId}`}
      onClose={onClose}
      accent="pink"
      size="md"
    >
      <p className="py-6 text-center text-zinc-500">Mic capture + S/A/B/C/D grade — DC4 fills in.</p>
    </StationOverlayShell>
  );
}
