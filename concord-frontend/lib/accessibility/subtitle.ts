// concord-frontend/lib/accessibility/subtitle.ts
//
// F1 — subtitle timing + queue logic (pure, testable). The SubtitleDisplay
// component applies these; the dialogue path feeds cues via a window event.

export interface SubtitleCue {
  id: string;
  /** Speaker label (TLOU2-style), e.g. "Concordia" or "Kiren". Optional. */
  speaker?: string;
  text: string;
  /** Computed display duration in ms. */
  durationMs: number;
}

/**
 * Reading-time-based duration: ~200 wpm (≈3.3 words/sec) with a floor so even
 * a one-word line stays readable, and a ceiling so a long line doesn't linger.
 */
export function subtitleDurationMs(text: string, minMs = 1500, maxMs = 9000): number {
  const words = (text || '').trim().split(/\s+/).filter(Boolean).length;
  const ms = Math.round((words / 3.3) * 1000) + 600; // +600ms latch
  return Math.max(minMs, Math.min(maxMs, ms));
}

/**
 * Enqueue a cue, collapsing an immediate exact-duplicate (same speaker+text as
 * the last queued) so repeated dispatches from the dialogue path don't stutter.
 * Caps the queue length to avoid unbounded growth.
 */
export function enqueueCue(queue: SubtitleCue[], cue: SubtitleCue, cap = 4): SubtitleCue[] {
  const last = queue[queue.length - 1];
  if (last && last.speaker === cue.speaker && last.text === cue.text) return queue;
  const next = [...queue, cue];
  return next.length > cap ? next.slice(next.length - cap) : next;
}
