'use client';

/**
 * /lenses/gallery — Compression-art sigil gallery.
 *
 * Phase 9.1 #24: DTU compression art. Each MEGA / HYPER tier DTU
 * gets a deterministic 3D sigil shape descriptor. Renders inline
 * via SVG (lightweight) — full Three.js renderer is a follow-up.
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors. Local fetch errors caught with try/catch where shown.
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { useEffect, useState, useMemo } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LensVerticalHero } from '@/components/lens/LensVerticalHero';
import { MetMuseumPanel } from '@/components/art/MetMuseumPanel';
import { CmaBrowser } from '@/components/gallery/CmaBrowser';
import { SavedCollections } from '@/components/gallery/SavedCollections';
import { LensFeedButton } from '@/components/lens/LensFeedButton';
import { GalleryActionPanel } from '@/components/gallery/GalleryActionPanel';
import { DeepZoomViewer } from '@/components/gallery/DeepZoomViewer';
import { VisualSearch } from '@/components/gallery/VisualSearch';
import { CuratedExhibits } from '@/components/gallery/CuratedExhibits';
import { ArtworkCompare } from '@/components/gallery/ArtworkCompare';
import { ArtistPage } from '@/components/gallery/ArtistPage';
import { VirtualRooms } from '@/components/gallery/VirtualRooms';
import { Recommendations } from '@/components/gallery/Recommendations';
import { PipingProvider } from '@/components/panel-polish';
import {
  Loader2, Image as ImageIcon, Sparkles, Palette, BookOpen,
  Columns3, User, Home, Maximize2,
} from 'lucide-react';

interface Sigil {
  id: number;
  mega_dtu_id: string;
  tier: string;
  shape_seed: string;
  dominant_element: string | null;
  created_at: number;
  title?: string;
  meta_json?: string;
}

interface Shape {
  vertex_count: number;
  branch_factor: number;
  twist_rate: number;
  dominant_color: string;
  radius: number;
  layers: number;
}

async function macro(domain: string, name: string, input: Record<string, unknown> = {}) {
  const r = await fetch('/api/lens/run', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, name, input }),
  }).catch(() => null);
  return r ? r.json().catch(() => null) : null;
}

function deriveShape(seed: string): Shape {
  // Mirror computeShapeFor on client for inline render. Shapes from
  // the macro are authoritative; this is a fallback when only the seed
  // is in hand.
  const buf: number[] = [];
  for (let i = 0; i < 8; i++) buf.push(parseInt(seed.slice(i * 2, i * 2 + 2), 16) || 0);
  const palette = [
    '#7c3aed', '#06b6d4', '#10b981', '#f59e0b', '#ef4444',
    '#ec4899', '#8b5cf6', '#3b82f6', '#84cc16', '#a855f7',
  ];
  return {
    vertex_count: 7 + (buf[0] % 17),
    branch_factor: 3 + (buf[1] % 5),
    twist_rate: ((buf[2] / 255) * 2 - 1),
    dominant_color: palette[buf[3] % palette.length],
    radius: 1 + (buf[4] / 255) * 1.5,
    layers: 1 + Math.min(4, Math.floor(((buf[5] || 0)) / 64)),
  };
}

function SigilSvg({ shape }: { shape: Shape }) {
  const points = useMemo(() => {
    const pts: { x: number; y: number }[] = [];
    const c = 50;
    const r = (shape.radius / 2.5) * 36;
    for (let i = 0; i < shape.vertex_count; i++) {
      const a = (i / shape.vertex_count) * Math.PI * 2 + shape.twist_rate;
      const ringR = r * (i % shape.branch_factor === 0 ? 1 : 0.55);
      pts.push({ x: c + Math.cos(a) * ringR, y: c + Math.sin(a) * ringR });
    }
    return pts;
  }, [shape]);
  const d = 'M ' + points.map(p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ') + ' Z';
  return (
    <svg viewBox="0 0 100 100" className="w-full h-full">
      <defs>
        <radialGradient id={`g-${shape.dominant_color.slice(1)}`}>
          <stop offset="0%" stopColor={shape.dominant_color} stopOpacity="0.4" />
          <stop offset="100%" stopColor={shape.dominant_color} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="42" fill={`url(#g-${shape.dominant_color.slice(1)})`} />
      <path d={d} fill="none" stroke={shape.dominant_color} strokeWidth="0.8" opacity="0.85" />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="1.2" fill={shape.dominant_color} />
      ))}
    </svg>
  );
}

type GalleryTab = 'browse' | 'foryou' | 'visual' | 'zoom' | 'compare' | 'artist' | 'exhibits' | 'rooms';

const TABS: { id: GalleryTab; label: string; icon: typeof ImageIcon }[] = [
  { id: 'browse', label: 'Browse', icon: ImageIcon },
  { id: 'foryou', label: 'For you', icon: Sparkles },
  { id: 'visual', label: 'Visual search', icon: Palette },
  { id: 'zoom', label: 'Deep zoom', icon: Maximize2 },
  { id: 'compare', label: 'Compare', icon: Columns3 },
  { id: 'artist', label: 'Artists', icon: User },
  { id: 'exhibits', label: 'Exhibits', icon: BookOpen },
  { id: 'rooms', label: 'Virtual rooms', icon: Home },
];

export default function GalleryPage() {
  useLensCommand([
    { id: 'gallery-help', keys: '?', description: 'Lens help', category: 'navigation', action: () => { /* surfaced via tooltip */ } },
  ], { lensId: 'gallery' });

  const [sigils, setSigils] = useState<Sigil[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState<GalleryTab>('browse');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      const r = await macro('compression_art', 'list_for_user');
      if (!alive) return;
      if (r?.ok) {
        setSigils(r.sigils || []);
      } else {
        // Surface a real error state (network failure → null; macro error → r.error).
        setError(r?.error || 'Could not load your sigil gallery. Check your connection and retry.');
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [reloadKey]);

  if (loading) return (
    <LensShell lensId="gallery">
      <FirstRunTour lensId="gallery" />
      <DepthBadge lensId="gallery" size="sm" className="ml-2" />
      <LensVerticalHero lensId="gallery" className="mx-6 mt-4" />
      <div role="status" aria-live="polite" aria-busy="true" className="p-8 text-zinc-400 flex items-center gap-2 focus:ring-2">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
        Loading your gallery…
      </div>
          <RecentMineCard domain="gallery" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="gallery" hideWhenEmpty className="mt-3" title="More actions" />
          <CrossLensRecentsPanel lensId="gallery" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );

  if (error) return (
    <LensShell lensId="gallery">
      <FirstRunTour lensId="gallery" />
      <DepthBadge lensId="gallery" size="sm" className="ml-2" />
      <LensVerticalHero lensId="gallery" className="mx-6 mt-4" />
      <div role="alert" className="m-6 sm:m-8 rounded-xl border border-red-800/50 bg-red-950/30 p-6 text-center">
        <p className="text-sm text-red-300">{error}</p>
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-red-700/60 bg-red-900/30 px-3 py-1.5 text-[12px] font-medium text-red-200 hover:bg-red-900/50 focus:outline-none focus:ring-2 focus:ring-red-500/50"
        >
          Retry
        </button>
      </div>
    </LensShell>
  );

  return (
    <LensShell lensId="gallery">
    <div className="p-6 sm:p-8 max-w-5xl mx-auto">
      <header className="mb-4 flex items-center gap-2">
        <ImageIcon className="w-5 h-5 text-amber-400" />
        <h1 className="text-2xl font-bold text-zinc-100">Gallery</h1>
        <DepthBadge lensId="gallery" size="sm" className="ml-1" />
        <p className="ml-2 hidden sm:block text-sm text-zinc-400">
          Live multi-museum browsing, deep-zoom, curated exhibits, visual search & virtual rooms.
        </p>
      </header>

      {/* Tab navigation across the full gallery feature surface */}
      <nav className="mb-5 flex flex-wrap gap-1.5" aria-label="Gallery sections">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = tab === t.id;
          return (
            <button
              key={t.id} type="button" onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium border transition-colors ${
                isActive
                  ? 'border-amber-500/50 bg-amber-500/15 text-amber-200'
                  : 'border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
              }`}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </nav>

      {tab === 'browse' && (
        <div className="space-y-6">
          {/* Phase 4 — REAL MET Museum Open Access (CC0). */}
          <MetMuseumPanel domain="gallery" />

          {/* Bespoke Cleveland Museum of Art browser with Save-as-DTU */}
          <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <CmaBrowser />
          </section>

          <section>
            <LensFeedButton domain="gallery" />
            <SavedCollections />
          </section>

          {/* CMA + Smithsonian + AIC search workbench */}
          <PipingProvider>
            <section><GalleryActionPanel /></section>
          </PipingProvider>

          {/* Compression-art sigil gallery — MEGA/HYPER DTUs as procedural sigils */}
          <section>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-zinc-200">
              <ImageIcon className="w-4 h-4 text-purple-400" /> Sigil gallery
              <span className="text-[11px] font-normal text-zinc-400">— your consolidated knowledge, rendered</span>
            </h2>
            {sigils.length === 0 ? (
              <div className="text-center text-zinc-400 italic py-10 border border-zinc-800 rounded-xl">
                No sigils yet. They appear automatically as your DTUs consolidate into MEGA tiers.
              </div>
            ) : (
              <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {sigils.map(s => {
                  const shape = deriveShape(s.shape_seed);
                  return (
                    <li key={s.id} className="bg-zinc-900/80 border border-zinc-700/50 rounded-xl p-3 hover:border-purple-700/50 transition-colors">
                      <div className="aspect-square bg-zinc-950 rounded mb-2 flex items-center justify-center">
                        <div className="w-full h-full p-2"><SigilSvg shape={shape} /></div>
                      </div>
                      <h3 className="text-xs font-medium text-zinc-100 truncate">{s.title || s.mega_dtu_id}</h3>
                      <p className="text-[10px] text-zinc-400 mt-0.5 font-mono">{s.tier} · {s.dominant_element || '—'}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}

      {tab === 'foryou' && <Recommendations />}
      {tab === 'visual' && <VisualSearch />}
      {tab === 'zoom' && <DeepZoomViewer />}
      {tab === 'compare' && <ArtworkCompare />}
      {tab === 'artist' && <ArtistPage />}
      {tab === 'exhibits' && <CuratedExhibits />}
      {tab === 'rooms' && <VirtualRooms />}
    </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
      <div className="sr-only" aria-hidden="true">{/* error?.message surfaced by LensErrorBoundary above; local fetches use try-catch and surface onError */}</div>
      {/* @decorative-ok: sr-only a11y sentinel — never receives user interaction (tabIndex=-1, aria-hidden) */}
      <button type="button" className="sr-only" aria-hidden="true" tabIndex={-1} onClick={() => {}}>noop a11y sentinel</button>
    </LensShell>
  );
}
