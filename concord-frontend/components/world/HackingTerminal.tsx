'use client';
// Phase DA2 stub → DB10 fills in. Fake-shell hacking terminal.
import { StationOverlayShell } from './_StationOverlayShell';
import type { OverlayProps } from './StationInteractionRouter';

export function HackingTerminal({ building, worldId, onClose }: OverlayProps) {
  return (
    <StationOverlayShell
      title={building.name || 'Hacking terminal'}
      subtitle={`hacking_terminal · ${worldId}`}
      onClose={onClose}
      accent="cyan"
      size="full"
    >
      <p className="py-6 text-center text-zinc-500">ls / cd / cat / connect terminal — DB10 fills in.</p>
    </StationOverlayShell>
  );
}
