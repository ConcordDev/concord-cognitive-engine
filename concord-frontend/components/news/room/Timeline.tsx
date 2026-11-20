'use client';

/**
 * The window, hour by hour. Each bar is the stories that arrived in that hour
 * (taller rose part: the ones the map could place). Drag across the bars to
 * look at a span; press play to replay the window hour by hour, the map
 * following along. Playback only steps through hours that exist in the data.
 */

import { useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import type { Bucket } from './roomApi';

const W = 960;
const H = 64;

export function Timeline({ buckets, range, onRange }: { buckets: Bucket[]; range: [number, number]; onRange: (r: [number, number]) => void }) {
  const [drag, setDrag] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const n = buckets.length;
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const bw = n ? W / n : W;
  const full = range[0] === 0 && range[1] === n - 1;

  const indexAt = (clientX: number) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box || !n) return 0;
    return Math.max(0, Math.min(n - 1, Math.floor(((clientX - box.left) / box.width) * n)));
  };

  // Replay: advance the end of the span one hour per step until the window's end.
  useEffect(() => {
    if (!playing) return;
    if (range[1] >= n - 1) { setPlaying(false); return; }
    const t = setTimeout(() => onRange([range[0], range[1] + 1]), 420);
    return () => clearTimeout(t);
  }, [playing, range, n, onRange]);

  const startPlay = () => {
    if (!n) return;
    if (range[1] >= n - 1) onRange([range[0], range[0]]);
    setPlaying(true);
  };

  const label = (i: number) => {
    const b = buckets[i];
    if (!b) return '';
    const d = new Date(b.at);
    return `${String(d.getUTCHours()).padStart(2, '0')}:00`;
  };

  return (
    <div className="flex items-center gap-3" data-testid="sr-timeline">
      <div className="flex flex-shrink-0 items-center gap-1">
        <button type="button" className="sr-btn sr-btn-ghost h-8 w-8 justify-center px-0" onClick={() => (playing ? setPlaying(false) : startPlay())} aria-label={playing ? 'Pause replay' : 'Replay the window'} title="Replay  (space)" data-testid="sr-play">
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <button type="button" className="sr-btn sr-btn-ghost h-8 w-8 justify-center px-0" onClick={() => { setPlaying(false); onRange([0, Math.max(0, n - 1)]); }} disabled={full} aria-label="Show the whole window" title="Whole window">
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-w-0 flex-1">
        <svg
          ref={svg}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="h-14 w-full cursor-crosshair touch-none"
          role="slider"
          tabIndex={0}
          aria-label="Time span"
          aria-valuemin={0}
          aria-valuemax={Math.max(0, n - 1)}
          aria-valuenow={range[1]}
          aria-valuetext={`${label(range[0])} to ${label(range[1])} UTC`}
          onPointerDown={(e) => { const i = indexAt(e.clientX); setDrag(i); setPlaying(false); onRange([i, i]); (e.currentTarget as Element).setPointerCapture(e.pointerId); }}
          onPointerMove={(e) => { if (drag === null) return; const i = indexAt(e.clientX); onRange([Math.min(drag, i), Math.max(drag, i)]); }}
          onPointerUp={() => setDrag(null)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') { e.preventDefault(); onRange(e.shiftKey ? [Math.min(range[0] + 1, range[1]), range[1]] : [range[0], Math.min(n - 1, range[1] + 1)]); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); onRange(e.shiftKey ? [Math.max(0, range[0] - 1), range[1]] : [range[0], Math.max(range[0], range[1] - 1)]); }
            else if (e.key === 'Home') { e.preventDefault(); onRange([0, n - 1]); }
          }}
        >
          {buckets.map((b, i) => {
            const on = i >= range[0] && i <= range[1];
            const h = (b.count / max) * (H - 6);
            const hp = (b.placed / max) * (H - 6);
            return (
              <g key={b.at}>
                <rect className="sr-bar" data-on={on ? 'true' : 'false'} x={i * bw + 1} y={H - h} width={Math.max(1, bw - 2)} height={h} />
                <rect className="sr-bar-placed" data-on={on ? 'true' : 'false'} x={i * bw + 1} y={H - hp} width={Math.max(1, bw - 2)} height={hp} />
              </g>
            );
          })}
          {n > 0 && <line className="sr-playhead" x1={(range[1] + 1) * bw} x2={(range[1] + 1) * bw} y1={0} y2={H} />}
        </svg>
        <div className="sr-mono flex justify-between text-[10.5px] sr-faint">
          <span>{label(0)}</span>
          <span className={full ? '' : 'sr-text-2'} data-testid="sr-span">{full ? `last ${n - 1} h` : `${label(range[0])}–${label(range[1])} UTC`}</span>
          <span>{label(n - 1)}</span>
        </div>
      </div>
    </div>
  );
}
