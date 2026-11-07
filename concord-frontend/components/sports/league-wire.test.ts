import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  HUB_WORLD_ID,
  LEAGUE_SPORTS,
  actionError,
  hasMatchScores,
  leagueCreateBody,
  winnerTeamId,
} from './league-wire';

test('create body names the hub world and trims the league name', () => {
  const body = leagueCreateBody('  Sunday League  ', 'soccer');
  assert.deepEqual(body, {
    name: 'Sunday League',
    sportKind: 'soccer',
    worldId: HUB_WORLD_ID,
  });
  assert.equal(body.worldId, 'concordia-hub');
});

test('sport list is the sports_leagues CHECK set', () => {
  assert.deepEqual([...LEAGUE_SPORTS], [
    'soccer',
    'basketball',
    'baseball',
    'esports',
    'racing',
    'brawling',
  ]);
  assert.equal(LEAGUE_SPORTS.includes('tennis' as never), false);
  assert.equal(LEAGUE_SPORTS.includes('cricket' as never), false);
});

test('a refused action is a sentence, and ok is silence', () => {
  assert.equal(
    actionError({ ok: false, reason: 'missing_inputs' }, 200, 'League was not created'),
    'League was not created (missing_inputs).',
  );
  assert.equal(actionError({ ok: true, leagueId: 'lg_1' } as { ok: boolean }, 200, 'League was not created'), null);
  assert.equal(actionError(null, 500, 'League was not created'), 'League was not created (500).');
  assert.equal(actionError({}, 200, 'Team was not added'), 'Team was not added.');
});

test('the winner is the higher score, and a tie is a draw', () => {
  assert.equal(winnerTeamId('home', 'away', 2, 1), 'home');
  assert.equal(winnerTeamId('home', 'away', 1, 3), 'away');
  assert.equal(winnerTeamId('home', 'away', 1, 1), null);
  assert.equal(hasMatchScores(0, 0), true);
  assert.equal(hasMatchScores(undefined, 1), false);
  assert.equal(hasMatchScores(1, Number.NaN), false);
});
