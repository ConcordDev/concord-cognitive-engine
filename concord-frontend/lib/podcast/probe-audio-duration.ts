/**
 * Read duration from a local audio file via the browser's media element.
 * Returns whole seconds, or 0 when metadata never arrives (timeout) —
 * callers must not invent a duration in that case.
 */
export function probeAudioFileDuration(file: Blob, timeoutMs = 1500): Promise<number> {
  return new Promise((resolve) => {
    let settled = false;
    let url: string | null = null;
    const finish = (sec: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (url) {
        try { URL.revokeObjectURL(url); } catch { /* already revoked */ }
      }
      const n = Number(sec);
      resolve(Number.isFinite(n) && n > 0 ? Math.max(1, Math.round(n)) : 0);
    };
    const timer = setTimeout(() => finish(0), timeoutMs);
    try {
      url = URL.createObjectURL(file);
      const audio = document.createElement('audio');
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => finish(audio.duration);
      audio.onerror = () => finish(0);
      audio.src = url;
    } catch {
      finish(0);
    }
  });
}
