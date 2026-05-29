'use client';

// Phase DC10 — Glyph spell composer.
// Loads the 10-entry seed glyph component library, lets the player drag
// (click-add) components into a chain, previews via /compose, mints via
// /mint.

import { useCallback, useEffect, useState } from 'react';
import { X, Wand2, Loader2 } from 'lucide-react';
import { StationOverlayShell } from './_StationOverlayShell';
import type { OverlayProps } from './StationInteractionRouter';
import { milestoneJuice, sfx } from '@/lib/concordia/juice';

interface Component {
  id: string;
  name?: string;
  glyph: string;
  element: string;
  effect?: string;
  cost_mana?: number;
  base_damage?: number;
}

interface ComposeResult {
  ok: boolean;
  composed_glyph?: string;
  element?: string;
  max_damage?: number;
  range_m?: number;
  costs?: { mana?: number; };
  narrative?: string;
  reason?: string;
}

export function GlyphSpellComposer({ building, onClose, worldId }: OverlayProps) {
  const [components, setComponents] = useState<Component[]>([]);
  const [chain, setChain] = useState<string[]>([]);
  const [preview, setPreview] = useState<ComposeResult | null>(null);
  const [spellName, setSpellName] = useState('');
  const [minted, setMinted] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const j = await fetch('/api/glyph-spells/components', { credentials: 'include' }).then(r => r.json());
        if (j?.ok) setComponents(j.components || []);
      } catch { /* swallow */ }
    })();
  }, []);

  const compose = useCallback(async (componentIds: string[]) => {
    if (componentIds.length < 2) { setPreview(null); return; }
    try {
      const r = await fetch('/api/glyph-spells/compose', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chain: componentIds }),
      });
      const j = await r.json();
      setPreview(j);
    } catch { /* swallow */ }
  }, []);

  const add = (id: string) => {
    const next = [...chain, id];
    setChain(next);
    compose(next);
  };
  const remove = (i: number) => {
    const next = chain.filter((_, idx) => idx !== i);
    setChain(next);
    compose(next);
  };

  const mint = useCallback(async () => {
    if (chain.length < 2 || !preview?.ok) return;
    setPending(true);
    try {
      const r = await fetch('/api/glyph-spells/mint', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          componentIds: chain,
          worldId,
          name: spellName.trim() || `${preview.composed_glyph || 'spell'}-${Date.now() % 10000}`,
        }),
      });
      const j = await r.json();
      if (j?.ok) {
        milestoneJuice('ui_glyph_mint');
        setMinted(j.spellId || j.dtuId || 'minted');
        setChain([]); setSpellName(''); setPreview(null);
      } else {
        sfx('ui_glyph_mint_failed');
      }
    } finally { setPending(false); }
  }, [chain, preview, worldId, spellName]);

  return (
    <StationOverlayShell
      title={building.name || 'Glyph altar'}
      subtitle={`glyph_altar · ${worldId}`}
      onClose={onClose}
      accent="violet"
      size="lg"
    >
      <div className="space-y-3">
        <div>
          <div className="mb-1 text-[10px] uppercase text-violet-300/70">component library ({components.length})</div>
          <div className="grid grid-cols-5 gap-1">
            {components.map((c) => (
              <button
                key={c.id}
                onClick={() => add(c.id)}
                title={c.effect || c.name}
                className="rounded border border-violet-500/30 bg-violet-950/30 p-2 text-center hover:border-violet-300/60 hover:bg-violet-900/40"
              >
                <div className="text-2xl text-violet-100">{c.glyph}</div>
                <div className="text-[9px] text-violet-300/80">{c.element}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1 text-[10px] uppercase text-violet-300/70">chain ({chain.length})</div>
          <div className="flex min-h-[40px] flex-wrap gap-1 rounded border border-violet-500/30 bg-violet-950/50 p-2">
            {chain.length === 0 && <span className="text-[10px] text-zinc-500">click components to compose</span>}
            {chain.map((id, i) => {
              const c = components.find((x) => x.id === id);
              return (
                <button
                  key={i}
                  onClick={() => remove(i)}
                  className="flex items-center gap-1 rounded bg-violet-500/30 px-2 py-1 text-xs text-violet-100 hover:bg-violet-500/50"
                >
                  <span className="text-base">{c?.glyph || '?'}</span>
                  <X size={10} />
                </button>
              );
            })}
          </div>
        </div>

        {preview && (
          <div className={['rounded border p-3 text-xs', preview.ok ? 'border-emerald-500/30 bg-emerald-950/30' : 'border-red-500/30 bg-red-950/30'].join(' ')}>
            {preview.ok ? (
              <>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-2xl text-emerald-100">{preview.composed_glyph}</span>
                  <span className="font-mono text-[10px] text-emerald-300/70">{preview.element}</span>
                </div>
                <div className="grid grid-cols-3 gap-1 text-center font-mono text-[10px] text-emerald-200">
                  <span>dmg {preview.max_damage}</span>
                  <span>range {preview.range_m}m</span>
                  <span>cost {preview.costs?.mana ?? '?'}</span>
                </div>
                {preview.narrative && <p className="mt-1 text-[10px] text-emerald-300/70">{preview.narrative}</p>}
              </>
            ) : (
              <span className="text-red-300">× {preview.reason}</span>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <input
            value={spellName}
            onChange={(e) => setSpellName(e.target.value)}
            placeholder="Spell name (optional)"
            className="flex-1 rounded border border-violet-500/30 bg-zinc-950 px-2 py-1.5 text-xs text-violet-100"
          />
          <button
            onClick={mint}
            disabled={pending || chain.length < 2 || !preview?.ok}
            className="flex items-center gap-1 rounded bg-violet-500/40 px-3 py-1.5 text-xs text-violet-50 hover:bg-violet-500/60 disabled:opacity-50"
          >
            {pending ? <Loader2 className="animate-spin" size={12} /> : <Wand2 size={12} />} Mint
          </button>
        </div>

        {minted && <div className="text-center text-[11px] text-amber-200">✦ minted: {minted}</div>}
      </div>
    </StationOverlayShell>
  );
}
