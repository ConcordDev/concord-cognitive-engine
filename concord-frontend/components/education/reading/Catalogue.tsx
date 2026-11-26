'use client';

/**
 * The card catalogue: a cabinet of drawers, one per subject, over the
 * typewritten cards of every published course. Searching, the drawers, the
 * level and the price all filter on the server (education.rr-catalog).
 */
import { useEffect, useRef, useState } from 'react';
import { Search, Star, Users } from 'lucide-react';
import { callNumber, cc, minutes, pub, type CourseCard, type Level, LEVELS } from './rr';

interface Catalog { courses: CourseCard[]; total: number; categories: string[] }
type Sort = 'new' | 'rating' | 'popular';

export function Catalogue({ onOpen, searchRef }: { onOpen: (id: string) => void; searchRef: React.MutableRefObject<HTMLInputElement | null> }) {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [level, setLevel] = useState<Level | ''>('');
  const [price, setPrice] = useState<'' | 'free' | 'paid'>('');
  const [sort, setSort] = useState<Sort>('new');
  const [data, setData] = useState<Catalog | null>(null);
  const [drawers, setDrawers] = useState<{ name: string; n: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const seq = useRef(0);

  // The drawers are every subject on the shelves, whatever is filtered.
  useEffect(() => {
    void pub<Catalog>('/catalog').then((r) => {
      if (!r.ok || !r.result) return;
      const counts = new Map<string, number>();
      for (const c of r.result.courses) counts.set(c.category, (counts.get(c.category) || 0) + 1);
      setDrawers([...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, n]) => ({ name, n })));
    });
  }, []);

  useEffect(() => {
    const mine = ++seq.current;
    setIsLoading(true);
    const t = setTimeout(async () => {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (category) params.set('category', category);
      if (level) params.set('level', level);
      if (price) params.set('price', price);
      if (sort !== 'new') params.set('sort', sort);
      const r = await pub<Catalog>(`/catalog?${params.toString()}`);
      if (mine !== seq.current) return;
      setIsLoading(false);
      if (!r.ok) { setError(r.error); return; }
      setError(null); setData(r.result);
    }, q ? 220 : 0);
    return () => clearTimeout(t);
  }, [q, category, level, price, sort]);

  const filtered = !!(q || category || level || price);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6" data-testid="rr-catalogue">
      <div className="flex flex-col gap-5 lg:flex-row">
        <section className="rr-cabinet shrink-0 p-3 lg:w-[290px]" aria-label="Subjects">
          <p className="rr-type mb-2 text-center text-[13px] tracking-widest text-[var(--rr-brass-2)]">CARD CATALOGUE</p>
          {drawers.length === 0 ? (
            <p className="px-2 py-4 text-center text-[13px] text-[#e8dcbc]">No subjects on the shelves yet. Courses appear here once a creator publishes one.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2">
              <button type="button" className="rr-drawer" aria-pressed={!category} onClick={() => setCategory('')}>
                <span className="rr-drawer-label rr-type text-[12px] uppercase">All</span>
                <span className="rr-num text-[11px] opacity-80">{drawers.reduce((s, d) => s + d.n, 0)} cards</span>
                <span className="rr-drawer-pull" aria-hidden />
              </button>
              {drawers.map((d) => (
                <button key={d.name} type="button" className="rr-drawer" aria-pressed={category === d.name} onClick={() => setCategory(category === d.name ? '' : d.name)} data-testid={`rr-drawer-${d.name}`}>
                  <span className="rr-drawer-label rr-type truncate text-[12px] uppercase">{d.name}</span>
                  <span className="rr-num text-[11px] opacity-80">{d.n} {d.n === 1 ? 'card' : 'cards'}</span>
                  <span className="rr-drawer-pull" aria-hidden />
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="min-w-0 flex-1" aria-label="Courses">
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[#e8dcbc] opacity-70" aria-hidden />
              <input ref={searchRef} className="rr-input rr-input-room pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles, subjects, creators  ( / )" aria-label="Search the catalogue" data-testid="rr-search" />
            </label>
            <select className="rr-input rr-input-room w-auto" value={level} onChange={(e) => setLevel(e.target.value as Level | '')} aria-label="Level">
              <option value="">Any level</option>{LEVELS.map((l) => <option key={l} value={l}>{l[0]!.toUpperCase() + l.slice(1)}</option>)}
            </select>
            <select className="rr-input rr-input-room w-auto" value={price} onChange={(e) => setPrice(e.target.value as '' | 'free' | 'paid')} aria-label="Price">
              <option value="">Free and paid</option><option value="free">Free</option><option value="paid">Paid</option>
            </select>
            <select className="rr-input rr-input-room w-auto" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
              <option value="new">Newest</option><option value="rating">Best rated</option><option value="popular">Most learners</option>
            </select>
          </div>

          <p className="rr-type mt-3 text-[13px] text-[#e8dcbc]" aria-live="polite">
            {data ? `${data.total} ${data.total === 1 ? 'course' : 'courses'}${category ? ` filed under ${category}` : ''}` : ' '}
          </p>

          {error && <p className="rr-room-error mt-3" role="alert">{error}</p>}
          {isLoading && !data ? (
            <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="rr-skeleton h-[190px]" />)}</div>
          ) : data && data.courses.length === 0 ? (
            <div className="rr-page mt-4 max-w-lg p-6" data-testid="rr-catalogue-empty">
              <p className="rr-book text-[20px]">{filtered ? 'No card matches that.' : 'The catalogue is empty.'}</p>
              <p className="mt-2 text-[14px] text-[var(--rr-ink-2)]">{filtered ? 'Try another word, or open a different drawer.' : 'Anyone can teach here: open Teaching to write the first course.'}</p>
            </div>
          ) : (
            <ul className={`mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3 transition-opacity ${isLoading ? 'opacity-60' : ''}`}>
              {(data?.courses || []).map((c) => (
                <li key={c.id}>
                  <button type="button" className="rr-card" onClick={() => onOpen(c.id)} data-testid={`rr-card-${c.id}`}>
                    <span className="rr-type flex items-center justify-between text-[12px] text-[var(--rr-ink-2)]">
                      <span>{callNumber(c)}</span>
                      <span className={`rr-stamp rr-type text-[12px] ${c.priceCC > 0 ? 'text-[var(--rr-red)]' : 'text-[var(--rr-good)]'}`}>{c.priceCC > 0 ? cc(c.priceCC) : 'FREE'}</span>
                    </span>
                    <span className="rr-type mt-3 text-[17px] leading-snug">{c.title}</span>
                    <span className="rr-type mt-0.5 text-[12.5px] text-[var(--rr-ink-2)]">by {c.creator.name}{c.creator.isMe ? ' (you)' : ''}</span>
                    <span className="rr-type mt-2 line-clamp-3 text-[12.5px] leading-[22px] text-[var(--rr-ink-2)]">{c.summary}</span>
                    <span className="rr-type mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-3 text-[12px] text-[var(--rr-ink-2)]">
                      <span>{c.lessons} {c.lessons === 1 ? 'lesson' : 'lessons'}{c.minutes ? ` · ${minutes(c.minutes)}` : ''}</span>
                      {c.rating != null && <span className="inline-flex items-center gap-1"><Star className="h-3 w-3 fill-current" aria-hidden />{c.rating.toFixed(1)} ({c.reviews})</span>}
                      <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" aria-hidden />{c.learners}</span>
                      {c.enrolled && <span className="font-bold text-[var(--rr-lamp)]">ON YOUR DESK</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
