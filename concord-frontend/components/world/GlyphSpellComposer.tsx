'use client';
// Phase DA2 stub → DC10 fills in. Glyph spell drag-compose workbench.
import { StationOverlayShell } from './_StationOverlayShell';
import type { OverlayProps } from './StationInteractionRouter';

export function GlyphSpellComposer({ building, worldId, onClose }: OverlayProps) {
  return (
    <StationOverlayShell
      title={building.name || 'Glyph altar'}
      subtitle={`glyph_altar · ${worldId}`}
      onClose={onClose}
      accent="violet"
      size="lg"
    >
      <p className="py-6 text-center text-zinc-500">Drag-compose spell chain — composeSpell preview + mint — DC10 fills in.</p>
    </StationOverlayShell>
  );
}
