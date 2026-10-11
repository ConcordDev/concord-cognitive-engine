import { describe, expect, it } from 'vitest';
import { draftDtuCall, manualPostSentence, sendDraftDtuOutcome, sendDraftDtuToTimelineCall } from '@/components/thread/manualPost';

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

  it('saves an attested draft as a DTU that says Concord did not send it, then cites that DTU on a private post', () => {
    const call = draftDtuCall({
      id: 'th_1',
      title: 'Harbor',
      content: 'Lights at dusk.',
      status: 'published',
      postedManually: true,
    });
    expect(String((call?.input.human as { summary: string }).summary)).toContain('Concord did not send it.');
    expect(String((call?.input.human as { summary: string }).summary)).toContain('Lights at dusk.');
    expect(call?.input.visibility).toBe('private');
    expect(call?.input.meta).toMatchObject({ visibility: 'private', createdFrom: 'thread', delivered: false, postedManually: true });
    const unposted = draftDtuCall({ id: 'th_2', content: 'Still writing.', status: 'draft' });
    expect(unposted?.input.visibility).toBe('private');
    expect(String((unposted?.input.human as { summary: string }).summary)).toContain('Still writing.');
    expect(String((unposted?.input.human as { summary: string }).summary)).toContain('Not posted.');
    expect(String((unposted?.input.human as { summary: string }).summary)).not.toContain('Concord did not send it.');
    const send = sendDraftDtuToTimelineCall({
      draft: { id: 'th_1', content: 'Lights at dusk.', status: 'published', postedManually: true },
      dtuId: 'dtu_9',
    });
    expect(send?.input).toMatchObject({ privacy: 'private', citedDtuId: 'dtu_9' });
    const sent = sendDraftDtuOutcome('dtu_9', {
      ok: true,
      result: { post: { id: 'pst_9', privacy: 'private', citedDtuId: 'dtu_9' } },
    });
    expect(sent.text).toBe('Sent DTU dtu_9 to your Timeline as private post pst_9.');
  });
});
