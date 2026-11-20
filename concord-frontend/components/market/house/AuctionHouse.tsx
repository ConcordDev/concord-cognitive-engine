'use client';

/**
 * The Auction House — the Market lens. An evening saleroom where people sell
 * the DTUs they made for Concord Coin. Six rooms:
 *   Saleroom    the catalogue: search, filters with real counts, sorts, covers
 *   The drawing this hour's front window, drawn by lot from a published seed
 *   Sales record what actually sold today / this week
 *   Commissions the pay board: rewards held in escrow, checked submissions
 *   Consign     put a DTU you made on sale, with a cover and a licence
 *   Your room   your lots, your earnings, your library
 * Every number comes from the house's own records (listings, purchases,
 * economy_ledger). The open lot lives in the URL (?lot=), so links and back work.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Gavel, Sparkles, ScrollText, Handshake, PackagePlus, DoorOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import LensAgentFab from '@/components/lens/LensAgentFab';
import { useAnonBrowse } from '@/lib/anon-browse';
import { useLensNav } from '@/hooks/useLensNav';
import { houseFontVars } from './houseFonts';
import { cc, house, hourLabel, setVisitor, type Lot, type OpenDtu, type Showcase, type Terms } from './houseApi';
import { Saleroom } from './Saleroom';
import { LotSheet, Reader } from './LotSheet';
import { ShowcaseRoom } from './ShowcaseRoom';
import { SalesRecord } from './SalesRecord';
import { CommissionsRoom } from './CommissionsRoom';
import { ConsignRoom } from './ConsignRoom';
import { MyRoom } from './MyRoom';
import './house.css';

export type Room = 'saleroom' | 'drawing' | 'record' | 'commissions' | 'consign' | 'mine';
export const ROOMS: { id: Room; label: string; key: string; icon: typeof Gavel }[] = [
  { id: 'saleroom', label: 'Saleroom', key: '1', icon: Gavel },
  { id: 'drawing', label: 'The drawing', key: '2', icon: Sparkles },
  { id: 'record', label: 'Sales record', key: '3', icon: ScrollText },
  { id: 'commissions', label: 'Commissions', key: '4', icon: Handshake },
  { id: 'consign', label: 'Consign', key: '5', icon: PackagePlus },
  { id: 'mine', label: 'Your room', key: '6', icon: DoorOpen },
];

const isRoom = (v: string | null): v is Room => !!v && ROOMS.some((r) => r.id === v);
const fromUrl = () => {
  if (typeof window === 'undefined') return { room: 'saleroom' as Room, lot: null as string | null };
  const p = new URLSearchParams(window.location.search);
  const room = p.get('room');
  const lot = p.get('lot');
  return { room: isRoom(room) ? room : 'saleroom', lot: lot && /^[\w-]{1,80}$/.test(lot) ? lot : null };
};

export function AuctionHouse({ signedIn }: { signedIn: boolean }) {
  setVisitor(!signedIn);
  const [room, setRoom] = useState<Room>(() => fromUrl().room);
  const [lot, setLot] = useState<string | null>(() => fromUrl().lot);
  const [reader, setReader] = useState<OpenDtu | null>(null);
  const [terms, setTerms] = useState<Terms | null>(null);
  const [showcase, setShowcase] = useState<Showcase | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const loadTerms = useCallback(async () => { const r = await house<Terms>('house-terms'); if (r.ok) setTerms(r.result); }, []);
  const loadShowcase = useCallback(async () => { const r = await house<Showcase>('house-showcase'); if (r.ok) setShowcase(r.result); }, []);
  useEffect(() => { void loadTerms(); void loadShowcase(); }, [loadTerms, loadShowcase]);
  // the drawing changes on the hour: look again when the next one is due
  useEffect(() => {
    if (!showcase?.next?.opensAt) return;
    const due = Date.parse(showcase.next.opensAt) - Date.now() + 2_000;
    const t = setTimeout(() => void loadShowcase(), Math.max(5_000, due));
    return () => clearTimeout(t);
  }, [showcase, loadShowcase]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3600); return () => clearTimeout(t); }, [toast]);

  const sync = useCallback((next: { room?: Room; lot?: string | null }, push = true) => {
    const u = new URL(window.location.href);
    if (next.room) { if (next.room === 'saleroom') u.searchParams.delete('room'); else u.searchParams.set('room', next.room); }
    if (next.lot !== undefined) { if (next.lot) u.searchParams.set('lot', next.lot); else u.searchParams.delete('lot'); }
    if (u.toString() !== window.location.href) window.history[push ? 'pushState' : 'replaceState']({}, '', u.toString());
  }, []);
  const go = useCallback((r: Room) => { setRoom(r); sync({ room: r }); window.scrollTo({ top: 0 }); }, [sync]);
  const openLot = useCallback((id: string) => { setLot(id); sync({ lot: id }); }, [sync]);
  const closeLot = useCallback(() => { setLot(null); sync({ lot: null }); }, [sync]);
  useEffect(() => {
    const onPop = () => { const s = fromUrl(); setRoom(s.room); setLot(s.lot); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey || lot || reader) return;
      const r = ROOMS.find((x) => x.key === e.key);
      if (r) { e.preventDefault(); go(r.id); return; }
      if (e.key === '/') { e.preventDefault(); if (room !== 'saleroom') go('saleroom'); requestAnimationFrame(() => searchRef.current?.focus()); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, lot, reader, room]);

  const onBought = (balance: number) => { setTerms((t) => (t ? { ...t, balance } : t)); setRefresh((k) => k + 1); setToast(`Bought. Your balance is ${cc(balance)}.`); };
  const onConsigned = (l: Lot) => { setRefresh((k) => k + 1); void loadShowcase(); setToast(`Consigned as lot ${l.id.replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase()}.`); openLot(l.id); };

  return (
    <div className={cn('ah min-h-[calc(100dvh-4.5rem)]', houseFontVars)} data-testid="ah-app" data-lens="market">
      <header className="ah-band">
        <div className="mx-auto flex max-w-[1320px] flex-wrap items-end justify-between gap-x-6 gap-y-2 px-4 pt-5 sm:px-6">
          <div>
            <p className="ah-label">Concord · est. on the ledger</p>
            <h1 className="ah-display text-[34px] font-semibold italic leading-none sm:text-[42px]">The Auction House</h1>
          </div>
          <div className="flex items-center gap-5 pb-1 text-[13px]">
            {showcase?.current && <button type="button" className="hidden text-left sm:block" onClick={() => go('drawing')}><span className="ah-label block">Front window</span><span className="ah-num">{showcase.current.winners.length ? `${showcase.current.winners.length} drawn` : 'dark this hour'} · {hourLabel(showcase.current.hour)}</span></button>}
            {signedIn ? (
              <div className="text-right" data-testid="ah-balance"><span className="ah-label block">Your balance</span><span className="ah-num text-[17px] font-semibold">{terms?.balance != null ? cc(terms.balance) : '—'}</span></div>
            ) : <a className="ah-btn ah-btn-brass" href={`/login?next=${encodeURIComponent('/lenses/market')}`}>Sign in</a>}
          </div>
        </div>
        <nav className="ah-scroll mx-auto mt-3 flex max-w-[1320px] gap-1 overflow-x-auto px-2 sm:px-4" role="tablist" aria-label="Rooms">
          {ROOMS.map((r) => {
            const Icon = r.icon;
            return (
              <button key={r.id} type="button" role="tab" aria-selected={room === r.id} className="ah-room" onClick={() => go(r.id)} data-testid={`ah-room-${r.id}`}>
                <Icon className="h-3.5 w-3.5" />{r.label}<span className="ah-kbd ml-1 hidden md:inline-flex">{r.key}</span>
              </button>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto max-w-[1320px] px-4 py-6 sm:px-6 sm:py-8">
        {room === 'saleroom' && <Saleroom onOpen={openLot} showcase={showcase} onShowcase={() => go('drawing')} refreshKey={refresh} searchRef={searchRef} />}
        {room === 'drawing' && <ShowcaseRoom key={showcase?.current?.seed || 'none'} showcase={showcase} signedIn={signedIn} onOpen={openLot} onChanged={loadShowcase} />}
        {room === 'record' && <SalesRecord onOpen={openLot} refreshKey={refresh} />}
        {room === 'commissions' && <CommissionsRoom signedIn={signedIn} balance={terms?.balance ?? null} onBalance={loadTerms} onReader={setReader} />}
        {room === 'consign' && <ConsignRoom signedIn={signedIn} terms={terms} onConsigned={onConsigned} />}
        {room === 'mine' && <MyRoom signedIn={signedIn} onOpen={openLot} onReader={setReader} refreshKey={refresh} onChanged={() => setRefresh((k) => k + 1)} />}
      </main>

      <footer className="mx-auto max-w-[1320px] px-4 pb-28 text-[12px] ah-muted sm:px-6 sm:pb-10">
        <div className="ah-double mb-3" />
        Sales settle in Concord Coin on the ledger. The house fee is {terms ? (terms.combinedRate * 100).toFixed(2) : '5.46'}% of each sale, and makers of work a lot cites are paid royalties from its sales automatically. Keys: 1–6 rooms · / search · esc close.
      </footer>

      {lot && <LotSheet id={lot} signedIn={signedIn} onClose={closeLot} onOpen={openLot} onBought={onBought} onReader={setReader} />}
      {reader && <Reader dtu={reader} onClose={() => setReader(null)} />}
      {toast && <div className="ah-band ah-rise fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 px-4 py-2 text-[13.5px] shadow-lg" role="status" data-testid="ah-toast">{toast}</div>}

      <LensAgentFab
        lensId="market"
        lensPrompt="You're inside Concord's Auction House (the Market lens), where people sell DTUs they made for Concord Coin, enter an hourly showcase drawn by lot, and post commissions with rewards held in escrow. Help with pricing, writing a good listing or brief, and finding work."
      />
    </div>
  );
}

/** The lens entry: members get their balance and every room; visitors browse the public window. */
export default function MarketLens() {
  useLensNav('market');
  const anon = useAnonBrowse();
  return <AuctionHouse signedIn={!anon} />;
}
