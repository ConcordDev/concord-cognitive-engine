// server/lib/chat/progress.js
//
// Real progress for a streaming chat turn. /api/chat/stream sets
// ctx.chatProgress to an SSE writer; chat.respond calls it at actual steps
// (brain call started, each tool started/finished, answer being written).
// Nothing here is a timer or a guess: no step, no event. Without a writer
// (JSON turns, tests) every call is a no-op.

const TOOL_LABELS = {
  web_search: "Searching the web",
  browse_url: "Reading the page",
  run_compute: "Running the calculation",
  conkay_design: "Sizing the design",
  conkay_solve: "Running the solver",
  conkay_compile_brief: "Compiling the design brief",
  dtu_search: "Searching your knowledge base",
  create_dtu: "Saving a DTU",
  run_lens_action: "Running a lens action",
  list_lens_actions: "Looking up lens actions",
  generate_image: "Generating the image",
  generate_3d: "Generating the 3D model",
};

export function toolLabel(call) {
  const base = TOOL_LABELS[call?.tool] || `Running ${String(call?.tool || "a tool").slice(0, 40)}`;
  const key = call?.tool === "run_compute" && typeof call?.params?.key === "string" ? ` (${call.params.key.slice(0, 60)})` : "";
  return base + key;
}

/** Emit one progress event; never throws, never blocks the turn. */
export function chatProgress(ctx, event) {
  try {
    if (typeof ctx?.chatProgress === "function") ctx.chatProgress({ at: Date.now(), ...event });
  } catch { /* decoration only */ }
}

/** Run a tool call, reporting running -> done|failed around it. */
export async function withToolProgress(ctx, call, run) {
  const label = toolLabel(call);
  chatProgress(ctx, { stage: "tool", tool: call?.tool, status: "running", label });
  try {
    const r = await run();
    chatProgress(ctx, { stage: "tool", tool: call?.tool, status: r && r.ok === false ? "failed" : "done", label });
    return r;
  } catch (e) {
    chatProgress(ctx, { stage: "tool", tool: call?.tool, status: "failed", label });
    throw e;
  }
}

/**
 * Read an Ollama /api/chat response with stream:true. Each content delta goes
 * to onToken as it arrives; the return value has the same shape a stream:false
 * response would (message.content, done_reason, eval counts), so the caller's
 * existing handling is unchanged.
 */
export async function readOllamaChatStream(res, onToken) {
  const decoder = new TextDecoder();
  let buf = "";
  let content = "";
  let last = {};
  const take = (line) => {
    if (!line.trim()) return;
    let j;
    try { j = JSON.parse(line); } catch { return; }
    const t = j?.message?.content;
    if (typeof t === "string" && t) {
      content += t;
      try { onToken?.(t); } catch { /* preview only */ }
    }
    if (j?.done) last = j;
  };
  for await (const part of res.body) {
    buf += decoder.decode(part, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) { take(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
  }
  take(buf + decoder.decode());
  return { ...last, message: { role: "assistant", content } };
}
