// lib/brain/record-brain-call.js
//
// Count a brain call that does not go through callBrain. The image paths
// (/api/vision/analyze → lib/vision-inference.js callVision, and the
// multimodal.vision_analyze macro) call the vision model directly, so
// BRAIN.multimodal.stats stayed at 0 requests while images were being
// answered (live test, 2026-10-17). Same fields callBrain updates.

/**
 * @param {object|null|undefined} brain  a BRAIN slot ({ stats })
 * @param {{ ok: boolean, startedAt: number, now?: number }} call
 */
export function recordBrainCall(brain, { ok, startedAt, now = Date.now() } = {}) {
  const s = brain?.stats;
  if (!s || typeof s !== "object") return;
  s.requests = (Number(s.requests) || 0) + 1;
  s.lastCallAt = new Date(now).toISOString();
  if (Number.isFinite(startedAt)) s.totalMs = (Number(s.totalMs) || 0) + Math.max(0, now - startedAt);
  if (!ok) s.errors = (Number(s.errors) || 0) + 1;
}
