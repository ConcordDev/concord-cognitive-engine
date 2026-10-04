import { describe, expect, it } from 'vitest';
import {
  dtuReadBackMatches,
  mailDtuCall,
  mailRecordSentence,
  sendMailDtuOutcome,
  sendMailDtuToTimelineCall,
} from '@/components/mail/mailKeep';

const mail = {
  id: 'mail_abc',
  fromUser: 'u1',
  toUser: 'u2',
  subject: 'Hello',
  body: 'See you there.',
};

describe('mail keep', () => {
  it('names a sent row only when the server returned an id', () => {
    expect(mailRecordSentence(mail, 'sent')).toBe('Mail sent. mail_abc');
    expect(mailRecordSentence(mail, 'inbox')).toBe('In your inbox. mail_abc');
    expect(mailRecordSentence({ ...mail, id: '' }, 'sent')).toBeNull();
  });

  it('builds a private mail DTU and a private Timeline cite', () => {
    const dtu = mailDtuCall(mail);
    expect(dtu?.domain).toBe('dtu');
    expect(dtu?.action).toBe('create');
    expect(dtu?.input).toMatchObject({
      source: 'mail-lens:message',
      meta: { visibility: 'private', createdFrom: 'mail' },
    });
    expect(String((dtu?.input.human as { summary: string }).summary)).toMatch(/Gmail was not used/);
    const send = sendMailDtuToTimelineCall(mail, 'dtu_9');
    expect(send?.input).toMatchObject({ privacy: 'private', citedDtuId: 'dtu_9' });
    expect(String(send?.input.content)).toMatch(/Gmail was not sent/);
    expect(sendMailDtuToTimelineCall(mail, 'not an id')).toBeNull();
  });

  it('says sent only when Timeline stored a private post that cites the DTU', () => {
    const ok = sendMailDtuOutcome('dtu_9', {
      ok: true,
      result: { post: { id: 'pst_1', privacy: 'private', citedDtuId: 'dtu_9' } },
    });
    expect(ok.text).toBe('Sent DTU dtu_9 to your Timeline as private post pst_1. Gmail was not sent.');
    expect(sendMailDtuOutcome('dtu_9', { ok: false, error: 'refused' }).text).toMatch(/^Not sent/);
    expect(sendMailDtuOutcome('dtu_9', {
      ok: true,
      result: { post: { id: 'pst_2', privacy: 'public', citedDtuId: 'dtu_9' } },
    }).text).toMatch(/was not sent as a private post/);
    expect(dtuReadBackMatches('dtu_9', { ok: true, result: { dtu: { id: 'dtu_9' } } })).toBe(true);
    expect(dtuReadBackMatches('dtu_9', { ok: true, result: { dtu: { id: 'other' } } })).toBe(false);
  });
});
