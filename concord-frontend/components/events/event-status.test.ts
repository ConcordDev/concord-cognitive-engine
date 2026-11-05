import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_STATUS_WORDS, statusFromEngine, statusToEngine } from './event-status';

describe('event status words', () => {
  it('uses one list and maps live and completed onto the engine', () => {
    assert.deepEqual([...EVENT_STATUS_WORDS], ['planning', 'confirmed', 'live', 'completed', 'cancelled']);
    assert.equal(statusToEngine('live'), 'confirmed');
    assert.equal(statusToEngine('completed'), 'complete');
    assert.equal(statusToEngine('planning'), 'planning');
    assert.equal(statusFromEngine('complete', '2099-01-01', '2026-11-03'), 'completed');
    assert.equal(statusFromEngine('confirmed', '2026-11-03', '2026-11-03'), 'live');
    assert.equal(statusFromEngine('confirmed', '2099-01-01', '2026-11-03'), 'confirmed');
  });
});
