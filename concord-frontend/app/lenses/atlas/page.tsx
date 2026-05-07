'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useLensNav } from '@/hooks/useLensNav';
import { motion } from 'framer-motion';
import {
  Map, Layers, Radio, AlertTriangle, Activity, RefreshCw,
  ChevronDown, Compass, Globe, Radar,
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

  const [tab, setTab] = useState<Tab>('terrain');
  const [showFeatures, setShowFeatures] = useState(false);
  const [queryLat, setQueryLat] = useState('');
  const [queryLng, setQueryLng] = useState('');

  // ── Data fetching ──────────────────────────────────────────────────────

  const { data: coverageData, isLoading: coverageLoading } = useQuery({
    queryKey: ['atlas-coverage'],
    queryFn: () => apiHelpers.atlasTomography.coverage().then(r => r.data),
    refetchInterval: 30000,
  });

  const { data: taxonomyData, isLoading: taxonomyLoading } = useQuery({
    queryKey: ['atlas-taxonomy'],
    queryFn: () => apiHelpers.atlasTomography.signalsTaxonomy('all', 50).then(r => r.data),
    refetchInterval: 20000,
  });

  const { data: anomalyData, isLoading: anomalyLoading } = useQuery({
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

      {/* Real-time Data Panel */}
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
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-400 hover:text-white transition-colors"
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
