// Render coverage for the chat Atlas signal view across each view mode, its loading state and an
// error payload.

import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import AtlasSignalView from '../AtlasSignalView';

const SIG = (id: string, category: string, adj = 'fixed') => ({ id, category, purpose: `Purpose ${id}`, frequency: 1420.4, adjustability: adj, classified_at: '2026-03-01T00:00:00Z', description: id === 's1' ? 'Hydrogen line' : null });
afterEach(() => cleanup());

describe('AtlasSignalView', () => {
  it('shows a loading state and an empty state', () => {
    expect(render(<AtlasSignalView data={null} loading />).container.textContent?.length).toBeGreaterThan(0);
    cleanup();
    expect(render(<AtlasSignalView data={null} />).container.textContent?.length).toBeGreaterThan(0);
  });
  it('renders the taxonomy, unknown, anomalies and spectrum views', () => {
    const signals = ['INFRASTRUCTURE', 'COMMUNICATION', 'NAVIGATION', 'SCIENTIFIC', 'BIOLOGICAL', 'GEOLOGICAL', 'UNKNOWN'].map((c, i) => SIG(`s${i}`, c, ['fixed', 'adjustable', 'tunable'][i % 3]));
    const views = [
      { ok: true, view: 'taxonomy' as const, taxonomy: { totalClassified: 7, category: 'ALL', count: 7, signals } },
      { ok: true, view: 'unknown' as const, unknown: { count: 2, total: 9, signals: signals.slice(0, 2) } },
      { ok: true, view: 'anomalies' as const, anomalies: { count: 2, signals: signals.slice(2, 4) } },
      { ok: true, view: 'spectrum' as const, spectrum: { totalSignals: 40, bands: { VLF: 3, HF: 12, UHF: 25 } } },
      { ok: true, view: 'taxonomy' as const, taxonomy: { totalClassified: 0, category: 'ALL', count: 0, signals: [] } },
      { ok: true, view: 'unknown' as const, unknown: { count: 0, total: 0, signals: [] } },
      { ok: true, view: 'anomalies' as const, anomalies: { count: 0, signals: [] } },
      { ok: false, view: 'spectrum' as const, error: 'signal bus offline' },
    ];
    for (const v of views) {
      const { container } = render(<AtlasSignalView data={v} />);
      expect(container.textContent?.length).toBeGreaterThan(0);
      cleanup();
    }
  });
});
