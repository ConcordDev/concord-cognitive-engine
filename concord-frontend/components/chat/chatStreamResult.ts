/**
 * Maps what the chat transport returned onto what the UI shows.
 *
 * A turn can fail in three shapes: the stream's final envelope carries
 * `out.ok === false` (e.g. session_forbidden), the server's catch envelope
 * carries a top-level `error` (no `out`), or the buffered JSON answer is an
 * `{ok:false}` macro result. Each used to collapse into the generic "overloaded
 * or misconfigured" text because only `reply` was carried through.
 */

type Rec = Record<string, unknown>;

const FAILURE_KEYS = ['ok', 'error', 'reason', 'code', 'message', 'errorId'] as const;

function failureFields(src: Rec | null | undefined): Rec {
  const out: Rec = {};
  if (!src) return out;
  for (const k of FAILURE_KEYS) if (src[k] !== undefined) out[k] = src[k];
  return out;
}

/** Builds the mutation result for a finished SSE turn. */
export function streamResult(
  finalOut: Rec | null,
  topLevel: Rec | null,
  accumulated: string,
): Rec {
  const o = finalOut ?? {};
  const failed =
    o.ok === false || !!o.error || (!finalOut && (topLevel?.ok === false || !!topLevel?.error));
  return {
    reply: accumulated || (o.reply as string) || '',
    refs: o.refs,
    sources: o.sources,
    webAugmented: o.webAugmented,
    toolCalls: o.toolCalls,
    computed: o.computed,
    dtuRefs: o.dtuRefs,
    artifacts: o.artifacts,
    answerConfidence: o.answerConfidence,
    answerConfidenceReason: o.answerConfidenceReason,
    ...(failed ? failureFields(topLevel) : {}),
    ...(failed ? failureFields(finalOut) : {}),
    streamed: true,
  };
}

export type ChatFailure =
  | { kind: 'session_forbidden'; message: string }
  | { kind: 'error'; message: string };

function hasReply(d: Rec): boolean {
  const out = d.out as Rec | undefined;
  return [d.reply, out?.reply, d.answer, d.content, d.text, d.response].some(
    (v) => typeof v === 'string' && v.trim().length > 0,
  );
}

/** Returns a failure when the turn failed and produced no answer text. */
export function chatFailure(data: Rec | null | undefined): ChatFailure | null {
  if (!data || hasReply(data)) return null;
  const out = (data.out as Rec | undefined) ?? undefined;
  const error = (data.error ?? out?.error) as unknown;
  const failed = data.ok === false || out?.ok === false || !!error;
  if (!failed) return null;
  const code = typeof error === 'string' ? error : '';
  if (code === 'session_forbidden') {
    return {
      kind: 'session_forbidden',
      message: 'This conversation belongs to a different account. Starting a new chat.',
    };
  }
  const label = code || (typeof data.message === 'string' ? data.message : '') || 'chat_failed';
  const errorId = typeof data.errorId === 'string' ? data.errorId : '';
  return { kind: 'error', message: `Error: ${label}${errorId ? ` (ref ${errorId})` : ''}` };
}
