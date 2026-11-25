'use client';

/**
 * Public animation share page — /share/animation/[token]
 *
 * Anyone with the link watches the animation: it plays on the clock at its
 * own frame rate with each drawing held for its exposure, and with its
 * soundtrack (streamed through this link's token, so a private soundtrack
 * plays here and nowhere else). The page calls the public REST route
 * `GET /api/animation/share/:token` with a plain unauthenticated fetch; the
 * token is the only access control. When the animator allowed downloads,
 * the page can render a real GIF or video file in the browser.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { AlertTriangle, Download, Eye, Pause, Play } from 'lucide-react';
import { drawFrame, filmSequence, type Anim, type AudioTrack } from '@/components/animation/table/draw';
import { exportAnimation, type ExportFormat } from '@/components/animation/table/encode';
import { tableFontVars } from '@/components/animation/table/tableFonts';
import '@/components/animation/table/table.css';

interface SharedAnimation extends Omit<Anim, 'frames' | 'audio'> { frameCount: number; frames?: Anim['frames']; audio?: AudioTrack[] }
interface ShareMeta { token: string; title: string; views: number; allowDownload: boolean }

export default function AnimationSharePage() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token || '');
  const [anim, setAnim] = useState<SharedAnimation | null>(null);
  const [share, setShare] = useState<ShareMeta | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pos, setPos] = useState(0); // film frame, 0-based
  const [playing, setPlaying] = useState(false);
  const [dl, setDl] = useState<{ busy: boolean; msg: string | null }>({ busy: false, msg: null });
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch(`/api/animation/share/${encodeURIComponent(token)}`);
        const body = await res.json().catch(() => null);
        if (!live) return;
        if (!res.ok || !body?.ok) { setErr(body?.error || 'This share link could not be opened.'); return; }
        setAnim(body.result.animation); setShare(body.result.share);
      } catch { if (live) setErr('This share link could not be opened.'); }
    })();
    return () => { live = false; };
  }, [token]);

  const seq = anim?.frames ? filmSequence(anim.frames) : [];
  const draw = useCallback((p: number) => {
    const c = canvas.current?.getContext('2d');
    if (!c || !anim?.frames?.length) return;
    drawFrame(c, anim.frames[seq[Math.min(p, seq.length - 1)] ?? 0], anim.background);
  }, [anim, seq]);
  useEffect(() => { if (!playing) draw(pos); }, [draw, pos, playing]);

  // Playback on the clock, with the soundtrack from each track's start time.
  useEffect(() => {
    if (!playing || !anim?.frames?.length || !seq.length) return;
    const fps = Math.max(1, anim.fps || 12);
    const startAt = pos >= seq.length - 1 ? 0 : pos;
    const t0 = performance.now() - (startAt / fps) * 1000;
    const timers: number[] = [];
    const players = (anim.audio || []).map((t) => ({ a: new Audio(t.src || ''), start: t.startSec || 0 }));
    for (const { a, start } of players) {
      const at = startAt / fps - start;
      if (at >= 0) { a.currentTime = at; void a.play().catch(() => {}); }
      else timers.push(window.setTimeout(() => { void a.play().catch(() => {}); }, -at * 1000));
    }
    const id = window.setInterval(() => {
      const p = Math.floor(((performance.now() - t0) / 1000) * fps);
      if (p >= seq.length) { setPos(seq.length - 1); setPlaying(false); return; }
      draw(p); setPos(p);
    }, Math.max(8, 500 / fps));
    return () => { window.clearInterval(id); timers.forEach((x) => window.clearTimeout(x)); players.forEach(({ a }) => { a.pause(); a.src = ''; }); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  const download = async (format: ExportFormat) => {
    if (!anim?.frames) return;
    setDl({ busy: true, msg: null });
    try {
      const r = await exportAnimation({ ...anim, frames: anim.frames, audio: anim.audio || [] } as Anim, format, {});
      const url = URL.createObjectURL(r.blob);
      const a = document.createElement('a'); a.href = url; a.download = `${anim.title.replace(/[^\w-]+/g, '_') || 'animation'}.${r.ext}`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setDl({ busy: false, msg: null });
    } catch (e) { setDl({ busy: false, msg: e instanceof Error ? e.message : 'The download could not be made.' }); }
  };

  return (
    <main className={`lt ${tableFontVars} min-h-screen px-4 py-8 sm:px-8`}>
      <div className="mx-auto max-w-4xl space-y-4">
        {err ? (
          <div className="lt-sheet flex items-start gap-3 p-5" role="alert"><AlertTriangle className="h-5 w-5 text-[var(--lt-red)]" /><p className="text-[14px]">{err}</p></div>
        ) : !anim || !share ? (
          <div className="lt-skeleton h-80" role="status" aria-label="Opening the animation" />
        ) : (
          <>
            <header className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h1 className="lt-title text-[2rem] leading-tight text-[#fbfaf6]">{anim.title}</h1>
                <p className="lt-mono text-[12px] text-[#c9c2b5]">{anim.width}×{anim.height} · {anim.fps} fps · {anim.frameCount} drawings{seq.length ? ` · ${(seq.length / Math.max(1, anim.fps)).toFixed(1)} s` : ''}{(anim.audio || []).length ? ' · with sound' : ''}</p>
              </div>
              <span className="flex items-center gap-1 text-[12px] text-[#c9c2b5]"><Eye className="h-3.5 w-3.5" /> {share.views} views</span>
            </header>
            {anim.frames?.length ? (
              <div className="lt-stage">
                <div className="lt-paperframe w-full">
                  <canvas ref={canvas} width={anim.width} height={anim.height} className="block h-auto w-full" aria-label={`${anim.title}, drawing ${(seq[pos] ?? 0) + 1}`} data-testid="share-canvas" />
                </div>
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              anim.thumbnail ? <img src={anim.thumbnail} alt={anim.title} className="w-full rounded" /> : null
            )}
            {seq.length > 0 && (
              <div className="flex items-center gap-3">
                <button type="button" className="lt-btn lt-btn-red" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause' : 'Play'} data-testid="share-play">{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}{playing ? 'Pause' : 'Play'}</button>
                <input type="range" min={0} max={Math.max(0, seq.length - 1)} value={pos} onChange={(e) => { setPlaying(false); setPos(Number(e.target.value)); }} className="flex-1 accent-[#d2382a]" aria-label="Frame" />
                <span className="lt-mono w-14 text-right text-[12px] text-[#c9c2b5]">{pos + 1}/{seq.length}</span>
              </div>
            )}
            {share.allowDownload ? (
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="lt-btn lt-desk-btn" onClick={() => { void download('gif'); }} disabled={dl.busy}><Download className="h-4 w-4" /> GIF</button>
                <button type="button" className="lt-btn lt-desk-btn" onClick={() => { void download('webm'); }} disabled={dl.busy}><Download className="h-4 w-4" /> Video</button>
                {dl.busy && <span className="text-[12px] text-[#c9c2b5]" role="status">Making the file…</span>}
                {dl.msg && <span className="lt-error" role="alert">{dl.msg}</span>}
              </div>
            ) : <p className="text-[12.5px] text-[#c9c2b5]">The animator turned off downloads for this link: you can watch it here.</p>}
          </>
        )}
      </div>
    </main>
  );
}
