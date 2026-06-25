'use client';

// Lens-as-Station keep-alive host.
//
// The persistent half of the "persistent redirect": instead of unmounting a
// lens overlay when you walk away (which would reload the lens and lose your
// in-progress work), the host KEEPS each opened station's iframe mounted and
// just toggles visibility. Walk away → the active station hides but its iframe
// (and all its state) stays alive; walk back → it reappears instantly. An LRU
// cap bounds how many lens iframes are kept warm at once.
//
// Reuses the (tested) LensStationOverlay verbatim — this component only owns the
// cache + visibility. `display:none` preserves an iframe's contentWindow, so the
// lens state genuinely survives (unlike unmounting or changing src).

import { useEffect, useRef, useState } from 'react';
import { LensStationOverlay } from './LensStationOverlay';
import { resolveStationLens } from '@/lib/station-lens-registry';
import type { BuildingDetail } from './StationInteractionRouter';

const MAX_KEPT = 4; // LRU cap on warm lens iframes

interface Opened { stationId: string; building: BuildingDetail; worldId: string; }

interface HostProps {
  active: { building: BuildingDetail; worldId: string } | null;
  onClose: () => void;
}

export function LensStationHost({ active, onClose }: HostProps) {
  const [opened, setOpened] = useState<Opened[]>([]);

  const station = active ? resolveStationLens(active.building.building_type) : null;
  const activeId = station ? active!.building.id : null;

  // Latest building/world for the active station, read inside the effect so the
  // effect only needs to depend on the station id (no exhaustive-deps churn).
  const latest = useRef<{ building?: BuildingDetail; worldId?: string }>({});
  latest.current = { building: active?.building, worldId: active?.worldId };

  useEffect(() => {
    if (!activeId) return;
    const { building, worldId } = latest.current;
    if (!building || !worldId) return;
    setOpened((prev) => {
      const without = prev.filter((o) => o.stationId !== activeId);
      // Re-add at the end (most-recently-used), evict the oldest past the cap.
      return [...without, { stationId: activeId, building, worldId }].slice(-MAX_KEPT);
    });
  }, [activeId]);

  if (opened.length === 0) return null;

  return (
    <>
      {opened.map((o) => {
        const visible = o.stationId === activeId;
        return (
          <div
            key={o.stationId}
            aria-hidden={!visible}
            data-station-kept={o.stationId}
            style={visible ? undefined : { display: 'none' }}
          >
            <LensStationOverlay building={o.building} worldId={o.worldId} onClose={onClose} />
          </div>
        );
      })}
    </>
  );
}

export default LensStationHost;
