/// <reference lib="webworker" />
/**
 * MP3 encode off the main thread. The UI posts float PCM and may cancel.
 * The encoder itself lives in mp3-encode-core.ts (never import mp3-encode.ts
 * here: it creates this worker, and that cycle hangs the Turbopack build).
 */

import { encodeMp3, type Mp3Bitrate, type Mp3Tags } from './mp3-encode-core';

const scope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;
const controllers = new Map<number, AbortController>();

scope.onmessage = (ev: MessageEvent) => {
  const msg = ev.data || {};
  if (msg.type === 'cancel') {
    controllers.get(msg.id)?.abort();
    return;
  }
  if (msg.type !== 'encode') return;
  const id = Number(msg.id);
  const ctl = new AbortController();
  controllers.set(id, ctl);
  const channels = (msg.channels as Float32Array[]) || [];
  void encodeMp3({
    channels,
    sampleRate: Number(msg.sampleRate),
    bitrate: Number(msg.bitrate) as Mp3Bitrate,
    tags: (msg.tags || undefined) as Mp3Tags | undefined,
    signal: ctl.signal,
    onProgress: (fraction) => scope.postMessage({ type: 'progress', id, fraction }),
  }).then((bytes) => {
    controllers.delete(id);
    scope.postMessage({ type: 'done', id, bytes }, [bytes.buffer]);
  }).catch((err: unknown) => {
    controllers.delete(id);
    const error = err instanceof Error ? err : new Error(String(err));
    scope.postMessage({ type: 'error', id, message: error.message, name: error.name });
  });
};
