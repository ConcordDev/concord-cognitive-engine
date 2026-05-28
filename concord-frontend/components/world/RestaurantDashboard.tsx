'use client';
// Phase DA2 stub → DB6 fills in. Restaurant order dashboard.
import { StationOverlayShell } from './_StationOverlayShell';
import type { OverlayProps } from './StationInteractionRouter';

export function RestaurantDashboard({ building, worldId, onClose }: OverlayProps) {
  return (
    <StationOverlayShell
      title={building.name || 'Restaurant'}
      subtitle={`restaurant · ${worldId}`}
      onClose={onClose}
      accent="amber"
      size="lg"
    >
      <p className="py-6 text-center text-zinc-500">Order queue — DB6 fills in pending orders + serve/expire countdowns.</p>
    </StationOverlayShell>
  );
}
