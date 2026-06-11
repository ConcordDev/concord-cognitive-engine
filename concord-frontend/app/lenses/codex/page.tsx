'use client';

import { LensShell } from '@/components/lens/LensShell';

/**
 * Wave 8b — The Codex: the authored cosmology, finally reachable.
 *
 * The 87+ hand-authored lore events were oracle-context only — never shown.
 * This lens reads the `lore.*` macros (public-read; hidden_truth stripped on
 * the server) and lets a player browse/filter the canon: the Three Pillars,
 * the Concord Link, the Cascade, every world's history. The "Cosmology" header
 * surfaces the Pantheon spine first, so a stranger can finally *find* the myth.
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';

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

export default function CodexLensPage() {
  const [facets, setFacets] = useState<Facets | null>(null);
  const [spine, setSpine] = useState<LoreEvent[]>([]);
  const [events, setEvents] = useState<LoreEvent[]>([]);
  const [world, setWorld] = useState<string>('');
  const [type, setType] = useState<string>('');
  const [q, setQ] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const f = await lensRun('lore', 'facets', {});
      if (f.data?.ok) setFacets((f.data.result as { facets: Facets }).facets);
      const s = await lensRun('lore', 'spine', {});
      if (s.data?.ok) setSpine((s.data.result as { events: LoreEvent[] }).events || []);
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('lore', 'list', {
      worldId: world || undefined, type: type || undefined, q: q || undefined, limit: 500,
    });
    if (r.data?.ok) setEvents((r.data.result as { events: LoreEvent[] }).events || []);
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

  return (
    <LensShell lensId="codex">
    <div style={{ maxWidth: 980, margin: '0 auto', padding: '24px 16px', color: '#e8e4dc' }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>The Codex</h1>
      <p style={{ opacity: 0.7, marginBottom: 20 }}>
        The canon of Concordia — {facets?.count ?? '…'} recorded truths across {facets?.worlds.length ?? '…'} worlds.
      </p>

      {/* Cosmology header — the Pantheon spine first. */}
      {spine.length > 0 && (
        <section style={{ marginBottom: 24, padding: 16, borderRadius: 12, background: 'rgba(120,90,200,0.08)', border: '1px solid rgba(120,90,200,0.25)' }}>
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
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <input placeholder="Search the canon…" value={q} onChange={e => setQ(e.target.value)}
          style={{ flex: 1, minWidth: 200, padding: '8px 12px', borderRadius: 8, background: '#1a1a22', border: '1px solid #333', color: '#e8e4dc' }} />
        <select value={world} onChange={e => setWorld(e.target.value)} style={{ padding: '8px 12px', borderRadius: 8, background: '#1a1a22', border: '1px solid #333', color: '#e8e4dc' }}>
          <option value="">All worlds</option>
          {facets?.worlds.map(w => <option key={w} value={w}>{w}</option>)}
        </select>
        <select value={type} onChange={e => setType(e.target.value)} style={{ padding: '8px 12px', borderRadius: 8, background: '#1a1a22', border: '1px solid #333', color: '#e8e4dc' }}>
          <option value="">All kinds</option>
          {facets?.types.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {loading ? <p style={{ opacity: 0.6 }}>Consulting the records…</p> : (
        grouped.map(([w, evs]) => (
          <section key={w} style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 15, textTransform: 'uppercase', letterSpacing: 1, opacity: 0.6, margin: '0 0 8px' }}>{w}</h3>
            <div style={{ display: 'grid', gap: 6 }}>
              {evs.map(e => (
                <article key={e.id} onClick={() => setOpen(open === e.id ? null : e.id)}
                  style={{ padding: '10px 14px', borderRadius: 10, background: '#15151c', border: '1px solid #2a2a35', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <strong>{e.title}</strong>
                    <span style={{ opacity: 0.5, fontSize: 13, whiteSpace: 'nowrap' }}>{e.type} · {e.era}</span>
                  </div>
                  {open === e.id && <p style={{ opacity: 0.85, margin: '8px 0 0', lineHeight: 1.55 }}>{e.description}</p>}
                </article>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
    </LensShell>
  );
}
