/* eslint-disable @next/next/no-img-element */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  Search, Loader2, Eye, Heart, MessageSquare, ImageIcon, Tag, Hash,
} from 'lucide-react';

interface SearchProject {
  id: string; userId: string; title: string; description: string; discipline: string;
  tags: string[]; coverUrl: string; images: { url: string }[];
  views: number; appreciations: number; commentCount: number; createdAt: string;
}
interface TagEntry { tag: string; count: number }
interface DisciplineEntry { discipline: string; count: number }

const SORTS = [
  { id: 'recent', label: 'Recent' },
  { id: 'appreciated', label: 'Most Appreciated' },
  { id: 'viewed', label: 'Most Viewed' },
];

export function DisciplineSearch() {
  const [query, setQuery] = useState('');
  const [discipline, setDiscipline] = useState('');
  const [tag, setTag] = useState('');
  const [sort, setSort] = useState('recent');
  const [results, setResults] = useState<SearchProject[]>([]);
  const [tags, setTags] = useState<TagEntry[]>([]);
  const [disciplines, setDisciplines] = useState<DisciplineEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const loadCloud = useCallback(async () => {
    const r = await lensRun('artistry', 'tagCloud', {});
    if (r.data?.ok) {
      setTags((r.data.result.tags as TagEntry[]) || []);
      setDisciplines((r.data.result.disciplines as DisciplineEntry[]) || []);
    }
  }, []);

  const runSearch = useCallback(async (opts?: { discipline?: string; tag?: string }) => {
    setLoading(true);
    setSearched(true);
    const r = await lensRun('artistry', 'search', {
      query, sort,
      discipline: opts?.discipline ?? discipline,
      tag: opts?.tag ?? tag,
    });
    if (r.data?.ok) setResults((r.data.result.results as SearchProject[]) || []);
    setLoading(false);
  }, [query, sort, discipline, tag]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadCloud(); runSearch(); }, []);

  const maxTagCount = Math.max(1, ...tags.map((t) => t.count));

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold flex items-center gap-2">
        <Search className="w-5 h-5 text-neon-pink" /> Browse by Discipline
      </h2>

      {/* Search bar */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
            placeholder="Search projects by title, tag, description..."
            className="w-full pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-neon-pink/50"
          />
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm">
          {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <button onClick={() => runSearch()} className="px-4 py-2 bg-neon-pink/20 rounded-lg text-sm hover:bg-neon-pink/30">Search</button>
      </div>

      {/* Active filters */}
      {(discipline || tag) && (
        <div className="flex flex-wrap gap-2 items-center text-xs">
          {discipline && (
            <span className="px-2 py-1 bg-neon-cyan/10 border border-neon-cyan/20 rounded-full text-neon-cyan flex items-center gap-1">
              <Tag className="w-3 h-3" /> {discipline}
              <button onClick={() => { setDiscipline(''); runSearch({ discipline: '' }); }} aria-label="Clear discipline">×</button>
            </span>
          )}
          {tag && (
            <span className="px-2 py-1 bg-neon-pink/10 border border-neon-pink/20 rounded-full text-neon-pink flex items-center gap-1">
              <Hash className="w-3 h-3" /> {tag}
              <button onClick={() => { setTag(''); runSearch({ tag: '' }); }} aria-label="Clear tag">×</button>
            </span>
          )}
        </div>
      )}

      {/* Discipline chips */}
      {disciplines.length > 0 && (
        <div>
          <h4 className="text-[10px] text-gray-500 uppercase mb-2">Disciplines</h4>
          <div className="flex flex-wrap gap-1.5">
            {disciplines.map((d) => (
              <button
                key={d.discipline}
                onClick={() => { setDiscipline(d.discipline); runSearch({ discipline: d.discipline }); }}
                className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                  discipline === d.discipline
                    ? 'bg-neon-cyan/20 border-neon-cyan/40 text-neon-cyan'
                    : 'bg-white/5 border-white/10 text-gray-400 hover:border-neon-cyan/30'
                }`}
              >
                {d.discipline} <span className="text-gray-600">({d.count})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tag cloud */}
      {tags.length > 0 && (
        <div>
          <h4 className="text-[10px] text-gray-500 uppercase mb-2">Tag Cloud</h4>
          <div className="flex flex-wrap gap-2 items-baseline">
            {tags.slice(0, 40).map((t) => {
              const scale = 0.7 + (t.count / maxTagCount) * 0.9;
              return (
                <button
                  key={t.tag}
                  onClick={() => { setTag(t.tag); runSearch({ tag: t.tag }); }}
                  className={`hover:text-neon-pink transition-colors ${tag === t.tag ? 'text-neon-pink' : 'text-gray-400'}`}
                  style={{ fontSize: `${scale}rem` }}
                >
                  #{t.tag}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Results */}
      <div>
        <h4 className="text-[10px] text-gray-500 uppercase mb-2">
          {searched ? `${results.length} ${results.length === 1 ? 'result' : 'results'}` : 'Results'}
        </h4>
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-neon-pink" /></div>
        ) : results.length === 0 ? (
          <div className="text-center py-10 text-gray-500 text-sm">No projects match your search.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {results.map((p) => (
              <div key={p.id} className="bg-white/5 border border-white/10 rounded-lg overflow-hidden hover:border-neon-pink/30 transition-colors">
                <div className="aspect-video bg-white/5 flex items-center justify-center overflow-hidden">
                  {(p.coverUrl || p.images?.[0]?.url)
                    ? <img src={p.coverUrl || p.images[0].url} alt={p.title} className="w-full h-full object-cover" />
                    : <ImageIcon className="w-7 h-7 text-gray-600" />}
                </div>
                <div className="p-3">
                  <h3 className="font-medium text-sm truncate">{p.title}</h3>
                  <div className="text-[11px] text-gray-500">by {p.userId} · {p.discipline}</div>
                  <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-500">
                    <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{p.views}</span>
                    <span className="flex items-center gap-1"><Heart className="w-3 h-3" />{p.appreciations}</span>
                    <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" />{p.commentCount}</span>
                  </div>
                  {p.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {p.tags.slice(0, 3).map((t) => <span key={t} className="text-[10px] px-1.5 py-0.5 bg-white/5 rounded text-gray-500">#{t}</span>)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
