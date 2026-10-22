/**
 * IndexedDB cache for Pitch Editor analysis, keyed by asset id, sample rate,
 * length, and analysis version. The memory cache in editor.ts is the sync
 * path used by playback and export. If IndexedDB is missing, memory is enough.
 */

import { analysisCacheKey, storeAnalysis, takeAnalysis } from './dsp/pitch/editor';
import type { PitchAnalysis } from './pitch-edit-types';

const DB_NAME = 'concord-studio-pitch';

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('analysis')) db.createObjectStore('analysis');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function loadCachedAnalysis(assetId: string, sampleRate: number, length: number): Promise<PitchAnalysis | null> {
  const key = analysisCacheKey(assetId, sampleRate, length);
  const mem = takeAnalysis(key);
  if (mem) return mem;
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction('analysis', 'readonly').objectStore('analysis').get(key);
      req.onsuccess = () => {
        const row = req.result as PitchAnalysis | undefined;
        if (row && row.version) {
          storeAnalysis(key, row);
          resolve(row);
        } else resolve(null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function rememberAnalysis(assetId: string, sampleRate: number, length: number, analysis: PitchAnalysis): Promise<void> {
  const key = analysisCacheKey(assetId, sampleRate, length);
  storeAnalysis(key, analysis);
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction('analysis', 'readwrite');
      tx.objectStore('analysis').put(analysis, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export function analyzeOffThread(channel: Float32Array, sampleRate: number, analyzeSync: (channel: Float32Array, sampleRate: number) => PitchAnalysis): Promise<PitchAnalysis> {
  if (typeof Worker === 'undefined') return Promise.resolve(analyzeSync(channel, sampleRate));
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./pitch-edit.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      resolve(analyzeSync(channel, sampleRate));
      return;
    }
    const copy = new Float32Array(channel);
    const finish = (analysis: PitchAnalysis) => {
      try { worker.terminate(); } catch { /* already gone */ }
      resolve(analysis);
    };
    worker.onerror = () => finish(analyzeSync(channel, sampleRate));
    worker.onmessage = (ev: MessageEvent) => {
      const msg = ev.data || {};
      if (msg.type === 'analysis' && msg.result) finish(msg.result as PitchAnalysis);
      else finish(analyzeSync(channel, sampleRate));
    };
    try {
      worker.postMessage({ type: 'analyze', id: 1, channel: copy, sampleRate }, [copy.buffer]);
    } catch {
      finish(analyzeSync(channel, sampleRate));
    }
  });
}
