'use client';

// Phase DB5 — Farm tile editor.
// Renders a 5×5 tile grid for the building. Empty tile → seed picker.
// Ripe tile (growth_stage=3) → harvest. Growing tiles show stage glyph.

import { useCallback, useEffect, useState } from 'react';
import { Sprout, Wheat, Loader2 } from 'lucide-react';
import { StationOverlayShell } from './_StationOverlayShell';
import type { OverlayProps } from './StationInteractionRouter';
import { successJuice, failureJuice, milestoneJuice } from '@/lib/concordia/juice';
import { playActionAtPlayer } from '@/lib/concordia/play-action';

interface Crop {
  claim_id: string;
  tile_x: number;
  tile_y: number;
  crop_kind: string;
  growth_stage: number;
}

interface CatalogEntry {
  id: string;
  name?: string;
  yield: number;
  growth_days: number;
  seasons: number[];
}

const GRID_W = 5;
const GRID_H = 5;

export function FarmTileEditor({ building, onClose, worldId }: OverlayProps) {
  const [crops, setCrops] = useState<Crop[]>([]);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/farming/building/${building.id}`, { credentials: 'include' });
      const j = await r.json();
      if (j?.ok) {
        setCrops(j.crops || []);
        setCatalog(j.catalog || []);
      }
    } catch { /* swallow */ }
  }, [building.id]);

  useEffect(() => { refresh(); }, [refresh]);

  const tileMap = new Map<string, Crop>();
  for (const c of crops) tileMap.set(`${c.tile_x}:${c.tile_y}`, c);

  const plant = useCallback(async (cropKind: string) => {
    if (!picker) return;
    setPending(true);
    try {
      const r = await fetch(`/api/farming/building/${building.id}/plant`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tileX: picker.x, tileY: picker.y, cropKind }),
      });
      const j = await r.json();
      if (j?.ok) {
        playActionAtPlayer('plant');
        successJuice('ui_seed_plant');
        setMsg(`planted ${cropKind}`);
        setPicker(null);
        refresh();
      } else {
        failureJuice();
        setMsg(j?.error || 'plant_failed');
      }
    } finally { setPending(false); }
  }, [picker, building.id, refresh]);

  const harvest = useCallback(async (x: number, y: number) => {
    setPending(true);
    try {
      const r = await fetch(`/api/farming/building/${building.id}/harvest`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tileX: x, tileY: y }),
      });
      const j = await r.json();
      if (j?.ok) {
        playActionAtPlayer('harvest');
        milestoneJuice('ui_crop_harvest');
        setMsg(`harvested ${j.harvested?.quantity ?? 1} × ${j.harvested?.itemId}`);
        refresh();
      } else {
        failureJuice();
        setMsg(j?.error || 'harvest_failed');
      }
    } finally { setPending(false); }
  }, [building.id, refresh]);

  const onTileClick = (x: number, y: number) => {
    const t = tileMap.get(`${x}:${y}`);
    if (!t) setPicker({ x, y });
    else if (t.growth_stage >= 3) harvest(x, y);
  };

  return (
    <StationOverlayShell
      title={building.name || 'Farm plot'}
      subtitle={`farm_plot · ${worldId}`}
      onClose={onClose}
      accent="emerald"
      size="lg"
    >
      <div className="space-y-3">
        <div className="grid gap-1 mx-auto" style={{ gridTemplateColumns: `repeat(${GRID_W}, 1fr)`, width: 'max-content' }}>
          {Array.from({ length: GRID_H }, (_, y) =>
            Array.from({ length: GRID_W }, (_, x) => {
              const t = tileMap.get(`${x}:${y}`);
              const ripe = t && t.growth_stage >= 3;
              const stage = t?.growth_stage ?? -1;
              return (
                <button
                  key={`${x}:${y}`}
                  onClick={() => onTileClick(x, y)}
                  disabled={pending}
                  className={[
                    'h-14 w-14 rounded border text-xs font-mono transition',
                    !t
                      ? 'border-emerald-500/20 bg-emerald-950/30 text-emerald-300/50 hover:border-emerald-400/60 hover:bg-emerald-900/40'
                      : ripe
                      ? 'border-amber-400/70 bg-amber-500/30 text-amber-100 hover:bg-amber-500/50'
                      : 'border-emerald-500/40 bg-emerald-900/40 text-emerald-200',
                  ].join(' ')}
                  title={t ? `${t.crop_kind} · stage ${stage}/3` : 'empty'}
                >
                  {!t ? <Sprout className="mx-auto opacity-30" size={14} /> : ripe ? <Wheat className="mx-auto" size={18} /> : <span>{stage}/3</span>}
                </button>
              );
            })
          ).flat()}
        </div>

        <div className="text-center text-[11px] text-zinc-400">
          {pending && <Loader2 className="inline animate-spin" size={11} />} {msg || 'click empty to plant · click ripe to harvest'}
        </div>

        {picker && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/40 p-3">
            <div className="mb-2 flex items-center justify-between text-xs text-emerald-200">
              <span>plant @ ({picker.x},{picker.y})</span>
              <button onClick={() => setPicker(null)} className="text-emerald-400/70 hover:text-emerald-200">×</button>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {catalog.slice(0, 9).map((c) => (
                <button
                  key={c.id}
                  onClick={() => plant(c.id)}
                  disabled={pending}
                  className="rounded border border-emerald-500/20 bg-emerald-900/30 p-1.5 text-left text-[11px] hover:border-emerald-400/60 hover:bg-emerald-800/40 disabled:opacity-50"
                >
                  <div className="font-semibold text-emerald-100">{c.name || c.id}</div>
                  <div className="text-[9px] text-emerald-300/70">{c.growth_days}d · ×{c.yield}</div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </StationOverlayShell>
  );
}
