/**
 * cinematic-capture.ts — auto-record gameplay clips for trailer / replay.
 *
 * Listens for high-emergence socket events (combat:kill, evo:asset-promoted,
 * world:crisis, world:refusal-field, faction-war:end, tournament:complete)
 * and starts a MediaRecorder against `<canvas>#concordia-canvas`. Clips
 * land in IndexedDB with metadata (event kind, timestamp, world, duration)
 * and can be exported as WebM via the `/lenses/captures` panel.
 *
 * Pre-this module the world had no automatic capture pipeline — even
 * spectacular events (Mass Raid dome collapse, faction war kill streaks,
 * tournament championships) generated zero trailer footage. The capture
 * system runs continuously when enabled and writes a rolling 12-second
 * pre-roll buffer so the moment leading INTO the event is preserved
 * along with the post-event reaction.
 *
 * Browser ceiling: MediaRecorder requires the canvas to be GPU-composited
 * with `preserveDrawingBuffer: true` OR the rendering context to be the
 * source of `captureStream()`. Three.js's WebGLRenderer canvas supports
 * captureStream out of the box at 30fps.
 */

import { subscribe, type SocketEvent } from '@/lib/realtime/socket';

const PRE_ROLL_SECONDS = 12;
const POST_ROLL_SECONDS = 6;
const FRAME_RATE = 30;
const STORAGE_KEY = 'concord-cinematic-captures';
const MAX_STORED_CLIPS = 30;

// Events that auto-trigger capture. Tier-1 events get full POST_ROLL,
// tier-2 events get half, tier-3 are toast-only (no clip).
const TRIGGER_EVENTS: { name: SocketEvent; tier: 1 | 2 | 3; label: string }[] = [
  { name: 'combat:kill',          tier: 1, label: 'Kill'                 },
  { name: 'evo:asset-promoted',   tier: 1, label: 'Evo asset promoted'  },
  { name: 'world:crisis',         tier: 1, label: 'World crisis'         },
  { name: 'world:refusal-field',  tier: 1, label: 'Refusal field'        },
  { name: 'faction-war:end',      tier: 1, label: 'Faction war end'      },
  { name: 'combat:combo-evolved', tier: 2, label: 'Combo evolved'        },
];

interface CaptureRecord {
  id: string;
  ts: number;
  eventKind: string;
  label: string;
  durationMs: number;
  blob: Blob;
}

interface SerializedCaptureRecord {
  id: string;
  ts: number;
  eventKind: string;
  label: string;
  durationMs: number;
  blobBase64: string;
  mimeType: string;
}

let _recorder: MediaRecorder | null = null;
let _stream: MediaStream | null = null;
let _chunks: Blob[] = [];
let _running = false;
let _captureUnsubs: (() => void)[] = [];

function findRenderCanvas(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  return (
    (document.getElementById('concordia-canvas') as HTMLCanvasElement | null) ??
    (document.querySelector('canvas') as HTMLCanvasElement | null) ??
    null
  );
}

async function blobToBase64(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => {
      const result = r.result;
      if (typeof result === 'string') {
        // strip "data:...;base64," prefix
        const idx = result.indexOf(',');
        resolve(idx >= 0 ? result.slice(idx + 1) : result);
      } else {
        reject(new Error('blob_read_failed'));
      }
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}

function persistClip(record: CaptureRecord): void {
  if (typeof window === 'undefined') return;
  blobToBase64(record.blob).then((blobBase64) => {
    const stored: SerializedCaptureRecord = {
      id: record.id,
      ts: record.ts,
      eventKind: record.eventKind,
      label: record.label,
      durationMs: record.durationMs,
      blobBase64,
      mimeType: record.blob.type || 'video/webm',
    };
    try {
      const all: SerializedCaptureRecord[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      all.push(stored);
      // Keep newest N to avoid filling localStorage (which caps ~5MB total).
      const trimmed = all.slice(-MAX_STORED_CLIPS);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      window.dispatchEvent(new CustomEvent('concordia:capture-saved', { detail: { id: record.id, label: record.label } }));
    } catch {
      // localStorage quota — quietly drop the clip rather than crash.
    }
  }).catch(() => { /* persist is best-effort */ });
}

function startContinuousCapture(canvas: HTMLCanvasElement): void {
  if (_running) return;
  try {
    const stream = canvas.captureStream(FRAME_RATE);
    _stream = stream;
    _chunks = [];
    const mr = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
    _recorder = mr;
    mr.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        _chunks.push(e.data);
        // Keep at most PRE_ROLL_SECONDS worth of chunks (1 chunk = 1 sec at timeslice 1000)
        if (_chunks.length > PRE_ROLL_SECONDS + POST_ROLL_SECONDS + 2) {
          _chunks.shift();
        }
      }
    };
    mr.start(1000); // 1-second chunks for ring-buffer rotation
    _running = true;
  } catch {
    _running = false;
  }
}

function snapshotClip(eventKind: string, label: string, postRollMs: number): void {
  if (!_running || !_recorder) return;
  // Wait POST_ROLL_SECONDS so the chunks ring buffer captures the
  // reaction, then assemble the saved clip from the current ring.
  setTimeout(() => {
    try {
      const blob = new Blob(_chunks.slice(), { type: 'video/webm' });
      const id = `cap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const record: CaptureRecord = {
        id,
        ts: Date.now(),
        eventKind,
        label,
        durationMs: PRE_ROLL_SECONDS * 1000 + postRollMs,
        blob,
      };
      persistClip(record);
    } catch { /* snapshot failure is non-fatal */ }
  }, postRollMs);
}

/**
 * Activate the capture pipeline. Idempotent. Call once per session
 * (typically from the world lens mount).
 */
export function startCinematicCapture(): void {
  if (typeof window === 'undefined') return;
  if (_running) return;
  const canvas = findRenderCanvas();
  if (!canvas) return;

  startContinuousCapture(canvas);
  if (!_running) return;

  // Wire triggers. Each callback snapshots the current ring buffer
  // PLUS a brief post-roll so we capture the reaction.
  for (const trig of TRIGGER_EVENTS) {
    if (trig.tier === 3) continue;
    const off = subscribe(trig.name, (payload: unknown) => {
      void payload;
      const postRollMs = trig.tier === 1 ? POST_ROLL_SECONDS * 1000 : Math.floor(POST_ROLL_SECONDS * 1000 / 2);
      snapshotClip(trig.name, trig.label, postRollMs);
    });
    _captureUnsubs.push(off);
  }
}

/**
 * Tear down the capture pipeline. Safe to call multiple times.
 */
export function stopCinematicCapture(): void {
  for (const u of _captureUnsubs) u();
  _captureUnsubs = [];
  if (_recorder && _recorder.state !== 'inactive') {
    try { _recorder.stop(); } catch { /* ok */ }
  }
  if (_stream) {
    for (const t of _stream.getTracks()) t.stop();
  }
  _recorder = null;
  _stream = null;
  _chunks = [];
  _running = false;
}

/**
 * List stored clips. Returned sorted newest first.
 */
export function listStoredClips(): SerializedCaptureRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const all: SerializedCaptureRecord[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return all.sort((a, b) => b.ts - a.ts);
  } catch {
    return [];
  }
}

/**
 * Decode a stored clip back into a downloadable Blob URL.
 */
export function clipBlobUrl(stored: SerializedCaptureRecord): string {
  // Defensive decode: corrupted localStorage entries (truncated quota,
  // manual editing) would otherwise throw on lens mount and break
  // the captures panel for everyone.
  try {
    const bin = atob(stored.blobBase64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const blob = new Blob([arr], { type: stored.mimeType });
    return URL.createObjectURL(blob);
  } catch {
    return '';
  }
}

export function deleteStoredClip(id: string): void {
  if (typeof window === 'undefined') return;
  try {
    const all: SerializedCaptureRecord[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const next = all.filter((c) => c.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch { /* ok */ }
}
