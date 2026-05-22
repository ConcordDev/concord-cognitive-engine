'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * GisPitMap — GIS pit/bench mapping layer. Geo-references mine sites
 * (via mining.site-set-location) and projects logged drill collars onto
 * a slippy map (via mining.gis-layer). Every marker is a real macro
 * feature; no seeded data.
 */

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { lensRun } from '@/lib/api/client';
import { MapPin, Loader2, Drill, Mountain } from 'lucide-react';

const MapView = dynamic(() => import('@/components/viz').then((m) => m.MapView), { ssr: false });

interface GisFeature {
  kind: 'site' | 'drillhole'; id: string; label: string;
  lat: number; lng: number; properties: Record<string, any>;
}
interface GisLayer {
  features: GisFeature[]; count: number; sites: number; drillholes: number; note: string;
}
interface SiteRef { id: string; name: string; lat?: number; lng?: number }

export function GisPitMap() {
  const [layer, setLayer] = useState<GisLayer | null>(null);
  const [sites, setSites] = useState<SiteRef[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [siteId, setSiteId] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');

  const loadSites = useCallback(async () => {
    const r = await lensRun<{ sites: SiteRef[] }>('mining', 'site-list', {});
    if (r.data.ok && r.data.result) {
      setSites(r.data.result.sites);
      setSiteId((prev) => prev || r.data.result?.sites[0]?.id || '');
    }
  }, []);

  const loadLayer = useCallback(async () => {
    const r = await lensRun<GisLayer>('mining', 'gis-layer', {});
    if (r.data.ok && r.data.result) setLayer(r.data.result);
    else if (r.data.error) setErr(r.data.error);
  }, []);

  useEffect(() => { void loadSites(); void loadLayer(); }, [loadSites, loadLayer]);

  async function setLocation() {
    if (!siteId) { setErr('Select a site.'); return; }
    const latN = Number(lat), lngN = Number(lng);
    if (!Number.isFinite(latN) || !Number.isFinite(lngN)) { setErr('Valid lat/lng required.'); return; }
    setBusy('loc'); setErr(null);
    const r = await lensRun('mining', 'site-set-location', { id: siteId, lat: latN, lng: lngN });
    setBusy(null);
    if (r.data.ok) { setLat(''); setLng(''); await loadSites(); await loadLayer(); }
    else setErr(r.data.error || 'set location failed');
  }

  const markers = (layer?.features || []).map((f) => ({
    id: f.id,
    lat: f.lat,
    lon: f.lng,
    label: f.kind === 'site'
      ? `${f.label} — ${f.properties.commodity ?? 'ore'} (${f.properties.status ?? 'active'})`
      : `${f.label} — ${f.properties.intervals ?? 0} intervals · ${f.properties.totalDepth ?? 0}m`,
    tone: (f.kind === 'site' ? 'warn' : 'info') as 'warn' | 'info',
  }));

  const selectedSite = sites.find((s) => s.id === siteId);

  return (
    <div className="rounded-lg border border-stone-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-stone-500/10 pb-2">
        <MapPin className="h-4 w-4 text-rose-400" />
        <h3 className="text-sm font-semibold text-white">GIS pit/bench mapping layer</h3>
        {layer && (
          <span className="ml-auto text-[10px] text-zinc-500">
            {layer.sites} sites · {layer.drillholes} drill collars
          </span>
        )}
      </header>

      {err && <div className="text-[11px] text-red-300 bg-red-500/10 border border-red-500/30 rounded px-2 py-1">{err}</div>}

      {/* geo-reference a site */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5 items-end">
        <div>
          <label className="text-[9px] text-zinc-500 block mb-0.5">Site</label>
          <select value={siteId} onChange={(e) => setSiteId(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-1 py-1.5 text-[11px] text-white">
            {sites.length === 0 && <option value="">no sites — add one first</option>}
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}{s.lat != null ? ' ✓' : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[9px] text-zinc-500 block mb-0.5">Latitude</label>
          <input value={lat} onChange={(e) => setLat(e.target.value.replace(/[^\d.-]/g, ''))} placeholder="-23.45"
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[11px] text-white font-mono" />
        </div>
        <div>
          <label className="text-[9px] text-zinc-500 block mb-0.5">Longitude</label>
          <input value={lng} onChange={(e) => setLng(e.target.value.replace(/[^\d.-]/g, ''))} placeholder="119.7"
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[11px] text-white font-mono" />
        </div>
        <button type="button" onClick={setLocation} disabled={!!busy || !siteId}
          className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-rose-700 hover:bg-rose-600 disabled:opacity-40 text-white rounded text-[12px]">
          {busy === 'loc' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MapPin className="w-3.5 h-3.5" />} Geo-reference
        </button>
      </div>

      {selectedSite && selectedSite.lat != null && (
        <div className="text-[10px] text-zinc-500">
          {selectedSite.name} is at {selectedSite.lat}, {selectedSite.lng}. Drill collars logged against this site are
          projected onto the map relative to its coordinates.
        </div>
      )}

      {markers.length > 0 ? (
        <div className="rounded-lg overflow-hidden border border-zinc-800">
          <MapView markers={markers} height={420} />
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 h-[200px] rounded-lg border border-zinc-800 bg-zinc-950/40 text-zinc-600">
          <Mountain className="w-6 h-6 opacity-40" />
          <p className="text-[11px]">Geo-reference a site to see it on the GIS layer.</p>
        </div>
      )}

      {layer && layer.features.length > 0 && (
        <div className="space-y-1 max-h-44 overflow-y-auto">
          {layer.features.map((f) => (
            <div key={f.id} className="flex items-center gap-2 text-[11px] bg-zinc-900/60 rounded px-2 py-1">
              {f.kind === 'site'
                ? <Mountain className="w-3 h-3 text-amber-400 shrink-0" />
                : <Drill className="w-3 h-3 text-cyan-400 shrink-0" />}
              <span className="text-zinc-200 truncate flex-1">{f.label}</span>
              <span className="font-mono text-zinc-500">{f.lat.toFixed(4)}, {f.lng.toFixed(4)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
