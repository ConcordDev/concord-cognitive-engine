'use client';

/**
 * PoetryDiscovery — curated discovery surface for the poetry lens.
 * Covers three backlog items: poem-a-day / themed collections,
 * reading history, and favorites. Every poem is fetched live from
 * PoetryDB; nothing is hardcoded.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Sun, Sparkles, Heart, HeartOff, BookMarked, Clock, Loader2, RefreshCw,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface DiscoveredPoem {
  title: string;
  author: string;
  lines: string[];
  lineCount: number;
}
interface Theme { id: string; label: string; authorCount: number }
interface Favorite {
  id: string; title: string; author: string; lines: string[];
  lineCount: number; savedAt: string;
}
interface HistoryEntry {
  id: string; title: string; author: string; readCount: number; lastReadAt: string;
}

type DiscoveryTab = 'today' | 'themes' | 'favorites' | 'history';

function PoemCard({
  poem, isFavorite, onFavorite, onUnfavorite, onRead,
}: {
  poem: DiscoveredPoem;
  isFavorite: boolean;
  onFavorite: () => void;
  onUnfavorite: () => void;
  onRead: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="flex items-start justify-between gap-2">
        <button
          onClick={() => { setOpen(o => !o); if (!open) onRead(); }}
          className="text-left flex-1"
        >
          <p className="text-sm font-semibold text-zinc-100 italic">{poem.title}</p>
          <p className="text-[11px] text-zinc-400">{poem.author} · {poem.lineCount} lines</p>
        </button>
        <button
          onClick={isFavorite ? onUnfavorite : onFavorite}
          aria-label={isFavorite ? 'Remove favorite' : 'Add favorite'}
          className={cn('p-1 rounded', isFavorite ? 'text-rose-400' : 'text-zinc-400 hover:text-rose-300')}
        >
          {isFavorite ? <Heart className="w-4 h-4 fill-current" /> : <Heart className="w-4 h-4" />}
        </button>
      </div>
      {open && (
        <pre className="mt-2 text-xs text-zinc-300 font-serif whitespace-pre-wrap leading-relaxed">
          {poem.lines.join('\n')}
        </pre>
      )}
    </div>
  );
}

export function PoetryDiscovery() {
  const [tab, setTab] = useState<DiscoveryTab>('today');
  const [potd, setPotd] = useState<DiscoveredPoem | null>(null);
  const [potdDate, setPotdDate] = useState('');
  const [themes, setThemes] = useState<Theme[]>([]);
  const [activeTheme, setActiveTheme] = useState<string | null>(null);
  const [themePoems, setThemePoems] = useState<DiscoveredPoem[]>([]);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const favRefs = new Set(favorites.map(f => `${f.author.toLowerCase()}::${f.title.toLowerCase()}`));

  const loadFavorites = useCallback(async () => {
    const r = await lensRun('poetry', 'favorite-list', {});
    if (r.data?.ok) setFavorites((r.data.result?.favorites as Favorite[]) || []);
  }, []);
  const loadHistory = useCallback(async () => {
    const r = await lensRun('poetry', 'reading-history', { limit: 50 });
    if (r.data?.ok) setHistory((r.data.result?.history as HistoryEntry[]) || []);
  }, []);
  const loadThemes = useCallback(async () => {
    const r = await lensRun('poetry', 'discovery-themes', {});
    if (r.data?.ok) setThemes((r.data.result?.themes as Theme[]) || []);
  }, []);
  const loadPotd = useCallback(async () => {
    setLoading(true); setError(null);
    const r = await lensRun('poetry', 'poem-of-the-day', {});
    if (r.data?.ok) {
      setPotd(r.data.result?.poem as DiscoveredPoem);
      setPotdDate((r.data.result?.date as string) || '');
    } else {
      setError((r.data?.error as string) || 'poem-of-the-day unavailable');
    }
    setLoading(false);
  }, []);

  useEffect(() => { void loadPotd(); void loadThemes(); void loadFavorites(); void loadHistory(); },
    [loadPotd, loadThemes, loadFavorites, loadHistory]);

  const openTheme = useCallback(async (id: string) => {
    setActiveTheme(id); setLoading(true); setError(null); setThemePoems([]);
    const r = await lensRun('poetry', 'themed-collection', { themeId: id, perAuthor: 2 });
    if (r.data?.ok) setThemePoems((r.data.result?.poems as DiscoveredPoem[]) || []);
    else setError((r.data?.error as string) || 'theme unavailable');
    setLoading(false);
  }, []);

  const favorite = useCallback(async (p: DiscoveredPoem) => {
    await lensRun('poetry', 'favorite-add', {
      title: p.title, author: p.author, lines: p.lines, source: 'poetrydb',
    });
    await loadFavorites();
  }, [loadFavorites]);
  const unfavorite = useCallback(async (p: DiscoveredPoem) => {
    const ref = `${p.author.toLowerCase()}::${p.title.toLowerCase()}`;
    const fav = favorites.find(f => `${f.author.toLowerCase()}::${f.title.toLowerCase()}` === ref);
    if (fav) { await lensRun('poetry', 'favorite-remove', { id: fav.id }); await loadFavorites(); }
  }, [favorites, loadFavorites]);
  const removeFav = useCallback(async (id: string) => {
    await lensRun('poetry', 'favorite-remove', { id });
    await loadFavorites();
  }, [loadFavorites]);
  const logRead = useCallback(async (p: DiscoveredPoem) => {
    await lensRun('poetry', 'reading-log', { title: p.title, author: p.author, source: 'poetrydb' });
    await loadHistory();
  }, [loadHistory]);

  const TABS: { id: DiscoveryTab; label: string; icon: typeof Sun }[] = [
    { id: 'today', label: 'Poem a Day', icon: Sun },
    { id: 'themes', label: 'Collections', icon: Sparkles },
    { id: 'favorites', label: `Favorites${favorites.length ? ` (${favorites.length})` : ''}`, icon: BookMarked },
    { id: 'history', label: 'Reading Log', icon: Clock },
  ];

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-amber-300" />
        <h3 className="text-sm font-bold text-zinc-100">Discover Poetry</h3>
      </div>

      <div className="flex flex-wrap gap-1 mb-3">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs',
              tab === t.id ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                : 'bg-zinc-900/60 text-zinc-400 border border-zinc-800 hover:text-zinc-200')}>
            <t.icon className="w-3.5 h-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {error && <p className="text-xs text-rose-400 mb-2">{error}</p>}

      {/* Poem a day */}
      {tab === 'today' && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] text-zinc-400">{potdDate || 'Featured today'}</span>
            <button onClick={loadPotd} className="text-zinc-400 hover:text-zinc-200" aria-label="Refresh">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
          {loading && !potd && <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />}
          {!loading && !potd && !error && <p className="text-xs text-zinc-400 italic">No data yet.</p>}
          {potd && (
            <PoemCard
              poem={potd}
              isFavorite={favRefs.has(`${potd.author.toLowerCase()}::${potd.title.toLowerCase()}`)}
              onFavorite={() => favorite(potd)}
              onUnfavorite={() => unfavorite(potd)}
              onRead={() => logRead(potd)}
            />
          )}
        </div>
      )}

      {/* Themed collections */}
      {tab === 'themes' && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {themes.length === 0 && <p className="text-xs text-zinc-400 italic">No data yet.</p>}
            {themes.map(th => (
              <button key={th.id} onClick={() => openTheme(th.id)}
                className={cn('px-2.5 py-1 rounded-lg text-xs border',
                  activeTheme === th.id ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                    : 'bg-zinc-900/60 text-zinc-300 border-zinc-800 hover:border-zinc-700')}>
                {th.label} <span className="text-zinc-600">· {th.authorCount}</span>
              </button>
            ))}
          </div>
          {loading && activeTheme && <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />}
          {!loading && activeTheme && themePoems.length === 0 && !error && (
            <p className="text-xs text-zinc-400 italic">No poems for this theme yet.</p>
          )}
          <div className="space-y-2">
            {themePoems.map((p, i) => (
              <PoemCard key={`${p.author}-${p.title}-${i}`} poem={p}
                isFavorite={favRefs.has(`${p.author.toLowerCase()}::${p.title.toLowerCase()}`)}
                onFavorite={() => favorite(p)}
                onUnfavorite={() => unfavorite(p)}
                onRead={() => logRead(p)} />
            ))}
          </div>
        </div>
      )}

      {/* Favorites */}
      {tab === 'favorites' && (
        <div className="space-y-2">
          {favorites.length === 0 && (
            <p className="text-xs text-zinc-400 italic">
              No favorites yet — bookmark poems from Poem a Day or Collections.
            </p>
          )}
          {favorites.map(f => (
            <div key={f.id} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-zinc-100 italic">{f.title}</p>
                  <p className="text-[11px] text-zinc-400">
                    {f.author} · saved {new Date(f.savedAt).toLocaleDateString()}
                  </p>
                </div>
                <button onClick={() => removeFav(f.id)} aria-label="Remove favorite"
                  className="p-1 text-zinc-400 hover:text-rose-300">
                  <HeartOff className="w-4 h-4" />
                </button>
              </div>
              {f.lines.length > 0 && (
                <pre className="mt-2 text-xs text-zinc-400 font-serif whitespace-pre-wrap line-clamp-4">
                  {f.lines.join('\n')}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Reading history */}
      {tab === 'history' && (
        <div className="space-y-1.5">
          {history.length === 0 && (
            <p className="text-xs text-zinc-400 italic">No reading history yet — open a poem to log it.</p>
          )}
          {history.map(h => (
            <div key={h.id} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2">
              <div>
                <p className="text-xs font-semibold text-zinc-200 italic">{h.title}</p>
                <p className="text-[10px] text-zinc-400">{h.author}</p>
              </div>
              <div className="text-right">
                <p className="text-[11px] text-amber-300">read ×{h.readCount}</p>
                <p className="text-[10px] text-zinc-400">{new Date(h.lastReadAt).toLocaleDateString()}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
