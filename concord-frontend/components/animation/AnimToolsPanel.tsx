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
  Spline, Bone, Brush, Share2,
  Loader2, Plus, Trash2, Link2, Copy, Check,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { uploadMedia } from './table/lt';


interface AudioTrack { id: string; name: string; url: string | null; mediaId?: string | null; src?: string | null; startSec: number }
interface FLayer { id: string; name: string }
interface Frame { id: string; layers?: FLayer[] }
interface Anim {
  id: string; title: string; width: number; height: number; fps: number;
  frames: Frame[]; audio?: AudioTrack[];
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



/* ── Audio waveform display + sync scrubbing ─────────────────────────── */
export function AudioSyncPanel({ anim, onChange }: { anim: Anim; onChange: () => void }) {
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
  const [err, setErr] = useState<string | null>(null);
  // The file itself is uploaded as your audio, so the soundtrack plays on the
  // table, on the share page and in the export. Its waveform is read here in
  // the browser and stored against the track for the X-sheet's sound column.
  const onFile = async (file: File) => {
    setBusy(true); setErr(null);
    try {
      const buf = await file.arrayBuffer();
      const AC = window.AudioContext
        || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      const actx = new AC();
      let decoded: AudioBuffer;
      try { decoded = await actx.decodeAudioData(buf.slice(0)); } catch { throw new Error(`“${file.name}” isn’t audio this browser can read.`); } finally { void actx.close(); }
      const data = decoded.getChannelData(0);
      const buckets = 600;
      const step = Math.max(1, Math.floor(data.length / buckets));
      const peaks: number[] = [];
      for (let i = 0; i < data.length; i += step) {
        let peak = 0;
        for (let j = i; j < i + step && j < data.length; j++) peak = Math.max(peak, Math.abs(data[j]));
        peaks.push(peak);
      }
      const name = file.name.replace(/\.[^.]+$/, '');
      const up = await uploadMedia(file, { title: name, filename: file.name, mediaType: 'audio', duration: decoded.duration, tags: ['animation-soundtrack'] });
      if (!up.ok) throw new Error(up.error);
      const add = await lensRun('animation', 'audio-track-add', { animId: anim.id, mediaId: up.mediaId, name, startSec: 0 });
      const track = add.data?.result?.track as AudioTrack | undefined;
      if (!add.data?.ok || !track) throw new Error(add.data?.error || 'The track could not be added.');
      await lensRun('animation', 'audio-waveform-set', { animId: anim.id, trackId: track.id, peaks, durationSec: decoded.duration });
      await loadSync();
      onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'The soundtrack could not be added.');
    }
    if (fileRef.current) fileRef.current.value = '';
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
          className="flex items-center gap-1 px-3 py-1.5 text-xs bg-[var(--lt-red,#0e7490)] hover:bg-[#b42c20] text-white rounded-lg disabled:opacity-50">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          Add a soundtrack
        </button>
        {sync && <span className="text-[11px] text-[var(--lt-muted,#a1a1aa)]">{sync.totalFrames} frames · {sync.durationSec}s</span>}
      </div>
      {err && <p className="lt-error" role="alert">{err}</p>}
      {!sync || sync.tracks.length === 0 ? (
        <p className="text-[11px] text-[var(--lt-muted,#a1a1aa)] italic">No soundtrack yet. Add an audio file: it plays as you scrub and play, shows in the X-sheet&rsquo;s sound column, and is mixed into video exports.</p>
      ) : (
        <ul className="space-y-2">
          {sync.tracks.map((t) => (
            <li key={t.id} className="bg-[var(--lt-paper-2,rgba(9,9,11,0.5))] rounded-lg p-2">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[11px] text-[var(--lt-graphite,#f4f4f5)] font-medium flex-1 truncate">{t.name}</span>
                <span className="text-[10px] text-[var(--lt-muted,#a1a1aa)]">
                  frame {t.startFrame}{t.endFrame != null ? `–${t.endFrame}` : ''}
                </span>
                <button aria-label="Delete" type="button" onClick={() => removeTrack(t.id)} className="text-[var(--lt-faint,#52525b)] hover:text-[var(--lt-bad,#fb7185)]">
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
    return <p className="text-[10px] text-[var(--lt-muted,#a1a1aa)] italic">Waveform unavailable.</p>;
  }
  return (
    <div className="flex items-end gap-px h-12 bg-[var(--lt-paper-2,#18181b)] rounded px-1 py-1 overflow-hidden">
      {peaks.map((p, i) => (
        <div key={i} className="flex-1 min-w-px bg-cyan-500/70 rounded-sm"
          style={{ height: `${Math.max(3, p * 100)}%` }} />
      ))}
    </div>
  );
}

/* ── Path / shape tweening between keyframes ─────────────────────────── */
export function TweenPanel({ anim, onChange }: { anim: Anim; onChange: () => void }) {
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
  const [curve, setCurve] = useState<{ t: number; value: number }[]>([]);

  // Real easing-curve macro sample, so the curve shape (not just the name)
  // informs which easing to pick before committing a tween.
  useEffect(() => {
    let active = true;
    void lensRun('animation', 'easing-curve', { type: easing, steps: 24 }).then((r) => {
      if (!active) return;
      if (r.data?.ok) setCurve((r.data.result as { samples: { t: number; value: number }[] }).samples || []);
    });
    return () => { active = false; };
  }, [easing]);

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
      <p className="text-[11px] text-[var(--lt-muted,#a1a1aa)]">
        Click points on each canvas to define a start and end shape. Point counts must match.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-[var(--lt-blue,#22d3ee)]">Start path · {fromPath.length} pts</span>
            <button type="button" onClick={() => setFromPath([])} className="text-[10px] text-[var(--lt-muted,#a1a1aa)] hover:text-[var(--lt-graphite,#d4d4d8)]">clear</button>
          </div>
          <canvas ref={fromRef} width={W} height={H} onClick={(e) => addPoint(e.currentTarget, e, true)}
            className="w-full rounded border border-[var(--lt-line,#3f3f46)] cursor-crosshair" />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-orange-400">End path · {toPath.length} pts</span>
            <button type="button" onClick={() => setToPath([])} className="text-[10px] text-[var(--lt-muted,#a1a1aa)] hover:text-[var(--lt-graphite,#d4d4d8)]">clear</button>
          </div>
          <canvas ref={toRef} width={W} height={H} onClick={(e) => addPoint(e.currentTarget, e, false)}
            className="w-full rounded border border-[var(--lt-line,#3f3f46)] cursor-crosshair" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Easing" onChange={(e) => setEasing(e.target.value)}
          className="bg-[var(--lt-input,#09090b)] border border-[var(--lt-line,#3f3f46)] rounded-lg px-2 py-1.5 text-xs text-[var(--lt-graphite,#f4f4f5)]">
          {(easings.length ? easings : [easing]).map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        {curve.length > 0 && (
          <svg viewBox="0 0 100 32" className="w-20 h-8 shrink-0" aria-label={`${easing} curve preview`}>
            <polyline
              fill="none" stroke="#22d3ee" strokeWidth="2"
              points={curve.map((s) => `${s.t * 100},${32 - s.value * 32}`).join(' ')}
            />
          </svg>
        )}
        <label className="flex items-center gap-1.5 text-[11px] text-[var(--lt-muted,#a1a1aa)]">
          Steps {steps}
          <input type="range" min={1} max={48} value={steps}
            onChange={(e) => setSteps(Number(e.target.value))} className="w-24 accent-[#d2382a]" />
        </label>
        <button type="button" onClick={runPreview}
          className="px-3 py-1.5 text-xs bg-[var(--lt-chip,#27272a)] hover:bg-[var(--lt-hover,#3f3f46)] text-[var(--lt-graphite,#f4f4f5)] rounded-lg">Preview</button>
        <button type="button" onClick={commit} disabled={busy}
          className="flex items-center gap-1 px-3 py-1.5 text-xs bg-[var(--lt-red,#0e7490)] hover:bg-[#b42c20] text-white rounded-lg disabled:opacity-50">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Spline className="w-3.5 h-3.5" />}
          Insert as frames
        </button>
      </div>
      {msg && <p className="text-[11px] text-[var(--lt-muted,#a1a1aa)]">{msg}</p>}
      {preview.length > 0 && (
        <div className="bg-[var(--lt-paper-2,rgba(9,9,11,0.5))] rounded-lg p-2">
          <p className="text-[10px] text-[var(--lt-muted,#a1a1aa)] mb-1">{preview.length}-frame tween preview</p>
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
export function CanvasPanel({ anim, onChange }: { anim: Anim; onChange: () => void }) {
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
        <h3 className="text-[11px] font-semibold text-[var(--lt-muted,#a1a1aa)] mb-1">Canvas size presets</h3>
        <p className="text-[10px] text-[var(--lt-muted,#a1a1aa)] mb-1.5">
          Current: {anim.width}×{anim.height} · {anim.fps} fps. Presets seed new projects from the gallery.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {presets.map((p) => (
            <div key={p.id}
              className={cn('text-[10px] rounded-lg px-2 py-1.5 border',
                p.width === anim.width && p.height === anim.height
                  ? 'border-[var(--lt-blue,#0891b2)] bg-cyan-950/40 text-[var(--lt-blue,#22d3ee)]'
                  : 'border-[var(--lt-line-2,#27272a)] bg-[var(--lt-paper-2,rgba(9,9,11,0.5))] text-[var(--lt-muted,#a1a1aa)]')}>
              <p className="font-medium">{p.label}</p>
              <p>{p.width}×{p.height} · {p.fps}fps</p>
            </div>
          ))}
        </div>
      </div>
      <div>
        <h3 className="text-[11px] font-semibold text-[var(--lt-muted,#a1a1aa)] mb-1">Frame rate</h3>
        <div className="flex flex-wrap gap-1.5">
          {fpsPresets.map((f) => (
            <button key={f} type="button" onClick={() => applyFps(f)}
              className={cn('px-2.5 py-1 text-[11px] rounded-lg',
                f === anim.fps ? 'bg-[var(--lt-red,#0e7490)] text-white' : 'bg-[var(--lt-chip,#27272a)] text-[var(--lt-graphite-2,#d4d4d8)] hover:bg-[var(--lt-hover,#3f3f46)]')}>
              {f} fps
            </button>
          ))}
        </div>
      </div>
      <div>
        <h3 className="text-[11px] font-semibold text-[var(--lt-muted,#a1a1aa)] mb-1">Onscreen guides</h3>
        <div className="space-y-1.5">
          <label className="flex items-center gap-2 text-[11px] text-[var(--lt-graphite-2,#d4d4d8)]">
            <input type="checkbox" checked={guides.grid}
              onChange={(e) => saveGuides({ ...guides, grid: e.target.checked })} className="accent-[#d2382a]" />
            Grid
            {guides.grid && (
              <input type="number" min={4} max={400} value={guides.gridSize}
                onChange={(e) => saveGuides({ ...guides, gridSize: Math.max(4, Number(e.target.value) || 32) })}
                className="w-14 bg-[var(--lt-input,#09090b)] border border-[var(--lt-line,#3f3f46)] rounded px-1.5 py-0.5 text-[11px]" />
            )}
          </label>
          <label className="flex items-center gap-2 text-[11px] text-[var(--lt-graphite-2,#d4d4d8)]">
            <input type="checkbox" checked={guides.thirds}
              onChange={(e) => saveGuides({ ...guides, thirds: e.target.checked })} className="accent-[#d2382a]" />
            Rule of thirds
          </label>
          <label className="flex items-center gap-2 text-[11px] text-[var(--lt-graphite-2,#d4d4d8)]">
            <input type="checkbox" checked={guides.safeArea}
              onChange={(e) => saveGuides({ ...guides, safeArea: e.target.checked })} className="accent-[#d2382a]" />
            Title-safe area
          </label>
          <label className="flex items-center gap-2 text-[11px] text-[var(--lt-graphite-2,#d4d4d8)]">
            Symmetry
            <select value={guides.symmetry}
              onChange={(e) => saveGuides({ ...guides, symmetry: e.target.value as typeof guides.symmetry })}
              className="bg-[var(--lt-input,#09090b)] border border-[var(--lt-line,#3f3f46)] rounded px-1.5 py-0.5 text-[11px]">
              <option value="none">none</option>
              <option value="vertical">vertical</option>
              <option value="horizontal">horizontal</option>
              <option value="both">both</option>
            </select>
          </label>
        </div>
      </div>
      {msg && <p className="text-[11px] text-[var(--lt-muted,#a1a1aa)]">{msg}</p>}
    </div>
  );
}

/* ── Rigging / bone armature ─────────────────────────────────────────── */
export function RigPanel({ anim, onChange }: { anim: Anim; onChange: () => void }) {
  const [bones, setBones] = useState<RigBone[]>([]);
  const [segments, setSegments] = useState<RigSegment[]>([]);
  const [selFrame, setSelFrame] = useState(anim.frames[0]?.id || '');
  const [name, setName] = useState('');
  const [boneError, setBoneError] = useState<string | null>(null);
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
    // FIX-animation-002: a blank name silently became 'Bone N' on the
    // server and a refusal showed nothing at all. The name is required
    // and the panel now says so; refusals surface in the same line.
    if (!name.trim()) { setBoneError('Give the bone a name.'); return; }
    const r = await lensRun('animation', 'rig-bone-add', {
      animId: anim.id, name: name.trim(), parentId: parentId || undefined,
    });
    if (r.data?.ok) {
      setName('');
      setBoneError(null);
      await loadRig();
      onChange();
    } else {
      setBoneError(r.data?.error || 'Could not add the bone.');
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

  const updateBone = async (bone: RigBone, patch: { name?: string; length?: number }) => {
    setBones((prev) => prev.map((b) => (b.id === bone.id ? { ...b, ...patch } : b)));
    await lensRun('animation', 'rig-bone-update', { animId: anim.id, boneId: bone.id, ...patch });
    await loadRig();
    onChange();
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-[var(--lt-muted,#a1a1aa)]">
        Build a bone armature for cut-out animation. Pose bones per frame; forward kinematics resolves the skeleton.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Bone name"
          className="bg-[var(--lt-input,#09090b)] border border-[var(--lt-line,#3f3f46)] rounded-lg px-2 py-1.5 text-xs text-[var(--lt-graphite,#f4f4f5)]" />
        <select aria-label="Parent bone" onChange={(e) => setParentId(e.target.value)}
          className="bg-[var(--lt-input,#09090b)] border border-[var(--lt-line,#3f3f46)] rounded-lg px-2 py-1.5 text-xs text-[var(--lt-graphite,#f4f4f5)]">
          <option value="">No parent (root)</option>
          {bones.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <button type="button" onClick={addBone}
          className="flex items-center gap-1 px-3 py-1.5 text-xs bg-[var(--lt-red,#0e7490)] hover:bg-[#b42c20] text-white rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Bone
        </button>
        <select aria-label="Pose frame" onChange={(e) => setSelFrame(e.target.value)}
          className="bg-[var(--lt-input,#09090b)] border border-[var(--lt-line,#3f3f46)] rounded-lg px-2 py-1.5 text-xs text-[var(--lt-graphite,#f4f4f5)] ml-auto">
          {anim.frames.map((f, i) => <option key={f.id} value={f.id}>Pose frame {i + 1}</option>)}
        </select>
      </div>
      <canvas ref={previewRef} width={W} height={H}
        className="w-full rounded border border-[var(--lt-line,#3f3f46)] bg-[var(--lt-paper-2,#18181b)]" />
      {boneError && (
        <p role="alert" className="text-[11px] text-[var(--lt-bad,#fb7185)]">{boneError}</p>
      )}
      {bones.length === 0 ? (
        <p className="text-[11px] text-[var(--lt-muted,#a1a1aa)] italic">No bones yet. Add a root bone to start the armature.</p>
      ) : (
        <ul className="space-y-1.5">
          {bones.map((b) => (
            <li key={b.id} className="flex items-center gap-2 bg-[var(--lt-paper-2,rgba(9,9,11,0.5))] rounded px-2 py-1.5">
              <Bone className="w-3 h-3 text-[var(--lt-blue,#22d3ee)] shrink-0" />
              <input value={b.name} aria-label="Bone name"
                onChange={(e) => setBones((prev) => prev.map((x) => (x.id === b.id ? { ...x, name: e.target.value } : x)))}
                onBlur={(e) => { if (e.target.value.trim() && e.target.value !== b.name) void updateBone(b, { name: e.target.value.trim() }); }}
                className="w-20 bg-transparent border-b border-transparent hover:border-[var(--lt-line,#3f3f46)] focus:border-[var(--lt-blue,#0891b2)] text-[11px] text-[var(--lt-graphite,#f4f4f5)] truncate outline-none" />
              <span className="text-[10px] text-[var(--lt-muted,#a1a1aa)] w-12 shrink-0">
                {b.parentId ? 'child' : 'root'}
              </span>
              <label className="flex items-center gap-1 text-[10px] text-[var(--lt-muted,#a1a1aa)] shrink-0">
                len
                <input type="number" min={4} max={2000} defaultValue={b.length} aria-label="Bone length"
                  onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v !== b.length) void updateBone(b, { length: v }); }}
                  className="w-12 bg-[var(--lt-input,#09090b)] border border-[var(--lt-line,#3f3f46)] rounded px-1 py-0.5 text-[10px] text-[var(--lt-graphite,#f4f4f5)]" />
              </label>
              <input type="range" min={-180} max={180} defaultValue={b.angle}
                onChange={(e) => setBoneAngle(b, Number(e.target.value))}
                className="flex-1 accent-[#d2382a]" />
              <button aria-label="Delete" type="button" onClick={() => deleteBone(b.id)} className="text-[var(--lt-faint,#52525b)] hover:text-[var(--lt-bad,#fb7185)]">
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
export function BrushPanel() {
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
      <p className="text-[11px] text-[var(--lt-muted,#a1a1aa)]">
        Save brushes with pressure-sensitive size/opacity dynamics. Saved brushes appear in the studio brush bar.
      </p>
      <div className="bg-[var(--lt-paper-2,rgba(9,9,11,0.5))] rounded-lg p-2.5 grid grid-cols-2 gap-2">
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Brush name"
          className="bg-[var(--lt-input,#09090b)] border border-[var(--lt-line,#3f3f46)] rounded-lg px-2 py-1.5 text-xs text-[var(--lt-graphite,#f4f4f5)] col-span-2" />
        <label className="flex items-center gap-1.5 text-[11px] text-[var(--lt-muted,#a1a1aa)]">
          Tool
          <select value={form.tool} onChange={(e) => setForm({ ...form, tool: e.target.value })}
            className="flex-1 bg-[var(--lt-input,#09090b)] border border-[var(--lt-line,#3f3f46)] rounded px-1.5 py-1 text-[11px] text-[var(--lt-graphite,#f4f4f5)]">
            {['pencil', 'ink', 'marker', 'airbrush', 'eraser'].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-[var(--lt-muted,#a1a1aa)]">
          Color
          <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })}
            className="w-8 h-7 bg-transparent cursor-pointer" />
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-[var(--lt-muted,#a1a1aa)]">
          Size {form.size}
          <input type="range" min={1} max={120} value={form.size}
            onChange={(e) => setForm({ ...form, size: Number(e.target.value) })} className="flex-1 accent-[#d2382a]" />
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-[var(--lt-muted,#a1a1aa)]">
          Opacity {Math.round(form.opacity * 100)}%
          <input type="range" min={0.05} max={1} step={0.05} value={form.opacity}
            onChange={(e) => setForm({ ...form, opacity: Number(e.target.value) })} className="flex-1 accent-[#d2382a]" />
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-[var(--lt-muted,#a1a1aa)]">
          Pressure→Size {Math.round(form.pressureSize * 100)}%
          <input type="range" min={0} max={1} step={0.05} value={form.pressureSize}
            onChange={(e) => setForm({ ...form, pressureSize: Number(e.target.value) })} className="flex-1 accent-[#d2382a]" />
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-[var(--lt-muted,#a1a1aa)]">
          Pressure→Opacity {Math.round(form.pressureOpacity * 100)}%
          <input type="range" min={0} max={1} step={0.05} value={form.pressureOpacity}
            onChange={(e) => setForm({ ...form, pressureOpacity: Number(e.target.value) })} className="flex-1 accent-[#d2382a]" />
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-[var(--lt-muted,#a1a1aa)]">
          Smoothing {Math.round(form.smoothing * 100)}%
          <input type="range" min={0} max={1} step={0.05} value={form.smoothing}
            onChange={(e) => setForm({ ...form, smoothing: Number(e.target.value) })} className="flex-1 accent-[#d2382a]" />
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-[var(--lt-muted,#a1a1aa)]">
          Taper {Math.round(form.taper * 100)}%
          <input type="range" min={0} max={1} step={0.05} value={form.taper}
            onChange={(e) => setForm({ ...form, taper: Number(e.target.value) })} className="flex-1 accent-[#d2382a]" />
        </label>
        <button type="button" onClick={save} disabled={!form.name.trim()}
          className="col-span-2 flex items-center justify-center gap-1 px-3 py-1.5 text-xs bg-[var(--lt-red,#0e7490)] hover:bg-[#b42c20] text-white rounded-lg disabled:opacity-50">
          <Plus className="w-3.5 h-3.5" /> Save brush
        </button>
      </div>
      {brushes.length === 0 ? (
        <p className="text-[11px] text-[var(--lt-muted,#a1a1aa)] italic">No custom brushes saved yet.</p>
      ) : (
        <ul className="space-y-1">
          {brushes.map((b) => (
            <li key={b.id} className="flex items-center gap-2 bg-[var(--lt-paper-2,rgba(9,9,11,0.5))] rounded px-2 py-1.5">
              <span className="w-4 h-4 rounded-full border border-[var(--lt-line,#3f3f46)]" style={{ background: b.color }} />
              <span className="text-[11px] text-[var(--lt-graphite,#f4f4f5)] flex-1 truncate">{b.name}</span>
              <span className="text-[10px] text-[var(--lt-muted,#a1a1aa)]">{b.tool} · {b.size}px</span>
              <span className="text-[10px] text-[var(--lt-blue,#22d3ee)]">P{Math.round(b.pressureSize * 100)}</span>
              <button aria-label="Delete" type="button" onClick={() => del(b.id)} className="text-[var(--lt-faint,#52525b)] hover:text-[var(--lt-bad,#fb7185)]">
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
export function SharePanel({ anim }: { anim: Anim }) {
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
      <p className="text-[11px] text-[var(--lt-muted,#a1a1aa)]">
        Make a link anyone can open, signed in or not. It plays the animation with its soundtrack;
        revoke it and both stop working.
      </p>
      {!share ? (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-[11px] text-[var(--lt-graphite-2,#d4d4d8)]">
            <input type="checkbox" checked={allowDownload}
              onChange={(e) => setAllowDownload(e.target.checked)} className="accent-[#d2382a]" />
            Let viewers download it (GIF or video)
          </label>
          <button type="button" onClick={create} disabled={busy}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-[var(--lt-red,#0e7490)] hover:bg-[#b42c20] text-white rounded-lg disabled:opacity-50">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
            Create share link
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 bg-[var(--lt-paper-2,rgba(9,9,11,0.5))] rounded-lg px-2 py-1.5">
            <Share2 className="w-3.5 h-3.5 text-[var(--lt-blue,#22d3ee)] shrink-0" />
            <span className="text-[11px] text-[var(--lt-graphite-2,#d4d4d8)] flex-1 truncate font-mono">{fullUrl}</span>
            <button aria-label="Copy share link" type="button" onClick={copy} className="inline-flex min-h-11 min-w-11 items-center justify-center text-[var(--lt-muted,#a1a1aa)] hover:text-[var(--lt-blue,#22d3ee)]">
              {copied ? <Check className="w-3.5 h-3.5 text-[var(--lt-good,#4ade80)]" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-[var(--lt-muted,#a1a1aa)]">
            <span>{share.views} view{share.views === 1 ? '' : 's'}</span>
            <span>{share.allowDownload ? 'download allowed' : 'view only'}</span>
            <button type="button" onClick={revoke} disabled={busy}
              className="ml-auto text-[var(--lt-bad,#fb7185)] hover:text-[var(--lt-bad,#fb7185)]">Revoke link</button>
          </div>
        </div>
      )}
    </div>
  );
}
