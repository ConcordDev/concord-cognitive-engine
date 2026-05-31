// Track 3 — event-feed curation. Pins priority tiers, same-kind batching within
// the window, critical-never-batches + always-on-top, and the cap that drops
// ambient before critical.

import { describe, it, expect } from 'vitest';
import { eventPriority, ingestEvent, digestLabel, type FeedItem } from '@/lib/concordia/event-digest';

describe('event-feed curation', () => {
  it('tiers events: crisis/fallen = critical, founded/quest = major, else ambient', () => {
    expect(eventPriority('kingdom:fallen')).toBe('critical');
    expect(eventPriority('faction-war:clash')).toBe('critical');
    expect(eventPriority('x', 'crisis')).toBe('critical');
    expect(eventPriority('kingdom:founded')).toBe('major');
    expect(eventPriority('companion:level-up')).toBe('major');
    expect(eventPriority('attention:allocation')).toBe('ambient');
  });

  it('batches a same-kind ambient burst into one row with a count', () => {
    let items: FeedItem[] = [];
    for (let i = 0; i < 6; i++) {
      items = ingestEvent(items, { name: 'attention:allocation', label: 'Attention shifted' }, { now: 1000 + i * 100 });
    }
    expect(items.length).toBe(1);
    expect(items[0].count).toBe(6);
    expect(digestLabel(items[0])).toBe('Attention shifted ×6');
  });

  it('does NOT batch across the window boundary', () => {
    let items: FeedItem[] = [];
    items = ingestEvent(items, { name: 'dream:captured', label: 'Dream' }, { now: 0, batchWindowMs: 1000 });
    items = ingestEvent(items, { name: 'dream:captured', label: 'Dream' }, { now: 5000, batchWindowMs: 1000 });
    expect(items.length).toBe(2);
  });

  it('critical events never batch and sort above ambient', () => {
    let items: FeedItem[] = [];
    items = ingestEvent(items, { name: 'attention:allocation', label: 'A' }, { now: 100 });
    items = ingestEvent(items, { name: 'kingdom:fallen', label: 'Kingdom fell' }, { now: 200 });
    items = ingestEvent(items, { name: 'kingdom:fallen', label: 'Kingdom fell' }, { now: 300 });
    const critical = items.filter((i) => i.priority === 'critical');
    expect(critical.length).toBe(2);          // two separate beats, not batched
    expect(items[0].priority).toBe('critical'); // sorted to the top
  });

  it('over cap, drops ambient before critical', () => {
    let items: FeedItem[] = [];
    items = ingestEvent(items, { name: 'kingdom:fallen', label: 'C' }, { now: 0, max: 3 });
    for (let i = 0; i < 10; i++) {
      items = ingestEvent(items, { name: `ambient:${i}`, label: 'amb' }, { now: 1000 + i, max: 3 });
    }
    expect(items.length).toBe(3);
    expect(items.some((i) => i.priority === 'critical')).toBe(true); // critical survived
  });
});
