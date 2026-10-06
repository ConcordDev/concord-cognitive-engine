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

import { useCallback, useEffect, useState, useMemo } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { cn } from '@/lib/utils';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
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
  Columns3, User, Home, Maximize2, Plus, RefreshCw,
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
  const j = r ? await r.json().catch(() => null) : null;
  // POST /api/lens/run wraps the macro's own payload in a transport
  // envelope `{ ok: true, result: PAYLOAD }` — unwrap to the payload so
  // callers can read the macro's real ok/error/sigils fields.
  return j?.result ?? j;
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

const TABS: { id: GalleryTab; label: string; keys: string; title: string; hint: string; icon: typeof ImageIcon }[] = [
  { id: 'browse', label: 'Browse', keys: '1', title: 'The wall', hint: 'Museum collections, saved works and your sigils', icon: ImageIcon },
  { id: 'foryou', label: 'For you', keys: '2', title: 'Hung for you', hint: 'Recommendations from what you save', icon: Sparkles },
  { id: 'visual', label: 'Visual search', keys: '3', title: 'Find it by eye', hint: 'Search by color and look', icon: Palette },
  { id: 'zoom', label: 'Deep zoom', keys: '4', title: 'Closer than the gallery allows', hint: 'Deep-zoom viewer', icon: Maximize2 },
  { id: 'compare', label: 'Compare', keys: '5', title: 'Two works, side by side', hint: 'Compare artworks', icon: Columns3 },
  { id: 'artist', label: 'Artists', keys: '6', title: 'The hands behind the work', hint: 'Artist pages', icon: User },
  { id: 'exhibits', label: 'Exhibits', keys: '7', title: 'Curated exhibits', hint: 'Curated exhibits', icon: BookOpen },
  { id: 'rooms', label: 'Virtual rooms', keys: '8', title: 'Walk the rooms', hint: 'Virtual rooms', icon: Home },
];

export default function GalleryPage() {
  useLensNav('gallery');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [sigils, setSigils] = useState<Sigil[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState<GalleryTab>('browse');

  const hangWork = useCallback(() => {
    setTab('browse');
    let tries = 0;
    const focus = () => {
      const el = document.querySelector<HTMLInputElement>('[data-lens-theme="gallery"] input[type="text"], [data-lens-theme="gallery"] input[type="search"], [data-lens-theme="gallery"] input:not([type])');
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus(); return; }
      if (++tries < 20) requestAnimationFrame(focus);
    };
    requestAnimationFrame(focus);
  }, []);

  useLensCommand(
    [
      ...TABS.map((t) => ({
        id: `tab-${t.id}`,
        keys: t.keys,
        description: `${t.label} — ${t.hint}`,
        category: 'navigation' as const,
        action: () => setTab(t.id),
      })),
      { id: 'gallery-hang', keys: 'n', description: 'Hang a work (search museums to save)', category: 'actions' as const, action: hangWork },
    ],
    { lensId: 'gallery' },
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await macro('compression_art', 'list_for_user');
      if (!alive) return;
      if (r?.ok) {
        setSigils(r.sigils || []);
        setError(null);
      } else {
        setError(r?.error || 'Could not load your sigil gallery. Check your connection and retry.');
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [reloadKey]);

  const current = TABS.find((t) => t.id === tab)!;

  return (
    <LensShell lensId="gallery" asMain={false}>
      <FirstRunTour lensId="gallery" />
      <DepthBadge lensId="gallery" size="sm" className="ml-2" />
      <div data-lens-theme="gallery" className="relative min-h-full px-8 pb-28 pt-6">
        <p className="text-[14px] text-zinc-500">Gallery</p>
        <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
          {current.title}{tab === 'browse' && who ? `, ${who}` : ''}
        </h1>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Gallery sections">
          {TABS.map((t) => {
            const Icon = t.icon;
            const on = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={on ? 'page' : undefined}
                title={`${t.hint} (${t.keys})`}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
                <kbd aria-hidden="true" className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{t.keys}</kbd>
              </button>
            );
          })}
        </nav>

        {tab === 'browse' && (
          <div className="space-y-6">
            <MetMuseumPanel domain="gallery" />

            <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
              <CmaBrowser />
            </section>

            <section>
              <LensFeedButton domain="gallery" />
              <SavedCollections />
            </section>

            <PipingProvider>
              <section><GalleryActionPanel /></section>
            </PipingProvider>

            <section>
              <h2 className="mb-3 flex items-center gap-2 text-[15px] font-medium text-zinc-200">
                <ImageIcon className="h-4 w-4 text-teal-300" /> Sigil gallery
                <span className="text-[12px] font-normal text-zinc-500">your consolidated knowledge, rendered</span>
                <button
                  type="button"
                  onClick={() => { setLoading(true); setReloadKey((k) => k + 1); }}
                  aria-label="Reload sigils"
                  title="Reload sigils"
                  className="ml-auto rounded-full border border-white/10 bg-white/[0.03] p-1.5 text-zinc-400 transition-colors hover:text-zinc-100"
                >
                  <RefreshCw className="h-3 w-3" />
                </button>
              </h2>
              {loading ? (
                <div role="status" aria-live="polite" aria-busy="true" className="flex items-center gap-2 rounded-2xl border border-white/10 bg-[#111] p-6 text-[14px] text-zinc-400">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading your sigils…
                </div>
              ) : error ? (
                <div role="alert" className="rounded-2xl border border-red-800/50 bg-red-950/30 p-5 text-center">
                  <p className="text-[14px] text-red-300">{error}</p>
                  <button
                    type="button"
                    onClick={() => { setLoading(true); setReloadKey((k) => k + 1); }}
                    className="mt-3 rounded-full border border-red-700/60 bg-red-900/30 px-4 py-1.5 text-[13px] font-medium text-red-200 hover:bg-red-900/50"
                  >
                    Retry
                  </button>
                </div>
              ) : sigils.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-[#111] py-10 text-center text-[14px] text-zinc-400">
                  No sigils yet. They appear automatically as your DTUs consolidate into MEGA tiers.
                </div>
              ) : (
                <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
                  {sigils.map((sg) => {
                    const shape = deriveShape(sg.shape_seed);
                    return (
                      <li key={sg.id} className="rounded-2xl border border-white/10 bg-[#111] p-3 transition-colors hover:border-white/20">
                        <div className="mb-2 flex aspect-square items-center justify-center rounded-xl bg-black/40">
                          <div className="h-full w-full p-2"><SigilSvg shape={shape} /></div>
                        </div>
                        <h3 className="truncate text-[13px] font-medium text-zinc-100">{sg.title || sg.mega_dtu_id}</h3>
                        <p className="mt-0.5 font-mono text-[11px] text-zinc-500">{sg.tier} · {sg.dominant_element || '—'}</p>
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

        <CrossLensRecentsPanel lensId="gallery" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={hangWork}
          title="Hang a work (N)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Plus className="h-4 w-4" />
          Hang a work
        </button>
      </div>
    </LensShell>
  );
}
