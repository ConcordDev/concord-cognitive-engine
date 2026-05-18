/**
 * Audio Logger — Sprint C Item #8.
 *
 * Always-on rolling-buffer capture of the master bus, persisted in
 * IndexedDB so the producer can save a moment they liked even after
 * they stopped playing.
 *
 * Storage model: chunks of ~5 seconds of Float32Array data
 * (downsampled to 22050 Hz mono to keep the buffer cheap). The ring
 * buffer holds ~10 minutes (120 chunks); when full, oldest chunk is
 * dropped. `saveSegment(startMs, endMs, title)` slices the ring,
 * reassembles a WAV blob, and uploads to the dtu mint endpoint as
 * a draft `kind='audio_capture'` DTU.
 *
 * Privacy: this is opt-in — `AudioLogger.attach(...)` only fires
 * after the producer hits the "Start logging" toggle, and the
 * UI shows a persistent recording indicator while it's active.
 */

const DB_NAME = 'concord-audio-logger';
const STORE = 'chunks';
const DB_VERSION = 1;
const CHUNK_SEC = 5;
const RING_MAX_CHUNKS = 120;       // ~10 min
const DOWNSAMPLE_RATE = 22050;

export interface AudioChunk {
  index: number;                  // monotonic chunk id
  startMs: number;                // wall-clock start (Date.now()) of this chunk
  endMs: number;                  // wall-clock end
  sampleRate: number;             // always DOWNSAMPLE_RATE in practice
  data: Float32Array;             // mono
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable in this environment'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'index' });
        store.createIndex('startMs', 'startMs', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('idb_open_failed'));
  });
  return dbPromise;
}

async function putChunk(chunk: AudioChunk): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.put(chunk);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('idb_put_failed'));
  });
}

async function pruneOldest(maxKept: number): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const idx = store.index('startMs');
    const countReq = store.count();
    countReq.onsuccess = () => {
      const count = countReq.result;
      if (count <= maxKept) { resolve(); return; }
      let toDelete = count - maxKept;
      const cursorReq = idx.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor || toDelete <= 0) { resolve(); return; }
        cursor.delete();
        toDelete -= 1;
        cursor.continue();
      };
      cursorReq.onerror = () => reject(cursorReq.error || new Error('idb_prune_failed'));
    };
    countReq.onerror = () => reject(countReq.error || new Error('idb_count_failed'));
  });
}

export async function listChunks(): Promise<AudioChunk[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result || []) as AudioChunk[]);
    req.onerror = () => reject(req.error || new Error('idb_get_all_failed'));
  });
}

export async function clearAll(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('idb_clear_failed'));
  });
}

/* ─── Downsampling: linear interpolation to DOWNSAMPLE_RATE mono ─── */

function downsample(input: Float32Array, inRate: number, outRate = DOWNSAMPLE_RATE): Float32Array {
  if (inRate === outRate) return input;
  const ratio = inRate / outRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio;
    const j = Math.floor(src);
    const frac = src - j;
    const a = input[j] || 0;
    const b = input[j + 1] || a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/* ─── WAV encoder (16-bit PCM mono) ─── */

export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  // RIFF header
  writeStr(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(view, 8, 'WAVE');
  // fmt chunk
  writeStr(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);        // PCM
  view.setUint16(22, 1, true);        // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);        // block align
  view.setUint16(34, 16, true);       // bits per sample
  // data chunk
  writeStr(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

function writeStr(view: DataView, off: number, s: string): void {
  for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
}

/* ─── Live tap controller ─── */

export interface AudioLoggerHandle {
  stop(): void;
  isRunning(): boolean;
  /** Latest chunk index (monotonic); useful for the UI indicator. */
  latestIndex(): number;
}

/**
 * Tap an AudioContext destination via the supplied analyser, slice
 * into 5-second chunks, downsample, persist in IndexedDB.
 *
 * The analyser MUST be connected to the master bus output (e.g.
 * `MixerEngine.getMasterAnalyser()`). We never tap getUserMedia
 * here — the existing AudioRecorder already covers mic capture
 * and confusing the two flows is exactly the privacy hazard
 * we want to avoid.
 */
export function startAudioLogger(analyser: AnalyserNode): AudioLoggerHandle {
  let running = true;
  let chunkIndex = 0;
  let lastSavedIndex = -1;
  const sampleRate = analyser.context.sampleRate;
  const samplesPerChunk = sampleRate * CHUNK_SEC;
  const buffer: number[] = [];
  // Use the analyser's existing fftSize as the per-frame read window.
  const frame = new Float32Array(analyser.fftSize);
  let lastChunkStartMs = Date.now();
  const intervalMs = (analyser.fftSize / sampleRate) * 1000;
  const timer = window.setInterval(() => {
    if (!running) return;
    analyser.getFloatTimeDomainData(frame);
    for (let i = 0; i < frame.length; i++) buffer.push(frame[i]);
    if (buffer.length >= samplesPerChunk) {
      const slice = buffer.splice(0, samplesPerChunk);
      const raw = new Float32Array(slice);
      const ds = downsample(raw, sampleRate);
      const now = Date.now();
      const chunk: AudioChunk = {
        index: chunkIndex,
        startMs: lastChunkStartMs,
        endMs: now,
        sampleRate: DOWNSAMPLE_RATE,
        data: ds,
      };
      putChunk(chunk)
        .then(() => pruneOldest(RING_MAX_CHUNKS))
        .catch(() => { /* best-effort persist */ });
      lastSavedIndex = chunkIndex;
      chunkIndex += 1;
      lastChunkStartMs = now;
    }
  }, intervalMs);

  return {
    stop() { running = false; window.clearInterval(timer); },
    isRunning() { return running; },
    latestIndex() { return lastSavedIndex; },
  };
}

/**
 * Materialise a saved WAV blob from the chunks whose [startMs, endMs)
 * overlaps [startMs, endMs] of the request. Used by the "Save this
 * moment" button.
 */
export async function saveSegmentToWav(startMs: number, endMs: number): Promise<{ blob: Blob; sampleRate: number; durationSec: number } | null> {
  if (endMs <= startMs) return null;
  const all = await listChunks();
  const overlapping = all
    .filter(c => c.endMs >= startMs && c.startMs <= endMs)
    .sort((a, b) => a.startMs - b.startMs);
  if (overlapping.length === 0) return null;
  const sampleRate = overlapping[0].sampleRate;
  let totalSamples = 0;
  for (const c of overlapping) totalSamples += c.data.length;
  const out = new Float32Array(totalSamples);
  let cursor = 0;
  for (const c of overlapping) {
    out.set(c.data, cursor);
    cursor += c.data.length;
  }
  return { blob: encodeWav(out, sampleRate), sampleRate, durationSec: totalSamples / sampleRate };
}

// Exported for tests.
export const _internal = { downsample, openDb, RING_MAX_CHUNKS, CHUNK_SEC, DOWNSAMPLE_RATE };
