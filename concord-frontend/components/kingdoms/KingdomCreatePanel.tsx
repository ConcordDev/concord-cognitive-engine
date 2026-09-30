'use client';

import { useCallback, useEffect, useState } from 'react';
import { DraftedTextarea } from '@/components/lens/DraftedTextarea';
import { RegionPolygonEditor } from '@/components/kingdoms/RegionPolygonEditor';
import type { Kingdom } from './types';

export function KingdomCreatePanel({ onCreated }: { onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const [worldId, setWorldId] = useState('concordia-hub');
  const [mode, setMode] = useState<'visual' | 'advanced'>('visual');
  const [points, setPoints] = useState<number[][]>([]);
  const [polygon, setPolygon] = useState('[[0,0],[100,0],[100,100],[0,100]]');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingKingdoms, setExistingKingdoms] = useState<Kingdom[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/kingdoms', { credentials: 'same-origin' });
        const j = await r.json();
        if (j?.ok) setExistingKingdoms(Array.isArray(j.kingdoms) ? j.kingdoms : []);
      } catch { /* ok */ }
    })();
  }, []);

  const regionsInWorld = existingKingdoms
    .filter((k) => k.world_id === worldId && Array.isArray(k.region_polygon) && k.region_polygon.length >= 3)
    .map((k) => ({ id: k.id, name: k.name, region_polygon: k.region_polygon }));

  const submit = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      let regionPolygon: number[][];
      if (mode === 'visual') {
        if (points.length < 3) { setError('place at least 3 vertices'); return; }
        regionPolygon = points;
      } else {
        try {
          regionPolygon = JSON.parse(polygon);
          if (!Array.isArray(regionPolygon) || regionPolygon.length < 3) throw new Error('need 3+ vertices');
        } catch (e) {
          setError(`polygon JSON invalid: ${e instanceof Error ? e.message : String(e)}`);
          return;
        }
      }
      const r = await fetch('/api/kingdoms', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, worldId, regionPolygon }),
      });
      const j = await r.json();
      if (j?.ok) onCreated(j.kingdomId);
      else setError(j?.error || 'create_failed');
    } finally { setSubmitting(false); }
  }, [mode, points, polygon, name, worldId, onCreated]);

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-6">
      <h2 className="mb-4 text-lg font-semibold text-amber-100">Found a Kingdom</h2>
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-[11px] uppercase tracking-wider text-slate-400">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Kingdom of …"
            className="w-full rounded bg-slate-800 px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] uppercase tracking-wider text-slate-400">World</label>
          <input
            value={worldId}
            onChange={(e) => setWorldId(e.target.value)}
            className="w-full rounded bg-slate-800 px-2 py-1 text-sm"
          />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="block text-[11px] uppercase tracking-wider text-slate-400">Region polygon</label>
            <button
              type="button"
              onClick={() => setMode((m) => (m === 'visual' ? 'advanced' : 'visual'))}
              className="text-[10px] text-slate-500 hover:text-slate-300"
            >
              {mode === 'visual' ? 'Advanced: raw JSON' : '← Back to visual editor'}
            </button>
          </div>
          {mode === 'visual' ? (
            <RegionPolygonEditor value={points} onChange={setPoints} existingRegions={regionsInWorld} />
          ) : (
            <>
              <DraftedTextarea
                lensId="kingdoms"
                draftKey="newKingdomPolygon"
                initial=""
                onValueChange={setPolygon}
                rows={4}
                className="w-full rounded bg-slate-800 px-2 py-1 font-mono text-xs"
              />
              <p className="mt-1 text-[10px] text-slate-400">Raw [[x,z], …] pairs, 3+ vertices.</p>
            </>
          )}
        </div>
        {error && <div className="rounded bg-rose-950/40 px-2 py-1 text-sm text-rose-300">{error}</div>}
        <button
          onClick={submit}
          disabled={!name || submitting}
          className="rounded bg-emerald-700 px-4 py-2 text-sm font-semibold hover:bg-emerald-600 disabled:opacity-50"
        >
          {submitting ? 'Founding…' : 'Found kingdom'}
        </button>
      </div>
    </div>
  );
}
