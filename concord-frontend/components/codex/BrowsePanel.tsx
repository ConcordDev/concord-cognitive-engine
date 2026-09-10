'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { lensRun } from '@/lib/api/client';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { COLORS, type Facets, type LoreEvent } from './types';

/** Canon browse — lore.list / facets + bookmark artifact store. */
export function BrowsePanel({
  facets, onFacets,
}: {
  facets: Facets | null;
  onFacets?: (f: Facets) => void;
}) {
  const pathname = usePathname();
  const [events, setEvents] = useState<LoreEvent[]>([]);
  const [world, setWorld] = useState('');
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [activeTag, setActiveTag] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { items: bookmarks, create: createBookmark, remove: removeBookmark } =
    useLensData<{ loreId: string; title: string }>('codex', 'bookmark');

  const bookmarkByLoreId = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of bookmarks) {
      const loreId = (b.data as { loreId?: string })?.loreId;
      if (loreId) m.set(loreId, b.id);
    }
    return m;
  }, [bookmarks]);

  const toggleBookmark = useCallback(async (e: LoreEvent) => {
    setSaveErr(null);
    try {
      const existing = bookmarkByLoreId.get(e.id);
      if (existing) await removeBookmark(existing);
      else await createBookmark({ title: e.title, data: { loreId: e.id, title: e.title } });
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : 'Sign in to keep a codex of your own.');
    }
  }, [bookmarkByLoreId, createBookmark, removeBookmark]);

  const copyPermalink = useCallback((id: string) => {
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
    const url = `${baseUrl}${pathname}?id=${encodeURIComponent(id)}`;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        setCopiedId(id);
        setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500);
      }).catch(() => {});
    }
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const f = await lensRun('lore', 'facets', {});
      if (cancelled) return;
      if (f.data?.ok && f.data.result) onFacets?.((f.data.result as { facets: Facets }).facets);
    })();
    return () => { cancelled = true; };
  }, [onFacets]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await lensRun('lore', 'list', {
      worldId: world || undefined, type: type || undefined, q: q || undefined, limit: 500,
    });
    if (r.data?.ok && r.data.result) {
      setEvents((r.data.result as { events: LoreEvent[] }).events || []);
    } else {
      setError(r.data?.error || 'The records could not be consulted.');
      setEvents([]);
    }
    setLoading(false);
  }, [world, type, q]);

  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);

  const tagFiltered = useMemo(
    () => activeTag ? events.filter(e => (e.tags || []).includes(activeTag)) : events,
    [events, activeTag],
  );

  const grouped = useMemo(() => {
    const m = new Map<string, LoreEvent[]>();
    for (const e of tagFiltered) {
      const k = e.world_id || 'concordia-hub';
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [tagFiltered]);

  const hasFilters = !!(world || type || q.trim() || activeTag);

  return (
    <>
      <div role="search" className="flex flex-col sm:flex-row sm:flex-wrap gap-2 mb-4">
        <input aria-label="Search the canon" placeholder="Search the canon…" value={q} onChange={e => setQ(e.target.value)}
          style={{ flex: 1, minWidth: 200, padding: '8px 12px', borderRadius: 8, background: COLORS.input, border: `1px solid ${COLORS.inputBorder}`, color: COLORS.fg }} />
        <select aria-label="Filter by world" value={world} onChange={e => setWorld(e.target.value)} style={{ padding: '8px 12px', borderRadius: 8, background: COLORS.input, border: `1px solid ${COLORS.inputBorder}`, color: COLORS.fg }}>
          <option value="">All worlds</option>
          {facets?.worlds.map(w => <option key={w} value={w}>{w}</option>)}
        </select>
        <select aria-label="Filter by kind" value={type} onChange={e => setType(e.target.value)} style={{ padding: '8px 12px', borderRadius: 8, background: COLORS.input, border: `1px solid ${COLORS.inputBorder}`, color: COLORS.fg }}>
          <option value="">All kinds</option>
          {facets?.types.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        {activeTag && (
          <button onClick={() => setActiveTag('')} title="Clear tag filter"
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 999, background: COLORS.accent, border: `1px solid ${COLORS.accentBorder}`, color: COLORS.fg, cursor: 'pointer', fontSize: 13 }}>
            #{activeTag} ✕
          </button>
        )}
      </div>

      {saveErr && (
        <p role="status" style={{ margin: '0 0 12px', padding: '8px 12px', borderRadius: 8, color: COLORS.error, background: COLORS.errorBg, border: `1px solid ${COLORS.errorBorder}`, fontSize: 14 }}>
          {saveErr}
        </p>
      )}

      <div aria-live="polite" aria-busy={loading}>
        {loading ? (
          <p role="status" style={{ opacity: 0.6 }}>Consulting the records…</p>
        ) : error ? (
          <div role="alert" style={{ padding: 16, borderRadius: 10, color: COLORS.error, background: COLORS.errorBg, border: `1px solid ${COLORS.errorBorder}` }}>
            <strong>The canon is unreachable.</strong>
            <p style={{ margin: '6px 0 10px', opacity: 0.85 }}>{error}</p>
            <button onClick={load} style={{ padding: '6px 14px', borderRadius: 8, background: COLORS.input, border: `1px solid ${COLORS.inputBorder}`, color: COLORS.fg, cursor: 'pointer' }}>Retry</button>
          </div>
        ) : tagFiltered.length === 0 ? (
          <div style={{ padding: 24, borderRadius: 10, textAlign: 'center', background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}` }}>
            <p style={{ fontWeight: 600, margin: '0 0 6px' }}>{hasFilters ? 'No truths match this query.' : 'The records are empty.'}</p>
            <p style={{ opacity: 0.7, margin: 0 }}>
              {hasFilters ? 'Loosen the filters to widen the search of the canon.' : 'The authored cosmology has not been seeded for this instance yet.'}
            </p>
            {hasFilters && (
              <button onClick={() => { setWorld(''); setType(''); setQ(''); setActiveTag(''); }} style={{ marginTop: 12, padding: '6px 14px', borderRadius: 8, background: COLORS.input, border: `1px solid ${COLORS.inputBorder}`, color: COLORS.fg, cursor: 'pointer' }}>
                Clear filters
              </button>
            )}
          </div>
        ) : (
          grouped.map(([w, evs]) => (
            <section key={w} aria-label={`Canon of ${w}`} style={{ marginBottom: 20 }}>
              <h3 style={{ fontSize: 15, textTransform: 'uppercase', letterSpacing: 1, opacity: 0.6, margin: '0 0 8px' }}>{w}</h3>
              <div style={{ display: 'grid', gap: 6 }}>
                {evs.map(e => {
                  const isOpen = open === e.id;
                  const isBookmarked = bookmarkByLoreId.has(e.id);
                  return (
                    <article key={e.id} className="transition-colors hover:border-violet-500/40"
                      style={{ padding: '10px 14px', borderRadius: 10, background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                        <button aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : e.id)}
                          style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', color: COLORS.fg, cursor: 'pointer', padding: 0, font: 'inherit' }}>
                          <strong>{e.title}</strong>
                          <span style={{ opacity: 0.5, fontSize: 13, whiteSpace: 'nowrap', marginLeft: 8 }}>{e.type} · {e.era}</span>
                        </button>
                        <button aria-label={`Copy permalink for ${e.title}`} onClick={() => copyPermalink(e.id)} title="Copy permalink" className="transition-colors"
                          style={{ background: 'none', border: 'none', color: copiedId === e.id ? '#8fe0a8' : COLORS.fg, opacity: copiedId === e.id ? 1 : 0.45, cursor: 'pointer', fontSize: 15, lineHeight: 1 }}>
                          {copiedId === e.id ? '✓' : '🔗'}
                        </button>
                        <button
                          aria-label={isBookmarked ? `Remove ${e.title} from your codex` : `Bookmark ${e.title} to your codex`}
                          aria-pressed={isBookmarked}
                          onClick={() => toggleBookmark(e)}
                          title={isBookmarked ? 'Bookmarked' : 'Bookmark'}
                          className="transition-colors"
                          style={{ background: 'none', border: 'none', color: isBookmarked ? '#cbb4ff' : COLORS.fg, opacity: isBookmarked ? 1 : 0.45, cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
                        >
                          {isBookmarked ? '★' : '☆'}
                        </button>
                      </div>
                      {isOpen && (
                        <div style={{ marginTop: 8 }}>
                          <p style={{ opacity: 0.85, margin: 0, lineHeight: 1.55 }}>{e.description}</p>
                          {e.significance && (
                            <p style={{ opacity: 0.75, margin: '8px 0 0', lineHeight: 1.5, fontStyle: 'italic', borderLeft: `2px solid ${COLORS.accentBorder}`, paddingLeft: 10 }}>{e.significance}</p>
                          )}
                          {(e.factions_involved && e.factions_involved.length > 0) && (
                            <p style={{ margin: '8px 0 0', fontSize: 13, opacity: 0.7 }}><strong style={{ opacity: 0.85 }}>Factions:</strong> {e.factions_involved.join(', ')}</p>
                          )}
                          {(e.known_by && e.known_by.length > 0) && (
                            <p style={{ margin: '4px 0 0', fontSize: 13, opacity: 0.7 }}><strong style={{ opacity: 0.85 }}>Known by:</strong> {e.known_by.join(', ')}</p>
                          )}
                          {(e.tags && e.tags.length > 0) && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                              {e.tags.map(t => (
                                <button key={t} onClick={(ev) => { ev.stopPropagation(); setActiveTag(activeTag === t ? '' : t); }} title={`Filter the canon by #${t}`}
                                  style={{
                                    fontSize: 12, padding: '2px 8px', borderRadius: 999, cursor: 'pointer',
                                    background: activeTag === t ? COLORS.accent : 'transparent',
                                    border: `1px solid ${activeTag === t ? COLORS.accentBorder : COLORS.panelBorder}`,
                                    color: COLORS.fg, opacity: activeTag === t ? 1 : 0.7,
                                  }}>
                                  #{t}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
      {bookmarks.length > 0 && (
        <p style={{ opacity: 0.6, fontSize: 13, marginTop: 12 }}>{bookmarks.length} bookmarked</p>
      )}
    </>
  );
}
