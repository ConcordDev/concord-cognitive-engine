'use client';

// ARCaptureGallery — real client-side capture pipeline for the AR Scene
// Studio (Wave-4 gap closure, docs/lens-specs/ar-capability-map.md item 13:
// "No AR capture/screenshot/recording gallery"). Grabs a REAL pixel frame
// from the scene viewport's actual react-three-fiber WebGL canvas via
// `canvas.toDataURL()`, and a REAL video clip via `canvas.captureStream()` +
// MediaRecorder — never a placeholder/stock image standing in for a
// "capture". Persists through server/domains/ar.js's captureUpload/
// captureList/captureGet/captureDelete macros and renders a real gallery
// of what was actually captured.

import { useState, useCallback, useEffect, useRef } from 'react';
import { lensRun } from '@/lib/api/client';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { Camera, Video, Square, Trash2, RefreshCw, Eye, X } from 'lucide-react';

export interface CaptureMeta {
  id: string;
  mimeType: string;
  sceneId: string | null;
  durationMs: number | null;
  label: string | null;
  byteSize: number;
  createdAt: string;
}
interface CaptureFull extends CaptureMeta {
  dataUrl: string;
}

interface Props {
  /** Ref to the real rendering surface (react-three-fiber's `gl.domElement`). */
  canvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  /** The active scene's id, when one exists — links captures to it. */
  sceneId: string | null;
  /** True when there is no real scene loaded — capture controls stay disabled. */
  disabled?: boolean;
  onNotify?: (msg: string) => void;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('blob read failed'));
    reader.readAsDataURL(blob);
  });
}

export function ARCaptureGallery({ canvasRef, sceneId, disabled, onNotify }: Props) {
  const [captures, setCaptures] = useState<CaptureMeta[]>([]);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordMs, setRecordMs] = useState(0);
  const [preview, setPreview] = useState<CaptureFull | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // A real inline honest-state message (in addition to the optional parent
  // toast via onNotify) — so "no render surface yet" / upload failures are
  // visible in this panel itself, not only bubbled up silently.
  const [localMsg, setLocalMsg] = useState<string | null>(null);
  const notify = useCallback((m: string) => {
    setLocalMsg(m);
    if (onNotify) onNotify(m);
  }, [onNotify]);

  // Real browser-support feature detection — an unsupported browser gets an
  // honest disabled state + message, never a button that silently no-ops.
  const screenshotSupported =
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.toDataURL === 'function';
  const recordingSupported =
    typeof window !== 'undefined' &&
    typeof window.MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function';

  const loadCaptures = useCallback(async () => {
    const r = await lensRun<{ captures: CaptureMeta[]; count: number }>('ar', 'captureList', {});
    if (r.data?.ok) setCaptures(r.data.result?.captures || []);
  }, []);

  useEffect(() => { loadCaptures(); }, [loadCaptures]);

  // Stop any in-flight recording + timer on unmount so nothing leaks.
  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try { recorderRef.current.stop(); } catch { /* already stopped */ }
    }
  }, []);

  const takeScreenshot = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) { notify('No active AR render surface to capture yet.'); return; }
    if (!screenshotSupported) { notify('Screenshot capture is not supported in this browser.'); return; }
    setBusy(true);
    try {
      // A real pixel grab of whatever the viewport is actually rendering right now.
      const dataUrl = canvas.toDataURL('image/png');
      const r = await lensRun<{ capture: CaptureMeta; uploaded: boolean }>('ar', 'captureUpload', {
        dataUrl, mimeType: 'image/png', sceneId: sceneId || undefined,
      });
      if (r.data?.ok) { notify('Screenshot captured.'); await loadCaptures(); }
      else notify(r.data?.error || 'Screenshot upload failed.');
    } catch (e) {
      notify(`Screenshot failed: ${String((e as Error)?.message || e)}`);
    } finally {
      setBusy(false);
    }
  }, [canvasRef, sceneId, screenshotSupported, notify, loadCaptures]);

  const stopRecording = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    try { recorderRef.current?.stop(); } catch { /* already stopped */ }
    recorderRef.current = null;
    setRecording(false);
  }, []);

  const startRecording = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) { notify('No active AR render surface to record yet.'); return; }
    if (!recordingSupported) { notify('Recording is not supported in this browser.'); return; }
    try {
      const stream = canvas.captureStream(30);
      const preferred = 'video/webm';
      const mimeType = typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(preferred)
        ? preferred : '';
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        const outType = recorder.mimeType || preferred;
        const blob = new Blob(chunksRef.current, { type: outType });
        const durationMs = Date.now() - startedAtRef.current;
        if (blob.size === 0) { notify('Recording produced no data — nothing to save.'); return; }
        setBusy(true);
        try {
          const dataUrl = await blobToDataUrl(blob);
          const r = await lensRun<{ capture: CaptureMeta; uploaded: boolean }>('ar', 'captureUpload', {
            dataUrl, mimeType: outType, sceneId: sceneId || undefined, durationMs,
          });
          if (r.data?.ok) { notify('Recording captured.'); await loadCaptures(); }
          else notify(r.data?.error || 'Recording upload failed.');
        } catch (e) {
          notify(`Recording upload failed: ${String((e as Error)?.message || e)}`);
        } finally {
          setBusy(false);
        }
      };
      recorder.start();
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      setRecordMs(0);
      timerRef.current = setInterval(() => setRecordMs(Date.now() - startedAtRef.current), 250);
      setRecording(true);
    } catch (e) {
      notify(`Recording failed to start: ${String((e as Error)?.message || e)}`);
    }
  }, [canvasRef, recordingSupported, sceneId, notify, loadCaptures]);

  const viewCapture = useCallback(async (id: string) => {
    setBusy(true);
    try {
      const r = await lensRun<{ capture: CaptureFull }>('ar', 'captureGet', { captureId: id });
      if (r.data?.ok && r.data.result) setPreview(r.data.result.capture);
      else notify(r.data?.error || 'Could not load capture.');
    } finally {
      setBusy(false);
    }
  }, [notify]);

  const deleteCapture = useCallback(async (id: string) => {
    const r = await lensRun<{ deleted: boolean; captureId: string }>('ar', 'captureDelete', { captureId: id });
    if (r.data?.ok) {
      setPreview((p) => (p && p.id === id ? null : p));
      await loadCaptures();
    } else {
      notify(r.data?.error || 'Delete failed.');
    }
  }, [loadCaptures, notify]);

  const captureDisabled = !!disabled || busy;

  return (
    <div className={cn(ds.panel, 'space-y-3')}>
      <div>
        <p className="text-sm text-gray-300 mb-1">Capture</p>
        <p className={ds.textMuted}>
          Grabs the real rendered frame from the scene viewport — a pixel capture of what&rsquo;s
          actually drawn, never a placeholder.
        </p>
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <button
            onClick={takeScreenshot}
            className={ds.btnSecondary}
            disabled={captureDisabled || !screenshotSupported}
            aria-label="Take screenshot"
          >
            <Camera className="w-4 h-4" /> Screenshot
          </button>
          {recording ? (
            <button
              onClick={stopRecording}
              className={cn(ds.btnSecondary, 'text-red-400')}
              disabled={!!disabled}
              aria-label="Stop recording"
            >
              <Square className="w-4 h-4" /> Stop ({(recordMs / 1000).toFixed(1)}s)
            </button>
          ) : (
            <button
              onClick={startRecording}
              className={ds.btnSecondary}
              disabled={captureDisabled || !recordingSupported}
              aria-label="Start recording"
            >
              <Video className="w-4 h-4" /> Record
            </button>
          )}
        </div>
        {!recordingSupported && (
          <p className="text-xs text-amber-400 mt-1">
            Recording not supported in this browser (no MediaRecorder / canvas.captureStream). Screenshot capture still works.
          </p>
        )}
        {!screenshotSupported && (
          <p className="text-xs text-amber-400 mt-1">Screenshot capture is not supported in this browser.</p>
        )}
        {disabled && (
          <p className="text-xs text-gray-500 mt-1">Load or create a scene before capturing.</p>
        )}
        {localMsg && <p className="text-xs text-neon-cyan mt-1">{localMsg}</p>}
      </div>

      <div className="border-t border-lattice-border pt-3">
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-300">Gallery ({captures.length})</p>
          <button onClick={loadCaptures} className={ds.btnGhost} aria-label="Refresh captures">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
        {captures.length === 0 ? (
          <p className={cn(ds.textMuted, 'mt-2')}>No captures yet — take a screenshot or record a clip above.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 mt-2">
            {captures.map((c) => (
              <div key={c.id} className="rounded-md border border-lattice-border p-2 text-xs space-y-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-white truncate">{c.label || c.mimeType}</span>
                  <button onClick={() => deleteCapture(c.id)} className={ds.btnGhost} aria-label={`Delete capture ${c.id}`}>
                    <Trash2 className="w-3.5 h-3.5 text-red-400" />
                  </button>
                </div>
                <p className="text-gray-400">{fmtBytes(c.byteSize)} &middot; {c.mimeType}</p>
                {c.durationMs != null && <p className="text-gray-400">{(c.durationMs / 1000).toFixed(1)}s</p>}
                <button onClick={() => viewCapture(c.id)} className={cn(ds.btnGhost, 'w-full justify-center')}>
                  <Eye className="w-3.5 h-3.5" /> View
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {preview && (
        <div className="border-t border-lattice-border pt-3">
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm text-gray-300">Preview</p>
            <button onClick={() => setPreview(null)} className={ds.btnGhost} aria-label="Close preview">
              <X className="w-4 h-4" />
            </button>
          </div>
          {preview.mimeType.startsWith('video/') ? (
            <video src={preview.dataUrl} controls className="w-full rounded-md" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview.dataUrl} alt="AR capture" className="w-full rounded-md" />
          )}
        </div>
      )}
    </div>
  );
}
