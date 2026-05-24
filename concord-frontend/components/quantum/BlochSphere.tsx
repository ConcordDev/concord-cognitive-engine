'use client';

/**
 * BlochSphere — a lightweight 2D-projected Bloch sphere rendered in SVG.
 * Takes a single-qubit Bloch vector { x, y, z } (already computed by the
 * statevector simulator's reduced density matrix) and draws the state
 * arrow inside a wireframe sphere. No Three.js needed — an orthographic
 * projection is enough to read the qubit state at a glance.
 */

export interface BlochVector {
  qubit: number;
  x: number;
  y: number;
  z: number;
  purity: number;
  mixed: boolean;
}

// Orthographic projection: looking slightly down at the sphere.
// X axis points right-ish, Y axis points up-out, Z axis points up.
function project(x: number, y: number, z: number, r: number) {
  const tilt = 0.45; // viewing tilt
  const px = x * 0.92 + y * 0.38;
  const py = -(z) + y * tilt * -0.55 - x * 0.1;
  return { sx: px * r, sy: py * r };
}

export function BlochSphere({ vector, size = 120 }: { vector: BlochVector; size?: number }) {
  const r = size / 2 - 14;
  const cx = size / 2;
  const cy = size / 2;

  const tip = project(vector.x, vector.y, vector.z, r);
  // axis endpoints
  const axes = [
    { from: project(-1, 0, 0, r), to: project(1, 0, 0, r), label: 'x', color: '#ec4899' },
    { from: project(0, -1, 0, r), to: project(0, 1, 0, r), label: 'y', color: '#22c55e' },
    { from: project(0, 0, -1, r), to: project(0, 0, 1, r), label: 'z', color: '#06b6d4' },
  ];

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} className="overflow-visible">
        {/* outline circle */}
        <circle cx={cx} cy={cy} r={r} fill="rgba(139,92,246,0.05)" stroke="#3f3f46" strokeWidth={1} />
        {/* equator ellipse */}
        <ellipse cx={cx} cy={cy} rx={r} ry={r * 0.34} fill="none" stroke="#27272a" strokeWidth={1} />
        {/* meridian ellipse */}
        <ellipse cx={cx} cy={cy} rx={r * 0.34} ry={r} fill="none" stroke="#27272a" strokeWidth={1} />
        {/* axes */}
        {axes.map((a) => (
          <g key={a.label}>
            <line
              x1={cx + a.from.sx} y1={cy + a.from.sy}
              x2={cx + a.to.sx} y2={cy + a.to.sy}
              stroke={a.color} strokeWidth={0.8} strokeOpacity={0.55} strokeDasharray="2 2"
            />
            <text
              x={cx + a.to.sx} y={cy + a.to.sy}
              fontSize={8} fill={a.color} textAnchor="middle" dy={3}
            >{a.label}</text>
          </g>
        ))}
        {/* state vector arrow */}
        <line
          x1={cx} y1={cy} x2={cx + tip.sx} y2={cy + tip.sy}
          stroke="#a855f7" strokeWidth={2.4} strokeLinecap="round"
        />
        <circle cx={cx + tip.sx} cy={cy + tip.sy} r={3.4} fill="#a855f7" />
        <circle cx={cx} cy={cy} r={1.6} fill="#71717a" />
      </svg>
      <div className="text-center">
        <p className="text-[10px] font-mono text-neon-purple">q[{vector.qubit}]</p>
        <p className="text-[9px] font-mono text-zinc-400">
          ({vector.x.toFixed(2)}, {vector.y.toFixed(2)}, {vector.z.toFixed(2)})
        </p>
        <p className={`text-[9px] ${vector.mixed ? 'text-amber-400' : 'text-emerald-400'}`}>
          {vector.mixed ? `mixed · r=${vector.purity.toFixed(2)}` : 'pure'}
        </p>
      </div>
    </div>
  );
}
