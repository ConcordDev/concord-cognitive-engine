// B10-takeover pins (B6, CB-0616):
//   FIX-tick-002 — eventOrgan attributes events to their source organ from
//     what /api/events actually sends (never a blanket 'unknown').
//   FIX-society-005 — the agent name is capped in the create/edit inputs
//     (matching the server's 120) and truncated on the card.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { eventOrgan, toTickEvent } from '@/components/tick/tick-model';

const FE_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), '..');

describe('FIX-tick-002 — organ attribution from the real event shape', () => {
  it('uses an explicit source or domain first', () => {
    expect(eventOrgan({ source: 'brain' })).toBe('brain');
    expect(eventOrgan({ domain: 'economy' })).toBe('economy');
    expect(eventOrgan({ meta: { source: 'sentinel' } })).toBe('sentinel');
  });
  it('falls back to the log type root — the emitting subsystem', () => {
    expect(eventOrgan({ type: 'c2.genesis' })).toBe('c2');
    expect(eventOrgan({ type: 'dtu.rename' })).toBe('dtu');
    expect(eventOrgan({ type: 'hydrate' })).toBe('hydrate');
  });
  it('toTickEvent maps a projected /api/events row end to end', () => {
    const t = toTickEvent({ id: 'e1', type: 'lens.run', action: 'x', message: '', meta: {}, timestamp: '2026-11-12T00:00:00Z' }, 0);
    expect(t.organ).toBe('lens');
    expect(t.type).toBe('lens.run');
  });
  it('the stream context maps rows through toTickEvent', () => {
    const src = fs.readFileSync(path.join(FE_DIR, 'components/tick/TickStreamContext.tsx'), 'utf8');
    expect(src).toContain('toTickEvent(e, i)');
    expect(src).not.toContain("|| 'unknown',");
  });
});

describe('FIX-society-005 — agent name cap + card truncation', () => {
  it('both name inputs carry maxLength 120 and the card name truncates', () => {
    const src = fs.readFileSync(path.join(FE_DIR, 'components/world-lens/AgentBuilder.tsx'), 'utf8');
    expect(src.match(/maxLength=\{120\}/g)?.length).toBe(2);
    expect(src).toContain('className="font-semibold text-base truncate"');
  });
});
