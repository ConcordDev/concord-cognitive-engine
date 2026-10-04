import { describe, expect, it } from 'vitest';
import { manualPostSentence } from '@/components/thread/manualPost';

describe('thread manual post sentence', () => {
  it('says the user posted it only when Concord records an attestation and did not deliver', () => {
    const ok = manualPostSentence({
      ok: true,
      result: { delivered: false, draft: { id: 'th_1', postedManually: true, status: 'published' } },
    });
    expect(ok).toEqual({
      claimed: true,
      text: 'Marked as posted by you (th_1). Concord did not send it.',
    });
  });

  it('does not say posted when the server omits the attestation', () => {
    const missing = manualPostSentence({ ok: true, result: { draft: { id: 'th_2', status: 'published' } } });
    expect(missing.claimed).toBe(false);
    expect(missing.text).toContain('Not marked.');
    const refused = manualPostSentence({ ok: false, error: 'draft not found' });
    expect(refused.text).toBe('Not marked. draft not found');
    expect(refused.text).not.toMatch(/Concord did not send it/);
  });
});
