'use client';

import { useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { AtlasSection } from '@/components/atlas/AtlasSection';
import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { PipingProvider } from '@/components/panel-polish';
import { SafeCard } from '@/components/common/SafeCard';
import { motion } from 'framer-motion';
import {
  Map, Layers, Radio, AlertTriangle, RefreshCw,
  Compass, Globe, Radar, Loader2, MapPinned, Satellite, Info,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import type { MapMarker } from '@/components/common/MapView';
import AtlasPublicView from '@/components/chat/AtlasPublicView';
import AtlasResearchView from '@/components/chat/AtlasResearchView';
import AtlasSignalView from '@/components/chat/AtlasSignalView';
import AtlasOverlay from '@/components/chat/AtlasOverlay';

// Leaflet requires dynamic import (no SSR)
const MapView = dynamic(() => import('@/components/common/MapView'), { ssr: false });

// ── Types ──────────────────────────────────────────────────────────────────

type Mode = 'map' | 'tomography';
type TomoTab = 'terrain' | 'signals' | 'anomalies' | 'coverage';

// ── Component ──────────────────────────────────────────────────────────────

export default function AtlasLensPage() {
  useLensNav('atlas');
  const [mode, setMode] = useState<Mode>('map');

  useLensCommand(
    [
      { id: 'mode-map', keys: 'g m', description: 'Map & trips', category: 'navigation', action: () => setMode('map') },
      { id: 'mode-tomo', keys: 'g s', description: 'Signal tomography', category: 'navigation', action: () => setMode('tomography') },
    ],
    { lensId: 'atlas' }
  );

  return (
    <LensShell lensId="atlas" asMain={false}>
      <FirstRunTour lensId="atlas" />
      <div data-lens-theme="atlas" className="min-h-screen bg-zinc-950 text-zinc-100 p-4 sm:p-6 space-y-4">
        {/* Header + mode toggle. Two distinct backends live under this one
            lens: a real Google-Maps-parity places/trips/directions tool
            (server/domains/atlas.js) and a sci-fi signal-tomography
            reconstruction concept (server/lib/foundation-atlas.js +
            atlas-signal-cortex.js). See docs/lens-specs/atlas-capability-map.md
            for why these are two modes instead of one blended surface. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-teal-500/20 flex items-center justify-center">
              <Map className="w-5 h-5 text-teal-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Atlas</h1>
              <p className="text-sm text-zinc-400">{mode === 'map' ? 'Places, trips & navigation' : 'Signal tomography & spatial intelligence'}</p>
            </div>
            <DepthBadge lensId="atlas" size="sm" className="ml-1" />
          </div>
          <div className="flex items-center gap-1 rounded-lg bg-zinc-900 border border-zinc-800 p-1" role="tablist" aria-label="Atlas mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'map'}
              onClick={() => setMode('map')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${mode === 'map' ? 'bg-teal-500/20 text-teal-200' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              <MapPinned className="w-3.5 h-3.5" /> Map &amp; trips
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'tomography'}
              onClick={() => setMode('tomography')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${mode === 'tomography' ? 'bg-purple-500/20 text-purple-200' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              <Satellite className="w-3.5 h-3.5" /> Signal tomography
            </button>
          </div>
        </div>

        {mode === 'map' ? (
          <PipingProvider>
            <AtlasSection />
          </PipingProvider>
        ) : (
          <SignalTomography />
        )}
      </div>
    </LensShell>
  );
}

// ── Signal Tomography mode ──────────────────────────────────────────────
//
// A distinct, honestly-disclosed secondary product: reconstructing terrain
// from mesh-network signal deltas (server/lib/foundation-atlas.js). The
// underlying store (`_atlasState`) is only ever populated by
// `collectSignal(...)`, and nothing in this deployment calls it — no mesh
// signal-ingestion pipeline is wired yet. Every query below is REAL (hits
// real REST routes backed by real code), but will honestly return empty/
// zero results until that pipeline exists. The banner below says so
// explicitly instead of leaving the user to guess why every panel is blank.

function SignalTomography() {
  const [tab, setTab] = useState<TomoTab>('terrain');
  const [queryLat, setQueryLat] = useState('');
  const [queryLng, setQueryLng] = useState('');

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

  // Build map markers from live tomography nodes — real (currently empty
  // in this deployment; see the disclosure banner above the map).
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

  const TABS: { id: TomoTab; label: string; icon: React.ReactNode }[] = [
    { id: 'terrain', label: 'Terrain', icon: <Map className="w-4 h-4" /> },
    { id: 'signals', label: 'Signals', icon: <Radio className="w-4 h-4" /> },
    { id: 'anomalies', label: 'Anomalies', icon: <AlertTriangle className="w-4 h-4" /> },
    { id: 'coverage', label: 'Coverage', icon: <Layers className="w-4 h-4" /> },
  ];

  return (
    <div className="space-y-4">
      {/* Honest disclosure — this is not a "currently empty, might fill in"
          message, it is structurally accurate: nothing in this deployment
          feeds the signal store yet. */}
      <div className="flex items-start gap-2 rounded-lg border border-purple-500/20 bg-purple-500/[0.04] p-3 text-xs text-purple-200">
        <Info className="w-4 h-4 shrink-0 mt-0.5 text-purple-300" />
        <p>
          Signal tomography reconstructs terrain, materials, and change-over-time from
          mesh-network signal deltas (real code — <code className="text-purple-100">server/lib/foundation-atlas.js</code>).
          This deployment has no mesh signal-ingestion pipeline wired yet, so every query
          below is a real, honestly-empty lookup — not simulated or fabricated. It will fill in
          automatically once a mesh network starts feeding it.
        </p>
      </div>

      {/* ── Four UX states ── */}
      {(coverageLoading || anomalyLoading) && !coverageError && !anomalyError && (
        <div role="status" aria-live="polite" className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 flex items-center gap-2">
          <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />
          <p className="text-sm text-zinc-400">Scanning signal tomography…</p>
        </div>
      )}
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
      {!coverageLoading && !anomalyLoading && !coverageError && !anomalyError &&
        markers.length === 0 &&
        ((taxonomyData as { signals?: unknown[]; total?: number })?.signals?.length || (taxonomyData as { total?: number })?.total || 0) === 0 &&
        ((anomalyData as { anomalies?: unknown[]; total?: number })?.anomalies?.length || (anomalyData as { total?: number })?.total || 0) === 0 && (
        <div className="bg-zinc-900 border border-dashed border-zinc-700 rounded-lg p-4 text-center">
          <p className="text-sm text-zinc-300 font-medium">No signal coverage yet</p>
          <p className="text-xs text-zinc-500 mt-1">Query a tile by latitude/longitude below to confirm — or check back once a mesh network is feeding this pipeline.</p>
        </div>
      )}

      {/* Stat Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Active Nodes', value: markers.length, icon: Radar, color: 'text-purple-400 bg-purple-500/10' },
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
      <div className="flex items-center gap-2 text-xs text-zinc-400">
        <Compass className="w-3.5 h-3.5 text-purple-400" />
        <span>Lat: {queryLat || '--'}</span>
        <span className="text-zinc-700">|</span>
        <span>Lng: {queryLng || '--'}</span>
        <span className="text-zinc-700">|</span>
        <span className="text-purple-400">{markers.length} markers loaded</span>
      </div>

      {/* Map */}
      <div className="rounded-lg overflow-hidden border border-zinc-800">
        <SafeCard label="Signal tomography map" className="h-[320px]">
          <MapView markers={markers} className="h-[320px]" onMarkerClick={handleMarkerClick} />
        </SafeCard>
      </div>

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
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white transition-colors"
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
    </div>
  );
}
