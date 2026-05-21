'use client';

/**
 * ResidueMap — dependency-free spectral-plane plot for the ghost-tracker lens.
 * Residues carry deterministic world-grid coords (x,z ∈ -512..512) derived
 * server-side from their signature. This SVG draws them on that plane so a
 * hunter knows where to go. Marker colour encodes drift type, ring encodes
 * severity, and extinguished residues fade out.
 */

const PLANE = 512;
const W = 460;
const H = 460;

const TYPE_TONE: Record<string, string> = {
  spectral: '#a78bfa',
  echo_chamber: '#38bdf8',
  self_reference: '#f472b6',
  memetic_drift: '#fbbf24',
};

const SEVERITY_RING: Record<string, number> = {
  low: 5,
  medium: 7,
  high: 9,
  critical: 12,
};

export interface MapResidue {
  id: string;
  drift_type: string;
  severity: string;
  coords: { x: number; z: number };
  stage?: string;
  confronted?: boolean;
}

export function ResidueMap({
  residues,
  selectedId,
  onSelect,
}: {
  residues: MapResidue[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const sx = (x: number) => ((x + PLANE) / (PLANE * 2)) * W;
  const sz = (z: number) => ((z + PLANE) / (PLANE * 2)) * H;

  return (
    <div className="rounded-lg border border-violet-700/30 bg-black/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs uppercase tracking-wide text-violet-400">Spectral plane</h3>
        <span className="text-[10px] text-gray-500">{residues.length} residues mapped</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Spectral residue map">
        <rect x={0} y={0} width={W} height={H} fill="#0a0d15" />
        {/* grid lines every 256 units */}
        {[-512, -256, 0, 256, 512].map((g) => (
          <g key={g}>
            <line x1={sx(g)} y1={0} x2={sx(g)} y2={H} stroke="#1e1b3a" strokeWidth={g === 0 ? 1.4 : 0.6} />
            <line x1={0} y1={sz(g)} x2={W} y2={sz(g)} stroke="#1e1b3a" strokeWidth={g === 0 ? 1.4 : 0.6} />
          </g>
        ))}
        {residues.map((r) => {
          const cx = sx(r.coords.x);
          const cy = sz(r.coords.z);
          const tone = TYPE_TONE[r.drift_type] || '#a1a1aa';
          const ring = SEVERITY_RING[r.severity] || 5;
          const isSel = r.id === selectedId;
          const faded = r.confronted || r.stage === 'extinguished';
          return (
            <g
              key={r.id}
              transform={`translate(${cx},${cy})`}
              onClick={() => onSelect(r.id)}
              style={{ cursor: 'pointer', opacity: faded ? 0.3 : 1 }}
            >
              {isSel && <circle r={ring + 5} fill="none" stroke="#fff" strokeWidth={1.2} />}
              <circle r={ring} fill="none" stroke={tone} strokeWidth={1.4} opacity={0.6} />
              <circle r={3.4} fill={tone} />
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
        {Object.entries(TYPE_TONE).map(([t, c]) => (
          <span key={t} className="flex items-center gap-1 text-gray-400">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: c }} />
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}
