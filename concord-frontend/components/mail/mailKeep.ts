/**
 * A Concord player-mail message can be saved as a private DTU and cited
 * on the author's private Timeline. Gmail is a separate connector and is
 * never described as sent by this path.
 */

export interface KeptMail {
  id: string;
  fromUser?: string;
  toUser?: string;
  subject: string;
  body?: string;
}

export interface MailKeepCall {
  domain: string;
  action: string;
  input: Record<string, unknown>;
}

const DTU_ID = /^[A-Za-z0-9_.:-]{1,80}$/;

/** Sentence derived from a row the server already returned. */
export function mailRecordSentence(mail: KeptMail | null | undefined, folder: 'inbox' | 'sent'): string | null {
  const id = String(mail?.id || '').trim();
  if (!id) return null;
  if (folder === 'sent') return `Mail sent. ${id}`;
  return `In your inbox. ${id}`;
}

export function mailBody(mail: KeptMail): string {
  return [
    `Mail ${mail.id}.`,
    `From: ${mail.fromUser || 'unknown'}`,
    `To: ${mail.toUser || 'unknown'}`,
    `Subject: ${mail.subject}`,
    '',
    (mail.body || '').trim(),
    '',
    'This is Concord player mail. Gmail was not used.',
  ].join('\n');
}

export function mailDtuCall(mail: KeptMail): MailKeepCall | null {
  const id = String(mail?.id || '').trim();
  const subject = String(mail?.subject || '').trim();
  if (!id || !subject) return null;
  const body = mailBody({ ...mail, id, subject });
  return {
    domain: 'dtu',
    action: 'create',
    input: {
      title: subject.slice(0, 80),
      tags: ['mail', 'player-mail'],
      source: 'mail-lens:message',
      human: { summary: body.slice(0, 8000) },
      core: {
        definitions: [`Concord player mail ${id}.`],
        claims: [body.slice(0, 240)],
      },
      meta: {
        visibility: 'private',
        consent: { allowCitations: false },
        createdFrom: 'mail',
        mail: {
          id,
          fromUser: mail.fromUser || '',
          toUser: mail.toUser || '',
          subject,
        },
      },
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function payloadOf(data: { result?: unknown }): Record<string, unknown> | null {
  let node = asRecord(data.result);
  if (!node) return null;
  const inner = asRecord(node.result);
  if (inner && ('dtu' in inner || 'post' in inner || 'id' in inner)) node = inner;
  return node;
}

export function dtuRecordId(data: { ok?: boolean; result?: unknown }): string {
  if (data.ok === false) return '';
  const payload = payloadOf(data);
  if (!payload) return '';
  const dtu = asRecord(payload.dtu);
  return String(dtu?.id || payload.id || '');
}

export function dtuReadBackMatches(id: string, data: { ok?: boolean; result?: unknown }): boolean {
  return Boolean(id) && dtuRecordId(data) === id;
}

export function dtuReadBackCall(id: string): MailKeepCall {
  return { domain: 'dtu', action: 'get', input: { id } };
}

export function sendMailDtuToTimelineCall(mail: KeptMail, dtuId: string): MailKeepCall | null {
  const id = dtuId.trim();
  const mailId = String(mail?.id || '').trim();
  if (!DTU_ID.test(id) || !mailId) return null;
  const content = [
    `Mail ${mailId}.`,
    `Subject: ${String(mail.subject || '').slice(0, 120)}`,
    `From DTU ${id}.`,
    'Concord player mail. Gmail was not sent.',
  ].join('\n').slice(0, 5000);
  return {
    domain: 'timeline',
    action: 'post-create',
    input: { content, privacy: 'private', media: [], citedDtuId: id },
  };
}

export function sendMailDtuOutcome(
  dtuId: string,
  data: { ok?: boolean; result?: unknown; error?: string | null },
): { claimed: boolean; text: string; postId: string } {
  if (data.ok === false) {
    return { claimed: false, postId: '', text: `Not sent. ${data.error || 'The server refused this.'}` };
  }
  const payload = payloadOf(data);
  const post = asRecord(payload?.post);
  const postId = String(post?.id || '');
  const privacy = String(post?.privacy || '');
  const cited = String(post?.citedDtuId || '');
  if (!postId) return { claimed: false, postId: '', text: 'Not sent. Timeline returned no post id.' };
  if (privacy !== 'private') {
    return { claimed: false, postId, text: `Timeline stored post ${postId} as ${privacy || 'unknown'}. DTU ${dtuId} was not sent as a private post.` };
  }
  if (cited !== dtuId) {
    return { claimed: false, postId, text: `Timeline stored private post ${postId} without DTU ${dtuId}.` };
  }
  return {
    claimed: true,
    postId,
    text: `Sent DTU ${dtuId} to your Timeline as private post ${postId}. Gmail was not sent.`,
  };
}
