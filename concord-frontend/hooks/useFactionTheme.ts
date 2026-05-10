'use client';

/**
 * useFactionTheme — Sprint D / V1+AA1
 *
 * Reads faction visual data (Sprint D V1) and exposes CSS variables +
 * Tailwind-compatible style overrides so any HUD can theme to the
 * caller's faction context.
 *
 * Default fallback: lattice-neutral (no theming).
 *
 * Usage:
 *   const theme = useFactionTheme(factionId);
 *   <div style={theme.accentBorder}>...</div>
 *   <div className={theme.accentText}>...</div>
 */

import { useEffect, useState } from 'react';

interface FactionVisual {
  primary_color: string;   // hex
  secondary_color: string;
  accent_color: string;
  sigil_path?: string;
  architecture_style?: 'fortified' | 'gracile' | 'crystalline' | 'organic' | 'industrial';
  preferred_weapon_archetypes?: string[];
  preferred_armor_silhouette?: 'heavy_plate' | 'robed' | 'leather' | 'exposed';
  banner_sigil_id?: string;
  ornamentation_motifs?: string[];
}

interface FactionTheme {
  visual: FactionVisual | null;
  /** Inline-style border using accent_color. */
  accentBorder: React.CSSProperties;
  /** Inline-style background using primary_color at low alpha. */
  primaryBgFaint: React.CSSProperties;
  /** Inline-style text color using accent. */
  accentText: React.CSSProperties;
  /** Inline-style fill using accent for SVG. */
  accentFill: React.CSSProperties;
  /** CSS variable map ready for `<div style={...}>`. */
  cssVars: React.CSSProperties;
}

const DEFAULT_VISUAL: FactionVisual = {
  primary_color: '#1a3a5c',     // lattice-neutral fallback
  secondary_color: '#0c0c0c',
  accent_color: '#3b82f6',      // neon-blue fallback
};

const cache = new Map<string, FactionVisual | null>();

export function useFactionTheme(factionId: string | null | undefined): FactionTheme {
  const [visual, setVisual] = useState<FactionVisual | null>(
    factionId && cache.has(factionId) ? cache.get(factionId) ?? null : null,
  );

  useEffect(() => {
    if (!factionId) { setVisual(null); return; }
    if (cache.has(factionId)) { setVisual(cache.get(factionId) ?? null); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/lens/run', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain: 'factions', name: 'visual', input: { factionId } }),
        });
        if (!r.ok) { cache.set(factionId, null); return; }
        const j = await r.json();
        const v = (j?.visual as FactionVisual | undefined) ?? null;
        cache.set(factionId, v);
        if (!cancelled) setVisual(v);
      } catch { cache.set(factionId, null); }
    })();
    return () => { cancelled = true; };
  }, [factionId]);

  const v = visual || DEFAULT_VISUAL;
  return {
    visual: visual,
    accentBorder: { borderColor: v.accent_color },
    primaryBgFaint: { backgroundColor: hexAlpha(v.primary_color, 0.12) },
    accentText: { color: v.accent_color },
    accentFill: { fill: v.accent_color },
    cssVars: {
      ['--faction-primary' as string]: v.primary_color,
      ['--faction-secondary' as string]: v.secondary_color,
      ['--faction-accent' as string]: v.accent_color,
    } as React.CSSProperties,
  };
}

function hexAlpha(hex: string, alpha: number): string {
  if (!hex.startsWith('#') || (hex.length !== 7 && hex.length !== 4)) return hex;
  let r: number, g: number, b: number;
  if (hex.length === 4) {
    r = parseInt(hex[1] + hex[1], 16);
    g = parseInt(hex[2] + hex[2], 16);
    b = parseInt(hex[3] + hex[3], 16);
  } else {
    r = parseInt(hex.slice(1, 3), 16);
    g = parseInt(hex.slice(3, 5), 16);
    b = parseInt(hex.slice(5, 7), 16);
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export const FACTION_THEME_CONSTANTS = Object.freeze({
  DEFAULT_VISUAL,
});
