/**
 * Read-aloud for regular Chat. Speech is a browser feature (Web Speech API);
 * the server has no TTS, so "read your last answer out loud" used to come back
 * as the same text with nothing spoken (chat-par probe 2026-10-17).
 */

const READ_ALOUD_RE = /^\s*(?:(?:please|can you|could you|would you)\s+)*(?:read|say|speak)\s+(?:that|this|it|the\s+(?:last\s+)?(?:answer|reply|response|message)|your\s+(?:last\s+|previous\s+)?(?:answer|reply|response|message))(?:\s+(?:back\s+)?(?:to me\s+)?(?:out\s+loud|aloud))?\s*(?:please)?\s*[.!?]*\s*$/i;
const ALOUD_RE = /\b(?:out\s+loud|aloud)\b/i;

/** True for "read your last answer out loud", "read that aloud", "say it out loud". */
export function isReadAloudRequest(text: string): boolean {
  const t = String(text || '');
  if (t.length > 120 || !READ_ALOUD_RE.test(t)) return false;
  return ALOUD_RE.test(t) || /^\s*(?:please\s+)?read\s+(?:that|it|this)\s*[.!?]*\s*$/i.test(t);
}

/** Markdown → plain speakable text (no URLs, code fences or markup). */
export function speakableText(md: string): string {
  return String(md || '')
    .replace(/```[\s\S]*?```/g, ' code block omitted. ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[*_`#>|~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000);
}

export function canSpeak(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

/** Speak now (call from the tap handler: iOS only allows speech from a user gesture). */
export function speakText(md: string): boolean {
  if (!canSpeak()) return false;
  const text = speakableText(md);
  if (!text) return false;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1;
    window.speechSynthesis.speak(u);
    return true;
  } catch {
    return false;
  }
}

export function stopSpeaking(): void {
  if (canSpeak()) {
    try { window.speechSynthesis.cancel(); } catch { /* nothing to stop */ }
  }
}
