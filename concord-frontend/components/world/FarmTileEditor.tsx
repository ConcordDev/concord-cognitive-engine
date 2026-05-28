'use client';
// Phase DA2 stub → DB5 fills in. Farm tile editor.
import { StationOverlayShell } from './_StationOverlayShell';
import type { OverlayProps } from './StationInteractionRouter';

export function FarmTileEditor({ building, worldId, onClose }: OverlayProps) {
  return (
    <StationOverlayShell
      title={building.name || 'Farm plot'}
      subtitle={`farm_plot · ${worldId}`}
      onClose={onClose}
      accent="emerald"
      size="lg"
    >
      <p className="py-6 text-center text-zinc-500">Tile editor — DB5 fills in grid + plant/water/harvest.</p>
    </StationOverlayShell>
  );
}
