import { describe, expect, it } from 'vitest';
import { rejectedWriteMessage, unreachableApiMessage } from '@/lib/api/client';

describe('unreachableApiMessage', () => {
  it('keeps the local-machine wording on localhost', () => {
    expect(unreachableApiMessage('localhost')).toMatch(/local Concord API/);
    expect(unreachableApiMessage('127.0.0.1')).toMatch(/local Concord API/);
  });

  it('shows a 400 write and stays quiet for a GET', () => {
    expect(rejectedWriteMessage(400, { message: 'year must be a whole model year' }, 'post')).toMatch(/model year/);
    expect(rejectedWriteMessage(400, { error: 'name_required' }, 'POST')).toBe('name required');
    expect(rejectedWriteMessage(400, { error: 'no_actor' }, 'get')).toBeNull();
    expect(rejectedWriteMessage(422, { error: 'nope' }, 'post')).toBeNull();
    expect(rejectedWriteMessage(400, {
      error: 'Council rejected DTU',
      reason: 'knowledge_insufficient_structure',
      score: 1,
      minScore: 2,
    }, 'post')).toMatch(/needs more structure/);
    expect(rejectedWriteMessage(400, {
      error: 'Council rejected DTU',
      reason: 'knowledge_insufficient_structure',
      score: 1,
      minScore: 2,
    }, 'post')).toMatch(/scored 1/);
  });

  it('does not call a hosted origin a local API', () => {
    const message = unreachableApiMessage('concord-os.org');
    expect(message).not.toMatch(/local Concord API/);
    expect(message).toMatch(/did not respond/);
  });
});
