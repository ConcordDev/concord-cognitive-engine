'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { house, KIND_LABEL, LICENSE_LABEL, hourLabel, type Catalogue, type Facet, type License, type Showcase } from './houseApi';
import { LotPlate, PlateSkeleton } from './LotPlate';

export interface Filters { q: string; kind: string; domain: string; tag: string; license: string; priceMin: string; priceMax: string; free: boolean; sort: string; page: number }
export const EMPTY_FILTERS: Filters = { q: '', kind: '', domain: '', tag: '', license: '', priceMin: '', priceMax: '', free: false, sort: 'newest', page: 1 };

const SORTS: { id: string; label: string }[] = [
  { id: 'newest', label: 'Newest consigned' },
  { id: 'trending', label: 'Selling now' },
  { id: 'bestselling', label: 'Most sold' },
  { id: 'price_asc', label: 'Price: low to high' },
  { id: 'price_desc', label: 'Price: high to low' },
];

export function Saleroom({ onOpen, showcase, onShowcase, refreshKey, searchRef }: {
  onOpen: (id: string) => void;
  showcase: Showcase | null;
  onShowcase: () => void;
  refreshKey: number;
  searchRef: React.RefObject<HTMLInputElement>;
}) {
  const [f, setF] = useState<Filters>(EMPTY_FILTERS);
  const [q, setQ] = useState('');
  const [data, setData] = useState<Catalogue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [railOpen, setRailOpen] = useState(false);
  const seq = useRef(0);

  // type to search, settle after a short pause
  useEffect(() => { const t = setTimeout(() => setF((p) => (p.q === q ? p : { ...p, q, page: 1 })), 220); return () => clearTimeout(t); }, [q]);

  useEffect(() => {
    const n = ++seq.current;
    setLoading(true);
    void house<Catalogue>('house-catalogue', { ...f, free: f.free || undefined, pageSize: 24 }).then((r) => {
      if (n !== seq.current) return;
      setLoading(false);
      if (r.ok) { setData(r.result); setError(null); } else setError(r.message);
    });
  }, [f, refreshKey]);

  const set = (patch: Partial<Filters>) => setF((p) => ({ ...p, ...patch, page: patch.page ?? 1 }));
  const active = useMemo(() => {
    const out: { key: keyof Filters; label: string }[] = [];
    if (f.kind) out.push({ key: 'kind', label: KIND_LABEL[f.kind] || f.kind });
    if (f.domain) out.push({ key: 'domain', label: f.domain });
    if (f.tag) out.push({ key: 'tag', label: `#${f.tag}` });
    if (f.license) out.push({ key: 'license', label: LICENSE_LABEL[f.license as License] || f.license });
    if (f.priceMin || f.priceMax) out.push({ key: 'priceMin', label: `${f.priceMin || 0}–${f.priceMax || '∞'} CC` });
    if (f.free) out.push({ key: 'free', label: 'Free only' });
    return out;
  }, [f]);
  const clear = (key: keyof Filters) => set(key === 'priceMin' ? { priceMin: '', priceMax: '' } : key === 'free' ? { free: false } : { [key]: '' } as Partial<Filters>);

  const drawnIds = new Set((showcase?.current?.winners || []).flatMap((w) => w.lots.map((l) => l.id)));
  const windowLots = (showcase?.current?.winners || []).flatMap((w) => w.lots.slice(0, 1));
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const rail = (
    <div className="space-y-5" data-testid="ah-rail">
      <FacetGroup title="Kind" facets={data?.facets.kind} value={f.kind} label={(v) => KIND_LABEL[v] || v} onPick={(v) => set({ kind: v })} />
      <FacetGroup title="Field" facets={data?.facets.domain} value={f.domain} onPick={(v) => set({ domain: v })} testId="ah-facet-domain" />
      <FacetGroup title="Licence" facets={data?.facets.license} value={f.license} label={(v) => LICENSE_LABEL[v as License] || v} onPick={(v) => set({ license: v })} />
      <div>
        <p className="ah-label mb-2">Price (CC)</p>
        <div className="flex items-center gap-2">
          <input className="ah-input ah-num" inputMode="decimal" placeholder="min" aria-label="Lowest price" value={f.priceMin} onChange={(e) => set({ priceMin: e.target.value.replace(/[^0-9.]/g, '') })} data-testid="ah-price-min" />
          <span className="ah-faint">–</span>
          <input className="ah-input ah-num" inputMode="decimal" placeholder="max" aria-label="Highest price" value={f.priceMax} onChange={(e) => set({ priceMax: e.target.value.replace(/[^0-9.]/g, '') })} data-testid="ah-price-max" />
        </div>
        <label className="mt-2 flex items-center gap-2 text-[13px] ah-ink-2">
          <input type="checkbox" checked={f.free} onChange={(e) => set({ free: e.target.checked })} /> Free lots only
          {data?.facets.price?.free ? <span className="ah-faint ah-num">({data.facets.price.free})</span> : null}
        </label>
      </div>
      {data?.facets.tag?.length ? (
        <div>
          <p className="ah-label mb-2">Tags</p>
          <div className="flex flex-wrap gap-1.5">
            {data.facets.tag.slice(0, 18).map((t) => (
              <button key={t.value} type="button" className="ah-chip" aria-pressed={f.tag === t.value} onClick={() => set({ tag: f.tag === t.value ? '' : t.value })}>#{t.value} <span className="ah-num opacity-70">{t.count}</span></button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* this hour's window */}
      {showcase?.current && windowLots.length > 0 && (
        <section className="ah-window ah-rise p-4 sm:p-5" aria-label="This hour's drawing" data-testid="ah-window-strip">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p className="ah-label">The front window · drawn {hourLabel(showcase.current.hour)}</p>
              <p className="ah-display text-[22px] italic">Six makers, drawn by lot — not by sales.</p>
            </div>
            <button type="button" className="ah-btn ah-btn-brass" onClick={onShowcase}>See the drawing</button>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {windowLots.map((l) => <LotPlate key={l.id} lot={l} onOpen={onOpen} size="sm" drawn />)}
          </div>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 ah-faint" aria-hidden />
          <input ref={searchRef} className="ah-input pl-9" placeholder="Search titles, makers, tags" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the catalogue" data-testid="ah-search" />
          <span className="ah-kbd absolute right-2 top-1/2 -translate-y-1/2">/</span>
        </label>
        <select className="ah-select w-auto" value={f.sort} onChange={(e) => set({ sort: e.target.value })} aria-label="Sort" data-testid="ah-sort">
          {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <button type="button" className="ah-btn lg:hidden" onClick={() => setRailOpen(true)} aria-expanded={railOpen}><SlidersHorizontal className="h-4 w-4" />Filter{active.length ? ` · ${active.length}` : ''}</button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <aside className="hidden lg:block" aria-label="Filters">{rail}</aside>
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <p className="text-[13px] ah-muted" data-testid="ah-count" aria-live="polite">
              {data ? (<><span className="ah-num font-semibold ah-ink-2">{data.total}</span> {data.total === 1 ? 'lot' : 'lots'}{active.length || f.q ? ` of ${data.inHouse} in the house` : ' in the house'}</>) : ' '}
            </p>
            {active.map((a) => (
              <button key={a.key} type="button" className="ah-chip" aria-pressed onClick={() => clear(a.key)} aria-label={`Remove filter ${a.label}`}>{a.label}<X className="h-3 w-3" /></button>
            ))}
            {active.length > 1 && <button type="button" className="text-[12px] underline ah-muted" onClick={() => setF({ ...EMPTY_FILTERS, q: f.q, sort: f.sort })}>Clear all</button>}
          </div>

          {error && <p className="ah-error mb-4" role="alert">{error}</p>}
          {loading && !data ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4" role="status" aria-label="Loading the catalogue">{Array.from({ length: 8 }, (_, i) => <PlateSkeleton key={i} />)}</div>
          ) : data && data.lots.length === 0 ? (
            <div className="ah-panel px-6 py-12 text-center" data-testid="ah-empty">
              <p className="ah-title text-[24px]">{data.inHouse === 0 ? 'The saleroom is empty tonight.' : 'No lot matches.'}</p>
              <p className="mt-2 text-[13.5px] ah-muted">{data.inHouse === 0 ? 'Nothing has been consigned yet. Consign a DTU you made and it will be the first lot on the floor.' : 'Loosen a filter, or clear the search.'}</p>
            </div>
          ) : (
            <div className={cn('grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4 transition-opacity', loading && 'opacity-60')} data-testid="ah-grid">
              {data?.lots.map((l) => <LotPlate key={l.id} lot={l} onOpen={onOpen} drawn={drawnIds.has(l.id)} />)}
            </div>
          )}

          {data && pages > 1 && (
            <nav className="mt-6 flex items-center justify-center gap-3" aria-label="Pages">
              <button type="button" className="ah-btn" disabled={f.page <= 1} onClick={() => set({ page: f.page - 1 })}>Previous</button>
              <span className="ah-num text-[13px] ah-muted">Page {data.page} of {pages}</span>
              <button type="button" className="ah-btn" disabled={f.page >= pages} onClick={() => set({ page: f.page + 1 })}>Next</button>
            </nav>
          )}
        </div>
      </div>

      {railOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden" role="dialog" aria-modal aria-label="Filters">
          <button type="button" className="ah-scrim flex-1" aria-label="Close filters" onClick={() => setRailOpen(false)} />
          <div className="ah-sheet ah-scroll w-[300px] max-w-[85vw] overflow-y-auto p-5">
            <div className="mb-4 flex items-center justify-between"><p className="ah-display text-[22px] italic">Filter</p><button type="button" className="ah-btn ah-btn-ghost" onClick={() => setRailOpen(false)} aria-label="Close"><X className="h-4 w-4" /></button></div>
            {rail}
          </div>
        </div>
      )}
    </div>
  );
}

function FacetGroup({ title, facets, value, onPick, label, testId }: { title: string; facets?: Facet[]; value: string; onPick: (v: string) => void; label?: (v: string) => string; testId?: string }) {
  if (!facets?.length) return null;
  return (
    <div data-testid={testId}>
      <p className="ah-label mb-1.5">{title}</p>
      <div className="space-y-0.5">
        {facets.slice(0, 10).map((x) => (
          <button key={x.value} type="button" className="ah-facet" aria-pressed={value === x.value} onClick={() => onPick(value === x.value ? '' : x.value)}>
            <span className="truncate">{label ? label(x.value) : x.value}</span>
            <span className="ah-num ah-faint text-[12px]">{x.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
