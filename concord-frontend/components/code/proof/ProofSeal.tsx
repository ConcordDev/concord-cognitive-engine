'use client';

/**
 * The seal: Proof's signature mark. One arc segment per check around a ring,
 * each in its check's state (lime proved, coral failed, amber stale, dashed
 * open, faint n/a). When every check that applies is proved, the ring closes
 * into a lime stamp that reads PROVED. Drawn only from the ledger.
 */

import type { CheckKey, CheckStatus } from './proofApi';

const GAP = 0.09; // radians between segments

function arc(cx: number, cy: number, r: number, a0: number, a1: number) {
  const p = (a: number) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  const [x0, y0] = p(a0); const [x1, y1] = p(a1);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export function ProofSeal({ order, states, green, size = 96, label = true }: {
  order: CheckKey[];
  states: Record<CheckKey, CheckStatus>;
  green: boolean;
  size?: number;
  label?: boolean;
}) {
  const n = order.length || 1;
  const done = order.filter((k) => states[k] === 'proved' || states[k] === 'not_applicable').length;
  const c = 50; const r = 42;
  const step = (Math.PI * 2) / n;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className="pf-ring" data-green={green ? 'true' : 'false'} role="img" aria-label={green ? 'Proved' : `${done} of ${n} checks proved`} data-testid="pf-ring">
      {order.map((k, i) => (
        <path key={k} d={arc(c, c, r, i * step + GAP / 2, (i + 1) * step - GAP / 2)} className="pf-ring-seg" data-s={states[k]} />
      ))}
      {label && (green ? (
        <g className="pf-ring-stamp">
          <circle cx={c} cy={c} r={31} />
          <text x={c} y={c + 4} textAnchor="middle">PROVED</text>
        </g>
      ) : (
        <text x={c} y={c + 7} textAnchor="middle" className="pf-ring-count">{done}<tspan className="pf-ring-of">/{n}</tspan></text>
      ))}
    </svg>
  );
}
