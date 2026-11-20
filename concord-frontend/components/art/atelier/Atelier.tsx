'use client';

/**
 * The Atelier — the Art lens. A north-lit painter's studio that opens straight
 * onto the canvas: your last piece, or a fresh one if you have none. Brushes
 * and colour sit in a tray on the left, the piece on the easel, and the studio
 * wall on the right (layers, the reference wall with museum search, colour,
 * studio tools, notes). Finished work sells through the Auction House: "Put on
 * sale" renders the canvas, files it as an image DTU and consigns it as a lot.
 * The open piece lives in the URL (?piece=), so links and back work.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { useLensNav } from '@/hooks/useLensNav';
import { cn } from '@/lib/utils';
import LensAgentFab from '@/components/lens/LensAgentFab';
import { ArtCanvas } from '../ArtCanvas';
import { ArtReferencesPanel } from '../ArtReferencesPanel';
import { MetMuseumPanel } from '../MetMuseumPanel';
import { ArtExplorer } from '../ArtExplorer';
import { ArtPalettesPanel } from '../ArtPalettesPanel';
import { PaletteWorkshop } from '../PaletteWorkshop';
import { ArtActionPanel } from '../ArtActionPanel';
import { ArtGenerateFromText } from '../ArtGenerateFromText';
import { ArtInspirePanel } from '../ArtInspirePanel';
import { ConceptArtBoard } from '../ConceptArtBoard';
import { PipingProvider } from '@/components/panel-polish';
import { atelierFontVars } from './atelierFonts';
import { PiecesDrawer, type Piece } from './PiecesDrawer';
import { SellDialog } from './SellDialog';
import './atelier.css';

const pieceFromUrl = () => {
  if (typeof window === 'undefined') return null;
  // ?piece= is the Atelier's own link; ?artwork= is the older form (chat's
  // "Open in Art lens" for a drawing) and still opens the piece.
  const q = new URLSearchParams(window.location.search);
  const p = q.get('piece') || q.get('artwork');
  return p && /^[\w:-]{1,80}$/.test(p) ? p : null;
};

export function Atelier() {
  const [piece, setPiece] = useState<string | null>(() => pieceFromUrl());
  const [pieces, setPieces] = useState<Piece[] | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sell, setSell] = useState<{ canvas: HTMLCanvasElement | null; artwork: { id: string; title: string } } | null>(null);
  const [colourIn, setColourIn] = useState<{ color: string; seq: number } | null>(null);
  const [refsMode, setRefsMode] = useState<'boards' | 'museum'>('boards');

  const go = useCallback((id: string | null, push = true) => {
    setPiece(id);
    const u = new URL(window.location.href);
    if (id) u.searchParams.set('piece', id); else u.searchParams.delete('piece');
    if (u.toString() !== window.location.href) window.history[push ? 'pushState' : 'replaceState']({}, '', u.toString());
  }, []);

  const loadPieces = useCallback(async () => {
    const r = await lensRun<{ artworks: Piece[] }>('art', 'artwork-list', {});
    if (r.data?.ok === false) { setError(r.data?.error || 'Your pieces could not be loaded.'); return null; }
    const list = r.data?.result?.artworks || [];
    setPieces(list);
    setError(null);
    return list;
  }, []);

  // Open on the canvas: the piece in the URL, else your latest, else a fresh one.
  useEffect(() => {
    let live = true;
    void (async () => {
      const list = await loadPieces();
      if (!live || !list) return;
      if (piece && list.some((p) => p.id === piece)) return;
      if (list.length) { go(list[0].id, false); return; }
      const made = await lensRun<{ artwork: { id: string } }>('art', 'artwork-create', { title: 'First study', width: 1280, height: 800, background: '#faf7f1' });
      if (!live) return;
      const id = made.data?.result?.artwork?.id;
      if (id) { await loadPieces(); go(id, false); } else setError(made.data?.error || 'A fresh canvas could not be made.');
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onPop = () => setPiece(pieceFromUrl());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const pick = useCallback((hex: string) => setColourIn((c) => ({ color: hex, seq: (c?.seq || 0) + 1 })), []);

  const side = {
    refs: (
      <div className="space-y-3">
        <div className="flex gap-1" role="tablist" aria-label="Reference wall">
          <button type="button" role="tab" aria-selected={refsMode === 'boards'} className="at-tab" onClick={() => setRefsMode('boards')}>Your boards</button>
          <button type="button" role="tab" aria-selected={refsMode === 'museum'} className="at-tab" onClick={() => setRefsMode('museum')}>Museums</button>
        </div>
        {refsMode === 'boards' ? <ArtReferencesPanel /> : (
          <div className="space-y-4">
            <MetMuseumPanel domain="art" />
            <ArtExplorer />
          </div>
        )}
      </div>
    ),
    colour: (
      <div className="space-y-4">
        <p className="text-[12px] text-[color:var(--at-muted)]">Click a colour to load it onto the brush.</p>
        <ArtPalettesPanel onPick={pick} />
        <PaletteWorkshop onPick={pick} />
      </div>
    ),
    notes: (
      <div className="space-y-4">
        <ArtInspirePanel />
        <ArtGenerateFromText compact />
        <PipingProvider><ArtActionPanel /></PipingProvider>
        <ConceptArtBoard />
      </div>
    ),
  };

  return (
    <div className={cn('at min-h-[calc(100dvh-4.5rem)] px-3 pb-24 pt-3 sm:px-5 sm:pb-8', atelierFontVars)} data-testid="at-app" data-lens="art">
      {error && <p className="at-error mb-3" role="alert">{error}</p>}
      {!piece && !error && (
        <div className="grid gap-3 lg:grid-cols-[208px_minmax(0,1fr)_300px]" role="status" aria-label="Opening your studio">
          <div className="at-skeleton h-[60vh]" /><div className="at-easel min-h-[60vh]" /><div className="at-skeleton h-[60vh]" />
        </div>
      )}
      {piece && (
        <ArtCanvas
          key={piece}
          artworkId={piece}
          onExit={() => { void loadPieces(); setDrawer(true); }}
          onSell={(canvas, artwork) => setSell({ canvas, artwork })}
          side={side}
          colourIn={colourIn}
        />
      )}
      {drawer && (
        <PiecesDrawer
          pieces={pieces}
          current={piece}
          onClose={() => setDrawer(false)}
          onOpen={(id) => { go(id); setDrawer(false); }}
          onChanged={loadPieces}
          onDeletedCurrent={async () => {
            const list = await loadPieces();
            if (list && list.length) { go(list[0].id); return; }
            const made = await lensRun<{ artwork: { id: string } }>('art', 'artwork-create', { title: 'New study', width: 1280, height: 800, background: '#faf7f1' });
            const id = made.data?.result?.artwork?.id;
            if (id) { await loadPieces(); go(id); } else setError(made.data?.error || 'A fresh canvas could not be made.');
          }}
        />
      )}
      {sell && <SellDialog canvas={sell.canvas} artwork={sell.artwork} onClose={() => setSell(null)} />}
      <LensAgentFab lensId="art" lensPrompt="You're inside Concord's Atelier (the Art lens): a layered painting studio with brushes, layers, references and museum search, where finished pieces can be sold through the Auction House. Help with composition, colour, technique and finding references." />
    </div>
  );
}

/** The lens entry. */
export default function ArtLens() {
  useLensNav('art');
  return <Atelier />;
}
