import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isFinalScore, isLiveScore, scoreboardDateLabel, scoreboardStatusLabel } from './scoreboard-card.ts';

describe('scoreboard card labels', () => {
  it('reads a finished game as Final when the description is missing', () => {
    const e = { completed: true, state: 'post', status: null, date: '2026-11-02T02:00:00Z' };
    assert.equal(isFinalScore(e), true);
    assert.equal(isLiveScore(e), false);
    assert.equal(scoreboardStatusLabel(e), 'Final');
  });

  it('keeps ESPN Final copy and a live clock', () => {
    assert.equal(scoreboardStatusLabel({ status: 'Final', completed: true, state: 'post' }), 'Final');
    assert.equal(isLiveScore({ status: 'Q3', state: 'in', completed: false, clock: '5:11' }), true);
    assert.equal(scoreboardStatusLabel({ status: 'Q3', state: 'in', completed: false, clock: '5:11' }), 'Q3 · 5:11');
  });

  it('does not invent a date', () => {
    assert.equal(scoreboardDateLabel(null), null);
    assert.equal(scoreboardDateLabel(''), null);
    assert.equal(scoreboardDateLabel('not-a-date'), null);
    assert.ok(scoreboardDateLabel('2026-11-02T02:00:00Z'));
  });
});
