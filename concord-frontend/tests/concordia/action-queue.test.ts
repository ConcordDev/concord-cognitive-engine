import { describe, it, expect } from 'vitest';
import { ActionQueue } from '@/lib/concordia/action-queue';

describe('B4 — action chaining queue', () => {
  it('plays immediately when idle, arming the protected window', () => {
    const q = new ActionQueue();
    expect(q.request({ verb: 'harvest' }, 1000, 300)).toBe(true); // plays now
    // a second verb during the window is queued, not played
    expect(q.request({ verb: 'plant' }, 1100, 300)).toBe(false);
    expect(q.pending).toBe(1);
  });

  it('flush returns nothing until the window elapses, then pops the queued verb', () => {
    const q = new ActionQueue();
    q.request({ verb: 'harvest' }, 1000, 300); // window ends at 1300
    q.request({ verb: 'plant' }, 1100, 300);   // queued
    expect(q.flush(1200)).toBeNull();           // still committed to harvest
    expect(q.flush(1350)).toEqual({ verb: 'plant' }); // window passed → flush plant
    expect(q.pending).toBe(0);
  });

  it('a verb after the window plays immediately (no queue)', () => {
    const q = new ActionQueue();
    q.request({ verb: 'a' }, 0, 200);
    expect(q.request({ verb: 'b' }, 500, 200)).toBe(true); // 500 > 200 → plays now
    expect(q.pending).toBe(0);
  });

  it('caps the queue (maxQueue=1 by default — chain, do not buffer a combo)', () => {
    const q = new ActionQueue();
    q.request({ verb: 'a' }, 0, 1000); // busy until 1000
    q.request({ verb: 'b' }, 100, 1000);
    q.request({ verb: 'c' }, 200, 1000);
    expect(q.pending).toBe(1);
    expect(q.flush(1001)).toEqual({ verb: 'c' }); // newest kept, older dropped
  });

  it('clear resets busy + queue', () => {
    const q = new ActionQueue();
    q.request({ verb: 'a' }, 0, 1000);
    q.request({ verb: 'b' }, 100, 1000);
    q.clear();
    expect(q.pending).toBe(0);
    expect(q.request({ verb: 'c' }, 200, 1000)).toBe(true); // idle again
  });
});
