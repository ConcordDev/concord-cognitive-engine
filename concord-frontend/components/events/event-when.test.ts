import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyEventDate, countsAsPast, countsAsUpcoming, eventDay } from './event-when';

const TODAY = '2026-11-03';

describe('event date class', () => {
  it('counts 2026-10-01 as past on 2026-11-03', () => {
    assert.equal(classifyEventDate('2026-10-01', TODAY), 'past');
    assert.equal(countsAsPast('2026-10-01', TODAY), true);
    assert.equal(countsAsUpcoming('2026-10-01', 'planning', TODAY), false);
    assert.equal(countsAsUpcoming('2026-10-01', 'confirmed', TODAY), false);
  });

  it('keeps today and a later date upcoming', () => {
    assert.equal(classifyEventDate('2026-11-03', TODAY), 'upcoming');
    assert.equal(classifyEventDate('2099-01-01', TODAY), 'upcoming');
    assert.equal(countsAsUpcoming('2099-01-01', 'planning', TODAY), true);
    assert.equal(countsAsUpcoming('2099-01-01', 'cancelled', TODAY), false);
  });

  it('does not invent a class for a missing date', () => {
    assert.equal(eventDay(null), '');
    assert.equal(eventDay('TBD'), '');
    assert.equal(classifyEventDate('', TODAY), 'undated');
    assert.equal(classifyEventDate('2026-10-01T18:00:00', TODAY), 'past');
  });
});
