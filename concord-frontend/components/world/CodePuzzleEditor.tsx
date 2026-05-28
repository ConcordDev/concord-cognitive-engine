'use client';
// Phase DA2 stub → DB11 fills in. Programming puzzle drag-and-drop VM editor.
import { StationOverlayShell } from './_StationOverlayShell';
import type { OverlayProps } from './StationInteractionRouter';

export function CodePuzzleEditor({ building, worldId, onClose }: OverlayProps) {
  return (
    <StationOverlayShell
      title={building.name || 'Code workstation'}
      subtitle={`programming_console · ${worldId}`}
      onClose={onClose}
      accent="cyan"
      size="full"
    >
      <p className="py-6 text-center text-zinc-500">MOV/ADD/JMP/JEZ/OUT drag-and-drop editor — DB11 fills in.</p>
    </StationOverlayShell>
  );
}
