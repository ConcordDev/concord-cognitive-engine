'use client';

import { useEffect, useState } from 'react';
import { TreeDeciduous, Loader2, MapPin, Calendar, X } from 'lucide-react';
import { api } from '@/lib/api/client';

export interface BioObservation {
  id: string;
  commonName: string;
  scientificName: string;
  observedAt: string;
  lat?: number;
  lng?: number;
  imageDataUrl?: string;
  notes?: string;
}

export function BiodiversityLog() {
  const [observations, setObservations] = useState<BioObservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.post('/api/lens/run', {
        domain: 'eco', action: 'biodiversity-list', input: { limit: 50 },
      });
      // /api/lens/run single-unwraps the handler envelope: a handler REJECTION
      // arrives as res.data.result = { ok:false, error }. Surface it as an error
      // (never silent-empty) so a backend failure is DISTINGUISHABLE from a
      // genuinely-empty life list.
      const node = res.data?.result;
      if (node && (node as { ok?: boolean }).ok === false) {
        setError((node as { error?: string }).error || 'Could not load life list.');
        setObservations([]);
      } else {
        setObservations(((node as { observations?: BioObservation[] })?.observations || []) as BioObservation[]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load life list.');
      setObservations([]);
    } finally { setLoading(false); }
  }

  async function remove(id: string) {
    try {
      await api.post('/api/lens/run', {
        domain: 'eco', action: 'biodiversity-delete', input: { id },
      });
      setObservations(prev => prev.filter(o => o.id !== id));
    } catch (e) {
      console.error('[BioLog] delete failed', e);
    }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <TreeDeciduous className="w-4 h-4 text-green-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Life list</span>
        <span className="ml-auto text-[10px] text-gray-400">{observations.length} observation{observations.length === 1 ? '' : 's'}</span>
      </header>
      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div role="status" aria-busy="true" className="flex items-center justify-center py-8 text-xs text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
          </div>
        ) : error ? (
          <div role="alert" className="px-3 py-8 text-center text-xs text-red-400 space-y-2">
            <div>{error}</div>
            <button
              onClick={() => refresh()}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-white/[0.04] border border-white/10 text-gray-300 hover:bg-white/[0.08]"
            >
              Retry
            </button>
          </div>
        ) : observations.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400">
            <TreeDeciduous className="w-8 h-8 mx-auto mb-2 opacity-30" />
            No species observed yet. Use the Species ID panel to identify and log.
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {observations.map(o => (
              <li key={o.id} className="px-3 py-2 hover:bg-white/[0.03] group">
                <div className="flex items-start gap-3">
                  {o.imageDataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={o.imageDataUrl} alt={o.commonName} className="w-12 h-12 rounded object-cover border border-white/10 shrink-0" />
                  ) : (
                    <div className="w-12 h-12 rounded bg-green-500/10 border border-green-500/30 flex items-center justify-center shrink-0">
                      <TreeDeciduous className="w-5 h-5 text-green-400" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white">{o.commonName}</div>
                    <div className="text-xs italic text-gray-400">{o.scientificName}</div>
                    <div className="flex items-center gap-3 text-[10px] text-gray-400 mt-0.5">
                      <span className="inline-flex items-center gap-0.5">
                        <Calendar className="w-3 h-3" /> {new Date(o.observedAt).toLocaleDateString()}
                      </span>
                      {o.lat != null && o.lng != null && (
                        <span className="inline-flex items-center gap-0.5">
                          <MapPin className="w-3 h-3" /> {o.lat.toFixed(2)}, {o.lng.toFixed(2)}
                        </span>
                      )}
                    </div>
                    {o.notes && <p className="text-[11px] text-gray-300 mt-1">{o.notes}</p>}
                  </div>
                  <button
                    onClick={() => remove(o.id)}
                    title="Remove"
                    className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-400"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default BiodiversityLog;
