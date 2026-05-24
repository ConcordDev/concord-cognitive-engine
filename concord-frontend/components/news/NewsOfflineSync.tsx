'use client';

/**
 * NewsOfflineSync — save-for-later offline reading. Articles synced via
 * `news.offline-sync` carry a self-contained snapshot (title/summary/source)
 * so they read without a live fetch. Snapshots are also cached to
 * localStorage so they survive a page reload while offline.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, WifiOff, Download, Trash2, ExternalLink, CloudOff } from 'lucide-react';

import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface DirArticle {
  id: string;
  title: string;
  source: string;
  topic: string;
}

interface OfflineArticle {
  articleId: string;
  title: string;
  summary: string | null;
  source: string;
  topic: string;
  url: string | null;
  publishedAt: string;
  syncedAt: string;
}

const LS_KEY = 'news:offline-cache';

export function NewsOfflineSync() {
  const [articles, setArticles] = useState<DirArticle[]>([]);
  const [offline, setOffline] = useState<OfflineArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (typeof navigator !== 'undefined') setOnline(navigator.onLine);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  const cacheLocally = useCallback((items: OfflineArticle[]) => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(items));
    } catch {
      /* storage may be full / unavailable */
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      // Offline: hydrate from the localStorage snapshot only.
      try {
        const raw = localStorage.getItem(LS_KEY);
        setOffline(raw ? (JSON.parse(raw) as OfflineArticle[]) : []);
      } catch {
        setOffline([]);
      }
      setArticles([]);
      setLoading(false);
      return;
    }
    const [dir, off] = await Promise.all([
      lensRun('news', 'article-list', {}),
      lensRun('news', 'offline-list', {}),
    ]);
    if (dir.data?.ok) setArticles((dir.data.result?.articles as DirArticle[]) || []);
    if (off.data?.ok) {
      const items = (off.data.result?.articles as OfflineArticle[]) || [];
      setOffline(items);
      cacheLocally(items);
    }
    setLoading(false);
  }, [cacheLocally]);

  useEffect(() => { void refresh(); }, [refresh]);

  const toggleSync = useCallback(async (id: string) => {
    setBusy(id);
    await lensRun('news', 'offline-sync', { id });
    await refresh();
    setBusy(null);
  }, [refresh]);

  const syncedIds = new Set(offline.map((o) => o.articleId));
  const available = articles.filter((a) => !syncedIds.has(a.id));

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-teal-600/15 to-transparent">
        <WifiOff className="w-5 h-5 text-teal-400" />
        <h2 className="text-sm font-bold text-zinc-100">Offline Reading</h2>
        <span
          className={cn(
            'text-[10px] px-1.5 py-0.5 rounded-full ml-auto',
            online ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300',
          )}
        >
          {online ? 'Online' : 'Offline'}
        </span>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-zinc-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : (
        <div className="p-3 space-y-4">
          {/* Saved offline */}
          <section>
            <h3 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300 mb-2">
              <CloudOff className="w-3.5 h-3.5 text-teal-400" />
              Saved for offline <span className="text-zinc-600">· {offline.length}</span>
            </h3>
            {offline.length === 0 ? (
              <p className="text-[11px] text-zinc-400 italic">
                Nothing saved yet — sync an article below to read it offline.
              </p>
            ) : (
              <ul className="space-y-2">
                {offline.map((o) => (
                  <li key={o.articleId} className="bg-zinc-900/70 border border-teal-500/20 rounded-xl p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-zinc-100">{o.title}</p>
                        <p className="text-[10px] text-zinc-400">
                          {o.source} · <span className="capitalize">{o.topic}</span> · synced{' '}
                          {String(o.syncedAt).slice(0, 10)}
                        </p>
                      </div>
                      {online && (
                        <button
                          type="button"
                          disabled={busy === o.articleId}
                          onClick={() => void toggleSync(o.articleId)}
                          className="text-zinc-600 hover:text-red-400 shrink-0 disabled:opacity-40"
                          aria-label="Remove from offline"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    {o.summary && (
                      <p className="text-[11px] text-zinc-400 mt-1">{o.summary}</p>
                    )}
                    {o.url && online && (
                      <a
                        href={o.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[10px] text-teal-400 hover:text-teal-300 mt-1"
                      >
                        <ExternalLink className="w-3 h-3" /> Open source
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Available to sync */}
          {online && (
            <section>
              <h3 className="text-xs font-semibold text-zinc-300 mb-2">
                Available to sync <span className="text-zinc-600">· {available.length}</span>
              </h3>
              {available.length === 0 ? (
                <p className="text-[11px] text-zinc-400 italic">
                  {articles.length === 0
                    ? 'No data yet — add articles to the news directory.'
                    : 'Every article is already saved offline.'}
                </p>
              ) : (
                <ul className="divide-y divide-zinc-800 border border-zinc-800 rounded-xl">
                  {available.map((a) => (
                    <li key={a.id} className="flex items-center gap-2 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-zinc-100 truncate">{a.title}</p>
                        <p className="text-[10px] text-zinc-400">{a.source}</p>
                      </div>
                      <button
                        type="button"
                        disabled={busy === a.id}
                        onClick={() => void toggleSync(a.id)}
                        className="flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-lg bg-teal-600 hover:bg-teal-500 text-white disabled:opacity-40"
                      >
                        <Download className="w-3 h-3" /> Sync
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
