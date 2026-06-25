'use client';

// Lens-as-Station overlay — the "persistent redirect" surface.
//
// When you interact with a building whose `building_type` is a lens station
// (lib/station-lens-registry.ts), the StationInteractionRouter mounts THIS
// component instead of a bespoke overlay. It frames the real, existing lens
// route inside the diegetic StationOverlayShell via an iframe — so every lens
// becomes an in-world place with zero per-lens UI work. The iframe is the
// persistent redirect: it loads `/lenses/<id>` exactly as the lens already
// renders, and carries world + station context so the lens can read where it was
// opened from.

import { StationOverlayShell } from './_StationOverlayShell';
import { resolveStationLens, stationLensSrc } from '@/lib/station-lens-registry';
import type { OverlayProps } from './StationInteractionRouter';

export function LensStationOverlay({ building, worldId, onClose }: OverlayProps) {
  const station = resolveStationLens(building.building_type);
  if (!station) return null;

  const src = stationLensSrc(station.lensId, worldId, building.id);

  return (
    <StationOverlayShell
      title={station.placeLabel}
      subtitle={`${station.verb}${building.name ? ` · ${building.name}` : ''}`}
      accent={station.accent}
      size="full"
      onClose={onClose}
    >
      <iframe
        title={`${station.placeLabel} — ${station.lensId} lens`}
        src={src}
        data-station-lens={station.lensId}
        className="h-[78vh] w-full rounded-lg border border-zinc-800 bg-zinc-950"
        // The lens route is same-origin; it needs full interactivity.
        allow="clipboard-read; clipboard-write; microphone; camera; gamepad; fullscreen"
      />
    </StationOverlayShell>
  );
}

export default LensStationOverlay;
