'use client';

import { COLORS, type LoreEvent } from './types';

/**
 * The Three Pillars — the canon's three primordial beings, by entry id
 * and in canon order: The First Law, The First Breath, The First Refusal.
 * (The view previously rendered the first six primordial entries under
 * this heading; the heading is the contract, so the set is the three.)
 * The view is a stated reduction of Browse: it shows the three entries
 * in full, and search / filters / permalinks / bookmarks live in Browse
 * canon — the panel says so rather than silently carrying fewer tools.
 */
const PILLAR_IDS = ['lore_first_thought', 'lore_first_breath', 'lore_first_refusal'] as const;

export function SpinePanel({ spine }: { spine: LoreEvent[] }) {
  const pillars = PILLAR_IDS
    .map(id => spine.find(e => e.id === id))
    .filter((e): e is LoreEvent => !!e);
  if (pillars.length === 0) return null;
  return (
    <section aria-label="The Three Pillars" style={{ marginBottom: 24, padding: 16, borderRadius: 12, background: COLORS.accent, border: `1px solid ${COLORS.accentBorder}` }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>The Three Pillars</h2>
      <p style={{ opacity: 0.65, fontSize: 13, margin: '0 0 10px' }}>
        The three primordial entries of the canon, shown in full. Search, filters, permalinks, and bookmarks live in Browse canon.
      </p>
      <div style={{ display: 'grid', gap: 8 }}>
        {pillars.map(e => (
          <details key={e.id}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{e.title} <span style={{ opacity: 0.5, fontWeight: 400 }}>· {e.era}</span></summary>
            <p style={{ opacity: 0.85, margin: '6px 0 0', lineHeight: 1.5 }}>{e.description}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
