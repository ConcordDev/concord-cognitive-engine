'use client';

/**
 * ─────────────────────────────────────────────────────────────────────────
 * CONCORD // FISHING HUB — rebuild (Frontend Rebuild Program, per-lens loop)
 * ─────────────────────────────────────────────────────────────────────────
 * CAPABILITY MAP (step 1 of the rebuild loop — `server/domains/fishing.js`,
 * 9 registered macros; cross-checked against `server/routes/fishing.js` +
 * the inline `/api/fishing/*` routes in `server.js`):
 *
 *   fishing.catalog   DESIGNED — full authored pool for a world. Backs the
 *                      "All" species tab + the "Species catalogued" stat.
 *   fishing.species    DESIGNED — biome-scoped pool. Backs the per-waters
 *                      filter chips: `listFishForWorld`'s filter matches
 *                      `f.biome === biome || f.subBiome === biome`, so
 *                      picking "River" is a REAL re-query, not a client
 *                      array filter.
 *   fishing.get        DESIGNED — one fish's full descriptor (description,
 *                      abilities, drop table, cooking buff). Backs the
 *                      species detail modal — a genuine second network call
 *                      per open, not a reuse of the catalog row.
 *   fishing.catches     DESIGNED — the player's real catch log
 *                      (player_inventory WHERE item_type='raw_fish').
 *   fishing.list        GENERIC ALIAS of `catalog` (same data, `items` key)
 *                      — the generic-lens `list` verb the manifest expects.
 *                      Not separately surfaced; surfacing it next to
 *                      `catalog` would just be the same table twice.
 *   fishing.create      ALIAS of `reel` (the generic-lens `create` artifact
 *                      verb — "create a catch by reeling"). Same code path
 *                      as reel; not a separate feature.
 *   fishing.session     UNSURFACED, honestly. Session lifecycle (bite
 *                      timing / tension accuracy) is fully owned end-to-end
 *                      by the shared `FishingMinigameOverlay` — this hub
 *                      page never holds a sessionId of its own, so there is
 *                      no real place to inspect one without duplicating
 *                      that component's state machine. Not faked.
 *   fishing.cast        WORLD-SHARED — the real cast/bite/reel loop (with
 *   fishing.reel        the tension-timing minigame) lives in
 *                      `components/world-lens/FishingMinigameOverlay.tsx`,
 *                      shared verbatim between "F near water" in the 3D
 *                      world and this hub's Cast button. That's the
 *                      correct shape (one real implementation, two entry
 *                      points) — this page does NOT reimplement casting; it
 *                      opens the same overlay. The one thing this rebuild
 *                      changed: the old page pre-cast a throwaway session
 *                      via its own fetch before opening the overlay (which
 *                      then cast AGAIN internally) — two sessions per
 *                      click, one silently discarded. Removed; the overlay
 *                      now owns casting exclusively.
 *
 * World-ownership note: casting from THIS hub always uses position (0,0)
 * and the "water" biome (there's no 3D position to sample outside the
 * world). Casting from inside `/lenses/world` (press F near a water tile)
 * uses the player's real position. The bridge callout below says this
 * honestly instead of pretending the hub has spatial awareness it doesn't.
 *
 * RETIRED: the old page's client-side-only "catalog" fetch via raw
 * `fetch('/api/fishing/catalog')` — species browsing/detail/catches now
 * dispatch through the real `fishing.*` macros via `lensRun`, matching the
 * documented `/api/lens/run` path (REST and macro dispatch are both thin
 * wrappers over the same `server/lib/fishing.js`, so this is a wiring-path
 * change, not a behavior change).
 * ─────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Fish, Sparkles, Compass, ArrowRight } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { FishingMinigameOverlay } from '@/components/world-lens/FishingMinigameOverlay';
import { StatTile, StatTileGrid, DensityToggle } from '@/components/ui';
import { useDensity } from '@/lib/hooks/useDensity';
import { lensRun } from '@/lib/api/client';
import { cn, formatRelativeTime } from '@/lib/utils';
import { ds } from '@/lib/design-system';
import { SpeciesCatalog } from '@/components/fishing/SpeciesCatalog';
import { SpeciesDetailModal } from '@/components/fishing/SpeciesDetailModal';
import { CatchLog } from '@/components/fishing/CatchLog';
import type { CatchRow, FishSpecies } from '@/components/fishing/types';

interface CatalogResult { ok: boolean; fish?: FishSpecies[]; reason?: string }
interface SpeciesResult { ok: boolean; fish?: FishSpecies[]; reason?: string }
interface CatchesResult { ok: boolean; catches?: CatchRow[]; reason?: string }

export default function FishingLensPage() {
  const [worldId, setWorldId] = useState<string>('concordia-hub');

  const [catalog, setCatalog] = useState<FishSpecies[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [activeBiome, setActiveBiome] = useState<string | null>(null);
  const [biomeSpecies, setBiomeSpecies] = useState<FishSpecies[]>([]);
  const [biomeLoading, setBiomeLoading] = useState(false);
  const [biomeError, setBiomeError] = useState<string | null>(null);

  const [catches, setCatches] = useState<CatchRow[]>([]);
  const [catchesLoading, setCatchesLoading] = useState(true);
  const [catchesReason, setCatchesReason] = useState<string | null>(null);

  const [selectedFish, setSelectedFish] = useState<FishSpecies | null>(null);
  const [minigameOpen, setMinigameOpen] = useState(false);
  const [justCaughtId, setJustCaughtId] = useState<string | null>(null);

  const { density } = useDensity();
  const tableDensity = density === 'low' ? 'comfortable' : 'compact';

  const prevTopCatchId = useRef<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const w = typeof window !== 'undefined' ? localStorage.getItem('concordia:activeWorldId') : null;
    if (w) setWorldId(w);
  }, []);

  // Defensive back-compat: something elsewhere in the app (or a future
  // world-lens deep link) may still dispatch this to request the overlay.
  useEffect(() => {
    const onOpen = () => setMinigameOpen(true);
    window.addEventListener('concordia:open-fishing', onOpen);
    return () => window.removeEventListener('concordia:open-fishing', onOpen);
  }, []);

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError(null);
    const res = await lensRun<CatalogResult>('fishing', 'catalog', { worldId });
    if (res.data.ok && res.data.result?.ok) {
      setCatalog(res.data.result.fish || []);
    } else {
      setCatalogError(res.data.result?.reason || res.data.error || 'Catalog unavailable.');
      setCatalog([]);
    }
    setCatalogLoading(false);
  }, [worldId]);

  const loadBiomeSpecies = useCallback(async (biome: string) => {
    setBiomeLoading(true);
    setBiomeError(null);
    const res = await lensRun<SpeciesResult>('fishing', 'species', { worldId, biome });
    if (res.data.ok && res.data.result?.ok) {
      setBiomeSpecies(res.data.result.fish || []);
    } else {
      setBiomeError(res.data.result?.reason || res.data.error || 'Species lookup failed.');
      setBiomeSpecies([]);
    }
    setBiomeLoading(false);
  }, [worldId]);

  const loadCatches = useCallback(async () => {
    setCatchesLoading(true);
    const res = await lensRun<CatchesResult>('fishing', 'catches', { limit: 100 });
    if (res.data.ok && res.data.result?.ok) {
      const rows = res.data.result.catches || [];
      setCatches(rows);
      setCatchesReason(null);
      return rows;
    }
    setCatchesReason(res.data.result?.reason || res.data.error || 'unavailable');
    setCatches([]);
    return [];
  }, []);

  useEffect(() => {
    setActiveBiome(null);
    loadCatalog();
    loadCatches().finally(() => setCatchesLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldId]);

  useEffect(() => {
    if (activeBiome) loadBiomeSpecies(activeBiome);
  }, [activeBiome, loadBiomeSpecies]);

  // Track the top catch id so a genuinely new one (post-reel refresh) can
  // get a brief, honest highlight — never a timed fake animation, only
  // triggered when the real data actually changed.
  useEffect(() => {
    prevTopCatchId.current = catches[0]?.id ?? null;
  }, [catches]);

  const handleMinigameClose = useCallback(() => {
    setMinigameOpen(false);
    setCatchesLoading(true);
    loadCatches().then((rows) => {
      setCatchesLoading(false);
      const newTop = rows[0]?.id ?? null;
      if (newTop && newTop !== prevTopCatchId.current) {
        setJustCaughtId(newTop);
        if (highlightTimer.current) clearTimeout(highlightTimer.current);
        highlightTimer.current = setTimeout(() => setJustCaughtId(null), 4000);
      }
    });
  }, [loadCatches]);

  useEffect(() => () => { if (highlightTimer.current) clearTimeout(highlightTimer.current); }, []);

  const facets = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of catalog) {
      const key = f.subBiome || f.biome;
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id, count]) => ({ id, label: id, count }));
  }, [catalog]);

  const displayedSpecies = activeBiome ? biomeSpecies : catalog;
  const displayedLoading = activeBiome ? biomeLoading : catalogLoading;
  const displayedError = activeBiome ? biomeError : catalogError;

  // Real derived stat — joins each catch's item_id ("raw_fish:<fishId>")
  // back to the catalog's rarity, never a fabricated count.
  const legendaryCatches = useMemo(() => {
    if (catalog.length === 0) return null;
    const rarityById = new Map(catalog.map((f) => [f.id, f.rarity]));
    return catches.filter((c) => rarityById.get(c.item_id.replace(/^raw_fish:/, '')) === 'legendary').length;
  }, [catches, catalog]);

  const mostRecentCatch = catches[0] ? formatRelativeTime(catches[0].acquired_at * 1000) : 'None yet';

  const handleCast = useCallback(() => {
    // No pre-fetch here — FishingMinigameOverlay owns the real cast → bite →
    // reel flow (fishing.cast / fishing.reel) end to end. Opening it twice
    // used to double-cast a throwaway session; that bug is gone.
    setMinigameOpen(true);
  }, []);

  return (
    <LensShell lensId="fishing">
      <div className={ds.pageContainer}>
        <header className={ds.sectionHeader}>
          <div>
            <h1 className={cn(ds.heading1, 'flex items-center gap-2')}>
              <Fish size={22} className="text-cyan-300" aria-hidden /> Fishing
            </h1>
            <p className={ds.textMuted}>Browse the local catalog, cast a line, review your catch log.</p>
          </div>
          <DensityToggle variant="dropdown" />
        </header>

        {/* Honest world-ownership bridge: the spatial minigame's real home is
            the 3D world; this hub is a companion, not a duplicate. */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-cyan-700/30 bg-cyan-950/20 px-4 py-3">
          <div className="flex items-start gap-2 text-sm text-cyan-100">
            <Compass className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" aria-hidden="true" />
            <p>
              Casting here uses a generic water spot. Inside the 3D world, press{' '}
              <kbd className="rounded border border-cyan-700/50 bg-black/30 px-1 font-mono text-xs">F</kbd>{' '}
              near real water to cast from your actual position and biome.
            </p>
          </div>
          <Link
            href="/lenses/world"
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-cyan-700/50 px-3 py-1.5 text-xs font-medium text-cyan-200 hover:bg-cyan-500/10"
          >
            Open world <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </div>

        <StatTileGrid columns={4}>
          <StatTile label="World" value={worldId} icon={<Compass className="h-4 w-4" aria-hidden="true" />} />
          <StatTile label="Species catalogued" value={catalog.length} icon={<Fish className="h-4 w-4" aria-hidden="true" />} />
          <StatTile label="Catches logged" value={catches.length} />
          <StatTile
            label="Legendary catches"
            value={legendaryCatches ?? '—'}
            caption={mostRecentCatch !== 'None yet' ? `Last: ${mostRecentCatch}` : undefined}
          />
        </StatTileGrid>

        <button
          type="button"
          onClick={handleCast}
          disabled={minigameOpen}
          className={cn(ds.btnPrimary, 'inline-flex w-full items-center justify-center gap-2 sm:w-auto')}
        >
          <Sparkles size={14} aria-hidden /> Cast line
        </button>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <SpeciesCatalog
              species={displayedSpecies}
              loading={displayedLoading}
              error={displayedError}
              onRetry={() => (activeBiome ? loadBiomeSpecies(activeBiome) : loadCatalog())}
              facets={facets}
              activeBiome={activeBiome}
              onSelectBiome={setActiveBiome}
              onSelectFish={setSelectedFish}
              density={tableDensity}
            />
          </div>
          <div>
            <CatchLog
              catches={catches}
              loading={catchesLoading}
              reason={catchesReason}
              onRetry={() => loadCatches()}
              justCaughtId={justCaughtId}
              density={tableDensity}
            />
          </div>
        </div>

        <SpeciesDetailModal
          fishId={selectedFish?.id ?? null}
          fishName={selectedFish?.name ?? null}
          worldId={worldId}
          onClose={() => setSelectedFish(null)}
        />

        {/* Reaction-timed minigame — the real cast/bite/reel loop, shared with
            the in-world "press F near water" entry point. */}
        <FishingMinigameOverlay
          open={minigameOpen}
          worldId={worldId}
          position={{ x: 0, z: 0 }}
          onClose={handleMinigameClose}
        />
      </div>
    </LensShell>
  );
}
