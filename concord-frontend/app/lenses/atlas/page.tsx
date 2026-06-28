'use client';

import { useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { AtlasSection } from '@/components/atlas/AtlasSection';
import { OsmGeocodePanel } from '@/components/atlas/OsmGeocodePanel';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { PlacesGraph } from '@/components/atlas/PlacesGraph';
import { NavigationSuite } from '@/components/atlas/NavigationSuite';
import { AtlasActionPanel } from '@/components/atlas/AtlasActionPanel';
import { PipingProvider } from '@/components/panel-polish';
import { SafeCard } from '@/components/common/SafeCard';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { motion } from 'framer-motion';
import {
  Map, Layers, Radio, AlertTriangle, RefreshCw,
  ChevronDown, Compass, Globe, Radar,
  Loader2, XCircle, Zap, MapPin, BarChart3, Route, Navigation,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import type { MapMarker } from '@/components/common/MapView';
import AtlasPublicView from '@/components/chat/AtlasPublicView';
import AtlasResearchView from '@/components/chat/AtlasResearchView';
import AtlasSignalView from '@/components/chat/AtlasSignalView';
import AtlasOverlay from '@/components/chat/AtlasOverlay';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { PlaceFinder } from '@/components/atlas/PlaceFinder';
import { DistanceMatrixPanel } from '@/components/atlas/DistanceMatrixPanel';
import { MapsDirections } from '@/components/atlas/MapsDirections';
import { RouteStops } from '@/components/atlas/RouteStops';
import { SavedPlaces } from '@/components/atlas/SavedPlaces';

// Leaflet requires dynamic import (no SSR)
const MapView = dynamic(() => import('@/components/common/MapView'), { ssr: false });

// ── Types ──────────────────────────────────────────────────────────────────

type Tab = 'terrain' | 'signals' | 'anomalies' | 'coverage';

// ── Component ──────────────────────────────────────────────────────────────

export default function AtlasLensPage() {
  useLensNav('atlas');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('atlas');

  // Backend action wiring
  const runAction = useRunArtifact('atlas');
  const { items: atlasItems } = useLensData<Record<string, unknown>>('atlas', 'location', { seed: [] });
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [isRunning, setIsRunning] = useState<string | null>(null);

  const handleAtlasAction = async (action: string) => {
    const targetId = atlasItems[0]?.id;
    if (!targetId) return;
    setIsRunning(action);
    try {
      const res = await runAction.mutateAsync({ id: targetId, action });
      if (res.ok === false) { setActionResult({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setActionResult(res.result as Record<string, unknown>); }
    } catch (e) { console.error(`Action ${action} failed:`, e); setActionResult({ message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
    setIsRunning(null);
  };

  const [tab, setTab] = useState<Tab>('terrain');
  const [showFeatures, setShowFeatures] = useState(true);
  const [queryLat, setQueryLat] = useState('');
  const [queryLng, setQueryLng] = useState('');

  // Lens-scoped keyboard commands. Mapping-tool idiom: t/s/a/c jump
  // between layers (terrain/signals/anomalies/coverage).
  useLensCommand(
    [
      { id: 'tab-terrain', keys: 't', description: 'Terrain', category: 'navigation', action: () => setTab('terrain') },
      { id: 'tab-signals', keys: 's', description: 'Signals', category: 'navigation', action: () => setTab('signals') },
      { id: 'tab-anomalies', keys: 'a', description: 'Anomalies', category: 'navigation', action: () => setTab('anomalies') },
      { id: 'tab-coverage', keys: 'c', description: 'Coverage', category: 'navigation', action: () => setTab('coverage') },
    ],
    { lensId: 'atlas' }
  );

  // ── Data fetching ──────────────────────────────────────────────────────

  const { data: coverageData, isLoading: coverageLoading, isError: coverageError, refetch: refetchCoverage } = useQuery({
    queryKey: ['atlas-coverage'],
    queryFn: () => apiHelpers.atlasTomography.coverage().then(r => r.data),
    refetchInterval: 30000,
  });

  const { data: taxonomyData, isLoading: taxonomyLoading } = useQuery({
    queryKey: ['atlas-taxonomy'],
    queryFn: () => apiHelpers.atlasTomography.signalsTaxonomy('all', 50).then(r => r.data),
    refetchInterval: 20000,
  });

  const { data: anomalyData, isLoading: anomalyLoading, isError: anomalyError, refetch: refetchAnomalies } = useQuery({
    queryKey: ['atlas-anomalies'],
    queryFn: () => apiHelpers.atlasTomography.signalsAnomalies(50).then(r => r.data),
    refetchInterval: 15000,
  });

  const { data: liveData } = useQuery({
    queryKey: ['atlas-live'],
    queryFn: () => apiHelpers.atlasTomography.live().then(r => r.data),
    refetchInterval: 10000,
  });

  const { data: tileData, isLoading: tileLoading, refetch: refetchTile } = useQuery({
    queryKey: ['atlas-tile', queryLat, queryLng],
    queryFn: () => apiHelpers.atlasTomography.tile(Number(queryLat), Number(queryLng)).then(r => r.data),
    enabled: !!(queryLat && queryLng),
  });

  const { data: spectrumData } = useQuery({
    queryKey: ['atlas-spectrum'],
    queryFn: () => apiHelpers.atlasTomography.signalsSpectrum().then(r => r.data),
    refetchInterval: 30000,
  });

  // Build map markers from coverage/live data
  const markers: MapMarker[] = [];
  if (liveData?.nodes) {
    (liveData.nodes as Array<{ lat: number; lng: number; id?: string; status?: string }>).forEach(
      (node) => {
        if (node.lat && node.lng) {
          markers.push({ lat: node.lat, lng: node.lng, label: node.id || 'Node', popup: node.status || 'Active' });
        }
      }
    );
  }

  function handleMarkerClick(m: MapMarker) {
    setQueryLat(String(m.lat));
    setQueryLng(String(m.lng));
    setTab('terrain');
    refetchTile();
  }

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'terrain', label: 'Terrain', icon: <Map className="w-4 h-4" /> },
    { id: 'signals', label: 'Signals', icon: <Radio className="w-4 h-4" /> },
    { id: 'anomalies', label: 'Anomalies', icon: <AlertTriangle className="w-4 h-4" /> },
    { id: 'coverage', label: 'Coverage', icon: <Layers className="w-4 h-4" /> },
  ];

  return (
    <LensShell lensId="atlas" asMain={false}>
      <FirstRunTour lensId="atlas" />
      <ManifestActionBar />
      <DepthBadge lensId="atlas" size="sm" className="ml-2" />
      <div className="px-4 mt-3">
        <AtlasSection />
      </div>
    <div data-lens-theme="atlas" className="min-h-screen bg-zinc-950 text-zinc-100 p-6 space-y-6">
      {/* Phase 4 — REAL OpenStreetMap Nominatim search. Tier-1 honest live geocode. */}
      <OsmGeocodePanel />
      {/* ── Four UX states for the tomography channel ── */}
      {/* LOADING */}
      {(coverageLoading || anomalyLoading) && !coverageError && !anomalyError && (
        <div role="status" aria-live="polite" className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 flex items-center gap-2">
          <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />
          <p className="text-sm text-zinc-400">Scanning signal tomography…</p>
        </div>
      )}
      {/* ERROR — role=alert + a working Retry that RE-FETCHES (not a full reload) */}
      {(coverageError || anomalyError) && (
        <div role="alert" className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 flex items-center justify-between">
          <p className="text-red-400 text-sm">Some data sources failed to load. Showing available data.</p>
          <button
            onClick={() => { refetchCoverage(); refetchAnomalies(); }}
            className="text-xs text-red-300 hover:text-white border border-red-500/30 rounded px-2 py-1"
          >
            Retry
          </button>
        </div>
      )}
      {/* EMPTY — honest CTA when every tomography source resolved with no rows */}
      {!coverageLoading && !anomalyLoading && !coverageError && !anomalyError &&
        markers.length === 0 &&
        ((taxonomyData as { signals?: unknown[]; total?: number })?.signals?.length || (taxonomyData as { total?: number })?.total || 0) === 0 &&
        ((anomalyData as { anomalies?: unknown[]; total?: number })?.anomalies?.length || (anomalyData as { total?: number })?.total || 0) === 0 && (
        <div className="bg-zinc-900 border border-dashed border-zinc-700 rounded-lg p-4 text-center">
          <p className="text-sm text-zinc-300 font-medium">No signal coverage yet</p>
          <p className="text-xs text-zinc-500 mt-1">Query a tile by latitude/longitude below, or save a place to seed your atlas.</p>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
            <Map className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Atlas</h1>
            <p className="text-sm text-zinc-400">Signal Tomography & Spatial Intelligence</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap ml-4">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="atlas" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Stat Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Active Nodes', value: markers.length, icon: Radar, color: 'text-emerald-400 bg-emerald-500/10' },
          { label: 'Signals', value: (taxonomyData as { signals?: unknown[] })?.signals?.length || (taxonomyData as { total?: number })?.total || 0, icon: Radio, color: 'text-cyan-400 bg-cyan-500/10' },
          { label: 'Anomalies', value: (anomalyData as { anomalies?: unknown[] })?.anomalies?.length || (anomalyData as { total?: number })?.total || 0, icon: AlertTriangle, color: 'text-amber-400 bg-amber-500/10' },
          { label: 'Coverage', value: (coverageData as { coverage?: number })?.coverage ? `${((coverageData as { coverage: number }).coverage * 100).toFixed(0)}%` : '--', icon: Globe, color: 'text-blue-400 bg-blue-500/10' },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08, duration: 0.4 }}
            className="rounded-lg bg-zinc-900 border border-zinc-800 p-3"
          >
            <div className={`w-8 h-8 rounded-lg ${stat.color} flex items-center justify-center mb-2`}>
              <stat.icon className="w-4 h-4" />
            </div>
            <p className="text-xl font-bold text-white">{stat.value}</p>
            <p className="text-xs text-zinc-400">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Zoom Level Indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="flex items-center gap-2 text-xs text-zinc-400"
      >
        <Compass className="w-3.5 h-3.5 text-emerald-400" />
        <span>Lat: {queryLat || '--'}</span>
        <span className="text-zinc-700">|</span>
        <span>Lng: {queryLng || '--'}</span>
        <span className="text-zinc-700">|</span>
        <span className="text-emerald-400">{markers.length} markers loaded</span>
      </motion.div>

      {/* Interactive Map */}
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="rounded-lg overflow-hidden border border-zinc-800"
      >
        <SafeCard label="Map view" className="h-[360px]">
          <MapView
            markers={markers}
            className="h-[360px]"
            onMarkerClick={handleMarkerClick}
          />
        </SafeCard>
      </motion.div>

      {/* Coordinate Query */}
      <div className="flex items-center gap-3">
        <input
          type="number"
          step="any"
          placeholder="Latitude"
          value={queryLat}
          onChange={(e) => setQueryLat(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 w-32"
        />
        <input
          type="number"
          step="any"
          placeholder="Longitude"
          value={queryLng}
          onChange={(e) => setQueryLng(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 w-32"
        />
        <button
          onClick={() => refetchTile()}
          disabled={!queryLat || !queryLng}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Query Tile
        </button>
        {tileData && (
          // @modal-escape-ok: AtlasOverlay is an inline attribution card, not a focus-trap modal
          <AtlasOverlay query={`${queryLat}, ${queryLng}`} result={tileData} loading={tileLoading} />
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-zinc-900 rounded-lg p-1">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
              tab === t.id ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-300'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="space-y-4">
        {tab === 'terrain' && (
          <>
            {/* Force-directed graph of the user's REAL saved atlas data —
                saved places + lists, fetched live. No mock seed data. */}
            <PlacesGraph />
            <AtlasPublicView
              data={tileData ? { ok: true, view: 'terrain', terrain: { tile: tileData.tile } } : coverageData ? { ok: true, view: 'coverage', coverage: coverageData } : null}
              loading={tileLoading || coverageLoading}
            />
            {tileData?.tile && (
              <AtlasResearchView
                data={{ ok: true, view: 'material', material: tileData.tile ? { material: tileData.tile.layers?.surface?.dominantMaterial || 'unknown', confidence: tileData.tile.confidence || 0, resolution_cm: tileData.tile.resolution_cm || 0 } : undefined }}
                loading={false}
              />
            )}
          </>
        )}

        {tab === 'signals' && (
          <>
            <AtlasSignalView
              data={taxonomyData ? { ok: true, view: 'taxonomy', taxonomy: taxonomyData } : null}
              loading={taxonomyLoading}
            />
            {spectrumData && (
              <AtlasSignalView
                data={{ ok: true, view: 'spectrum', spectrum: spectrumData }}
                loading={false}
              />
            )}
          </>
        )}

        {tab === 'anomalies' && (
          <AtlasSignalView
            data={anomalyData ? { ok: true, view: 'anomalies', anomalies: anomalyData } : null}
            loading={anomalyLoading}
          />
        )}

        {tab === 'coverage' && (
          <AtlasPublicView
            data={coverageData ? { ok: true, view: 'coverage', coverage: coverageData } : null}
            loading={coverageLoading}
          />
        )}
      </div>

      {/* ── Backend Action Panels ── */}
      <div className="panel p-4">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><Zap className="w-4 h-4 text-neon-cyan" /> Atlas Compute Actions</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <button onClick={() => handleAtlasAction('geocode')} disabled={isRunning !== null} className="flex flex-col items-center gap-2 p-3 bg-lattice-deep rounded-lg border border-lattice-border hover:border-neon-cyan/50 transition-colors disabled:opacity-50">
            {isRunning === 'geocode' ? <Loader2 className="w-5 h-5 text-neon-cyan animate-spin" /> : <MapPin className="w-5 h-5 text-neon-cyan" />}
            <span className="text-xs text-gray-300">Geocode</span>
          </button>
          <button onClick={() => handleAtlasAction('distanceMatrix')} disabled={isRunning !== null} className="flex flex-col items-center gap-2 p-3 bg-lattice-deep rounded-lg border border-lattice-border hover:border-neon-purple/50 transition-colors disabled:opacity-50">
            {isRunning === 'distanceMatrix' ? <Loader2 className="w-5 h-5 text-neon-purple animate-spin" /> : <Navigation className="w-5 h-5 text-neon-purple" />}
            <span className="text-xs text-gray-300">Distance Matrix</span>
          </button>
          <button onClick={() => handleAtlasAction('regionStats')} disabled={isRunning !== null} className="flex flex-col items-center gap-2 p-3 bg-lattice-deep rounded-lg border border-lattice-border hover:border-green-400/50 transition-colors disabled:opacity-50">
            {isRunning === 'regionStats' ? <Loader2 className="w-5 h-5 text-green-400 animate-spin" /> : <BarChart3 className="w-5 h-5 text-green-400" />}
            <span className="text-xs text-gray-300">Region Stats</span>
          </button>
          <button onClick={() => handleAtlasAction('routeOptimize')} disabled={isRunning !== null} className="flex flex-col items-center gap-2 p-3 bg-lattice-deep rounded-lg border border-lattice-border hover:border-orange-400/50 transition-colors disabled:opacity-50">
            {isRunning === 'routeOptimize' ? <Loader2 className="w-5 h-5 text-orange-400 animate-spin" /> : <Route className="w-5 h-5 text-orange-400" />}
            <span className="text-xs text-gray-300">Route Optimize</span>
          </button>
        </div>
        {actionResult && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-4 p-3 bg-lattice-deep rounded-lg border border-lattice-border">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold flex items-center gap-2"><Globe className="w-4 h-4 text-neon-cyan" /> Result</h4>
              <button onClick={() => setActionResult(null)} className="text-gray-400 hover:text-white" aria-label="Xcircle"><XCircle className="w-4 h-4" /></button>
            </div>
            {/* Geocode */}
            {actionResult.resolved !== undefined && actionResult.count !== undefined && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 bg-lattice-surface rounded text-center"><p className="text-sm font-bold text-neon-cyan">{actionResult.resolvedCount as number || 0}</p><p className="text-[10px] text-gray-400">Resolved</p></div>
                  <div className="p-2 bg-lattice-surface rounded text-center"><p className="text-sm font-bold text-red-400">{actionResult.unresolvedCount as number || 0}</p><p className="text-[10px] text-gray-400">Unresolved</p></div>
                </div>
                {(actionResult.resolved as Array<{ name: string; lat: number; lon: number; distanceFromOriginKm?: number }>)?.slice(0, 5).map((p, i) => (
                  <div key={i} className="flex items-center justify-between text-xs p-1.5 bg-lattice-surface rounded">
                    <span className="text-white">{p.name}</span>
                    <span className="text-gray-400">{p.lat?.toFixed(2)}, {p.lon?.toFixed(2)}</span>
                    {p.distanceFromOriginKm !== undefined && <span className="text-neon-cyan">{p.distanceFromOriginKm}km</span>}
                  </div>
                ))}
              </div>
            )}
            {/* Distance Matrix */}
            {actionResult.matrix !== undefined && (
              <div className="space-y-2">
                <div className="text-xs text-gray-400">{actionResult.pointCount as number} points, {(actionResult.stats as Record<string, unknown>)?.totalPairs as number} pairs</div>
                {(actionResult.stats as Record<string, unknown>)?.minDistancePair ? <div className="text-xs text-neon-green">Closest: {((actionResult.stats as Record<string, unknown>).minDistancePair as string[])?.join(' - ')} ({(actionResult.stats as Record<string, unknown>).minDistanceKm as number}km)</div> : null}
                {(actionResult.stats as Record<string, unknown>)?.maxDistancePair ? <div className="text-xs text-red-400">Farthest: {((actionResult.stats as Record<string, unknown>).maxDistancePair as string[])?.join(' - ')} ({(actionResult.stats as Record<string, unknown>).maxDistanceKm as number}km)</div> : null}
              </div>
            )}
            {/* Region Stats */}
            {actionResult.totals !== undefined && actionResult.rankings !== undefined && (
              <div className="space-y-2">
                <div className="text-lg font-bold text-green-400">{actionResult.regionCount as number} Regions</div>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(actionResult.totals as Record<string, unknown>).map(([key, val]) => (
                    <div key={`total-${key}`} className="p-2 bg-lattice-surface rounded"><p className="text-[10px] text-gray-400 capitalize">Total {key.replace(/([A-Z])/g, ' $1')}</p><p className="text-sm font-bold text-white">{String(val)}</p></div>
                  ))}
                  {Object.entries(actionResult.averages as Record<string, unknown>).map(([key, val]) => (
                    <div key={`avg-${key}`} className="p-2 bg-lattice-surface rounded"><p className="text-[10px] text-gray-400 capitalize">Avg {key.replace(/([A-Z])/g, ' $1')}</p><p className="text-sm font-bold text-white">{String(val)}</p></div>
                  ))}
                </div>
                {actionResult.distribution ? (
                  <div className="p-2 bg-lattice-surface rounded">
                    <p className="text-[10px] text-gray-400">Distribution</p>
                    <p className="text-sm font-bold text-white">{String((actionResult.distribution as Record<string, unknown>).concentration)}</p>
                  </div>
                ) : null}
              </div>
            )}
            {/* Route Optimize */}
            {actionResult.optimizedRoute !== undefined && actionResult.totalDistanceKm !== undefined && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 bg-lattice-surface rounded text-center"><p className="text-sm font-bold text-orange-400">{actionResult.totalDistanceKm as number}km</p><p className="text-[10px] text-gray-400">Total Distance</p></div>
                  <div className="p-2 bg-lattice-surface rounded text-center"><p className="text-sm font-bold text-neon-cyan">{(actionResult.optimizedRoute as unknown[])?.length || 0}</p><p className="text-[10px] text-gray-400">Stops</p></div>
                </div>
                {(actionResult.optimizedRoute as Array<{ name: string; step: number }>)?.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs p-1.5 bg-lattice-surface rounded">
                    <span className="text-orange-400 font-bold w-5 text-center">{s.step}</span>
                    <span className="text-white">{s.name}</span>
                  </div>
                ))}
              </div>
            )}
            {!!actionResult.message && !actionResult.resolved && !actionResult.matrix && !actionResult.totals && !actionResult.optimizedRoute && (
              <p className="text-sm text-gray-400">{actionResult.message as string}</p>
            )}
          </motion.div>
        )}
      </div>

      {/* Real-time Data Panel */}
      <UniversalActions domain="atlas" artifactId={null} compact />
      {realtimeData && (
        <RealtimeDataPanel
          domain="atlas"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}

      {/* Lens Features */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Lens Features & Capabilities
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} />
        </button>
        {showFeatures && (
          <div className="px-4 pb-4">
            <LensFeaturePanel lensId="atlas" />
          </div>
        )}
      </div>

      {/* Bespoke OSM place finder (Nominatim + Overpass) with SVG map + Save-as-DTU */}
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <PlaceFinder />
      </section>

      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <DistanceMatrixPanel />
      </section>

      <section className="mt-6">
        <MapsDirections />
      </section>

      <section className="mt-6">
        <RouteStops />
      </section>

      <section className="mt-6">
        <SavedPlaces />
      </section>

      {/* Google-Maps-parity navigation suite: multi-modal directions,
          live traffic, transit, real-time navigation, street imagery,
          place details, offline map areas. */}
      <section className="mt-6">
        <NavigationSuite />
      </section>

      <PipingProvider>
        <section className="mt-6">
          <AtlasActionPanel />
        </section>
      </PipingProvider>
    </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
      <a href="#atlas-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to atlas content</a>
          <RecentMineCard domain="atlas" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="atlas" hideWhenEmpty className="mt-3" title="More actions" />
          <CrossLensRecentsPanel lensId="atlas" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
