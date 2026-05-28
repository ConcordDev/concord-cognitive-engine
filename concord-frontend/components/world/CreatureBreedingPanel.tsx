'use client';
// Phase DA2 stub → DC6 fills in. Creature crossbreeding pair-picker.
import { StationOverlayShell } from './_StationOverlayShell';
import type { OverlayProps } from './StationInteractionRouter';

export function CreatureBreedingPanel({ building, worldId, onClose }: OverlayProps) {
  return (
    <StationOverlayShell
      title={building.name || 'Creature pen'}
      subtitle={`creature_pen · ${worldId}`}
      onClose={onClose}
      accent="violet"
      size="lg"
    >
      <p className="py-6 text-center text-zinc-500">Pair two creatures — compatibility check + hybrid generation — DC6 fills in.</p>
    </StationOverlayShell>
  );
}
