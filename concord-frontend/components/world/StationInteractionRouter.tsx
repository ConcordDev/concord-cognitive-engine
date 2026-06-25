'use client';

// Phase DA2 — World station / workbench interaction router.
//
// Listens for concordia:building-interact (dispatched by the world page
// when the raycaster hits a building). Looks up the building's
// building_type and:
//   1. Proximity gates (player must be within ~4m)
//   2. Routes to the matching workbench overlay (lazy-loaded)
//
// This is the canonical mount point for every station/workbench
// gameplay surface — farm, restaurant, trivia, karaoke, mahjong,
// hacking terminal, programming console, factory workbench, theme
// park booth, creature pen, glyph altar, fishing spot.
//
// Building-type → overlay-component-name table is the production
// invariant: a new gameplay station type slots in here, nowhere else.

import { useEffect, useState, useCallback, lazy, Suspense } from 'react';
import { resolveStationLens } from '@/lib/station-lens-registry';

const PROXIMITY_GATE_M = 4;

// Lazy overlays — wrapped in Suspense so initial bundle stays lean.
const FarmTileEditor          = lazy(() => import('./FarmTileEditor').then(m => ({ default: m.FarmTileEditor })));
const RestaurantDashboard     = lazy(() => import('./RestaurantDashboard').then(m => ({ default: m.RestaurantDashboard })));
const TriviaKioskPanel        = lazy(() => import('./TriviaKioskPanel').then(m => ({ default: m.TriviaKioskPanel })));
const KaraokeMicrophone       = lazy(() => import('./KaraokeMicrophone').then(m => ({ default: m.KaraokeMicrophone })));
const MahjongTable            = lazy(() => import('./MahjongTable').then(m => ({ default: m.MahjongTable })));
const HackingTerminal         = lazy(() => import('./HackingTerminal').then(m => ({ default: m.HackingTerminal })));
const CodePuzzleEditor        = lazy(() => import('./CodePuzzleEditor').then(m => ({ default: m.CodePuzzleEditor })));
const FactoryEditor           = lazy(() => import('./FactoryEditor').then(m => ({ default: m.FactoryEditor })));
const ThemeParkAttractionPanel = lazy(() => import('./ThemeParkAttractionPanel').then(m => ({ default: m.ThemeParkAttractionPanel })));
const CreatureBreedingPanel   = lazy(() => import('./CreatureBreedingPanel').then(m => ({ default: m.CreatureBreedingPanel })));
const GlyphSpellComposer      = lazy(() => import('./GlyphSpellComposer').then(m => ({ default: m.GlyphSpellComposer })));
const MysteryBoardLauncher    = lazy(() => import('./MysteryBoardLauncher').then(m => ({ default: m.MysteryBoardLauncher })));
// Lens-as-Station — the keep-alive host mounts any real lens (by building_type →
// lib/station-lens-registry.ts) as a persistent iframe overlay and keeps it warm
// when you walk away. Stays mounted, so it lives outside the active/!active gate.
const LensStationHost         = lazy(() => import('./LensStationHost').then(m => ({ default: m.LensStationHost })));

// Production invariant: this is the canonical building_type → overlay map.
// New gameplay stations slot here, nowhere else.
const ROUTER_TABLE: Record<string, React.LazyExoticComponent<React.ComponentType<OverlayProps>>> = {
  farm_plot:           FarmTileEditor,
  restaurant:          RestaurantDashboard,
  trivia_kiosk:        TriviaKioskPanel,
  karaoke_booth:       KaraokeMicrophone,
  mahjong_table:       MahjongTable,
  hacking_terminal:    HackingTerminal,
  programming_console: CodePuzzleEditor,
  factory_workbench:   FactoryEditor,
  attraction_booth:    ThemeParkAttractionPanel,
  creature_pen:        CreatureBreedingPanel,
  glyph_altar:         GlyphSpellComposer,
  mystery_board:       MysteryBoardLauncher,
};

export const STATION_TYPES = Object.freeze(Object.keys(ROUTER_TABLE));

interface BuildingDetail {
  id: string;
  building_type: string;
  x: number;
  z: number;
  name?: string;
}

interface OverlayProps {
  building: BuildingDetail;
  worldId: string;
  onClose: () => void;
}

interface InteractEvent {
  buildingId: string;
  worldId: string;
  playerX: number;
  playerZ: number;
}

export function StationInteractionRouter() {
  const [active, setActive] = useState<{ building: BuildingDetail; worldId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onInteract = useCallback(async (e: Event) => {
    const detail = (e as CustomEvent<InteractEvent>).detail;
    if (!detail) return;
    try {
      // Fetch the building's full record to read building_type + position.
      const r = await fetch(`/api/worlds/${encodeURIComponent(detail.worldId)}/buildings/${encodeURIComponent(detail.buildingId)}`);
      if (!r.ok) {
        setError('building lookup failed');
        return;
      }
      const j = await r.json();
      const building: BuildingDetail | null = j?.building || null;
      if (!building) return;

      // Proximity gate.
      const dist = Math.hypot((building.x ?? 0) - detail.playerX, (building.z ?? 0) - detail.playerZ);
      if (dist > PROXIMITY_GATE_M) {
        setError(`Too far — get closer (${dist.toFixed(1)}m)`);
        setTimeout(() => setError(null), 2500);
        return;
      }

      // Route to the right overlay: a bespoke gameplay station (ROUTER_TABLE)
      // or, failing that, a lens-station (any real lens mounted as an iframe
      // overlay via the station-lens registry).
      if (!ROUTER_TABLE[building.building_type] && !resolveStationLens(building.building_type)) {
        // Building type has no overlay; do nothing (other handlers may pick it up).
        return;
      }
      setActive({ building, worldId: detail.worldId });
      // Phase E8 — tutorial action for the workbench-interact step.
      window.dispatchEvent(new CustomEvent('concordia:tutorial-action', { detail: { action: 'workbench-interact' } }));
    } catch {
      setError('network error');
      setTimeout(() => setError(null), 2500);
    }
  }, []);

  useEffect(() => {
    window.addEventListener('concordia:building-interact', onInteract);
    return () => window.removeEventListener('concordia:building-interact', onInteract);
  }, [onInteract]);

  // ESC closes the active overlay.
  useEffect(() => {
    if (!active) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setActive(null); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  // Bespoke gameplay overlays (ROUTER_TABLE) unmount on close, as before. Lens
  // stations route through the always-mounted LensStationHost so their iframes
  // stay warm when you walk away — hence the host lives OUTSIDE the !active gate.
  const BespokeOverlay = active ? ROUTER_TABLE[active.building.building_type] : undefined;
  const lensActive = active && resolveStationLens(active.building.building_type) ? active : null;

  return (
    <>
      {error && (
        <div className="pointer-events-none fixed left-1/2 top-20 z-50 -translate-x-1/2 rounded-md border border-rose-500/40 bg-zinc-950/95 px-3 py-1.5 text-xs text-rose-200 shadow-lg backdrop-blur">
          {error}
        </div>
      )}

      {active && BespokeOverlay && (
        <Suspense fallback={
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur">
            <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-300">Loading…</div>
          </div>
        }>
          <BespokeOverlay
            building={active.building}
            worldId={active.worldId}
            onClose={() => setActive(null)}
          />
        </Suspense>
      )}

      <Suspense fallback={null}>
        <LensStationHost active={lensActive} onClose={() => setActive(null)} />
      </Suspense>
    </>
  );
}

export type { OverlayProps, BuildingDetail };
