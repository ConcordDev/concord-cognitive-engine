'use client';

/**
 * AnimToolsPanel — surfaces the FlipaClip / Pencil2D feature-parity backlog
 * for a single animation project: video export, audio waveform sync, shape
 * tweening, canvas presets + guides, rigging, custom brushes, and sharing.
 * Every value here is real user input or computed from the live project —
 * no sample data.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Film, AudioWaveform, Spline, Grid3x3, Bone, Brush, Share2,
  Loader2, Plus, Trash2, Download, Link2, Copy, Check,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type ToolTab = 'export' | 'audio' | 'tween' | 'canvas' | 'rig' | 'brushes' | 'share';

interface AudioTrack { id: string; name: string; url: string | null; startSec: number }
interface FLayer { id: string; name: string }
interface Frame { id: string; layers?: FLayer[] }
interface Anim {
  id: string; title: string; width: number; height: number; fps: number;
  frames: Frame[]; audio?: AudioTrack[];
}

interface ExportJob {
  id: string; format: string; width: number; height: number; fps: number;
  frameCount: number; fileSizeBytes: number; durationSec: number; createdAt: string;
}
interface CanvasPreset { id: string; label: string; width: number; height: number; fps: number }
interface Brush {
  id: string; name: string; tool: string; size: number; opacity: number;
  pressureSize: number; pressureOpacity: number; smoothing: number; taper: number; color: string;
}
interface RigBone {
  id: string; name: string; parentId: string | null;
  x: number; y: number; length: number; angle: number;
}
interface RigSegment {
  id: string; name: string; originX: number; originY: number; tipX: number; tipY: number;
}

const TOOL_TABS: { id: ToolTab; label: string; icon: typeof Film }[] = [
  { id: 'export', label: 'Export', icon: Film },
  { id: 'audio', label: 'Audio Sync', icon: AudioWaveform },
  { id: 'tween', label: 'Tween', icon: Spline },
  { id: 'canvas', label: 'Canvas', icon: Grid3x3 },
  { id: 'rig', label: 'Rig', icon: Bone },
  { id: 'brushes', label: 'Brushes', icon: Brush },
  { id: 'share', label: 'Share', icon: Share2 },
];

function fmtBytes(n: number): string {
  if (n <= 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
}

export function AnimToolsPanel({ anim, onChange }: { anim: Anim; onChange: () => void }) {
  const [tab, setTab] = useState<ToolTab>('export');
  return (
    <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="flex flex-wrap gap-1 p-2 border-b border-zinc-800 bg-zinc-950/40">
        {TOOL_TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            className={cn('flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-lg',
              tab === t.id ? 'bg-cyan-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700')}>
            <t.icon className="w-3 h-3" /> {t.label}
          </button>
        ))}
      </div>
      <div className="p-3">
        {tab === 'export' && <ExportPanel anim={anim} />}
        {tab === 'audio' && <AudioSyncPanel anim={anim} onChange={onChange} />}
        {tab === 'tween' && <TweenPanel anim={anim} onChange={onChange} />}
        {tab === 'canvas' && <CanvasPanel anim={anim} onChange={onChange} />}
        {tab === 'rig' && <RigPanel anim={anim} onChange={onChange} />}
        {tab === 'brushes' && <BrushPanel />}
        {tab === 'share' && <SharePanel anim={anim} />}
      </div>
    </div>
  );
}

/* ── Video export (MP4 / GIF / WebM) ─────────────────────────────────── */
function ExportPanel({ anim }: { anim: Anim }) {
  const [format, setFormat] = useState<'mp4' | 'gif' | 'webm' | 'png-sequence'>('mp4');
  const [scale, setScale] = useState(1);
  const [busy, setBusy] = useState(false);
  const [exports, setExports] = useState<ExportJob[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  const loadExports = useCallback(async () => {
    const r = await lensRun('animation', 'export-list', { animId: anim.id });
    if (r.data?.ok) setExports((r.data.result?.exports as ExportJob[]) || []);
  }, [anim.id]);

  useEffect(() => { void loadExports(); }, [loadExports]);

  // Render each project frame to an off-screen canvas and encode in-browser.
  const runExport = async () => {
    setBusy(true);
    setStatus('Building render manifest…');
    try {
      const mr = await lensRun('animation', 'export-manifest', { id: anim.id, format, scale });
      if (!mr.data?.ok) { setStatus(mr.data?.error || 'Manifest failed'); setBusy(false); return; }
      const manifest = mr.data.result as {
        width: number; height: number; fps: number; frameCount: number;
        durationSec: number; sequence: { sourceFrameId: string }[]; background: string;
      };
      if (!manifest.frameCount) { setStatus('Nothing to export — add frames first.'); setBusy(false); return; }

      const ar = await lensRun('animation', 'anim-get', { id: anim.id });
      const fullAnim = ar.data?.result?.animation as
        | { frames: { id: string; layers?: { visible: boolean; strokes: Stroke[] }[] }[] }
        | undefined;
      if (!fullAnim) { setStatus('Could not load frames.'); setBusy(false); return; }
      const frameById = new Map(fullAnim.frames.map((f) => [f.id, f]));

      const cv = document.createElement('canvas');
      cv.width = manifest.width;
      cv.height = manifest.height;
      const cx = cv.getContext('2d');
      if (!cx) { setStatus('Canvas unavailable.'); setBusy(false); return; }

      // Encode: WebCodecs WebM/MP4 when supported, else animated capture fallback.
      const blobParts: Blob[] = [];
      const recStream = (cv as HTMLCanvasElement & { captureStream?: (fps: number) => MediaStream })
        .captureStream?.(manifest.fps);
      const recorderType = format === 'webm' ? 'video/webm' : format === 'mp4' ? 'video/mp4' : '';
      let recorder: MediaRecorder | null = null;
      if (recStream && recorderType && typeof MediaRecorder !== 'undefined'
        && MediaRecorder.isTypeSupported(recorderType)) {
        recorder = new MediaRecorder(recStream, { mimeType: recorderType });
        recorder.ondataavailable = (e) => { if (e.data.size) blobParts.push(e.data); };
        recorder.start();
      }

      const pngFrames: string[] = [];
      for (let i = 0; i < manifest.sequence.length; i++) {
        setStatus(`Rendering frame ${i + 1}/${manifest.sequence.length}…`);
        const src = frameById.get(manifest.sequence[i].sourceFrameId);
        cx.save();
        cx.fillStyle = manifest.background || '#ffffff';
        cx.fillRect(0, 0, cv.width, cv.height);
        cx.scale(scale, scale);
        if (src?.layers) {
          for (const l of src.layers) {
            if (!l.visible) continue;
            for (const st of l.strokes) drawExportStroke(cx, st);
          }
        }
        cx.restore();
        if (format === 'png-sequence' || (!recorder && format === 'gif')) {
          pngFrames.push(cv.toDataURL('image/png'));
        }
        if (recorder) await new Promise((res) => setTimeout(res, 1000 / manifest.fps));
      }

      let blob: Blob;
      let ext = format === 'png-sequence' ? 'txt' : format;
      if (recorder) {
        await new Promise<void>((res) => {
          recorder!.onstop = () => res();
          recorder!.stop();
        });
        blob = new Blob(blobParts, { type: recorderType });
        ext = format === 'mp4' ? 'mp4' : 'webm';
      } else {
        // PNG sequence or GIF fallback — pack the data URLs into a manifest file.
        const payload = JSON.stringify({ format, fps: manifest.fps, frames: pngFrames });
        blob = new Blob([payload], { type: 'application/json' });
        ext = 'json';
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${anim.title.replace(/[^\w-]+/g, '_') || 'animation'}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);

      await lensRun('animation', 'export-record', {
        animId: anim.id, format, width: manifest.width, height: manifest.height,
        frameCount: manifest.frameCount, durationSec: manifest.durationSec,
        fileSizeBytes: blob.size,
      });
      await loadExports();
      setStatus(`Exported ${manifest.frameCount} frames (${fmtBytes(blob.size)}).`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Export failed.');
    }
    setBusy(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={format} onChange={(e) => setFormat(e.target.value as typeof format)}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
          <option value="mp4">MP4 video</option>
          <option value="webm">WebM video</option>
          <option value="gif">GIF (frame pack)</option>
          <option value="png-sequence">PNG sequence</option>
        </select>
        <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
          Scale {Math.round(scale * 100)}%
          <input type="range" min={0.25} max={2} step={0.25} value={scale}
            onChange={(e) => setScale(Number(e.target.value))} className="w-24 accent-cyan-500" />
        </label>
        <button type="button" onClick={runExport} disabled={busy}
          className="flex items-center gap-1 px-3 py-1.5 text-xs bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg disabled:opacity-50">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          Export
        </button>
      </div>
      {status && <p className="text-[11px] text-zinc-400">{status}</p>}
      <div>
        <h4 className="text-[11px] font-semibold text-zinc-400 mb-1">Export history</h4>
        {exports.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No exports yet.</p>
        ) : (
          <ul className="space-y-1">
            {exports.map((x) => (
              <li key={x.id} className="flex items-center gap-2 text-[11px] text-zinc-300 bg-zinc-950/50 rounded px-2 py-1">
                <Film className="w-3 h-3 text-cyan-400" />
                <span className="uppercase font-mono text-cyan-300">{x.format}</span>
                <span>{x.width}×{x.height}</span>
                <span>{x.frameCount} fr</span>
                <span className="text-zinc-400">{x.durationSec}s</span>
                <span className="ml-auto text-zinc-400">{fmtBytes(x.fileSizeBytes)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

interface Stroke { tool: string; color: string; size: number; opacity: number; points: number[][] }
function drawExportStroke(c: CanvasRenderingContext2D, st: Stroke) {
  const pts = st.points;
  if (!pts.length) return;
  c.save();
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.lineWidth = st.size;
  c.strokeStyle = st.color;
  c.fillStyle = st.color;
  c.globalAlpha = st.opacity;
  if (pts.length === 1) {
    c.beginPath();
    c.arc(pts[0][0], pts[0][1], Math.max(0.5, st.size / 2), 0, Math.PI * 2);
    c.fill();
  } else {
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.stroke();
  }
  c.restore();
}

/* ── Audio waveform display + sync scrubbing ─────────────────────────── */
function AudioSyncPanel({ anim, onChange }: { anim: Anim; onChange: () => void }) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [sync, setSync] = useState<{
    fps: number; totalFrames: number; durationSec: number;
    tracks: { id: string; name: string; startFrame: number; endFrame: number | null;
      durationSec: number; waveform: number[] }[];
  } | null>(null);

  const loadSync = useCallback(async () => {
    const r = await lensRun('animation', 'audio-sync-map', { id: anim.id });
    if (r.data?.ok) setSync(r.data.result as NonNullable<typeof sync>);
  }, [anim.id]);

  useEffect(() => { void loadSync(); }, [loadSync]);

  // Decode the chosen audio file in-browser, extract per-bucket peaks,
  // register the track, then push the waveform to the backend.
  const onFile = async (file: File) => {
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const AC = window.AudioContext
        || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      const actx = new AC();
      const decoded = await actx.decodeAudioData(buf.slice(0));
      const data = decoded.getChannelData(0);
      const buckets = 600;
      const step = Math.max(1, Math.floor(data.length / buckets));
      const peaks: number[] = [];
      for (let i = 0; i < data.length; i += step) {
        let peak = 0;
        for (let j = i; j < i + step && j < data.length; j++) peak = Math.max(peak, Math.abs(data[j]));
        peaks.push(peak);
      }
      void actx.close();
      const add = await lensRun('animation', 'audio-track-add', {
        animId: anim.id, name: file.name.replace(/\.[^.]+$/, ''), startSec: 0,
      });
      const track = add.data?.result?.track as AudioTrack | undefined;
      if (!track) { setBusy(false); return; }
      await lensRun('animation', 'audio-waveform-set', {
        animId: anim.id, trackId: track.id, peaks, durationSec: decoded.duration,
      });
      await loadSync();
      onChange();
    } catch {
      /* unsupported audio — silently ignore */
    }
    setBusy(false);
  };

  const removeTrack = async (id: string) => {
    await lensRun('animation', 'audio-track-remove', { animId: anim.id, id });
    await loadSync();
    onChange();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input ref={fileRef} type="file" accept="audio/*" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }} />
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
          className="flex items-center gap-1 px-3 py-1.5 text-xs bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg disabled:opacity-50">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          Add audio + waveform
        </button>
        {sync && <span className="text-[11px] text-zinc-400">{sync.totalFrames} frames · {sync.durationSec}s</span>}
      </div>
      {!sync || sync.tracks.length === 0 ? (
        <p className="text-[11px] text-zinc-400 italic">No audio tracks. Add a file to see its waveform aligned to the frame timeline.</p>
      ) : (
        <ul className="space-y-2">
          {sync.tracks.map((t) => (
            <li key={t.id} className="bg-zinc-950/50 rounded-lg p-2">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[11px] text-zinc-200 font-medium flex-1 truncate">{t.name}</span>
                <span className="text-[10px] text-zinc-400">
                  frame {t.startFrame}{t.endFrame != null ? `–${t.endFrame}` : ''}
                </span>
                <button aria-label="Delete" type="button" onClick={() => removeTrack(t.id)} className="text-zinc-600 hover:text-rose-400">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <WaveformBar peaks={t.waveform} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WaveformBar({ peaks }: { peaks: number[] }) {
  if (!peaks.length) {
    return <p className="text-[10px] text-zinc-400 italic">Waveform unavailable.</p>;
  }
  return (
    <div className="flex items-end gap-px h-12 bg-zinc-900 rounded px-1 py-1 overflow-hidden">
      {peaks.map((p, i) => (
        <div key={i} className="flex-1 min-w-px bg-cyan-500/70 rounded-sm"
          style={{ height: `${Math.max(3, p * 100)}%` }} />
      ))}
    </div>
  );
}

/* ── Path / shape tweening between keyframes ─────────────────────────── */
function TweenPanel({ anim, onChange }: { anim: Anim; onChange: () => void }) {
  const fromRef = useRef<HTMLCanvasElement | null>(null);
  const toRef = useRef<HTMLCanvasElement | null>(null);
  const [fromPath, setFromPath] = useState<number[][]>([]);
  const [toPath, setToPath] = useState<number[][]>([]);
  const [easing, setEasing] = useState('ease-in-out');
  const [steps, setSteps] = useState(8);
  const [preview, setPreview] = useState<{ path: number[][] }[]>([]);
  const [easings, setEasings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const W = 240;
  const H = Math.round((anim.height / anim.width) * W) || 140;
  const sx = W / anim.width;
  const sy = H / anim.height;

  const drawMini = useCallback((cv: HTMLCanvasElement | null, path: number[][], color: string) => {
    if (!cv) return;
    const c = cv.getContext('2d');
    if (!c) return;
    c.clearRect(0, 0, cv.width, cv.height);
    c.fillStyle = '#18181b';
    c.fillRect(0, 0, cv.width, cv.height);
    if (path.length) {
      c.strokeStyle = color;
      c.fillStyle = color;
      c.lineWidth = 2;
      c.beginPath();
      path.forEach((p, i) => {
        const x = p[0] * sx;
        const y = p[1] * sy;
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
      });
      c.stroke();
      for (const p of path) {
        c.beginPath();
        c.arc(p[0] * sx, p[1] * sy, 3, 0, Math.PI * 2);
        c.fill();
      }
    }
  }, [sx, sy]);

  useEffect(() => { drawMini(fromRef.current, fromPath, '#22d3ee'); }, [drawMini, fromPath]);
  useEffect(() => { drawMini(toRef.current, toPath, '#fb923c'); }, [drawMini, toPath]);

  const addPoint = (cv: HTMLCanvasElement, e: React.MouseEvent, isFrom: boolean) => {
    const rect = cv.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * anim.width);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * anim.height);
    if (isFrom) setFromPath((p) => [...p, [x, y]]);
    else setToPath((p) => [...p, [x, y]]);
  };

  const runPreview = async () => {
    setMsg(null);
    if (fromPath.length < 2 || fromPath.length !== toPath.length) {
      setMsg('Both paths need the same number of points (≥ 2).');
      return;
    }
    const r = await lensRun('animation', 'tween-shapes', { animId: anim.id, fromPath, toPath, easing, steps });
    if (r.data?.ok) {
      const res = r.data.result as { frames: { path: number[][] }[]; easings: string[] };
      setPreview(res.frames);
      setEasings(res.easings || []);
    } else {
      setMsg(r.data?.error || 'Tween failed.');
    }
  };

  const commit = async () => {
    if (fromPath.length < 2 || fromPath.length !== toPath.length) {
      setMsg('Both paths need the same number of points (≥ 2).');
      return;
    }
    setBusy(true);
    const r = await lensRun('animation', 'tween-to-frames', {
      animId: anim.id, fromPath, toPath, easing, steps,
      afterFrameId: anim.frames[anim.frames.length - 1]?.id,
    });
    setBusy(false);
    if (r.data?.ok) {
      const c = (r.data.result as { count: number }).count;
      setMsg(`Inserted ${c} tweened frames.`);
      onChange();
    } else {
      setMsg(r.data?.error || 'Commit failed.');
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-400">
        Click points on each canvas to define a start and end shape. Point counts must match.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-cyan-400">Start path · {fromPath.length} pts</span>
            <button type="button" onClick={() => setFromPath([])} className="text-[10px] text-zinc-400 hover:text-zinc-300">clear</button>
          </div>
          <canvas ref={fromRef} width={W} height={H} onClick={(e) => addPoint(e.currentTarget, e, true)}
            className="w-full rounded border border-zinc-700 cursor-crosshair" />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-orange-400">End path · {toPath.length} pts</span>
            <button type="button" onClick={() => setToPath([])} className="text-[10px] text-zinc-400 hover:text-zinc-300">clear</button>
          </div>
          <canvas ref={toRef} width={W} height={H} onClick={(e) => addPoint(e.currentTarget, e, false)}
            className="w-full rounded border border-zinc-700 cursor-crosshair" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select value={easing} onChange={(e) => setEasing(e.target.value)}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
          {(easings.length ? easings : [easing]).map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
          Steps {steps}
          <input type="range" min={1} max={48} value={steps}
            onChange={(e) => setSteps(Number(e.target.value))} className="w-24 accent-cyan-500" />
        </label>
        <button type="button" onClick={runPreview}
          className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">Preview</button>
        <button type="button" onClick={commit} disabled={busy}
          className="flex items-center gap-1 px-3 py-1.5 text-xs bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg disabled:opacity-50">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Spline className="w-3.5 h-3.5" />}
          Insert as frames
        </button>
      </div>
      {msg && <p className="text-[11px] text-zinc-400">{msg}</p>}
      {preview.length > 0 && (
        <div className="bg-zinc-950/50 rounded-lg p-2">
          <p className="text-[10px] text-zinc-400 mb-1">{preview.length}-frame tween preview</p>
          <TweenPreviewCanvas frames={preview} width={W * 1.6} height={H * 1.6} animW={anim.width} animH={anim.height} />
        </div>
      )}
    </div>
  );
}

function TweenPreviewCanvas(
  { frames, width, height, animW, animH }:
  { frames: { path: number[][] }[]; width: number; height: number; animW: number; animH: number },
) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const c = cv.getContext('2d');
    if (!c) return;
    c.fillStyle = '#18181b';
    c.fillRect(0, 0, cv.width, cv.height);
    const sx = cv.width / animW;
    const sy = cv.height / animH;
    frames.forEach((f, i) => {
      const a = (i + 1) / frames.length;
      c.strokeStyle = `rgba(34,211,238,${0.15 + a * 0.7})`;
      c.lineWidth = 1.5;
      c.beginPath();
      f.path.forEach((p, j) => {
        const x = p[0] * sx;
        const y = p[1] * sy;
        if (j === 0) c.moveTo(x, y); else c.lineTo(x, y);
      });
      c.stroke();
    });
  }, [frames, animW, animH]);
  return <canvas ref={ref} width={Math.round(width)} height={Math.round(height)} className="w-full rounded" />;
}

/* ── Canvas presets + grid / guides ──────────────────────────────────── */
function CanvasPanel({ anim, onChange }: { anim: Anim; onChange: () => void }) {
  const [presets, setPresets] = useState<CanvasPreset[]>([]);
  const [fpsPresets, setFpsPresets] = useState<number[]>([]);
  const [guides, setGuides] = useState({
    grid: false, gridSize: 32, thirds: false, safeArea: false,
    symmetry: 'none' as 'none' | 'vertical' | 'horizontal' | 'both',
  });
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void lensRun('animation', 'canvas-presets', {}).then((r) => {
      if (r.data?.ok) {
        const res = r.data.result as { presets: CanvasPreset[]; fpsPresets: number[] };
        setPresets(res.presets);
        setFpsPresets(res.fpsPresets);
      }
    });
  }, []);

  const applyFps = async (fps: number) => {
    await lensRun('animation', 'anim-update-settings', { id: anim.id, fps });
    setMsg(`Project set to ${fps} fps.`);
    onChange();
  };

  const saveGuides = async (next: typeof guides) => {
    setGuides(next);
    const r = await lensRun('animation', 'set-canvas-guides', { animId: anim.id, ...next });
    if (r.data?.ok) {
      window.dispatchEvent(new CustomEvent('anim:guides', {
        detail: { animId: anim.id, guides: (r.data.result as { guides: typeof guides }).guides },
      }));
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-[11px] font-semibold text-zinc-400 mb-1">Canvas size presets</h4>
        <p className="text-[10px] text-zinc-400 mb-1.5">
          Current: {anim.width}×{anim.height} · {anim.fps} fps. Presets seed new projects from the gallery.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {presets.map((p) => (
            <div key={p.id}
              className={cn('text-[10px] rounded-lg px-2 py-1.5 border',
                p.width === anim.width && p.height === anim.height
                  ? 'border-cyan-600 bg-cyan-950/40 text-cyan-200'
                  : 'border-zinc-800 bg-zinc-950/50 text-zinc-400')}>
              <p className="font-medium">{p.label}</p>
              <p>{p.width}×{p.height} · {p.fps}fps</p>
            </div>
          ))}
        </div>
      </div>
      <div>
        <h4 className="text-[11px] font-semibold text-zinc-400 mb-1">Frame rate</h4>
        <div className="flex flex-wrap gap-1.5">
          {fpsPresets.map((f) => (
            <button key={f} type="button" onClick={() => applyFps(f)}
              className={cn('px-2.5 py-1 text-[11px] rounded-lg',
                f === anim.fps ? 'bg-cyan-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700')}>
              {f} fps
            </button>
          ))}
        </div>
      </div>
      <div>
        <h4 className="text-[11px] font-semibold text-zinc-400 mb-1">Onscreen guides</h4>
        <div className="space-y-1.5">
          <label className="flex items-center gap-2 text-[11px] text-zinc-300">
            <input type="checkbox" checked={guides.grid}
              onChange={(e) => saveGuides({ ...guides, grid: e.target.checked })} className="accent-cyan-500" />
            Grid
            {guides.grid && (
              <input type="number" min={4} max={400} value={guides.gridSize}
                onChange={(e) => saveGuides({ ...guides, gridSize: Math.max(4, Number(e.target.value) || 32) })}
                className="w-14 bg-zinc-950 border border-zinc-700 rounded px-1.5 py-0.5 text-[11px]" />
            )}
          </label>
          <label className="flex items-center gap-2 text-[11px] text-zinc-300">
            <input type="checkbox" checked={guides.thirds}
              onChange={(e) => saveGuides({ ...guides, thirds: e.target.checked })} className="accent-cyan-500" />
            Rule of thirds
          </label>
          <label className="flex items-center gap-2 text-[11px] text-zinc-300">
            <input type="checkbox" checked={guides.safeArea}
              onChange={(e) => saveGuides({ ...guides, safeArea: e.target.checked })} className="accent-cyan-500" />
            Title-safe area
          </label>
          <label className="flex items-center gap-2 text-[11px] text-zinc-300">
            Symmetry
            <select value={guides.symmetry}
              onChange={(e) => saveGuides({ ...guides, symmetry: e.target.value as typeof guides.symmetry })}
              className="bg-zinc-950 border border-zinc-700 rounded px-1.5 py-0.5 text-[11px]">
              <option value="none">none</option>
              <option value="vertical">vertical</option>
              <option value="horizontal">horizontal</option>
              <option value="both">both</option>
            </select>
          </label>
        </div>
      </div>
      {msg && <p className="text-[11px] text-zinc-400">{msg}</p>}
    </div>
  );
}

/* ── Rigging / bone armature ─────────────────────────────────────────── */
function RigPanel({ anim, onChange }: { anim: Anim; onChange: () => void }) {
  const [bones, setBones] = useState<RigBone[]>([]);
  const [segments, setSegments] = useState<RigSegment[]>([]);
  const [selFrame, setSelFrame] = useState(anim.frames[0]?.id || '');
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const previewRef = useRef<HTMLCanvasElement | null>(null);

  const W = 280;
  const H = Math.round((anim.height / anim.width) * W) || 160;

  const loadRig = useCallback(async () => {
    const r = await lensRun('animation', 'rig-get', { animId: anim.id });
    if (r.data?.ok) setBones((r.data.result as { bones: RigBone[] }).bones || []);
    if (selFrame) {
      const pr = await lensRun('animation', 'rig-resolve-pose', { animId: anim.id, frameId: selFrame });
      if (pr.data?.ok) setSegments((pr.data.result as { segments: RigSegment[] }).segments || []);
    }
  }, [anim.id, selFrame]);

  useEffect(() => { void loadRig(); }, [loadRig]);

  useEffect(() => {
    const cv = previewRef.current;
    if (!cv) return;
    const c = cv.getContext('2d');
    if (!c) return;
    c.fillStyle = '#18181b';
    c.fillRect(0, 0, cv.width, cv.height);
    const sx = cv.width / anim.width;
    const sy = cv.height / anim.height;
    for (const seg of segments) {
      c.strokeStyle = '#22d3ee';
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(seg.originX * sx, seg.originY * sy);
      c.lineTo(seg.tipX * sx, seg.tipY * sy);
      c.stroke();
      c.fillStyle = '#fb923c';
      c.beginPath();
      c.arc(seg.originX * sx, seg.originY * sy, 4, 0, Math.PI * 2);
      c.fill();
    }
  }, [segments, anim.width, anim.height]);

  const addBone = async () => {
    const r = await lensRun('animation', 'rig-bone-add', {
      animId: anim.id, name: name.trim(), parentId: parentId || undefined,
    });
    if (r.data?.ok) {
      setName('');
      await loadRig();
      onChange();
    }
  };

  const deleteBone = async (id: string) => {
    await lensRun('animation', 'rig-bone-delete', { animId: anim.id, boneId: id });
    await loadRig();
    onChange();
  };

  const setBoneAngle = async (bone: RigBone, angle: number) => {
    await lensRun('animation', 'rig-pose-set', {
      animId: anim.id, frameId: selFrame, boneId: bone.id, angle,
    });
    await loadRig();
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-400">
        Build a bone armature for cut-out animation. Pose bones per frame; forward kinematics resolves the skeleton.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Bone name"
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <select value={parentId} onChange={(e) => setParentId(e.target.value)}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
          <option value="">No parent (root)</option>
          {bones.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <button type="button" onClick={addBone}
          className="flex items-center gap-1 px-3 py-1.5 text-xs bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Bone
        </button>
        <select value={selFrame} onChange={(e) => setSelFrame(e.target.value)}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 ml-auto">
          {anim.frames.map((f, i) => <option key={f.id} value={f.id}>Pose frame {i + 1}</option>)}
        </select>
      </div>
      <canvas ref={previewRef} width={W} height={H}
        className="w-full rounded border border-zinc-700 bg-zinc-900" />
      {bones.length === 0 ? (
        <p className="text-[11px] text-zinc-400 italic">No bones yet. Add a root bone to start the armature.</p>
      ) : (
        <ul className="space-y-1.5">
          {bones.map((b) => (
            <li key={b.id} className="flex items-center gap-2 bg-zinc-950/50 rounded px-2 py-1.5">
              <Bone className="w-3 h-3 text-cyan-400 shrink-0" />
              <span className="text-[11px] text-zinc-200 w-24 truncate">{b.name}</span>
              <span className="text-[10px] text-zinc-400 w-16">
                {b.parentId ? 'child' : 'root'}
              </span>
              <input type="range" min={-180} max={180} defaultValue={b.angle}
                onChange={(e) => setBoneAngle(b, Number(e.target.value))}
                className="flex-1 accent-cyan-500" />
              <button aria-label="Delete" type="button" onClick={() => deleteBone(b.id)} className="text-zinc-600 hover:text-rose-400">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── Custom brush library + pressure dynamics ────────────────────────── */
function BrushPanel() {
  const [brushes, setBrushes] = useState<Brush[]>([]);
  const [form, setForm] = useState({
    name: '', tool: 'ink', size: 8, opacity: 1, color: '#222222',
    pressureSize: 0.6, pressureOpacity: 0.3, smoothing: 0.4, taper: 0.3,
  });

  const load = useCallback(async () => {
    const r = await lensRun('animation', 'brush-list', {});
    if (r.data?.ok) setBrushes((r.data.result as { brushes: Brush[] }).brushes || []);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!form.name.trim()) return;
    const r = await lensRun('animation', 'brush-save', { ...form, name: form.name.trim() });
    if (r.data?.ok) {
      setForm({ ...form, name: '' });
      await load();
    }
  };

  const del = async (id: string) => {
    await lensRun('animation', 'brush-delete', { id });
    await load();
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-400">
        Save brushes with pressure-sensitive size/opacity dynamics. Saved brushes appear in the studio brush bar.
      </p>
      <div className="bg-zinc-950/50 rounded-lg p-2.5 grid grid-cols-2 gap-2">
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Brush name"
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 col-span-2" />
        <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
          Tool
          <select value={form.tool} onChange={(e) => setForm({ ...form, tool: e.target.value })}
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-1.5 py-1 text-[11px] text-zinc-100">
            {['pencil', 'ink', 'marker', 'airbrush', 'eraser'].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
          Color
          <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })}
            className="w-8 h-7 bg-transparent cursor-pointer" />
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
          Size {form.size}
          <input type="range" min={1} max={120} value={form.size}
            onChange={(e) => setForm({ ...form, size: Number(e.target.value) })} className="flex-1 accent-cyan-500" />
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
          Opacity {Math.round(form.opacity * 100)}%
          <input type="range" min={0.05} max={1} step={0.05} value={form.opacity}
            onChange={(e) => setForm({ ...form, opacity: Number(e.target.value) })} className="flex-1 accent-cyan-500" />
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
          Pressure→Size {Math.round(form.pressureSize * 100)}%
          <input type="range" min={0} max={1} step={0.05} value={form.pressureSize}
            onChange={(e) => setForm({ ...form, pressureSize: Number(e.target.value) })} className="flex-1 accent-cyan-500" />
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
          Pressure→Opacity {Math.round(form.pressureOpacity * 100)}%
          <input type="range" min={0} max={1} step={0.05} value={form.pressureOpacity}
            onChange={(e) => setForm({ ...form, pressureOpacity: Number(e.target.value) })} className="flex-1 accent-cyan-500" />
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
          Smoothing {Math.round(form.smoothing * 100)}%
          <input type="range" min={0} max={1} step={0.05} value={form.smoothing}
            onChange={(e) => setForm({ ...form, smoothing: Number(e.target.value) })} className="flex-1 accent-cyan-500" />
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
          Taper {Math.round(form.taper * 100)}%
          <input type="range" min={0} max={1} step={0.05} value={form.taper}
            onChange={(e) => setForm({ ...form, taper: Number(e.target.value) })} className="flex-1 accent-cyan-500" />
        </label>
        <button type="button" onClick={save} disabled={!form.name.trim()}
          className="col-span-2 flex items-center justify-center gap-1 px-3 py-1.5 text-xs bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg disabled:opacity-50">
          <Plus className="w-3.5 h-3.5" /> Save brush
        </button>
      </div>
      {brushes.length === 0 ? (
        <p className="text-[11px] text-zinc-400 italic">No custom brushes saved yet.</p>
      ) : (
        <ul className="space-y-1">
          {brushes.map((b) => (
            <li key={b.id} className="flex items-center gap-2 bg-zinc-950/50 rounded px-2 py-1.5">
              <span className="w-4 h-4 rounded-full border border-zinc-600" style={{ background: b.color }} />
              <span className="text-[11px] text-zinc-200 flex-1 truncate">{b.name}</span>
              <span className="text-[10px] text-zinc-400">{b.tool} · {b.size}px</span>
              <span className="text-[10px] text-cyan-400">P{Math.round(b.pressureSize * 100)}</span>
              <button aria-label="Delete" type="button" onClick={() => del(b.id)} className="text-zinc-600 hover:text-rose-400">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── Shareable export link ───────────────────────────────────────────── */
function SharePanel({ anim }: { anim: Anim }) {
  const [share, setShare] = useState<{ token: string; url: string; views: number; allowDownload: boolean } | null>(null);
  const [allowDownload, setAllowDownload] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const fullUrl = share
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}${share.url}`
    : '';

  const create = async () => {
    setBusy(true);
    const r = await lensRun('animation', 'share-create', { animId: anim.id, allowDownload });
    setBusy(false);
    if (r.data?.ok) setShare(r.data.result?.share as NonNullable<typeof share>);
  };

  const revoke = async () => {
    if (!share) return;
    setBusy(true);
    await lensRun('animation', 'share-revoke', { token: share.token });
    setBusy(false);
    setShare(null);
  };

  const copy = async () => {
    if (!fullUrl) return;
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-400">
        Generate a shareable link to this animation. Anyone with the link can view it.
      </p>
      {!share ? (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-[11px] text-zinc-300">
            <input type="checkbox" checked={allowDownload}
              onChange={(e) => setAllowDownload(e.target.checked)} className="accent-cyan-500" />
            Allow viewers to download frames
          </label>
          <button type="button" onClick={create} disabled={busy}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg disabled:opacity-50">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
            Create share link
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 bg-zinc-950/50 rounded-lg px-2 py-1.5">
            <Share2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span className="text-[11px] text-zinc-300 flex-1 truncate font-mono">{fullUrl}</span>
            <button type="button" onClick={copy} className="text-zinc-400 hover:text-cyan-300">
              {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-zinc-400">
            <span>{share.views} view{share.views === 1 ? '' : 's'}</span>
            <span>{share.allowDownload ? 'download allowed' : 'view only'}</span>
            <button type="button" onClick={revoke} disabled={busy}
              className="ml-auto text-rose-400 hover:text-rose-300">Revoke link</button>
          </div>
        </div>
      )}
    </div>
  );
}
