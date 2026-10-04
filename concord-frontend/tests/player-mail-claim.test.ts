import { describe, expect, it } from 'vitest';
import { claimResultText, sendFailureText } from '@/components/mail/playerMail';

describe('player mail sentences', () => {
  it('does not say sent or claimed when the macro refuses', () => {
    expect(sendFailureText('dtu_not_owned')).toMatch(/Not sent/);
    expect(sendFailureText('insufficient_funds')).toMatch(/Not sent/);
    expect(claimResultText({ ok: false, error: 'insufficient_funds_for_cod' }).msg).toMatch(/Not claimed/);
  });

  it('reports only the DTUs the server actually transferred', () => {
    const note = claimResultText({
      ok: true,
      payout: { attachmentCc: 10, codCcPaid: 4 },
      attachments: { dtuIds: ['a', 'b'], transferred: ['a'], skipped: ['b'] },
    });
    expect(note.kind).toBe('ok');
    expect(note.msg).toContain('Claimed 10 CC');
    expect(note.msg).toContain('paid 4 CC cash on delivery');
    expect(note.msg).toContain('1 DTU transferred');
    expect(note.msg).toContain('1 DTU stayed with the owner');
  });

  it('says nothing moved when the claim was already done', () => {
    expect(claimResultText({ ok: true, alreadyClaimed: true }).msg).toBe('Already claimed. Nothing new moved.');
  });
});
