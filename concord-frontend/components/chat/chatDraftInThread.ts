/**
 * Keep → DTU → Thread, from a chat message.
 *
 * Thread stores a draft that cites a DTU the forge step already saved.
 * A draft is not a post. No id, or a read-back that doesn't match, means
 * there is nothing to cite.
 */

export interface ChatThreadDraftCall {
  domain: 'thread';
  action: 'thread-draft';
  input: {
    title: string;
    content: string;
    platform: string;
    citedDtuId: string;
  };
}

export function chatThreadDraftCall(args: {
  dtuId: string;
  title: string;
  content: string;
  platform?: string;
}): ChatThreadDraftCall | null {
  const id = String(args.dtuId || '').trim();
  const content = String(args.content || '').trim();
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(id) || content.length < 2) return null;
  const title = String(args.title || content).trim().slice(0, 120) || content.slice(0, 80);
  return {
    domain: 'thread',
    action: 'thread-draft',
    input: {
      title,
      content: content.slice(0, 25000),
      platform: args.platform || 'x',
      citedDtuId: id,
    },
  };
}

export interface ChatThreadDraftResult {
  draftId: string;
  status: string;
  citedDtuId: string;
}

/** What the screen may claim. Null when Thread did not keep a citing draft. */
export function chatThreadDraftOutcome(
  data: { ok?: boolean; result?: unknown; error?: string | null } | null | undefined,
  dtuId: string,
): ChatThreadDraftResult | null {
  if (!data || data.ok === false) return null;
  const result = data.result && typeof data.result === 'object' ? (data.result as Record<string, unknown>) : null;
  const nested = result?.result && typeof result.result === 'object' ? (result.result as Record<string, unknown>) : null;
  const draftSource = (nested?.draft || result?.draft) as Record<string, unknown> | undefined;
  const draft = draftSource && typeof draftSource === 'object' ? draftSource : null;
  if (!draft) return null;
  const draftId = String(draft.id || '').trim();
  const cited = String(draft.citedDtuId || '').trim();
  const status = String(draft.status || '').trim();
  if (!draftId || cited !== String(dtuId).trim() || status !== 'draft') return null;
  return { draftId, status, citedDtuId: cited };
}
