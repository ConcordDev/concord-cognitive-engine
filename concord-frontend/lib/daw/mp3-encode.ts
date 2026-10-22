/**
 * MP3 encode for Studio export: the off-thread wrapper.
 *
 * The encoder core (lamejs, ID3, bitrates, inspectMp3) lives in
 * mp3-encode-core.ts and is re-exported here, so callers keep importing from
 * './mp3-encode'. Only this file creates the Worker; the worker imports the
 * core, never this file.
 */

import { encodeMp3, type Mp3EncodeOptions } from './mp3-encode-core';

export * from './mp3-encode-core';

let workerSeq = 0;

/**
 * Encode off the UI thread. Falls back to the same encoder on this thread
 * when Worker is unavailable (tests, older browsers) — still chunked, so
 * cancel and progress keep working.
 */
export function encodeMp3OffThread(opts: Mp3EncodeOptions): Promise<Uint8Array> {
  if (typeof Worker === 'undefined') return encodeMp3(opts);
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./mp3-encode.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      encodeMp3(opts).then(resolve, reject);
      return;
    }
    const id = ++workerSeq;
    const copies = opts.channels.slice(0, 2).map((c) => new Float32Array(c));
    const finish = (fn: () => void) => {
      try { worker.terminate(); } catch { /* already gone */ }
      fn();
    };
    const onAbort = () => {
      try { worker.postMessage({ type: 'cancel', id }); } catch { /* worker already dead */ }
      finish(() => {
        const e = new Error('MP3 encode cancelled');
        e.name = 'AbortError';
        reject(e);
      });
    };
    if (opts.signal?.aborted) { onAbort(); return; }
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    worker.onerror = (ev) => {
      opts.signal?.removeEventListener('abort', onAbort);
      finish(() => reject(new Error(ev.message || 'MP3 encoder failed')));
    };
    worker.onmessage = (ev: MessageEvent) => {
      const msg = ev.data || {};
      if (msg.id !== id) return;
      if (msg.type === 'progress') opts.onProgress?.(Number(msg.fraction) || 0);
      else if (msg.type === 'done') {
        opts.signal?.removeEventListener('abort', onAbort);
        finish(() => resolve(new Uint8Array(msg.bytes)));
      } else if (msg.type === 'error') {
        opts.signal?.removeEventListener('abort', onAbort);
        const e = new Error(String(msg.message || 'MP3 encode failed'));
        if (msg.name) e.name = String(msg.name);
        finish(() => reject(e));
      }
    };
    worker.postMessage(
      { type: 'encode', id, channels: copies, sampleRate: opts.sampleRate, bitrate: opts.bitrate, tags: opts.tags || null },
      copies.map((c) => c.buffer),
    );
  });
}
