'use client';

import { useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { AtlasSection } from '@/components/atlas/AtlasSection';
import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { PipingProvider } from '@/components/panel-polish';
import { SafeCard } from '@/components/common/SafeCard';
import {
  Map, Layers, Radio, AlertTriangle, RefreshCw,
  Compass, Globe, Radar, Loader2, MapPinned, Info, ShieldCheck, Search,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import type { MapMarker } from '@/components/common/MapView';
import AtlasPublicView from '@/components/chat/AtlasPublicView';
import AtlasResearchView from '@/components/chat/AtlasResearchView';
import AtlasSignalView from '@/components/chat/AtlasSignalView';
import AtlasOverlay from '@/components/chat/AtlasOverlay';
import { SignalClassifyForm } from '@/components/atlas/SignalClassifyForm';
import AtlasPrivacyMonitor, { type PrivacyMonitorData } from '@/components/chat/AtlasPrivacyMonitor';
import { PrivacyVerifyForm } from '@/components/atlas/PrivacyVerifyForm';
import { SpatialQueryForm } from '@/components/atlas/SpatialQueryForm';

// Leaflet requires dynamic import (no SSR)
const MapView = dynamic(() => import('@/components/common/MapView'), { ssr: false });

// ── Types ──────────────────────────────────────────────────────────────────

type TomoTab = 'terrain' | 'signals' | 'anomalies' | 'coverage' | 'privacy' | 'query';

// ── Component ──────────────────────────────────────────────────────────────

type AtlasView = 'map' | TomoTab;

const VIEWS: { id: AtlasView; label: string; keys: string; title: string; hint: string; icon: typeof Map }[] = [
  { id: 'map', label: 'Map & trips', keys: 'g m', title: 'Where to next', hint: 'Places, trips and navigation', icon: MapPinned },
  { id: 'terrain', label: 'Terrain', keys: 'g t', title: 'What the ground is made of', hint: 'Reconstructed terrain and material for a tile', icon: Map },
  { id: 'signals', label: 'Signals', keys: 'g s', title: 'What the air is carrying', hint: 'Signal taxonomy, spectrum and classification', icon: Radio },
  { id: 'anomalies', label: 'Anomalies', keys: 'g a', title: 'What changed that should not have', hint: 'Detected signal anomalies', icon: AlertTriangle },
  { id: 'coverage', label: 'Coverage', keys: 'g c', title: 'How much of the world is mapped', hint: 'Tomography coverage', icon: Layers },
  { id: 'privacy', label: 'Privacy', keys: 'g p', title: 'What the atlas refuses to see', hint: 'Privacy zones and interior-never-generated verification', icon: ShieldCheck },
  { id: 'query', label: 'Query', keys: 'g q', title: 'Ask the atlas a spatial question', hint: 'Spatial queries', icon: Search },
];

export default function AtlasLensPage() {
  useLensNav('atlas');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [view, setView] = useState<AtlasView>('map');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `atlas-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setView(v.id),
    })),
    { lensId: 'atlas' }
  );

  const current = VIEWS.find((v) => v.id === view)!;

  return (
    <LensShell lensId="atlas" asMain={false}>
      <FirstRunTour lensId="atlas" />
      <DepthBadge lensId="atlas" size="sm" className="ml-2" />
      {/* Two distinct backends live under this one lens: a real Google-Maps-parity
          places/trips/directions tool (server/domains/atlas.js) and a signal-tomography
          reconstruction product (server/lib/foundation-atlas.js + atlas-signal-cortex.js).
          See docs/lens-specs/atlas-capability-map.md for why they stay separate views. */}
      <NorthStarFrame
        lensId="atlas"
        crumb="Atlas"
        title={`${current.title}${view === 'map' && who ? `, ${who}` : ''}`}
        subtitle={view === 'map' ? 'Places, trips and navigation' : 'Signal tomography and spatial intelligence'}
        tabs={VIEWS.map((v) => ({ id: v.id, label: v.label, icon: v.icon, keys: v.keys, hint: v.hint }))}
        activeTab={view}
        onTab={(id) => setView(id as AtlasView)}
        tabsLabel="Atlas views"
        cta={{ label: 'Query a tile', icon: Compass, onClick: () => setView('terrain'), title: 'Look up reconstructed terrain for a latitude/longitude' }}
      >
        {view === 'map' ? (
          <PipingProvider>
            <AtlasSection />
          </PipingProvider>
        ) : (
          <SignalTomography tab={view} setTab={setView} />
        )}
      </NorthStarFrame>
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

function SignalTomography({ tab, setTab }: { tab: TomoTab; setTab: (t: TomoTab) => void }) {
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

  const { data: privacyZonesData, isLoading: privacyZonesLoading, isError: privacyZonesError, refetch: refetchPrivacyZones } = useQuery<PrivacyMonitorData>({
    queryKey: ['atlas-privacy-zones'],
    queryFn: () => apiHelpers.atlasTomography.privacyZones('zones').then(r => r.data),
    refetchInterval: 30000,
  });

  const { data: privacyStatsData, isLoading: privacyStatsLoading } = useQuery<PrivacyMonitorData>({
    queryKey: ['atlas-privacy-stats'],
    queryFn: () => apiHelpers.atlasTomography.privacyZones('stats').then(r => r.data),
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
        <div role="status" aria-live="polite" className="bg-[#111] border border-white/10 rounded-lg p-3 flex items-center gap-2">
          <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />
          <p className="text-sm text-gray-400">Scanning signal tomography…</p>
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
        <div className="bg-lattice-surface border border-dashed border-lattice-border rounded-lg p-4 text-center">
          <p className="text-sm text-gray-300 font-medium">No signal coverage yet</p>
          <p className="text-xs text-gray-500 mt-1">Query a tile by latitude/longitude below to confirm — or check back once a mesh network is feeding this pipeline.</p>
        </div>
      )}

      {/* Stat Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Active Nodes', value: markers.length, icon: Radar, color: 'text-purple-400 bg-purple-500/10' },
          { label: 'Signals', value: (taxonomyData as { signals?: unknown[] })?.signals?.length || (taxonomyData as { total?: number })?.total || 0, icon: Radio, color: 'text-cyan-400 bg-cyan-500/10' },
          { label: 'Anomalies', value: (anomalyData as { anomalies?: unknown[] })?.anomalies?.length || (anomalyData as { total?: number })?.total || 0, icon: AlertTriangle, color: 'text-amber-400 bg-amber-500/10' },
          { label: 'Coverage', value: (coverageData as { coverage?: number })?.coverage ? `${((coverageData as { coverage: number }).coverage * 100).toFixed(0)}%` : '--', icon: Globe, color: 'text-blue-400 bg-blue-500/10' },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-2xl border border-white/10 bg-[#111] p-3"
          >
            <div className={`w-8 h-8 rounded-lg ${stat.color} flex items-center justify-center mb-2`}>
              <stat.icon className="w-4 h-4" />
            </div>
            <p className="text-xl font-bold text-white font-mono tabular-nums">{stat.value}</p>
            <p className="text-xs text-gray-400">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Zoom Level Indicator */}
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Compass className="w-3.5 h-3.5 text-purple-400" />
        <span>Lat: <span className="font-mono tabular-nums text-gray-300">{queryLat || '--'}</span></span>
        <span className="text-gray-700">|</span>
        <span>Lng: <span className="font-mono tabular-nums text-gray-300">{queryLng || '--'}</span></span>
        <span className="text-gray-700">|</span>
        <span className="text-purple-400"><span className="font-mono tabular-nums">{markers.length}</span> markers loaded</span>
      </div>

      {/* Map */}
      <div className="rounded-2xl overflow-hidden border border-white/10">
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
          className="bg-[#111] border border-white/10 rounded px-3 py-1.5 text-sm text-gray-200 w-32"
        />
        <input
          type="number"
          step="any"
          placeholder="Longitude"
          value={queryLng}
          onChange={(e) => setQueryLng(e.target.value)}
          className="bg-[#111] border border-white/10 rounded px-3 py-1.5 text-sm text-gray-200 w-32"
        />
        <button
          onClick={() => refetchTile()}
          disabled={!queryLat || !queryLng}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm bg-teal-400 hover:bg-teal-300 text-black disabled:opacity-40 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Query Tile
        </button>
        {tileData && (
          // @modal-escape-ok: AtlasOverlay is an inline attribution card, not a focus-trap modal
          <AtlasOverlay query={`${queryLat}, ${queryLng}`} result={tileData} loading={tileLoading} />
        )}
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
            <SignalClassifyForm />
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

        {tab === 'privacy' && (
          <>
            <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/[0.04] p-3 text-xs text-red-200">
              <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-red-300" />
              <p>
                Privacy zones are established when a signal profile is classified as residential,
                medical, religious, government, or military (real code —{' '}
                <code className="text-red-100">server/lib/atlas-signal-cortex.js#detectPrivacyZone</code>).
                ABSOLUTE and RESTRICTED zones carry an interior-never-generated guarantee — verify
                it below. This deployment has no automatic zone-detection pipeline wired to live
                signal ingestion yet, so the list is real and honestly empty until zones exist.
              </p>
            </div>

            {privacyZonesError && (
              <div role="alert" className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 flex items-center justify-between">
                <p className="text-red-400 text-sm">Could not load privacy zones.</p>
                <button
                  onClick={() => refetchPrivacyZones()}
                  className="text-xs text-red-300 hover:text-white border border-red-500/30 rounded px-2 py-1"
                >
                  Retry
                </button>
              </div>
            )}

            <AtlasPrivacyMonitor data={privacyZonesData ?? null} loading={privacyZonesLoading} />
            <PrivacyVerifyForm zones={privacyZonesData?.zones?.zones ?? []} />
            <AtlasPrivacyMonitor data={privacyStatsData ?? null} loading={privacyStatsLoading} />
          </>
        )}

        {tab === 'query' && <SpatialQueryForm />}
      </div>
    </div>
  );
}
