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
 */

import { LensShell } from '@/components/lens/LensShell';
import { useEffect, useMemo, useState, useCallback } from 'react';
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

export default function CodexLensPage() {
  const [facets, setFacets] = useState<Facets | null>(null);
  const [spine, setSpine] = useState<LoreEvent[]>([]);
  const [events, setEvents] = useState<LoreEvent[]>([]);
  const [world, setWorld] = useState<string>('');
  const [type, setType] = useState<string>('');
  const [q, setQ] = useState<string>('');
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

  const grouped = useMemo(() => {
    const m = new Map<string, LoreEvent[]>();
    for (const e of events) {
      const k = e.world_id || 'concordia-hub';
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [events]);

  const hasFilters = !!(world || type || q.trim());

  return (
    <LensShell lensId="codex">
    <div style={{ maxWidth: 980, margin: '0 auto', padding: '24px 16px', color: COLORS.fg }}>
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
      <div role="search" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
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
        ) : events.length === 0 ? (
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
              <button onClick={() => { setWorld(''); setType(''); setQ(''); }} style={{ marginTop: 12, padding: '6px 14px', borderRadius: 8, background: COLORS.input, border: `1px solid ${COLORS.inputBorder}`, color: COLORS.fg, cursor: 'pointer' }}>
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
                          aria-label={isBookmarked ? `Remove ${e.title} from your codex` : `Bookmark ${e.title} to your codex`}
                          aria-pressed={isBookmarked}
                          onClick={() => toggleBookmark(e)}
                          title={isBookmarked ? 'Bookmarked' : 'Bookmark'}
                          style={{ background: 'none', border: 'none', color: isBookmarked ? '#cbb4ff' : COLORS.fg, opacity: isBookmarked ? 1 : 0.45, cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>
                          {isBookmarked ? '★' : '☆'}
                        </button>
                      </div>
                      {isOpen && <p style={{ opacity: 0.85, margin: '8px 0 0', lineHeight: 1.55 }}>{e.description}</p>}
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
