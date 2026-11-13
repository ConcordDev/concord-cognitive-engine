import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SentinelScanConfig } from './SentinelScanConfig';

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async () => ({
    data: {
      ok: true,
      result: {
        config: {
          scopes: ['chat', 'files'],
          activeScopes: ['chat'],
          rules: [],
          autoTriageMinSeverity: 'medium',
          updatedAt: '2026-11-12T00:00:00Z',
        },
      },
    },
  })),
}));

// FIX-sentinel-013: the Shield / Monitors / Rules consoles rendered their
// controls at ~20-30px with 10px control text. Every button and form
// control in the three views now carries the 44px floor (min-h-11), and
// the per-threat row buttons' text rose from 10px to text-xs. Read-only
// data badges and mono lists keep the console's density by design.
describe('Sentinel console touch targets (FIX-sentinel-013)', () => {
  it('Rules scope and severity chips meet the floor', async () => {
    render(<SentinelScanConfig />);
    const chip = await screen.findByRole('button', { name: 'chat' });
    expect(chip.className).toContain('min-h-11');
    const sev = await screen.findByRole('button', { name: 'medium' });
    expect(sev.className).toContain('min-h-11');
  });

  it('every button/control class in the three views carries the floor', () => {
    for (const f of ['SentinelShield.tsx', 'SentinelMonitors.tsx', 'SentinelScanConfig.tsx']) {
      const src = readFileSync(join(__dirname, f), 'utf8');
      const tags = src.match(/<(?:button|input|select|textarea)\b[\s\S]*?(?<!\\)>/g) || [];
      for (const tag of tags) {
        if (/type="(checkbox|radio|hidden)"/.test(tag)) continue;
        const cm = tag.match(/className=\{?["`]([^"`]*)["`]/);
        if (!cm) continue;
        expect(cm[1], `${f}: ${cm[1].slice(0, 60)}`).toContain('min-h-11');
      }
    }
  });
});
