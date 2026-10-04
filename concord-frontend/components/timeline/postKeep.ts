/**
 * Keep a Timeline post the viewer can already see.
 *
 * A DTU is private. A Thread draft is not a post. A Forum topic is offered
 * only when the viewer wrote the post, or the post is already public —
 * copying someone else's friends-only post into a forum would widen it.
 */

export type KeepKind = 'dtu' | 'forum' | 'thread-draft';

export interface KeepPost {
  id: string;
  authorId: string;
  content: string;
  privacy: 'public' | 'friends' | 'private';
  sharedFrom?: { authorId: string; content: string } | null;
  media?: { url?: string; caption?: string }[];
}

export interface KeepCall {
  domain: string;
  action: string;
  input: Record<string, unknown>;
}

const TRUNCATED = '\n…(truncated)';

export function capText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const room = Math.max(0, maxChars - TRUNCATED.length);
  return text.slice(0, room) + TRUNCATED;
}

export function forumAllowed(post: KeepPost, viewerId: string): boolean {
  return post.authorId === viewerId || post.privacy === 'public';
}

export function keepBody(post: KeepPost, maxChars: number): string {
  const lines: string[] = [
    `Source: Concord Timeline post ${post.id} by ${post.authorId} (${post.privacy}).`,
  ];
  const content = (post.content || '').trim();
  if (content) lines.push('', content);
  const quoted = (post.sharedFrom?.content || '').trim();
  if (quoted) {
    lines.push('', `Quoted from ${post.sharedFrom?.authorId || 'unknown'}: ${quoted}`);
  }
  for (const item of post.media || []) {
    const url = (item.url || '').trim();
    if (!url) continue;
    const caption = (item.caption || '').trim();
    lines.push('', caption ? `Media: ${url} (${caption})` : `Media: ${url}`);
  }
  if (lines.length === 1) return '';
  return capText(lines.join('\n'), maxChars);
}

function titleFor(post: KeepPost, body: string): string {
  const content = (post.content || '').trim();
  const first = content.split('\n').find((line) => line.trim()) || body.split('\n').find((line) => !line.startsWith('Source:'));
  return (first || 'Timeline post').trim().slice(0, 80);
}

export function keepCalls(post: KeepPost): Record<KeepKind, KeepCall> | null {
  const body = keepBody(post, 8000);
  if (!body) return null;
  const title = titleFor(post, body);
  const claims = [(post.content || '').trim() || `Saved Concord Timeline post ${post.id}.`].map((line) => line.slice(0, 240));
  return {
    dtu: {
      domain: 'dtu',
      action: 'create',
      input: {
        title,
        tags: ['timeline', 'post'],
        source: 'timeline-lens:post',
        human: { summary: keepBody(post, 8000) },
        core: {
          definitions: [`Saved Concord Timeline post ${post.id}.`],
          claims,
        },
        meta: {
          visibility: 'private',
          consent: { allowCitations: false },
          createdFrom: 'timeline',
          postId: post.id,
          authorId: post.authorId,
          privacy: post.privacy,
        },
      },
    },
    forum: {
      domain: 'forum',
      action: 'topic-create',
      input: {
        title: title.slice(0, 200),
        body: keepBody(post, 8000),
        format: 'plain',
        tags: ['timeline'],
      },
    },
    'thread-draft': {
      domain: 'thread',
      action: 'thread-draft',
      input: { title: title.slice(0, 120), content: keepBody(post, 25000) },
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function payloadOf(data: { ok?: boolean; result?: unknown; error?: string | null }): Record<string, unknown> | null {
  let node = asRecord(data.result);
  if (!node) return null;
  const inner = asRecord(node.result);
  if (inner && ('topic' in inner || 'draft' in inner || 'dtu' in inner || 'id' in inner)) node = inner;
  return node;
}

export function keepOutcome(
  kind: KeepKind,
  data: { ok?: boolean; result?: unknown; error?: string | null },
): { claimed: boolean; text: string } {
  if (data.ok === false) {
    return { claimed: false, text: `Not saved. ${data.error || 'The server refused this.'}` };
  }
  const payload = payloadOf(data);
  if (!payload) return { claimed: false, text: 'Not saved. The server returned no record.' };

  if (kind === 'dtu') {
    const dtu = asRecord(payload.dtu);
    const id = String(dtu?.id || payload.id || '');
    if (!id) return { claimed: false, text: 'Not saved. No DTU id returned.' };
    return { claimed: true, text: `Saved as private DTU ${id}.` };
  }

  if (kind === 'forum') {
    const topic = asRecord(payload.topic);
    const id = String(topic?.id || '');
    if (!id) return { claimed: false, text: 'Not created. Forum returned no topic id.' };
    return { claimed: true, text: `Forum topic ${id} created.` };
  }

  const draft = asRecord(payload.draft);
  const id = String(draft?.id || '');
  const status = String(draft?.status || '');
  if (!id) return { claimed: false, text: 'Not saved. Thread returned no draft id.' };
  if (status !== 'draft') {
    return { claimed: false, text: `Thread draft ${id} came back as ${status || 'unknown'}. Not posted.` };
  }
  return { claimed: true, text: `Saved Thread draft ${id}. Not posted.` };
}
