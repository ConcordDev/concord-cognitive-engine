// server/lib/sse.js
//
// Shared Server-Sent-Events setup that survives the production proxy chain
// (nginx → Cloudflare → RunPod). Concordia's chat/log/event streams worked on
// localhost but buffered-then-dumped and ~100s-dropped behind the proxies
// because the SSE responses were missing two things (SSE Streaming Hardening
// spec):
//
//   1. `X-Accel-Buffering: no`        — nginx MUST NOT buffer the event stream
//   2. `Cache-Control: … no-transform`— Cloudflare MUST NOT transform/compress it
//   + a heartbeat (a `:` comment line every ~15s) that beats Cloudflare's ~100s
//     idle-drop on long/idle generations.
//
// `startSSE(res)` is the one place those headers + the heartbeat + the close
// cleanup live. Byte-compatible on localhost (the headers are additive and safe;
// the heartbeat is an SSE comment that clients ignore).

const SSE_HEARTBEAT_MS = Number(process.env.CONCORD_SSE_HEARTBEAT_MS) || 15000;

/**
 * Prepare an Express response for SSE and start the keep-alive heartbeat.
 * @param {import('http').ServerResponse} res
 * @param {{ heartbeatMs?: number }} [opts]
 * @returns {() => void} stop — clears the heartbeat (also auto-cleared on close)
 */
export function startSSE(res, { heartbeatMs = SSE_HEARTBEAT_MS } = {}) {
  res.setHeader("Content-Type", "text/event-stream");
  // no-transform so Cloudflare doesn't rewrite/compress the stream.
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // The critical one: nginx must not buffer the response (honored end-to-end).
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const hb = setInterval(() => {
    try { res.write(":keepalive\n\n"); } catch { /* connection closed */ }
  }, heartbeatMs);
  if (typeof hb.unref === "function") hb.unref(); // never hold the process open

  const stop = () => clearInterval(hb);
  if (typeof res.on === "function") res.on("close", stop);
  return stop;
}
