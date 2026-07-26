'use client';

/**
 * Wave 8b — The Codex: the authored cosmology, finally reachable.
 *
 * The 87+ hand-authored lore events were oracle-context only — never shown.
 * This lens is a READER over the real `lore` domain (server/domains/lore.js —
 * register("lore", "list"|"get"|"facets"|"spine"); all public-read, hidden_truth
 * stripped server-side in lib/authored-lore.js). It lets a player browse/filter
 * the canon — the Three Pillars, the Concord Link, the Cascade, every world's
 * history — and (when signed in) bookmark entries into their own codex via the
 * generic per-user artifact store (`useLensData('codex','bookmark')`).
 *
 * Four explicit UX states are rendered: loading, error, empty (no matches), and
 * populated. Filters + the cosmology spine + bookmarks are all real backend
 * reads/writes — no mock/seed data lives in this file.
 *
 * Wave 3 rebuild: `lore.list` already returns significance/factions_involved/
 * known_by/tags on every event (server/lib/authored-lore.js#publicEvent) but
 * only description was rendered in the expanded row — the rest sat fetched and
 * unused. Now surfaced, plus tags are clickable cross-references (client-side
 * filter over the already-fetched set, no extra round-trip) so browsing one
 * entry's tag narrows the canon to every other entry that shares it — the
 * "related entries" pattern a compendium reader (Destiny 2's Lore Book, Hades'
 * Codex) is expected to have.
 *
 * Wave 4 gap-closure (docs/lens-specs/codex-capability-map.md — `lore.get`):
 * `/lenses/codex?id=<loreId>` resolves that one entry via the real `lore.get`
 * macro and shows it in a dedicated detail modal — independent of whatever
 * browse filters happen to be active, so a shared link always resolves even
 * if the linked entry would otherwise be filtered out of view. Every entry
 * also gets a "Copy permalink" control so the link is actually producible,
 * not just consumable.
 */

import { LensShell } from '@/components/lens/LensShell';
import { Suspense, useEffect, useMemo, useState, useCallback } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { lensRun } from '@/lib/api/client';
import { useLensData } from '@/lib/hooks/use-lens-data';

interface LoreEvent {
  id: string;
  title: string;
  type: string;
  era: string;
  description: string;
  significance?: string;
  world_id?: string;
  factions_involved?: string[];
  known_by?: string[];
  tags?: string[];
}
interface Facets { worlds: string[]; types: string[]; eras: string[]; count: number }

const COLORS = {
  fg: '#e8e4dc',
  panel: '#15151c',
  panelBorder: '#2a2a35',
  input: '#1a1a22',
  inputBorder: '#333',
  accent: 'rgba(120,90,200,0.08)',
  accentBorder: 'rgba(120,90,200,0.25)',
  error: '#ff8888',
  errorBg: 'rgba(200,60,60,0.08)',
  errorBorder: 'rgba(200,60,60,0.3)',
};

function CodexLensInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  // Deep-link id, e.g. /lenses/codex?id=lore_founding_compact.
  const deepLinkId = searchParams.get('id');

  const [facets, setFacets] = useState<Facets | null>(null);
  const [spine, setSpine] = useState<LoreEvent[]>([]);
  const [events, setEvents] = useState<LoreEvent[]>([]);
  const [world, setWorld] = useState<string>('');
  const [type, setType] = useState<string>('');
  const [q, setQ] = useState<string>('');
  // Tag filter is applied client-side: `lore.list` already returns tags on
  // every event, so no extra round-trip is needed. Clicking a tag on any
  // entry narrows the visible set to entries sharing that tag — a real
  // cross-reference path through the canon, not a cosmetic decoration.
  const [activeTag, setActiveTag] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  // Real per-user bookmark persistence over the generic artifact store. Reads are
  // public-safe (empty for anon); create is auth-gated and degrades gracefully.
  const {
    items: bookmarks,
    create: createBookmark,
    remove: removeBookmark,
  } = useLensData<{ loreId: string; title: string }>('codex', 'bookmark');
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const bookmarkByLoreId = useMemo(() => {
    const m = new Map<string, string>(); // loreId -> artifact id
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
      if (existing) {
        await removeBookmark(existing);
      } else {
        await createBookmark({ title: e.title, data: { loreId: e.id, title: e.title } });
      }
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : 'Sign in to keep a codex of your own.');
    }
  }, [bookmarkByLoreId, createBookmark, removeBookmark]);

  // Deep-link resolve: ?id=<loreId> fetches that one entry via the real
  // `lore.get` macro, independent of the current browse filters — a shared
  // link must resolve even when the linked entry wouldn't otherwise show up
  // in the (possibly filtered) list below.
  const [deepLink, setDeepLink] = useState<{ loading: boolean; error: string | null; event: LoreEvent | null }>(
    { loading: false, error: null, event: null },
  );

  useEffect(() => {
    if (!deepLinkId) { setDeepLink({ loading: false, error: null, event: null }); return; }
    let cancelled = false;
    setDeepLink({ loading: true, error: null, event: null });
    (async () => {
      const r = await lensRun('lore', 'get', { id: deepLinkId });
      if (cancelled) return;
      const event = r.data.ok ? ((r.data.result as { event?: LoreEvent } | null)?.event ?? null) : null;
      if (event) {
        setDeepLink({ loading: false, error: null, event });
      } else {
        setDeepLink({ loading: false, error: r.data.error || 'No entry matches this link.', event: null });
      }
    })();
    return () => { cancelled = true; };
  }, [deepLinkId]);

  const closeDeepLink = useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [router, pathname]);

  // Escape closes the deep-link modal — keyboard focus lives inside the
  // dialog (the Close button, the Copy permalink button), never on the
  // backdrop itself, so a document-level listener is the only way Escape
  // reaches the handler; the modal's own onKeyDown below is a redundant
  // second path for the rare case the backdrop itself is focused.
  useEffect(() => {
    if (!deepLinkId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDeepLink();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [deepLinkId, closeDeepLink]);

  // Copy-permalink: the producing side of the deep-link feature. Every entry
  // (list row + the deep-link modal itself) can generate its own shareable URL.
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyPermalink = useCallback((id: string) => {
    const base = typeof window !== 'undefined' ? window.location.origin : '';
    const url = `${base}${pathname}?id=${encodeURIComponent(id)}`;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        setCopiedId(id);
        setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500);
      }).catch(() => { /* clipboard permission denied — link is still valid, just not auto-copied */ });
    }
  }, [pathname]);

  // Cosmology header + filter facets — fetched once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const f = await lensRun('lore', 'facets', {});
      if (cancelled) return;
      if (f.data?.ok && f.data.result) setFacets((f.data.result as { facets: Facets }).facets);
      const s = await lensRun('lore', 'spine', {});
      if (cancelled) return;
      if (s.data?.ok && s.data.result) setSpine((s.data.result as { events: LoreEvent[] }).events || []);
    })();
    return () => { cancelled = true; };
  }, []);

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
    <LensShell lensId="codex">
    <div className="w-full max-w-[980px] mx-auto px-4 sm:px-6 py-6" style={{ color: COLORS.fg }}>
      {/* Deep-link detail modal — /lenses/codex?id=<loreId>, resolved via lore.get. */}
      {deepLinkId && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Codex entry detail"
          style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(0,0,0,0.6)' }}
          onClick={closeDeepLink}
          onKeyDown={(e) => { if (e.key === 'Escape') closeDeepLink(); }}
        >
          <div
            style={{ maxWidth: 640, width: '100%', maxHeight: '82vh', overflowY: 'auto', borderRadius: 12, padding: 20, background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}` }}
            onClick={(ev) => ev.stopPropagation()}
            onKeyDown={(ev) => { if (ev.key === 'Escape') closeDeepLink(); else ev.stopPropagation(); }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{deepLink.event?.title ?? 'Codex entry'}</h2>
              <button
                onClick={closeDeepLink}
                aria-label="Close entry detail"
                style={{ background: 'none', border: 'none', color: COLORS.fg, opacity: 0.6, cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 0 }}>
                ✕
              </button>
            </div>
            {deepLink.loading ? (
              <p role="status" style={{ opacity: 0.6, marginTop: 10 }}>Consulting the records…</p>
            ) : deepLink.error ? (
              <div role="alert" style={{ marginTop: 12, padding: 12, borderRadius: 8, color: COLORS.error, background: COLORS.errorBg, border: `1px solid ${COLORS.errorBorder}` }}>
                {deepLink.error}
              </div>
            ) : deepLink.event ? (
              <div style={{ marginTop: 10 }}>
                <p style={{ opacity: 0.5, fontSize: 13, margin: '0 0 10px' }}>
                  {deepLink.event.type} · {deepLink.event.era}{deepLink.event.world_id ? ` · ${deepLink.event.world_id}` : ''}
                </p>
                <p style={{ opacity: 0.85, margin: 0, lineHeight: 1.55 }}>{deepLink.event.description}</p>
                {deepLink.event.significance && (
                  <p style={{ opacity: 0.75, margin: '10px 0 0', lineHeight: 1.5, fontStyle: 'italic', borderLeft: `2px solid ${COLORS.accentBorder}`, paddingLeft: 10 }}>
                    {deepLink.event.significance}
                  </p>
                )}
                {(deepLink.event.factions_involved && deepLink.event.factions_involved.length > 0) && (
                  <p style={{ margin: '10px 0 0', fontSize: 13, opacity: 0.7 }}>
                    <strong style={{ opacity: 0.85 }}>Factions:</strong> {deepLink.event.factions_involved.join(', ')}
                  </p>
                )}
                {(deepLink.event.known_by && deepLink.event.known_by.length > 0) && (
                  <p style={{ margin: '4px 0 0', fontSize: 13, opacity: 0.7 }}>
                    <strong style={{ opacity: 0.85 }}>Known by:</strong> {deepLink.event.known_by.join(', ')}
                  </p>
                )}
                <button
                  onClick={() => copyPermalink(deepLink.event!.id)}
                  style={{ marginTop: 14, padding: '6px 14px', borderRadius: 8, background: COLORS.input, border: `1px solid ${COLORS.inputBorder}`, color: COLORS.fg, cursor: 'pointer', fontSize: 13 }}>
                  {copiedId === deepLink.event.id ? 'Copied!' : 'Copy permalink'}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}

      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>The Codex</h1>
      <p style={{ opacity: 0.7, marginBottom: 20 }}>
        The canon of Concordia — {facets?.count ?? '…'} recorded truths across {facets?.worlds.length ?? '…'} worlds.
        {bookmarks.length > 0 && <span> · {bookmarks.length} bookmarked</span>}
      </p>

      {/* Cosmology header — the Pantheon spine first. */}
      {spine.length > 0 && (
        <section aria-label="The Three Pillars" style={{ marginBottom: 24, padding: 16, borderRadius: 12, background: COLORS.accent, border: `1px solid ${COLORS.accentBorder}` }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>The Three Pillars</h2>
          <div style={{ display: 'grid', gap: 8 }}>
            {spine.filter(e => e.type === 'primordial').slice(0, 6).map(e => (
              <details key={e.id}>
                <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{e.title} <span style={{ opacity: 0.5, fontWeight: 400 }}>· {e.era}</span></summary>
                <p style={{ opacity: 0.85, margin: '6px 0 0', lineHeight: 1.5 }}>{e.description}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      {/* Filters */}
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
          <button
            onClick={() => setActiveTag('')}
            title="Clear tag filter"
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

      {/* Four explicit states: loading · error · empty · populated. */}
      <div aria-live="polite" aria-busy={loading}>
        {loading ? (
          <p role="status" style={{ opacity: 0.6 }}>Consulting the records…</p>
        ) : error ? (
          <div role="alert" style={{ padding: 16, borderRadius: 10, color: COLORS.error, background: COLORS.errorBg, border: `1px solid ${COLORS.errorBorder}` }}>
            <strong>The canon is unreachable.</strong>
            <p style={{ margin: '6px 0 10px', opacity: 0.85 }}>{error}</p>
            <button onClick={load} style={{ padding: '6px 14px', borderRadius: 8, background: COLORS.input, border: `1px solid ${COLORS.inputBorder}`, color: COLORS.fg, cursor: 'pointer' }}>
              Retry
            </button>
          </div>
        ) : tagFiltered.length === 0 ? (
          <div style={{ padding: 24, borderRadius: 10, textAlign: 'center', background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}` }}>
            <p style={{ fontWeight: 600, margin: '0 0 6px' }}>
              {hasFilters ? 'No truths match this query.' : 'The records are empty.'}
            </p>
            <p style={{ opacity: 0.7, margin: 0 }}>
              {hasFilters
                ? 'Loosen the filters to widen the search of the canon.'
                : 'The authored cosmology has not been seeded for this instance yet.'}
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
                    <article key={e.id}
                      className="transition-colors hover:border-violet-500/40"
                      style={{ padding: '10px 14px', borderRadius: 10, background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                        <button
                          aria-expanded={isOpen}
                          onClick={() => setOpen(isOpen ? null : e.id)}
                          style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', color: COLORS.fg, cursor: 'pointer', padding: 0, font: 'inherit' }}>
                          <strong>{e.title}</strong>
                          <span style={{ opacity: 0.5, fontSize: 13, whiteSpace: 'nowrap', marginLeft: 8 }}>{e.type} · {e.era}</span>
                        </button>
                        <button
                          aria-label={`Copy permalink for ${e.title}`}
                          onClick={() => copyPermalink(e.id)}
                          title="Copy permalink"
                          className="transition-colors"
                          style={{ background: 'none', border: 'none', color: copiedId === e.id ? '#8fe0a8' : COLORS.fg, opacity: copiedId === e.id ? 1 : 0.45, cursor: 'pointer', fontSize: 15, lineHeight: 1 }}>
                          {copiedId === e.id ? '✓' : '🔗'}
                        </button>
                        <button
                          aria-label={isBookmarked ? `Remove ${e.title} from your codex` : `Bookmark ${e.title} to your codex`}
                          aria-pressed={isBookmarked}
                          onClick={() => toggleBookmark(e)}
                          title={isBookmarked ? 'Bookmarked' : 'Bookmark'}
                          className="transition-colors"
                          style={{ background: 'none', border: 'none', color: isBookmarked ? '#cbb4ff' : COLORS.fg, opacity: isBookmarked ? 1 : 0.45, cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>
                          {isBookmarked ? '★' : '☆'}
                        </button>
                      </div>
                      {isOpen && (
                        <div style={{ marginTop: 8 }}>
                          <p style={{ opacity: 0.85, margin: 0, lineHeight: 1.55 }}>{e.description}</p>
                          {e.significance && (
                            <p style={{ opacity: 0.75, margin: '8px 0 0', lineHeight: 1.5, fontStyle: 'italic', borderLeft: `2px solid ${COLORS.accentBorder}`, paddingLeft: 10 }}>
                              {e.significance}
                            </p>
                          )}
                          {(e.factions_involved && e.factions_involved.length > 0) && (
                            <p style={{ margin: '8px 0 0', fontSize: 13, opacity: 0.7 }}>
                              <strong style={{ opacity: 0.85 }}>Factions:</strong> {e.factions_involved.join(', ')}
                            </p>
                          )}
                          {(e.known_by && e.known_by.length > 0) && (
                            <p style={{ margin: '4px 0 0', fontSize: 13, opacity: 0.7 }}>
                              <strong style={{ opacity: 0.85 }}>Known by:</strong> {e.known_by.join(', ')}
                            </p>
                          )}
                          {(e.tags && e.tags.length > 0) && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                              {e.tags.map(t => (
                                <button
                                  key={t}
                                  onClick={(ev) => { ev.stopPropagation(); setActiveTag(activeTag === t ? '' : t); }}
                                  title={`Filter the canon by #${t}`}
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
    </div>
    </LensShell>
  );
}

export default function CodexLensPage() {
  return (
    <Suspense fallback={null}>
      <CodexLensInner />
    </Suspense>
  );
}
