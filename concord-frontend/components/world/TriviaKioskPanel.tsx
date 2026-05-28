'use client';
// Phase DA2 stub → DB7 fills in. Trivia kiosk + answer panel.
import { StationOverlayShell } from './_StationOverlayShell';
import type { OverlayProps } from './StationInteractionRouter';

export function TriviaKioskPanel({ building, worldId, onClose }: OverlayProps) {
  return (
    <StationOverlayShell
      title={building.name || 'Trivia kiosk'}
      subtitle={`trivia_kiosk · ${worldId}`}
      onClose={onClose}
      accent="violet"
      size="md"
    >
      <p className="py-6 text-center text-zinc-500">Question + citation picker — DB7 fills in.</p>
    </StationOverlayShell>
  );
}
