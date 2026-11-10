import { describe, expect, it } from 'vitest';
import { unreachableApiMessage } from '@/lib/api/client';

describe('unreachableApiMessage', () => {
  it('keeps the local-machine wording on localhost', () => {
    expect(unreachableApiMessage('localhost')).toMatch(/local Concord API/);
    expect(unreachableApiMessage('127.0.0.1')).toMatch(/local Concord API/);
  });

  it('does not call a hosted origin a local API', () => {
    const message = unreachableApiMessage('concord-os.org');
    expect(message).not.toMatch(/local Concord API/);
    expect(message).toMatch(/did not respond/);
  });
});
