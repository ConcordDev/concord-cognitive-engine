import { describe, it, expect } from 'vitest';
import { dtuCreatedAt, dtuEventTime, dtuFullContent, resolveDtuTotal } from '@/lib/dtu/display';

describe('dtu display', () => {
  it('falls back from content to creti text, summary, and notes, and skips score objects', () => {
    expect(dtuFullContent({ content: '  body  ' })).toBe('body');
    expect(dtuFullContent({ creti: 'creti text' })).toBe('creti text');
    expect(dtuFullContent({ creti: { clarity: 0.4 }, cretiHuman: 'human creti' })).toBe('human creti');
    expect(dtuFullContent({ human: { summary: 'stored summary' } })).toBe('stored summary');
    expect(dtuFullContent({ summary: 'flat summary' })).toBe('flat summary');
    expect(dtuFullContent({ machine: { notes: 'notes body' } })).toBe('notes body');
    expect(dtuFullContent(null)).toBe('');
    expect(dtuFullContent({})).toBe('');
  });

  it('reads persisted creation time and never invents now', () => {
    const created = dtuCreatedAt({ createdAt: '2020-01-02T03:04:05.000Z', timestamp: '2024-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
    expect(created?.toISOString()).toBe('2020-01-02T03:04:05.000Z');
    expect(dtuCreatedAt({ timestamp: '2021-05-05T00:00:00.000Z' })?.toISOString()).toBe('2021-05-05T00:00:00.000Z');
    expect(dtuCreatedAt({ updatedAt: '2026-01-01T00:00:00.000Z' })).toBeNull();
    expect(dtuCreatedAt({ createdAt: 'not-a-date' })).toBeNull();
    expect(dtuCreatedAt(null)).toBeNull();
    expect(dtuEventTime({ createdAt: '2020-01-02T03:04:05.000Z' })).toBe('2020-01-02T03:04:05.000Z');
    expect(dtuEventTime({})).toBe('');
  });

  it('uses pagination.total and falls back to the shown rows when the reported total is 0', () => {
    expect(resolveDtuTotal({ pagination: { total: 20 }, dtus: [{}, {}] })).toBe(20);
    expect(resolveDtuTotal({ total: 0, items: new Array(20) })).toBe(20);
    expect(resolveDtuTotal({ total: 0, dtus: [] })).toBe(0);
    expect(resolveDtuTotal(null)).toBe(0);
    expect(resolveDtuTotal({ total: 4 })).toBe(4);
  });
});
