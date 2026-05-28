'use client';
// Phase DA2 stub → DB15 fills in. Theme park attraction owner panel.
import { StationOverlayShell } from './_StationOverlayShell';
import type { OverlayProps } from './StationInteractionRouter';

export function ThemeParkAttractionPanel({ building, worldId, onClose }: OverlayProps) {
  return (
    <StationOverlayShell
      title={building.name || 'Attraction booth'}
      subtitle={`attraction_booth · ${worldId}`}
      onClose={onClose}
      accent="amber"
      size="lg"
    >
      <p className="py-6 text-center text-zinc-500">Visitor count, revenue, appeal, ticket adjust — DB15 fills in.</p>
    </StationOverlayShell>
  );
}
