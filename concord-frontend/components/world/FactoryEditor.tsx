'use client';

// Phase DB12 — Per-claim factory editor.
// Renders a 10×8 tile grid for an owned land_claim. Click empty tile →
// chest/belt/crafter picker → place. Click two entities → connect them
// (sets source.connections). Right-click → remove. Polls /api/factory/claim
// at 1Hz for live state.

import { useCallback, useEffect, useState } from 'react';
import { Box, ArrowRight, Cog, Loader2 } from 'lucide-react';
import type { LucideIcon } from "lucide-react";
import { StationOverlayShell } from './_StationOverlayShell';
import type { OverlayProps } from './StationInteractionRouter';

const GRID_W = 10;
const GRID_H = 8;

interface Entity {
  id: string;
  claim_id: string;
  entity_type: 'chest' | 'belt' | 'crafter';
  tile_x: number;
  tile_y: number;
  rotation: number;
  connections_json: string;
}

interface Claim { id: string; world_id: string; name?: string; }

const ICON: Record<string, LucideIcon> = {
  chest: Box, belt: ArrowRight, crafter: Cog,
};

export function FactoryEditor({ building, onClose, worldId }: OverlayProps) {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [claimId, setClaimId] = useState<string | null>(null);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Load claims via macro lens-run.
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/lens/run', {
          method: 'POST', credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ domain: 'land_claims', name: 'list_for_user', input: {} }),
        });
        const j = await r.json();
        const list = j?.data?.claims || j?.claims || [];
        const inWorld = list.filter((c: Claim) => !c.world_id || c.world_id === worldId);
        setClaims(inWorld);
        if (inWorld.length === 1) setClaimId(inWorld[0].id);
      } catch { /* swallow */ }
    })();
  }, [worldId]);

  const refresh = useCallback(async () => {
    if (!claimId) return;
    try {
      const j = await fetch(`/api/factory/claim/${claimId}`, { credentials: 'include' }).then(r => r.json());
      if (j?.ok) setEntities(j.entities || []);
    } catch { /* swallow */ }
  }, [claimId]);

  useEffect(() => {
    if (!claimId) return;
    refresh();
    const t = setInterval(refresh, 1000);
    return () => clearInterval(t);
  }, [claimId, refresh]);

  const entityMap = new Map<string, Entity>();
  for (const e of entities) entityMap.set(`${e.tile_x}:${e.tile_y}`, e);

  const place = useCallback(async (entityType: string) => {
    if (!picker || !claimId) return;
    setPending(true);
    try {
      const r = await fetch('/api/factory/place', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ claimId, entityType, tileX: picker.x, tileY: picker.y }),
      });
      const j = await r.json();
      if (j?.ok) { setMsg(`placed ${entityType}`); setPicker(null); refresh(); }
      else setMsg(j?.error || 'place_failed');
    } finally { setPending(false); }
  }, [picker, claimId, refresh]);

  const remove = useCallback(async (entityId: string) => {
    setPending(true);
    try {
      await fetch(`/api/factory/remove/${entityId}`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' }, body: '{}',
      });
      refresh();
    } finally { setPending(false); }
  }, [refresh]);

  const connect = useCallback(async (targetId: string) => {
    if (!connectFrom) return;
    setPending(true);
    try {
      const r = await fetch('/api/factory/connect', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceId: connectFrom, targetId }),
      });
      const j = await r.json();
      if (j?.ok) { setMsg('connected'); refresh(); }
      else setMsg(j?.error || 'connect_failed');
      setConnectFrom(null);
    } finally { setPending(false); }
  }, [connectFrom, refresh]);

  const onTileClick = (x: number, y: number) => {
    const e = entityMap.get(`${x}:${y}`);
    if (e) {
      if (connectFrom === e.id) setConnectFrom(null);
      else if (connectFrom) connect(e.id);
      else setConnectFrom(e.id);
    } else if (!connectFrom) {
      setPicker({ x, y });
    }
  };

  const onTileContextMenu = (e: React.MouseEvent, x: number, y: number) => {
    e.preventDefault();
    const ent = entityMap.get(`${x}:${y}`);
    if (ent) remove(ent.id);
  };

  if (!claimId) {
    return (
      <StationOverlayShell title={building.name || 'Factory workbench'} subtitle="pick a claim" onClose={onClose} accent="slate" size="full">
        {claims.length === 0 ? (
          <p className="py-6 text-center text-zinc-500 text-sm">You don't own a claim in this world. Claim land first via the housing lens.</p>
        ) : (
          <div className="space-y-1">
            {claims.map((c) => (
              <button key={c.id} onClick={() => setClaimId(c.id)} className="block w-full rounded border border-slate-500/30 bg-slate-900/40 p-2 text-left hover:border-slate-400/60">
                <div className="text-sm text-slate-100">{c.name || c.id}</div>
                <div className="text-[10px] text-slate-400">{c.id}</div>
              </button>
            ))}
          </div>
        )}
      </StationOverlayShell>
    );
  }

  return (
    <StationOverlayShell
      title={building.name || 'Factory workbench'}
      subtitle={`claim ${claimId.slice(0, 12)} · ${entities.length} entities`}
      onClose={onClose}
      accent="slate"
      size="full"
    >
      <div className="space-y-3">
        <div className="text-center text-[11px] text-zinc-400">
          left-click empty: place · left-click entity: select for connect · right-click: remove
          {connectFrom && <span className="ml-2 text-emerald-300">· selected for connect</span>}
        </div>

        <div className="grid mx-auto gap-0.5" style={{ gridTemplateColumns: `repeat(${GRID_W}, 1fr)`, width: 'max-content' }}>
          {Array.from({ length: GRID_H }, (_, y) =>
            Array.from({ length: GRID_W }, (_, x) => {
              const e = entityMap.get(`${x}:${y}`);
              const Icon = e ? ICON[e.entity_type] : null;
              const selected = e?.id === connectFrom;
              return (
                <button
                  key={`${x}:${y}`}
                  onClick={() => onTileClick(x, y)}
                  onContextMenu={(ev) => onTileContextMenu(ev, x, y)}
                  disabled={pending}
                  className={[
                    'h-10 w-10 rounded border text-xs transition flex items-center justify-center',
                    !e
                      ? 'border-slate-700 bg-slate-950/50 hover:border-slate-500 hover:bg-slate-800'
                      : selected
                      ? 'border-emerald-400 bg-emerald-500/40 text-emerald-100'
                      : e.entity_type === 'chest'
                      ? 'border-amber-500/40 bg-amber-900/40 text-amber-200'
                      : e.entity_type === 'belt'
                      ? 'border-cyan-500/40 bg-cyan-900/40 text-cyan-200'
                      : 'border-violet-500/40 bg-violet-900/40 text-violet-200',
                  ].join(' ')}
                  title={e ? `${e.entity_type} @ (${x},${y})` : `empty (${x},${y})`}
                >
                  {Icon ? <Icon size={14} /> : null}
                </button>
              );
            })
          ).flat()}
        </div>

        {msg && <div className="text-center text-[10px] text-amber-200">{msg}</div>}
        {pending && <Loader2 className="mx-auto animate-spin text-slate-400" size={12} />}

        {picker && (
          <div className="mx-auto max-w-md rounded-lg border border-slate-500/30 bg-slate-950/50 p-3">
            <div className="mb-2 flex items-center justify-between text-xs text-slate-200">
              <span>place @ ({picker.x},{picker.y})</span>
              <button onClick={() => setPicker(null)} className="text-slate-400 hover:text-slate-100">×</button>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {(['chest', 'belt', 'crafter'] as const).map((t) => {
                const Icon = ICON[t];
                return (
                  <button key={t} onClick={() => place(t)} disabled={pending} className="rounded border border-slate-500/30 bg-slate-800/50 p-2 hover:border-slate-300/60 hover:bg-slate-700/50 disabled:opacity-50">
                    <Icon size={18} className="mx-auto" />
                    <div className="mt-1 text-center text-[10px] text-slate-200">{t}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </StationOverlayShell>
  );
}
