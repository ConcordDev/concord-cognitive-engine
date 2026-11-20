'use client';

/**
 * The Binder — the DTUs lens. Every DTU is a card in a collector's binder,
 * filed on its shelf: Works, Specs & designs, Documents, Knowledge. Data,
 * Records (your own context), Parts and System rows stay out of sight until
 * you filter them in, and the binder says how many there are. Open a card to
 * flip it, design it, check its claims, publish it, build on it, or carry it
 * to the fusion table with another card to make a new one that credits both.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, EyeOff, Plus, Search, Sparkles, Wrench, X } from 'lucide-react';
import { DTUQuickCreate } from '@/components/dtu/DTUQuickCreate';
import { cn } from '@/lib/utils';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import LensAgentFab from '@/components/lens/LensAgentFab';
import { WorkbenchPanel } from '../WorkbenchPanel';
import { OpsPanel } from '../OpsPanel';
import { TrendingDtus } from '../TrendingDtus';
import { binderFontVars } from './binderFonts';
import { CardFace } from './CardFace';
import { CardStage } from './CardStage';
import { BINDER_CHANGED, HIDDEN, SHELF, SHOWN, bd, changed, readAddress, says, writeAddress, type Card, type Shelf } from './bd';
import './binder.css';

const PAGE = 12;
interface Facets { counts: Record<Shelf, number>; hiddenTotal: number; domains: { name: string; n: number }[] }

export function Binder() {
  const [addr, setAddr] = useState(() => readAddress());
  const [tab, setTab] = useState<Shelf | 'all'>('all');
  const [hidden, setHidden] = useState<Shelf[]>([]);
  const initialQ = typeof window !== 'undefined' ? (new URLSearchParams(window.location.search).get('q') || '').slice(0, 120) : '';
  const [q, setQ] = useState(initialQ);
  const [query, setQuery] = useState(initialQ);
  const [domain, setDomain] = useState<string | null>(null);
  const [sort, setSort] = useState<'newest' | 'built-on' | 'checked' | 'title'>('newest');
  const [page, setPage] = useState(0);
  const [cards, setCards] = useState<Card[] | null>(null);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fuse, setFuse] = useState<Card[]>([]);
  const [tools, setTools] = useState(false);
  const [creating, setCreating] = useState(false);
  const [rev, setRev] = useState(0);

  useEffect(() => {
    const sync = () => setAddr(readAddress());
    const bump = () => setRev((n) => n + 1);
    window.addEventListener('popstate', sync);
    window.addEventListener('bd:address', sync);
    window.addEventListener(BINDER_CHANGED, bump);
    return () => { window.removeEventListener('popstate', sync); window.removeEventListener('bd:address', sync); window.removeEventListener(BINDER_CHANGED, bump); };
  }, []);

  const shelves = useMemo<Shelf[]>(() => (tab === 'all' ? [...SHOWN, ...hidden] : [tab]), [tab, hidden]);

  useEffect(() => {
    let live = true;
    void bd<Facets>('shelf-facets', { scope: addr.scope }).then((r) => { if (live) setFacets(r.ok && r.result?.counts ? { ...r.result, domains: r.result.domains || [] } : null); });
    return () => { live = false; };
  }, [addr.scope, rev]);

  useEffect(() => {
    let live = true;
    setCards(null); setErr(null);
    void bd<{ cards: Card[]; total: number }>('shelf-browse', { scope: addr.scope, shelves, q: query, domain, sort, offset: page * PAGE, limit: PAGE }).then((r) => {
      if (!live) return;
      if (!r.ok) { setErr(says(r)); setCards([]); return; }
      setCards(r.result?.cards || []); setTotal(r.result?.total || 0);
    });
    return () => { live = false; };
  }, [addr.scope, shelves, query, domain, sort, page, rev]);
  useEffect(() => { setPage(0); }, [addr.scope, tab, hidden, query, domain, sort]);

  const toFuse = useCallback((c: Card) => setFuse((f) => (f.some((x) => x.id === c.id) ? f : [...f, c].slice(-2))), []);

  useLensCommand([
    { id: 'bd-mine', keys: 'm', description: 'Binder: my cards', category: 'navigation' as const, action: () => writeAddress({ scope: 'mine', card: null }) },
    { id: 'bd-lib', keys: 'l', description: 'Binder: the library', category: 'navigation' as const, action: () => writeAddress({ scope: 'library', card: null }) },
    { id: 'bd-next', keys: ']', description: 'Binder: next page', category: 'navigation' as const, action: () => setPage((p) => p + 1) },
    { id: 'bd-prev', keys: '[', description: 'Binder: previous page', category: 'navigation' as const, action: () => setPage((p) => Math.max(0, p - 1)) },
  ], { lensId: 'dtus' });

  const pages = Math.max(1, Math.ceil(total / PAGE));
  const shownCount = facets ? SHOWN.reduce((a, s) => a + facets.counts[s], 0) : null;

  return (
    <div className={cn('bd min-h-[calc(100dvh-4.5rem)] px-3 pb-36 pt-5 sm:px-6', binderFontVars)} data-testid="bd-app" data-lens="dtus">
      <div className="mx-auto max-w-[1240px]">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="bd-label">{addr.scope === 'mine' ? 'Your binder' : 'The library'}</p>
            <h1 className="bd-title text-[40px] leading-none sm:text-[52px]">The Binder</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-full border border-[color:var(--bd-pocket-edge)] p-0.5" role="group" aria-label="Whose cards">
              <button type="button" className="bd-chip !border-0" aria-pressed={addr.scope === 'mine'} onClick={() => writeAddress({ scope: 'mine', card: null })}>Mine <kbd className="bd-mono opacity-60">m</kbd></button>
              <button type="button" className="bd-chip !border-0" aria-pressed={addr.scope === 'library'} onClick={() => writeAddress({ scope: 'library', card: null })}>Library <kbd className="bd-mono opacity-60">l</kbd></button>
            </div>
            <button type="button" className="bd-btn bd-btn-go" onClick={() => setCreating(true)} data-testid="bd-new"><Plus className="h-4 w-4" /> New card</button>
            <button type="button" className="bd-btn" onClick={() => setTools(true)}><Wrench className="h-4 w-4" /> Tools</button>
          </div>
        </header>

        {addr.card ? <CardStage key={addr.card} id={addr.card} onFuse={toFuse} /> : (
          <>
            {/* shelf tabs */}
            <div className="flex flex-wrap items-end gap-1" role="tablist" aria-label="Shelves">
              <button type="button" role="tab" className="bd-tab" aria-selected={tab === 'all'} style={{ ['--shelf' as string]: 'var(--bd-go)' }} onClick={() => setTab('all')}>All shelves <span className="bd-mono text-[11px] opacity-70">{shownCount ?? ''}</span></button>
              {SHOWN.map((s) => (
                <button key={s} type="button" role="tab" className="bd-tab" aria-selected={tab === s} style={{ ['--shelf' as string]: SHELF[s].ink }} onClick={() => setTab(s)} title={SHELF[s].blurb}>
                  <span className="bd-dot" style={{ background: SHELF[s].ink }} aria-hidden />{SHELF[s].label} <span className="bd-mono text-[11px] opacity-70">{facets?.counts[s] ?? ''}</span>
                </button>
              ))}
            </div>
            <div className="bd-page">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <form className="relative min-w-[200px] flex-1" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--bd-muted)]" />
                  <input className="bd-input pl-9" placeholder="Find a card" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a card" />
                </form>
                <select className="bd-input !w-auto" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort">
                  <option value="newest">Newest</option><option value="built-on">Most built on</option><option value="checked">Verified first</option><option value="title">A–Z</option>
                </select>
              </div>
              {facets && facets.domains.length > 1 && (
                <div className="mb-3 flex flex-wrap gap-1.5" aria-label="Domains">
                  <button type="button" className="bd-chip" aria-pressed={!domain} onClick={() => setDomain(null)}>Any field</button>
                  {facets.domains.slice(0, 14).map((d) => <button key={d.name} type="button" className="bd-chip capitalize" aria-pressed={domain === d.name} onClick={() => setDomain(domain === d.name ? null : d.name)}>{d.name} <span className="bd-mono opacity-60">{d.n}</span></button>)}
                </div>
              )}
              {tab === 'all' && facets && facets.hiddenTotal > 0 && (
                <div className="mb-4 flex flex-wrap items-center gap-1.5 text-[12.5px] text-[color:var(--bd-muted)]">
                  <EyeOff className="h-3.5 w-3.5" /> <span>{facets.hiddenTotal} kept out of sight:</span>
                  {HIDDEN.filter((s) => facets.counts[s] > 0).map((s) => (
                    <button key={s} type="button" className="bd-chip" aria-pressed={hidden.includes(s)} title={SHELF[s].blurb} onClick={() => setHidden((h) => (h.includes(s) ? h.filter((x) => x !== s) : [...h, s]))}>
                      <span className="bd-dot" style={{ background: SHELF[s].ink }} aria-hidden />{SHELF[s].label} {facets.counts[s]}
                    </button>
                  ))}
                </div>
              )}
              {err && <p className="bd-error mb-3" role="alert">{err}</p>}
              {!cards ? (
                <div className="bd-pockets" role="status" aria-label="Opening the binder">{Array.from({ length: 8 }, (_, i) => <div key={i} className="bd-skeleton" />)}</div>
              ) : cards.length === 0 ? (
                <div className="py-12 text-center">
                  <p className="bd-title text-[22px]">{query ? `No cards match “${query}”.` : addr.scope === 'mine' ? 'No cards on this shelf yet.' : 'Nothing published here yet.'}</p>
                  <p className="mt-1 text-[14px] text-[color:var(--bd-muted)]">{addr.scope === 'mine' ? 'What you make across Concord lands here as cards: music, art, designs, documents and knowledge.' : 'Published cards from everyone appear in the library.'}</p>
                </div>
              ) : (
                <ul className="bd-pockets" data-testid="bd-pockets">
                  {cards.map((c) => (
                    <li key={c.id}>
                      <button type="button" className="bd-slot block w-full" data-fuse={fuse.some((f) => f.id === c.id)} onClick={() => writeAddress({ card: c.id })} aria-label={`Open ${c.title}`}>
                        <CardFace card={c} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {cards && total > PAGE && (
                <nav className="mt-5 flex items-center justify-center gap-3" aria-label="Pages">
                  <button type="button" className="bd-btn !px-2.5" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
                  <span className="bd-mono text-[12.5px] text-[color:var(--bd-ink-2)]">Page {page + 1} of {pages} · {total} cards</span>
                  <button type="button" className="bd-btn !px-2.5" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
                </nav>
              )}
            </div>
          </>
        )}
      </div>

      <FuseTray cards={fuse} onRemove={(id) => setFuse((f) => f.filter((x) => x.id !== id))} onDone={(id) => { setFuse([]); changed(); writeAddress({ card: id }); }} />

      {creating && <DTUQuickCreate onClose={() => setCreating(false)} onSuccess={() => { setCreating(false); changed(); }} source="binder" />}
      {tools && (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal aria-label="Binder tools">
          <button type="button" className="bd-scrim hidden flex-1 sm:block" aria-label="Close" onClick={() => setTools(false)} />
          <section className="bd-scroll h-full w-full max-w-[720px] overflow-y-auto bg-[#0f1426] p-5">
            <div className="mb-4 flex items-center justify-between"><p className="bd-title text-[24px]">Tools</p><button type="button" className="bd-btn !px-2.5" onClick={() => setTools(false)} aria-label="Close tools"><X className="h-4 w-4" /></button></div>
            <p className="mb-4 text-[13px] text-[color:var(--bd-muted)]">Citation and lineage graphs, compare and merge, bulk edits, layers, saved views, trending, and the substrate probes.</p>
            <div className="space-y-6"><WorkbenchPanel /><TrendingDtus /><OpsPanel /></div>
          </section>
        </div>
      )}
      <LensAgentFab lensId="dtus" lensPrompt="You're inside Concord's Binder (the DTUs lens): every DTU is a collectible card on a shelf (works, specs, documents, knowledge; data, records, parts and system hidden unless filtered in). Owners design cards, check knowledge claims before publishing, build on cards and fuse two into a new one that credits both. Help organise, find connections and improve cards." />
    </div>
  );
}

function FuseTray({ cards, onRemove, onDone }: { cards: Card[]; onRemove: (id: string) => void; onDone: (id: string) => void }) {
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (cards.length === 2 && !title) setTitle(`${cards[0].title} × ${cards[1].title}`.slice(0, 160)); }, [cards, title]);
  if (!cards.length) return null;
  const go = async () => {
    setBusy(true); setErr(null);
    const r = await bd<{ card: Card }>('card-fuse', { aId: cards[0].id, bId: cards[1].id, title, note });
    setBusy(false);
    if (r.ok && r.result) { setTitle(''); setNote(''); onDone(r.result.card.id); } else setErr(says(r));
  };
  return (
    <div className="bd-fuse-tray fixed inset-x-0 bottom-0 z-40 px-3 py-3 sm:px-6" role="region" aria-label="Fusion table" data-testid="bd-fuse">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-3">
        <p className="bd-title flex items-center gap-1.5 text-[16px]"><Sparkles className="h-4 w-4 text-[color:var(--bd-go)]" /> Fusion table</p>
        {[0, 1].map((i) => (
          <div key={i} className="relative">
            <div className="bd-fuse-slot">{cards[i] ? <div className="w-full"><CardFace card={cards[i]} live={false} size="mini" /></div> : '+'}</div>
            {cards[i] && <button type="button" className="absolute -right-2 -top-2 rounded-full bg-black/70 p-0.5" onClick={() => onRemove(cards[i].id)} aria-label={`Take ${cards[i].title} off the table`}><X className="h-3 w-3" /></button>}
          </div>
        ))}
        {cards.length < 2 ? <p className="text-[13px] text-[color:var(--bd-muted)]">Add one more card to fuse. Open any card and choose “To the fusion table”.</p> : (
          <>
            <input className="bd-input min-w-[180px] flex-1" maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Name the new card" placeholder="Name the new card" />
            <input className="bd-input min-w-[180px] flex-1" maxLength={1200} value={note} onChange={(e) => setNote(e.target.value)} aria-label="What the new card adds" placeholder="What does it make together? (optional)" />
            <button type="button" className="bd-btn bd-btn-go" disabled={busy || !title.trim()} onClick={() => void go()} data-testid="bd-fuse-go">{busy ? 'Fusing…' : 'Fuse into a new card'}</button>
          </>
        )}
        {err && <p className="bd-error w-full" role="alert">{err}</p>}
        {cards.length === 2 && <p className="w-full text-[11.5px] text-[color:var(--bd-muted)]">The new card credits both. When it sells, part of the price flows back to their creators through the royalty cascade.</p>}
      </div>
    </div>
  );
}

/** The lens entry. */
export default function DtusLens() {
  useLensNav('dtus');
  return <Binder />;
}
