import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { latestWeighInLabel, profileWeightLabel } from './pet-card-labels.ts';

describe('pet card weight labels', () => {
  it('names the profile weight and does not treat a blank as zero', () => {
    assert.equal(profileWeightLabel(10), 'Profile weight 10 kg');
    assert.equal(profileWeightLabel(10.5), 'Profile weight 10.5 kg');
    assert.equal(profileWeightLabel(0), null);
    assert.equal(profileWeightLabel(null), null);
    assert.equal(profileWeightLabel(undefined), null);
  });

  it('names the latest weigh-in, including when it differs from the profile', () => {
    assert.equal(profileWeightLabel(10), 'Profile weight 10 kg');
    assert.equal(
      latestWeighInLabel({ weightKg: 10.5, date: '2026-11-01' }),
      'Latest weigh-in 10.5 kg · 2026-11-01',
    );
  });

  it('says when no weigh-in is stored', () => {
    assert.equal(latestWeighInLabel(null), 'No weigh-in on this record');
    assert.equal(latestWeighInLabel(undefined), 'No weigh-in on this record');
    assert.equal(latestWeighInLabel({ weightKg: null, date: '2026-11-01' }), 'No weigh-in on this record');
  });
});
