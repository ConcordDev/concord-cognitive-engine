// One reader for every agent-style response (CKPT-19). `chat_agent.do` returns its text in `answer`;
// older panels each read their own mix of reply / summary / output.
export type AgentReply = { ok: true; text: string } | { ok: false; reason: string };

const filled = (v: unknown): boolean => {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  return true;
};

const asText = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v, null, 2));

/** `data` is the axios `r.data` from POST /api/lens/run. */
export function readAgentReply(data: unknown): AgentReply {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const result = (d.result && typeof d.result === 'object' ? d.result : {}) as Record<string, unknown>;
  for (const v of [result.answer, result.reply, result.summary, result.output, d.reply]) {
    if (filled(v)) return { ok: true, text: asText(v) };
  }
  if (result.ok === false || d.ok === false) {
    const reason = result.reason || result.error || d.error;
    return { ok: false, reason: typeof reason === 'string' && reason ? reason : 'The agent could not finish.' };
  }
  return { ok: false, reason: 'The agent finished without writing anything.' };
}
