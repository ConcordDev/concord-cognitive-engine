'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PersonaMarketplace — discover/search published personas. Wires
 * personas.browse + personas.facets for full text + tag + category filtering.
 */

import { useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';

interface PersonaCard {
  id: string;
  name: string;
  tagline: string;
  category: string;
  tags: string[];
  portrait: string;
  authorUserId: string;
  rating: number;
  ratingCount: number;
  installCount: number;
  chatCount: number;
}

interface Facet { name: string; count: number }

export function PersonaMarketplace({ onOpen }: { onOpen: (personaId: string) => void }) {
  const [rows, setRows] = useState<PersonaCard[]>([]);
  const [total, setTotal] = useState(0);
  const [tags, setTags] = useState<Facet[]>([]);
  const [categories, setCategories] = useState<Facet[]>([]);
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState<'popular' | 'recent' | 'rating'>('popular');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [b, f] = await Promise.all([
        lensRun('personas', 'browse', { query, tag, category, sort }),
        lensRun('personas', 'facets', {}),
      ]);
      if (b.data?.ok) {
        const res = b.data.result as any;
        setRows((res.personas || []) as PersonaCard[]);
        setTotal(res.total || 0);
      } else {
        // Fail closed: an unreachable browse macro must surface, not render
        // as an empty (but "loaded") marketplace.
        setError(b.data?.error || 'Could not load the marketplace.');
      }
      if (f.data?.ok) {
        const res = f.data.result as any;
        setTags((res.tags || []) as Facet[]);
        setCategories((res.categories || []) as Facet[]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the marketplace.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag, category, sort]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          type="text" value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void load(); }}
          placeholder="Search published personas…"
          className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100"
        />
        <button
          type="button" onClick={load}
          className="px-4 bg-purple-700 hover:bg-purple-600 text-white text-sm rounded-lg"
        >Search</button>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={sort} onChange={(e) => setSort(e.target.value as any)}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-200"
        >
          <option value="popular">Most popular</option>
          <option value="recent">Recently updated</option>
          <option value="rating">Highest rated</option>
        </select>
        {category && (
          <button
            type="button" onClick={() => setCategory('')}
            className="text-[11px] text-cyan-300 bg-cyan-950/40 rounded px-2 py-1"
          >category: {category} ✕</button>
        )}
        {tag && (
          <button
            type="button" onClick={() => setTag('')}
            className="text-[11px] text-purple-300 bg-purple-950/40 rounded px-2 py-1"
          >#{tag} ✕</button>
        )}
      </div>

      {(categories.length > 0 || tags.length > 0) && (
        <div className="flex flex-wrap gap-1">
          {categories.map((c) => (
            <button
              key={c.name} type="button"
              onClick={() => setCategory(category === c.name ? '' : c.name)}
              className={`text-[10px] rounded px-1.5 py-0.5 ${
                category === c.name
                  ? 'bg-cyan-700 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
              }`}
            >{c.name} ({c.count})</button>
          ))}
          {tags.map((t) => (
            <button
              key={t.name} type="button"
              onClick={() => setTag(tag === t.name ? '' : t.name)}
              className={`text-[10px] rounded px-1.5 py-0.5 ${
                tag === t.name
                  ? 'bg-purple-700 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
              }`}
            >#{t.name} ({t.count})</button>
          ))}
        </div>
      )}

      {loading ? (
        <div role="status" aria-live="polite" className="text-zinc-400 py-6 text-center">Loading marketplace…</div>
      ) : error ? (
        <div role="alert" className="text-center py-8 border border-red-800/50 bg-red-950/30 rounded-xl">
          <p className="text-sm text-red-300">{error}</p>
          <button
            type="button" onClick={load}
            className="mt-3 text-xs text-red-200 underline hover:text-red-100 focus:outline-none focus:ring-2 focus:ring-amber-500 rounded"
          >Retry</button>
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center text-zinc-400 italic py-8 border border-zinc-800 rounded-xl">
          No published personas match. Author one and publish it to seed the marketplace.
        </div>
      ) : (
        <>
          <p className="text-[11px] text-zinc-400">{total} persona{total === 1 ? '' : 's'}</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {rows.map((p) => (
              <li key={p.id}>
                <button
                  type="button" onClick={() => onOpen(p.id)}
                  className="w-full text-left flex gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 hover:border-purple-700/60"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.portrait} alt={p.name} className="h-14 w-14 rounded-lg flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-zinc-100 truncate">{p.name}</div>
                    <div className="text-[11px] text-zinc-400 truncate">{p.tagline || p.category}</div>
                    <div className="text-[10px] text-zinc-400 mt-0.5">
                      ★ {p.rating || '—'} · {p.installCount} installs · {p.chatCount} chats
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
