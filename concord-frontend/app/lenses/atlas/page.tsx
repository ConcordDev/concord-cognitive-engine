'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useLensNav } from '@/hooks/useLensNav';
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

  // ── Data fetching ──────────────────────────────────────────────────────

  const { data: coverageData, isLoading: coverageLoading, isError: coverageError } = useQuery({
    queryKey: ['atlas-coverage'],
    queryFn: () => apiHelpers.atlasTomography.coverage().then(r => r.data),
    refetchInterval: 30000,
  });

  const { data: taxonomyData, isLoading: taxonomyLoading } = useQuery({
    queryKey: ['atlas-taxonomy'],
    queryFn: () => apiHelpers.atlasTomography.signalsTaxonomy('all', 50).then(r => r.data),
    refetchInterval: 20000,
  });

  const { data: anomalyData, isLoading: anomalyLoading, isError: anomalyError } = useQuery({
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
    <div data-lens-theme="atlas" className="min-h-screen bg-zinc-950 text-zinc-100 p-6 space-y-6">
      {/* Error banner */}
      {(coverageError || anomalyError) && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 flex items-center justify-between">
          <p className="text-red-400 text-sm">Some data sources failed to load. Showing available data.</p>
          <button onClick={() => window.location.reload()} className="text-xs text-red-300 hover:text-white">Retry</button>
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
            <p className="text-sm text-zinc-500">Signal Tomography & Spatial Intelligence</p>
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
            <p className="text-xs text-zinc-500">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Zoom Level Indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="flex items-center gap-2 text-xs text-zinc-500"
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
        <MapView
          markers={markers}
          className="h-[360px]"
          onMarkerClick={handleMarkerClick}
        />
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
              tab === t.id ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'
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
              <button onClick={() => setActionResult(null)} className="text-gray-400 hover:text-white"><XCircle className="w-4 h-4" /></button>
            </div>
            {/* Geocode */}
            {actionResult.resolved !== undefined && actionResult.count !== undefined && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 bg-lattice-surface rounded text-center"><p className="text-sm font-bold text-neon-cyan">{actionResult.resolvedCount as number || 0}</p><p className="text-[10px] text-gray-500">Resolved</p></div>
                  <div className="p-2 bg-lattice-surface rounded text-center"><p className="text-sm font-bold text-red-400">{actionResult.unresolvedCount as number || 0}</p><p className="text-[10px] text-gray-500">Unresolved</p></div>
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
                    <div key={`total-${key}`} className="p-2 bg-lattice-surface rounded"><p className="text-[10px] text-gray-500 capitalize">Total {key.replace(/([A-Z])/g, ' $1')}</p><p className="text-sm font-bold text-white">{String(val)}</p></div>
                  ))}
                  {Object.entries(actionResult.averages as Record<string, unknown>).map(([key, val]) => (
                    <div key={`avg-${key}`} className="p-2 bg-lattice-surface rounded"><p className="text-[10px] text-gray-500 capitalize">Avg {key.replace(/([A-Z])/g, ' $1')}</p><p className="text-sm font-bold text-white">{String(val)}</p></div>
                  ))}
                </div>
                {actionResult.distribution ? (
                  <div className="p-2 bg-lattice-surface rounded">
                    <p className="text-[10px] text-gray-500">Distribution</p>
                    <p className="text-sm font-bold text-white">{String((actionResult.distribution as Record<string, unknown>).concentration)}</p>
                  </div>
                ) : null}
              </div>
            )}
            {/* Route Optimize */}
            {actionResult.optimizedRoute !== undefined && actionResult.totalDistanceKm !== undefined && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 bg-lattice-surface rounded text-center"><p className="text-sm font-bold text-orange-400">{actionResult.totalDistanceKm as number}km</p><p className="text-[10px] text-gray-500">Total Distance</p></div>
                  <div className="p-2 bg-lattice-surface rounded text-center"><p className="text-sm font-bold text-neon-cyan">{(actionResult.optimizedRoute as unknown[])?.length || 0}</p><p className="text-[10px] text-gray-500">Stops</p></div>
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
    </div>
  );
}
