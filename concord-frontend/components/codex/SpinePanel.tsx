'use client';

import { COLORS, type LoreEvent } from './types';

/** Cosmology header — lore.spine primordial entries. */
export function SpinePanel({ spine }: { spine: LoreEvent[] }) {
  if (spine.length === 0) return null;
  return (
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
  );
}
