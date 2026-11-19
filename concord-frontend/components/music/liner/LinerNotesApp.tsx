'use client';

/**
 * Liner Notes — the Music lens. One navigation state, kept in the URL so the
 * browser's back button and shared links work: Listen Now, Search, Library,
 * For Artists, and the release / artist pages they lead to. Playback runs on
 * the platform's single player (the global Now Playing bar), so music keeps
 * going while you use other lenses.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Disc3, Library, Mic2, Search, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import LensAgentFab from '@/components/lens/LensAgentFab';
import { linerFontVars } from './linerFonts';
import { ListenNow } from './ListenNow';
import { SearchView } from './SearchView';
import { LibraryView, type LibraryTab } from './LibraryView';
import { ForArtists } from './ForArtists';
import { ReleasePage } from './ReleasePage';
import { ArtistPage } from './ArtistPage';
import { usePlayCounter } from './play';
import type { ArtistCard } from './linerApi';
import './linernotes.css';

type View = 'listen' | 'search' | 'library' | 'artists' | 'release' | 'artist';
export interface Nav { v: View; id?: string; h?: string; k?: string; q?: string; t?: string }

const ROOT: Array<{ v: View; label: string; icon: typeof Disc3 }> = [
  { v: 'listen', label: 'Listen Now', icon: Disc3 },
  { v: 'search', label: 'Search', icon: Search },
  { v: 'library', label: 'Library', icon: Library },
  { v: 'artists', label: 'For Artists', icon: Mic2 },
];
const VIEWS = new Set<View>(['listen', 'search', 'library', 'artists', 'release', 'artist']);

export function navFromSearch(search: string): Nav {
  const p = new URLSearchParams(search);
  const v = p.get('v') as View | null;
  const nav: Nav = { v: v && VIEWS.has(v) ? v : 'listen' };
  for (const k of ['id', 'h', 'k', 'q', 't'] as const) { const x = p.get(k); if (x) nav[k] = x.slice(0, 120); }
  if (nav.v === 'release' && !nav.id) nav.v = 'listen';
  if (nav.v === 'artist' && !nav.h && !nav.k) nav.v = 'listen';
  return nav;
}

export function searchFromNav(nav: Nav, current: string): string {
  const p = new URLSearchParams(current);
  for (const k of ['v', 'id', 'h', 'k', 'q', 't']) p.delete(k);
  if (nav.v !== 'listen') p.set('v', nav.v);
  for (const k of ['id', 'h', 'k', 'q', 't'] as const) if (nav[k]) p.set(k, nav[k]!);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function LinerNotesApp() {
  const [nav, setNav] = useState<Nav>(() => (typeof window === 'undefined' ? { v: 'listen' } : navFromSearch(window.location.search)));
  const [bump, setBump] = useState(0);

  const go = useCallback((next: Nav, replace = false) => {
    setNav(next);
    try {
      const url = `${window.location.pathname}${searchFromNav(next, window.location.search)}`;
      if (replace) window.history.replaceState(window.history.state, '', url);
      else window.history.pushState(window.history.state, '', url);
    } catch { /* noop */ }
    if (!replace) document.getElementById('ln-main')?.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    const onPop = () => setNav(navFromSearch(window.location.search));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // "/" jumps to search from anywhere in the lens (not while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== '/' || e.metaKey || e.ctrlKey || (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable))) return;
      e.preventDefault();
      go({ v: 'search' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  // Plays counted by the server refresh the page you are looking at (play counts, top songs).
  usePlayCounter(() => setBump((b) => b + 1));

  const openRelease = useCallback((id: string) => go({ v: 'release', id }), [go]);
  const openArtist = useCallback((a: ArtistCard) => go(a.handle ? { v: 'artist', h: a.handle } : { v: 'artist', k: a.key }), [go]);
  const artistParams = useMemo(() => (nav.h ? { handle: nav.h } : { artistKey: nav.k }), [nav.h, nav.k]);
  const onQuery = useCallback((q: string) => go({ v: 'search', q: q || undefined }, true), [go]);
  const rootOf = nav.v === 'release' || nav.v === 'artist' ? null : nav.v;

  return (
    <div className={cn('liner flex h-full min-h-0 w-full flex-col md:flex-row', linerFontVars)} data-lens="music">
      <nav aria-label="Music" className="flex flex-shrink-0 gap-1 overflow-x-auto border-b ln-rule px-2 py-2 md:w-56 md:flex-col md:overflow-visible md:border-b-0 md:border-r md:px-3 md:py-6">
        <p className="ln-serif hidden px-3 pb-4 text-2xl md:block">Music</p>
        {ROOT.map(({ v, label, icon: Icon }) => (
          <button key={v} type="button" onClick={() => go({ v })} aria-current={rootOf === v ? 'page' : undefined} className="ln-nav-item flex flex-shrink-0 items-center gap-2.5 px-3 py-2 text-sm" data-testid={`ln-nav-${v}`}>
            <Icon className="h-4 w-4" aria-hidden /> {label}
          </button>
        ))}
        <p className="mt-auto hidden px-3 pb-16 pt-6 text-[11px] leading-relaxed text-[color:var(--ln-faint)] md:block">Press / to search. Music keeps playing while you use the rest of Concord.</p>
      </nav>

      <main id="ln-main" className="relative min-h-0 min-w-0 flex-1 overflow-y-auto">
        {(nav.v === 'release' || nav.v === 'artist') && (
          <button type="button" onClick={() => window.history.back()} className="ln-btn ln-btn-quiet absolute left-3 top-3 z-10 h-8 w-8 sm:left-5" aria-label="Back">
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        {nav.v === 'listen' && <ListenNow onRelease={openRelease} onArtist={openArtist} onForArtists={() => go({ v: 'artists' })} />}
        {nav.v === 'search' && <SearchView initial={nav.q || ''} onQuery={onQuery} onRelease={openRelease} onArtist={openArtist} />}
        {nav.v === 'library' && <LibraryView initialTab={(['purchases', 'songs', 'playlists', 'recent', 'replay', 'sound'].includes(nav.t || '') ? nav.t : 'purchases') as LibraryTab} onTab={(t) => go({ v: 'library', t }, true)} onRelease={openRelease} onArtist={openArtist} />}
        {nav.v === 'artists' && <ForArtists onRelease={openRelease} onArtist={openArtist} focusId={nav.id || null} onFocus={(id) => go({ v: 'artists', id: id || undefined }, true)} />}
        {nav.v === 'release' && nav.id && <ReleasePage key={nav.id} id={nav.id} onArtist={openArtist} onRelease={openRelease} refreshKey={bump} />}
        {nav.v === 'artist' && <ArtistPage key={nav.h || nav.k} artist={artistParams} onRelease={openRelease} onArtist={openArtist} refreshKey={bump} />}
      </main>

      <LensAgentFab
        lensId="music"
        lensPrompt="You're inside Concord Music (Liner Notes): independent artists release music here and fans stream and buy it with Concord Coin. Help with discovering music, writing liner notes and credits, pricing and releasing music, and building playlists."
      />
    </div>
  );
}

export default LinerNotesApp;
