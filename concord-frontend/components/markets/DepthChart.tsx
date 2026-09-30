'use client';

import { useMemo } from 'react';
import { Loader2 } from 'lucide-react';

export interface DepthLevel {
  price: number;
  size: number;
}

interface DepthChartProps {
  yesBids: DepthLevel[];
  noBids: DepthLevel[];
  midProbability: number;
  loading?: boolean;
  className?: string;
}

/**
 * Real depth-of-market chart for the `markets.order-book` prediction-market
 * response (server/domains/markets.js — real resting-order aggregation, not
 * simulated). Both sides live on one shared "probability of YES" axis:
 * YES resting orders fill when prob <= limitPrice (a standard bid — they sit
 * BELOW the current price), NO resting orders fill when prob >= 1-limitPrice
 * (a standard ask once transformed to 1-price — they sit ABOVE the current
 * price). That transform is what makes this a textbook mirrored depth chart
 * (cumulative volume valley at the current price, walls rising outward) —
 * see server/domains/markets.js `matchRestingOrders` for the fill condition
 * this derives from.
 */
export default function DepthChart({ yesBids, noBids, midProbability, loading, className }: DepthChartProps) {
  const { bidPath, bidArea, askPath, askArea, midX, W, H, PAD, totalYes, totalNo } = useMemo(() => {
    const W = 640;
    const H = 150;
    const PAD = 10;
    const baseline = H - PAD;

    // YES bids sit at their own limit price (below mid); NO bids transform
    // to their trigger position 1-price (above mid) on the shared axis.
    const bids = [...yesBids].sort((a, b) => b.price - a.price); // best (nearest mid) first
    const asks = [...noBids]
      .map((r) => ({ price: 1 - r.price, size: r.size }))
      .sort((a, b) => a.price - b.price); // best (nearest mid) first

    const maxCum = Math.max(
      bids.reduce((s, r) => s + r.size, 0),
      asks.reduce((s, r) => s + r.size, 0),
      1e-9,
    );

    const xScale = (p: number) => PAD + Math.max(0, Math.min(1, p)) * (W - PAD * 2);
    const yScale = (cum: number) => baseline - (cum / maxCum) * (H - PAD * 2);

    const midX = xScale(midProbability);

    // Build a step path walking outward from the mid line so the chart
    // reads as a valley at the current price with walls rising outward —
    // never a fabricated smooth curve.
    function stepPath(levels: DepthLevel[], anchorX: number, direction: 1 | -1) {
      if (levels.length === 0) return { path: '', area: '' };
      let cum = 0;
      let cx = anchorX;
      const pts: Array<[number, number]> = [[cx, baseline]];
      for (const lvl of levels) {
        const nx = xScale(lvl.price);
        pts.push([cx, yScale(cum)]);
        cum += lvl.size;
        pts.push([nx, yScale(cum)]);
        cx = nx;
      }
      pts.push([cx, baseline]);
      const path = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
      const area = `${path} Z`;
      void direction;
      return { path, area };
    }

    const bidPaths = stepPath(bids, midX, -1);
    const askPaths = stepPath(asks, midX, 1);

    return {
      bidPath: bidPaths.path,
      bidArea: bidPaths.area,
      askPath: askPaths.path,
      askArea: askPaths.area,
      midX,
      W,
      H,
      PAD,
      totalYes: bids.reduce((s, r) => s + r.size, 0),
      totalNo: asks.reduce((s, r) => s + r.size, 0),
    };
  }, [yesBids, noBids, midProbability]);

  const empty = yesBids.length === 0 && noBids.length === 0;

  if (loading) {
    return (
      <div className={`flex h-[150px] items-center justify-center rounded border border-white/10 bg-lattice-void/40 ${className || ''}`}>
        <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
      </div>
    );
  }

  if (empty) {
    return (
      <div className={`flex h-[150px] flex-col items-center justify-center gap-1 rounded border border-white/10 bg-lattice-void/40 text-gray-400 ${className || ''}`}>
        <span className="text-xs">No resting orders in the book</span>
        <span className="text-[10px]">Place a limit order to add depth</span>
      </div>
    );
  }

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[150px]" role="img" aria-label="Order book depth — cumulative resting volume around the current price">
        <defs>
          <linearGradient id="depth-bid-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#34d399" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#34d399" stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id="depth-ask-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fb7185" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#fb7185" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {bidArea && <path d={bidArea} fill="url(#depth-bid-fill)" />}
        {bidPath && <path d={bidPath} fill="none" stroke="#34d399" strokeWidth={1.5} />}
        {askArea && <path d={askArea} fill="url(#depth-ask-fill)" />}
        {askPath && <path d={askPath} fill="none" stroke="#fb7185" strokeWidth={1.5} />}
        <line x1={midX} y1={PAD} x2={midX} y2={H - PAD} stroke="#94a3b8" strokeWidth={1} strokeDasharray="3,3" />
      </svg>
      <div className="mt-1 flex items-center justify-between text-[10px] font-mono tabular-nums text-gray-400">
        <span className="text-emerald-300">▲ YES {Number(totalYes ?? 0).toFixed(0)} ⚡</span>
        <span className="text-gray-300">mid {Number(midProbability ?? 0).toFixed(2)}</span>
        <span className="text-rose-300">▼ NO {Number(totalNo ?? 0).toFixed(0)} ⚡</span>
      </div>
    </div>
  );
}
