'use client';

/**
 * Export, as files that are what they say they are: WebM or MP4 with the
 * soundtrack mixed in, an animated GIF, or a ZIP of PNG frames. Each format
 * is checked against this browser's real encoders first; one it can't make
 * is shown as unavailable with the reason. Progress is the real count of
 * frames encoded. A finished video can be published from here.
 */

import { useEffect, useRef, useState } from 'react';
import { Download, Film, Upload } from 'lucide-react';
import { exportAnimation, exportCapabilities, type ExportFormat, type ExportResult, type Progress } from './encode';
import { an, secs, uploadMedia } from './lt';
import type { Anim } from './draw';

const FORMATS: { id: ExportFormat; label: string; note: string }[] = [
  { id: 'webm', label: 'WebM video', note: 'VP9 + Opus' },
  { id: 'mp4', label: 'MP4 video', note: 'H.264' },
  { id: 'gif', label: 'Animated GIF', note: 'no sound' },
  { id: 'png-zip', label: 'PNG frames', note: 'ZIP, one per frame' },
];
const fmtBytes = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function ExportDesk({ anim, onPublish }: { anim: Anim; onPublish?: (mediaId: string, durationSec: number) => void }) {
  const [caps, setCaps] = useState<Record<string, { video?: boolean; audio?: boolean } | boolean> | null>(null);
  const [format, setFormat] = useState<ExportFormat>('webm');
  const [scale, setScale] = useState(1);
  const [withSound, setWithSound] = useState(true);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<(ExportResult & { url: string; name: string }) | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    void exportCapabilities(anim.width * scale, anim.height * scale, anim.fps).then((c) => { if (live) setCaps(c as never); });
    return () => { live = false; };
  }, [anim.width, anim.height, anim.fps, scale]);
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const available = (f: ExportFormat): boolean => {
    if (!caps) return f === 'gif' || f === 'png-zip';
    const c = caps[f];
    return typeof c === 'boolean' ? c : !!c?.video;
  };
  const hasSound = (anim.audio || []).some((t) => t.src || t.url);
  const soundOk = format === 'webm' || format === 'mp4' ? !!(caps?.[format] as { audio?: boolean } | undefined)?.audio : false;

  const run = async () => {
    setErr(null); setResult(null);
    if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
    setProgress({ stage: 'frames', done: 0, total: 1 });
    try {
      const r = await exportAnimation(anim, format, { scale, withSound: withSound && hasSound, onProgress: setProgress });
      const url = URL.createObjectURL(r.blob);
      urlRef.current = url;
      const name = `${(anim.title || 'animation').replace(/[^\w-]+/g, '_')}.${r.ext}`;
      setResult({ ...r, url, name });
      // The record is what was actually made: its real size, frames and length.
      void an('export-record', { animId: anim.id, format: format === 'png-zip' ? 'png-sequence' : format, width: r.width, height: r.height, frameCount: r.filmFrames, durationSec: r.durationSec, fileSizeBytes: r.blob.size });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'The export failed.');
    }
    setProgress(null);
  };

  const publish = async () => {
    if (!result || !onPublish) return;
    setUploading(true); setErr(null);
    const up = await uploadMedia(result.blob, { title: anim.title, filename: result.name, mediaType: 'video', duration: result.durationSec, tags: ['animation'] });
    setUploading(false);
    if (!up.ok) { setErr(up.error); return; }
    onPublish(up.mediaId, result.durationSec);
  };

  return (
    <div className="space-y-3" data-testid="lt-export">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Export format">
        {FORMATS.map((f) => {
          const ok = available(f.id);
          return (
            <button key={f.id} type="button" className="lt-chip" aria-pressed={format === f.id} disabled={!ok} onClick={() => setFormat(f.id)} title={ok ? f.note : 'This browser can’t encode this format'} data-testid={`lt-format-${f.id}`}>
              {f.label}<span className="text-[10.5px] font-normal opacity-70">{ok ? f.note : 'unavailable here'}</span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[13px]">
        <label className="flex items-center gap-2">Size
          <select className="lt-input !w-auto !min-h-[32px] !py-0.5" value={scale} onChange={(e) => setScale(Number(e.target.value))} aria-label="Export size">
            {[0.5, 1, 1.5, 2].map((s) => <option key={s} value={s}>{Math.round(anim.width * s)}×{Math.round(anim.height * s)}</option>)}
          </select>
        </label>
        {(format === 'webm' || format === 'mp4') && (
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={withSound && hasSound && soundOk} disabled={!hasSound || !soundOk} onChange={(e) => setWithSound(e.target.checked)} />
            {hasSound ? (soundOk ? 'Mix in the soundtrack' : 'This browser can’t encode audio here') : 'No soundtrack to mix'}
          </label>
        )}
        <button type="button" className="lt-btn lt-btn-red ml-auto" onClick={() => { void run(); }} disabled={!!progress || !available(format)} data-testid="lt-export-run">
          <Film className="h-4 w-4" /> {progress ? 'Exporting…' : 'Export'}
        </button>
      </div>
      {progress && (
        <div role="status" aria-live="polite" className="space-y-1">
          <div className="h-1.5 overflow-hidden rounded bg-[var(--lt-paper-2)]"><div className="h-full bg-[var(--lt-blue)]" style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} /></div>
          <p className="lt-mono text-[11.5px] text-[var(--lt-muted)]">{progress.stage === 'sound' ? 'Mixing the soundtrack…' : progress.stage === 'finishing' ? 'Finishing the file…' : `Frame ${progress.done + 1} of ${progress.total}`}</p>
        </div>
      )}
      {err && <p className="lt-error" role="alert">{err}</p>}
      {result && (
        <div className="lt-rise grid gap-3 sm:grid-cols-[minmax(0,240px)_1fr]" data-testid="lt-export-result">
          <div className="overflow-hidden rounded bg-black">
            {result.mime.startsWith('video/') ? <video src={result.url} controls playsInline className="w-full" />
              // eslint-disable-next-line @next/next/no-img-element
              : result.mime === 'image/gif' ? <img src={result.url} alt={`${anim.title}, animated`} className="w-full" />
                : <p className="p-4 text-[12px] text-[#ccc]">{result.filmFrames} PNG frames in a ZIP.</p>}
          </div>
          <div className="space-y-1.5 text-[13px]">
            <p className="font-semibold">{result.name}</p>
            <p className="lt-mono text-[12px] text-[var(--lt-muted)]">{fmtBytes(result.blob.size)} · {result.width}×{result.height} · {result.filmFrames} frames · {secs(result.durationSec)} · {result.codec}{result.withSound ? ' · with sound' : ''}</p>
            <div className="flex flex-wrap gap-2 pt-1">
              <a className="lt-btn" href={result.url} download={result.name} data-testid="lt-export-download"><Download className="h-4 w-4" /> Download</a>
              {onPublish && result.mime.startsWith('video/') && (
                <button type="button" className="lt-btn lt-btn-red" onClick={() => { void publish(); }} disabled={uploading} data-testid="lt-export-publish"><Upload className="h-4 w-4" /> {uploading ? 'Uploading…' : 'Publish this render'}</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
