'use client';

import { useCallback, useEffect, useState } from 'react';
import { Navigation, Loader2, RefreshCw, Radio } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { MapView, type MapMarker } from '@/components/viz/MapView';
import { cn } from '@/lib/utils';

interface Technician { id: string; name: string; status: string }
interface LiveTech { id: string; name: string; lat: number; lng: number; status: string; activeJobId: string | null; locationUpdatedAt: string | null }
interface Job { id: string; number: string; customerName: string; description: string; status: string }

const STATUS_TONE: Record<string, MapMarker['tone']> = {
  available: 'good', on_route: 'info', on_site: 'warn', break: 'warn', off: 'default',
};
const FIELD_STATUSES = ['en-route', 'on-site', 'completed'] as const;

export function FieldTrackingPanel() {
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [liveTechs, setLiveTechs] = useState<LiveTech[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [locDraft, setLocDraft] = useState<{ techId: string; lat: string; lng: string }>({ techId: '', lat: '', lng: '' });
  const [fieldDraft, setFieldDraft] = useState<{ jobId: string; status: typeof FIELD_STATUSES[number]; note: string }>({ jobId: '', status: 'en-route', note: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [t, m, j] = await Promise.all([
        lensRun<{ technicians: Technician[] }>('trades', 'technicians-list', {}),
        lensRun<{ technicians: LiveTech[] }>('trades', 'technicians-live-map', {}),
        lensRun<{ jobs: Job[] }>('trades', 'job-list', {}),
      ]);
      if (t.data?.ok && t.data.result) setTechnicians(t.data.result.technicians);
      if (m.data?.ok && m.data.result) setLiveTechs(m.data.result.technicians);
      if (j.data?.ok && j.data.result) setJobs(j.data.result.jobs);
    } catch (e) { console.error('[FieldTracking] refresh failed', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function pushLocation() {
    const lat = Number(locDraft.lat), lng = Number(locDraft.lng);
    if (!locDraft.techId || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
    try {
      const r = await lensRun('trades', 'technician-update-location', { id: locDraft.techId, lat, lng });
      if (r.data?.ok) { setLocDraft({ techId: '', lat: '', lng: '' }); await refresh(); }
    } catch (e) { console.error('[FieldTracking] location failed', e); }
  }

  function useBrowserLocation() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      pos => setLocDraft(d => ({ ...d, lat: pos.coords.latitude.toFixed(5), lng: pos.coords.longitude.toFixed(5) })),
      err => console.error('[FieldTracking] geolocation denied', err),
    );
  }

  async function pushFieldStatus() {
    if (!fieldDraft.jobId) return;
    try {
      const r = await lensRun('trades', 'field-status-update', {
        jobId: fieldDraft.jobId, status: fieldDraft.status, note: fieldDraft.note,
      });
      if (r.data?.ok) { setFieldDraft({ jobId: '', status: 'en-route', note: '' }); await refresh(); }
    } catch (e) { console.error('[FieldTracking] field status failed', e); }
  }

  const markers: MapMarker[] = liveTechs.map(t => ({
    id: t.id, lat: t.lat, lon: t.lng, label: t.name, tone: STATUS_TONE[t.status] || 'default',
  }));
  const activeJobs = jobs.filter(j => j.status !== 'completed' && j.status !== 'cancelled' && j.status !== 'invoiced');

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Navigation className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Field tracking &amp; GPS</span>
        <span className="ml-auto text-[10px] text-gray-400">{markers.length} techs located</span>
        <button onClick={refresh} className="p-1 rounded hover:bg-white/5 text-gray-400" aria-label="Refresh"><RefreshCw className="w-3.5 h-3.5" /></button>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading field data…</div>
      ) : (
        <div className="p-3 space-y-3">
          {markers.length > 0 ? (
            <MapView markers={markers} height={220} />
          ) : (
            <div className="rounded border border-dashed border-white/10 py-8 text-center text-xs text-gray-400">
              No technician locations yet — push a GPS fix below.
            </div>
          )}

          {liveTechs.length > 0 && (
            <ul className="space-y-1">
              {liveTechs.map(t => (
                <li key={t.id} className="rounded border border-white/10 bg-black/20 px-2 py-1.5 flex items-center gap-2">
                  <Radio className={cn('w-3 h-3', t.status === 'available' ? 'text-emerald-400' : t.status === 'on_site' ? 'text-amber-400' : 'text-cyan-400')} />
                  <span className="text-xs text-white flex-1">{t.name}</span>
                  <span className="text-[10px] font-mono text-gray-400">{t.lat.toFixed(3)}, {t.lng.toFixed(3)}</span>
                  <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-white/5 text-gray-400">{t.status.replace('_', ' ')}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded border border-cyan-500/20 bg-cyan-500/[0.04] p-2.5 space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-cyan-400">Push GPS fix</div>
              <select value={locDraft.techId} onChange={e => setLocDraft(d => ({ ...d, techId: e.target.value }))} className="w-full px-2 py-1 text-xs bg-black/40 border border-white/10 rounded text-gray-100">
                <option value="">— select technician —</option>
                {technicians.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <div className="grid grid-cols-2 gap-1.5">
                <input type="number" value={locDraft.lat} onChange={e => setLocDraft(d => ({ ...d, lat: e.target.value }))} placeholder="lat" className="px-2 py-1 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
                <input type="number" value={locDraft.lng} onChange={e => setLocDraft(d => ({ ...d, lng: e.target.value }))} placeholder="lng" className="px-2 py-1 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
              </div>
              <div className="flex gap-1.5">
                <button onClick={useBrowserLocation} className="flex-1 px-2 py-1 rounded border border-white/10 text-[10px] text-gray-300 hover:bg-white/5">Use my location</button>
                <button onClick={pushLocation} disabled={!locDraft.techId || !locDraft.lat || !locDraft.lng} className="flex-1 px-2 py-1 rounded border border-cyan-500/40 bg-cyan-500/15 text-[10px] text-cyan-200 disabled:opacity-40">Update</button>
              </div>
            </div>

            <div className="rounded border border-amber-500/20 bg-amber-500/[0.04] p-2.5 space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-amber-400">Field status update</div>
              <select value={fieldDraft.jobId} onChange={e => setFieldDraft(d => ({ ...d, jobId: e.target.value }))} className="w-full px-2 py-1 text-xs bg-black/40 border border-white/10 rounded text-gray-100">
                <option value="">— select job —</option>
                {activeJobs.map(j => <option key={j.id} value={j.id}>{j.number} · {j.customerName}</option>)}
              </select>
              <select value={fieldDraft.status} onChange={e => setFieldDraft(d => ({ ...d, status: e.target.value as typeof FIELD_STATUSES[number] }))} className="w-full px-2 py-1 text-xs bg-black/40 border border-white/10 rounded text-gray-100">
                {FIELD_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <input value={fieldDraft.note} onChange={e => setFieldDraft(d => ({ ...d, note: e.target.value }))} placeholder="Field note (optional)" className="w-full px-2 py-1 text-xs bg-black/40 border border-white/10 rounded text-gray-100" />
              <button onClick={pushFieldStatus} disabled={!fieldDraft.jobId} className="w-full px-2 py-1 rounded border border-amber-500/40 bg-amber-500/15 text-[10px] text-amber-200 disabled:opacity-40">Report from field</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default FieldTrackingPanel;
