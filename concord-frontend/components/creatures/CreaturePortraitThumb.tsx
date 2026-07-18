'use client';

// CreaturePortraitThumb — the honest procedural creature "portrait."
//
// Concord's creature system is body-plan-based (topology + mass + height +
// a real tree of parts from server/lib/procedural-creature.js), not
// 2D-art-based — there is no art asset pipeline and no real-world reference
// photography this could honestly draw from. Reaching for an image model
// here would be fabrication (nothing real for it to be grounded in).
//
// What's real: server/lib/creature-portrait.js#buildCreaturePortraitSvg
// renders the species' actual body-plan geometry (real topology, real
// mass/height-derived part dimensions, real part count, the real coatColor
// hash) as a deterministic SVG schematic — same species always renders the
// identical SVG. This component fetches that SVG via the `creatures.portrait`
// macro and displays it, framed explicitly as a "procedural schematic," not
// concept art or a photographic likeness.
//
// A per-key module-level cache dedupes fetches when the same species_id
// appears in multiple rows (e.g. one species across several biome
// populations) — one network call per distinct species, not one per row.

import { useEffect, useState } from 'react';
import { Dna } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface PortraitResult {
  ok: boolean;
  svg?: string;
  params?: {
    topology?: string;
    massKg?: number;
    heightM?: number;
    partCount?: number;
  };
  reason?: string;
}

const portraitCache = new Map<string, Promise<PortraitResult>>();

function fetchPortrait(speciesId: string, dominant?: string | null, variant?: string | null): Promise<PortraitResult> {
  const key = `${speciesId}|${dominant || ''}|${variant || ''}`;
  const cached = portraitCache.get(key);
  if (cached) return cached;
  const p = lensRun('creatures', 'portrait', { species_id: speciesId, dominant, variant })
    .then((r) => (r?.data?.result as PortraitResult | null) || { ok: false, reason: 'no_response' })
    .catch((e) => ({ ok: false, reason: e instanceof Error ? e.message : 'fetch_failed' }));
  portraitCache.set(key, p);
  return p;
}

interface CreaturePortraitThumbProps {
  speciesId: string;
  dominant?: string | null;
  variant?: string | null;
  /** Square size in pixels. Default 40 (list-row scale); pass a larger value for a feature spot. */
  size?: number;
  className?: string;
}

export function CreaturePortraitThumb({ speciesId, dominant, variant, size = 40, className = '' }: CreaturePortraitThumbProps) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [svg, setSvg] = useState<string | null>(null);
  const [label, setLabel] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    setSvg(null);
    if (!speciesId) { setState('error'); return; }
    fetchPortrait(speciesId, dominant, variant).then((r) => {
      if (cancelled) return;
      if (r.ok && r.svg) {
        setSvg(r.svg);
        const p = r.params;
        setLabel(p ? `${speciesId} — ${p.topology || 'creature'}, ${p.massKg ? Math.round(p.massKg) : '?'}kg` : speciesId);
        setState('ready');
      } else {
        setState('error');
      }
    });
    return () => { cancelled = true; };
  }, [speciesId, dominant, variant]);

  const dim = { width: size, height: size };

  if (state === 'loading') {
    return (
      <div
        style={dim}
        role="status"
        aria-label={`Loading procedural portrait for ${speciesId}`}
        className={`flex-shrink-0 animate-pulse rounded border border-zinc-800 bg-zinc-900/60 ${className}`}
      />
    );
  }

  if (state === 'error' || !svg) {
    // Honest fallback — no fabricated art, just a neutral placeholder icon.
    // This is the correct empty state when the macro genuinely has nothing
    // (e.g. an unresolvable species id), never a stock silhouette pretending
    // to be that species.
    return (
      <div
        style={dim}
        title={`No procedural portrait for ${speciesId}`}
        className={`flex flex-shrink-0 items-center justify-center rounded border border-dashed border-zinc-800 bg-zinc-900/30 text-zinc-700 ${className}`}
      >
        <Dna size={Math.round(size * 0.4)} aria-hidden />
      </div>
    );
  }

  return (
    <div
      style={dim}
      title={`${label} · procedural body-plan schematic`}
      className={`flex-shrink-0 overflow-hidden rounded border border-zinc-800 bg-zinc-950 [&>svg]:h-full [&>svg]:w-full ${className}`}
      // The injected markup is server-generated from a pure, deterministic
      // renderer (server/lib/creature-portrait.js) driven only by numeric
      // body-plan params — never from user-supplied text — so this is safe.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
