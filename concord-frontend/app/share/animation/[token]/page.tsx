'use client';

/**
 * Public animation share viewer — /share/animation/[token]
 *
 * Wires the `animation.share-get` macro (already real: token generation,
 * copy-link, revoke were all built and working in `AnimToolsPanel`'s
 * SharePanel) to an actual consuming page. Before this page existed, the
 * "Create share link" button produced a real token and a real URL
 * (`/share/animation/{token}`) that pointed at nothing — no route in the
 * app rendered it, so every generated link 404'd. That's a real gap the
 * capability map documents: a working share generator with no way to ever
 * open the link.
 *
 * Genuinely public (2026-07, Wave 4 gap closure): this page now calls the
 * dedicated public REST route `GET /api/animation/share/:token`
 * (server.js) with a plain, unauthenticated `fetch` — no cookie, no
 * Authorization header, no dependency on `useAuth()`. The route invokes
 * the `animation.share-get` LENS_ACTIONS handler directly (bypassing the
 * authenticated `/api/lens/run` surface entirely, the same pattern already
 * used for the welding client portal), so a genuinely logged-out visitor
 * with the link can view the animation. The token itself is the only
 * access control — it's an unguessable id scoped server-side to exactly
 * one animation.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Loader2, Eye, Download, AlertTriangle } from 'lucide-react';

interface Stroke { tool: string; color: string; size: number; opacity: number; points: number[][] }
interface FLayer { visible: boolean; strokes: Stroke[] }
interface Frame { id: string; exposure: number; layers?: FLayer[]; strokes?: Stroke[] }
interface SharedAnimation {
  id: string; title: string; width: number; height: number; fps: number; background: string;
  thumbnail: string | null; frameCount: number; frames?: Frame[];
}

function drawFrame(c: CanvasRenderingContext2D, frame: Frame | undefined, background: string) {
  if (!frame) return;
  c.fillStyle = background;
  c.fillRect(0, 0, c.canvas.width, c.canvas.height);
  const strokes = Array.isArray(frame.layers) && frame.layers.length
    ? frame.layers.filter((l) => l.visible).flatMap((l) => l.strokes)
    : frame.strokes || [];
  for (const st of strokes) {
    const pts = st.points;
    if (!pts.length) continue;
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
}

export default function AnimationSharePage() {
  const params = useParams<{ token: string }>();
  const token = (params?.token as string) || '';
  const [share, setShare] = useState<{ token: string; title: string; views: number; allowDownload: boolean } | null>(null);
  const [anim, setAnim] = useState<SharedAnimation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [frameIdx, setFrameIdx] = useState(0);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/animation/share/${encodeURIComponent(token)}`);
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || 'This share link is invalid or has been revoked.');
        setShare(null);
        setAnim(null);
        return;
      }
      const result = data.result as { share: typeof share; animation: SharedAnimation };
      setShare(result.share);
      setAnim(result.animation);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!anim?.frames?.length) return;
    const cv = document.getElementById('share-anim-canvas') as HTMLCanvasElement | null;
    const c = cv?.getContext('2d');
    if (!c) return;
    drawFrame(c, anim.frames[frameIdx], anim.background);
  }, [anim, frameIdx]);

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-zinc-400">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (error || !anim) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-6">
        <div className="max-w-sm text-center space-y-3">
          <AlertTriangle className="w-8 h-8 text-rose-400 mx-auto" />
          <p className="text-sm text-zinc-300">{error || 'Animation not found.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center gap-4 px-6 py-10">
      <header className="text-center">
        <h1 className="text-lg font-semibold text-zinc-100">{anim.title}</h1>
        <p className="text-xs text-zinc-500 flex items-center justify-center gap-3 mt-1">
          <span className="flex items-center gap-1"><Eye className="w-3 h-3" /> {share?.views ?? 0} views</span>
          <span>{anim.width}×{anim.height} · {anim.fps} fps · {anim.frameCount} frames</span>
        </p>
      </header>
      <div className="bg-[repeating-conic-gradient(#3f3f46_0%_25%,#27272a_0%_50%)] bg-[length:16px_16px] rounded-xl p-2">
        {anim.frames?.length ? (
          <canvas id="share-anim-canvas" width={anim.width} height={anim.height}
            className="rounded shadow-lg" style={{ maxWidth: '80vw', maxHeight: '55vh' }} />
        ) : anim.thumbnail ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={anim.thumbnail} alt={anim.title} className="rounded shadow-lg" style={{ maxWidth: '80vw', maxHeight: '55vh' }} />
        ) : (
          <p className="text-xs text-zinc-500 p-8">The owner disabled frame downloads for this link — only the thumbnail is shareable.</p>
        )}
      </div>
      {anim.frames && anim.frames.length > 1 && (
        <div className="flex items-center gap-2">
          <input type="range" min={0} max={anim.frames.length - 1} value={frameIdx}
            onChange={(e) => setFrameIdx(Number(e.target.value))} className="w-64 accent-orange-500"
            aria-label="Scrub frames" />
          <span className="text-[11px] text-zinc-500 tabular-nums">{frameIdx + 1}/{anim.frames.length}</span>
        </div>
      )}
      {share?.allowDownload && anim.frames?.length ? (
        <p className="flex items-center gap-1.5 text-[11px] text-zinc-500"><Download className="w-3 h-3" /> Frame download enabled by the owner</p>
      ) : null}
    </div>
  );
}
