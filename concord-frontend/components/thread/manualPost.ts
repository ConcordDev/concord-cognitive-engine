/**
 * The composer "I posted this" control calls thread.draft-publish.
 * That macro records the user's own attestation. It does not send the
 * thread anywhere. The sentence may say posted by you only when the
 * server returns postedManually and delivered: false.
 */

export function manualPostSentence(data: {
  ok?: boolean;
  result?: {
    delivered?: boolean;
    draft?: { id?: string; postedManually?: boolean; status?: string } | null;
  } | null;
  error?: string | null;
}): { claimed: boolean; text: string } {
  if (data.ok === false) {
    return { claimed: false, text: `Not marked. ${data.error || 'The server refused this.'}` };
  }
  const draft = data.result?.draft;
  const id = String(draft?.id || '');
  if (!id || draft?.postedManually !== true || draft?.status !== 'published' || data.result?.delivered !== false) {
    return { claimed: false, text: 'Not marked. Concord did not record this as posted by you.' };
  }
  return { claimed: true, text: `Marked as posted by you (${id}). Concord did not send it.` };
}

export interface DraftDtuSource {
  id: string;
  title?: string;
  content: string;
  status?: string;
  postedManually?: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function payloadOf(data: { ok?: boolean; result?: unknown }): Record<string, unknown> | null {
  let node = asRecord(data.result);
  if (!node) return null;
  const inner = asRecord(node.result);
  if (inner && ('dtu' in inner || 'post' in inner || 'id' in inner)) node = inner;
  return node;
}

/** Private DTU of this draft. The summary says Concord sent it only when the draft itself says so. */
export function draftDtuCall(draft: DraftDtuSource): { domain: string; action: string; input: Record<string, unknown> } | null {
  const content = (draft.content || '').trim();
  const id = (draft.id || '').trim();
  if (!id || content.length < 2) return null;
  const attested = draft.postedManually === true && draft.status === 'published';
  const statusLine = attested
    ? 'Status: posted by you. Concord did not send it.'
    : 'Status: draft. Not posted.';
  const summary = `Source: Concord Thread draft ${id}.\n${statusLine}\n\n${content}`.slice(0, 8000);
  return {
    domain: 'dtu',
    action: 'create',
    input: {
      title: (draft.title || content.split('\n')[0] || 'Thread draft').slice(0, 120),
      // dtu.create stamps visibility from this field. meta.visibility alone
      // does not win, and the thread lens is in the social default set, so
      // an omitted visibility would store a public DTU.
      visibility: 'private',
      tags: ['thread', 'draft'],
      source: 'thread-lens:draft',
      human: { summary },
      core: {
        definitions: [`Saved Concord Thread draft ${id}.`],
        claims: [statusLine],
      },
      meta: {
        visibility: 'private',
        consent: { allowCitations: false },
        createdFrom: 'thread',
        draftId: id,
        postedManually: attested,
        delivered: false,
      },
    },
  };
}

export function dtuReadBackCall(id: string): { domain: string; action: string; input: Record<string, unknown> } {
  return { domain: 'dtu', action: 'get', input: { id } };
}

export function dtuRecordId(data: { ok?: boolean; result?: unknown }): string {
  const payload = payloadOf(data);
  if (!payload) return '';
  const dtu = asRecord(payload.dtu);
  return String(dtu?.id || payload.id || '');
}

export function dtuReadBackMatches(id: string, data: { ok?: boolean; result?: unknown }): boolean {
  if (!id || (data as { ok?: boolean }).ok === false) return false;
  return dtuRecordId(data) === id;
}

export function sendDraftDtuToTimelineCall(args: {
  draft: DraftDtuSource;
  dtuId: string;
}): { domain: string; action: string; input: Record<string, unknown> } | null {
  const dtuId = args.dtuId.trim();
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(dtuId)) return null;
  const base = draftDtuCall(args.draft);
  const summary = String((base?.input.human as { summary?: string } | undefined)?.summary || '');
  if (!summary) return null;
  const cite = `\n\nDTU ${dtuId}`;
  const content = summary.length + cite.length <= 5000 ? `${summary}${cite}` : summary.slice(0, 5000);
  return {
    domain: 'timeline',
    action: 'post-create',
    input: { content, privacy: 'private', media: [], citedDtuId: dtuId },
  };
}

export function sendDraftDtuOutcome(
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
  if (privacy !== 'private' || cited !== dtuId) {
    return { claimed: false, postId, text: `Timeline stored post ${postId} without private DTU ${dtuId}.` };
  }
  return { claimed: true, postId, text: `Sent DTU ${dtuId} to your Timeline as private post ${postId}.` };
}
