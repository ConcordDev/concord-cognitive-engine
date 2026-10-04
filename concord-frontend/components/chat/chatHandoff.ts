/**
 * Chat transcript handoff.
 *
 * Builds the payloads the chat menu sends to existing macros, and turns
 * the server's reply into a sentence that matches what actually happened.
 * A Timeline post is "posted" only when post-create returns a post id.
 * A Thread draft is never described as posted.
 */

export interface HandoffMessage {
  role: string;
  content: string;
}

export type HandoffKind = 'dtu' | 'timeline-private' | 'timeline-public' | 'forum' | 'thread-draft';

export interface HandoffCall {
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

export function buildTranscript(messages: HandoffMessage[], maxChars: number, sessionId: string | null): string {
  const source = `Source: Concord chat${sessionId ? ` ${sessionId}` : ''}.`;
  const lines: string[] = [];
  for (const message of messages) {
    const body = (message.content || '').trim();
    if (!body) continue;
    const who = message.role === 'assistant' ? 'Concord' : message.role === 'system' ? 'System' : 'You';
    lines.push(`${who}: ${body}`);
  }
  if (lines.length === 0) return '';
  return capText(`${source}\n\n${lines.join('\n\n')}`, maxChars);
}

function titleFor(title: string, transcript: string): string {
  const named = title.trim();
  if (named && named !== 'Chat transcript') return named.slice(0, 120);
  const first = transcript.split('\n').find((line) => line.startsWith('You: '));
  return (first ? first.slice(4) : 'Chat transcript').slice(0, 80);
}

export function handoffCalls(args: {
  title: string;
  sessionId: string | null;
  messages: HandoffMessage[];
}): Record<HandoffKind, HandoffCall> | null {
  const timeline = buildTranscript(args.messages, 5000, args.sessionId);
  if (!timeline) return null;
  const forumBody = buildTranscript(args.messages, 8000, args.sessionId);
  const threadBody = buildTranscript(args.messages, 25000, args.sessionId);
  const dtuBody = buildTranscript(args.messages, 8000, args.sessionId);
  const title = titleFor(args.title, timeline);
  const excerpts = args.messages
    .map((m) => (m.content || '').trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((line) => line.slice(0, 240));
  const claims = excerpts.length > 0 ? excerpts : ['This DTU is a saved Concord chat transcript.'];

  return {
    dtu: {
      domain: 'dtu',
      action: 'create',
      input: {
        title,
        tags: ['chat', 'transcript'],
        source: 'chat-lens:transcript',
        human: { summary: dtuBody },
        core: {
          definitions: [`Transcript of Concord chat${args.sessionId ? ` ${args.sessionId}` : ''}.`],
          claims,
        },
        meta: {
          visibility: 'private',
          consent: { allowCitations: false },
          createdFrom: 'chat',
          sessionId: args.sessionId,
          messageCount: args.messages.filter((m) => (m.content || '').trim()).length,
        },
      },
    },
    'timeline-private': {
      domain: 'timeline',
      action: 'post-create',
      input: { content: timeline, privacy: 'private', media: [] },
    },
    'timeline-public': {
      domain: 'timeline',
      action: 'post-create',
      input: { content: timeline, privacy: 'public', media: [] },
    },
    forum: {
      domain: 'forum',
      action: 'topic-create',
      input: { title: title.slice(0, 200), body: forumBody, format: 'plain', tags: ['chat'] },
    },
    'thread-draft': {
      domain: 'thread',
      action: 'thread-draft',
      input: { title: title.slice(0, 120), content: threadBody },
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

/** Peel one { result } layer if the caller did not already unwrap lensRun. */
function payloadOf(data: { ok?: boolean; result?: unknown; error?: string | null }): Record<string, unknown> | null {
  let node = asRecord(data.result);
  if (!node) return null;
  const inner = asRecord(node.result);
  if (inner && ('post' in inner || 'topic' in inner || 'draft' in inner || 'dtu' in inner || 'id' in inner)) {
    node = inner;
  }
  return node;
}

export function handoffOutcome(
  kind: HandoffKind,
  data: { ok?: boolean; result?: unknown; error?: string | null },
): { claimed: boolean; text: string } {
  if (data.ok === false) {
    const reason = data.error || 'The server refused this.';
    return { claimed: false, text: `Not saved. ${reason}` };
  }
  const payload = payloadOf(data);
  if (!payload) return { claimed: false, text: 'Not saved. The server returned no record.' };

  if (kind === 'dtu') {
    const dtu = asRecord(payload.dtu);
    const id = String(dtu?.id || payload.id || '');
    if (!id) return { claimed: false, text: 'Not saved. No DTU id returned.' };
    return { claimed: true, text: `Saved as DTU ${id}.` };
  }

  if (kind === 'timeline-private' || kind === 'timeline-public') {
    const post = asRecord(payload.post);
    const id = String(post?.id || '');
    const privacy = String(post?.privacy || '');
    const asked = kind === 'timeline-public' ? 'public' : 'private';
    if (!id) return { claimed: false, text: 'Not posted. Timeline returned no post id.' };
    if (privacy !== asked) {
      return { claimed: true, text: `Timeline stored post ${id} as ${privacy || 'unknown'}, not ${asked}.` };
    }
    const word = privacy === 'public' ? 'publicly' : 'privately';
    return { claimed: true, text: `Posted ${word} to your Timeline (${id}).` };
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
