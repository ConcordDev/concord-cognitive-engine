'use client';
// Phase DA2 stub → DB12 fills in. Per-claim factory tile-grid editor.
import { StationOverlayShell } from './_StationOverlayShell';
import type { OverlayProps } from './StationInteractionRouter';

export function FactoryEditor({ building, worldId, onClose }: OverlayProps) {
  return (
    <StationOverlayShell
      title={building.name || 'Factory workbench'}
      subtitle={`factory_workbench · ${worldId}`}
      onClose={onClose}
      accent="slate"
      size="full"
    >
      <p className="py-6 text-center text-zinc-500">Chest / belt / crafter tile grid editor — DB12 fills in.</p>
    </StationOverlayShell>
  );
}
