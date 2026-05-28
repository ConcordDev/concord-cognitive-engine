'use client';
// Phase DA2 stub → DC5 fills in. Mahjong table.
import { StationOverlayShell } from './_StationOverlayShell';
import type { OverlayProps } from './StationInteractionRouter';

export function MahjongTable({ building, worldId, onClose }: OverlayProps) {
  return (
    <StationOverlayShell
      title={building.name || 'Mahjong table'}
      subtitle={`mahjong_table · ${worldId}`}
      onClose={onClose}
      accent="emerald"
      size="xl"
    >
      <p className="py-6 text-center text-zinc-500">4-player draw/discard/declare table — DC5 fills in.</p>
    </StationOverlayShell>
  );
}
