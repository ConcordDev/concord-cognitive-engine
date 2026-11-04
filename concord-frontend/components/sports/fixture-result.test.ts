import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  badgeForStored,
  resultFromDate,
  resultFromScores,
  scorePair,
} from './fixture-result';

const TODAY = '2026-11-03';

test('a past fixture with no score is not upcoming', () => {
  assert.equal(resultFromDate('2026-10-29', TODAY), 'unscored');
  assert.equal(
    badgeForStored({ result: 'upcoming', date: '2026-10-29' }, TODAY),
    'unscored',
  );
});

test('today and a later date with no score stay upcoming', () => {
  assert.equal(resultFromDate('2026-11-03', TODAY), 'upcoming');
  assert.equal(resultFromDate('2026-11-10', TODAY), 'upcoming');
  assert.equal(resultFromDate('', TODAY), 'upcoming');
});

test('both scores record a result, and a blank is not zero', () => {
  assert.deepEqual(scorePair('2', '1'), { kind: 'pair', home: 2, away: 1 });
  assert.equal(resultFromScores(2, 1), 'win');
  assert.equal(resultFromScores(1, 2), 'loss');
  assert.equal(resultFromScores(0, 0), 'draw');
  assert.deepEqual(scorePair('', ''), { kind: 'blank' });
  assert.deepEqual(scorePair('2', ''), { kind: 'partial' });
  assert.equal(scorePair(Number.NaN, 1).kind, 'partial');
});

test('a stored win stays a win even when the date is past', () => {
  assert.equal(badgeForStored({ result: 'win', date: '2026-10-29' }, TODAY), 'win');
});
