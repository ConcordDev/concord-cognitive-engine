'use client';

/**
 * CareerLadderPath — a real vertical progress-path SVG over the actual
 * `careers.ladder` tiers. A node is unlocked when the real `skill` value
 * (the same slider driving contract eligibility elsewhere on this page)
 * clears that tier's real `skillGate`, and further gated when the real
 * reputation check (`ReputationGate`) flags it — the same two real signals
 * the existing list view already reads, just given a shape that actually
 * looks like a career ladder instead of a plain list.
 */

interface LadderTier {
  tier: number;
  title: string;
  skillGate: number;
  wageBase: number;
  isBranchPoint: boolean;
  isMastery: boolean;
}

interface CareerLadderPathProps {
  ladder: LadderTier[];
  skill: number;
  gatedTiers: number[];
}

export function CareerLadderPath({ ladder, skill, gatedTiers }: CareerLadderPathProps) {
  if (ladder.length === 0) return null;

  const ROW_H = 46;
  const width = 320;
  const nodeX = 26;
  const height = ladder.length * ROW_H + 20;

  // The current rung: the highest tier whose skillGate is already cleared
  // and isn't reputation-gated — the real "you are here" marker.
  let currentTier = -1;
  ladder.forEach((t) => {
    const reachable = skill >= t.skillGate && !gatedTiers.includes(t.tier);
    if (reachable) currentTier = t.tier;
  });

  return (
    <div className="mb-3 overflow-x-auto rounded-lg border border-white/10 bg-black/30 p-3">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Career ladder progress path">
        {/* The spine */}
        <line x1={nodeX} y1={16} x2={nodeX} y2={height - 10} stroke="#3f3f46" strokeWidth={2} />
        {/* Filled portion up to the current rung */}
        {currentTier >= 0 && (
          <line
            x1={nodeX} y1={16}
            x2={nodeX}
            y2={16 + ladder.findIndex((t) => t.tier === currentTier) * ROW_H}
            stroke="#fbbf24" strokeWidth={2}
          />
        )}
        {ladder.map((t, i) => {
          const y = 16 + i * ROW_H;
          const locked = skill < t.skillGate || gatedTiers.includes(t.tier);
          const isCurrent = t.tier === currentTier;
          const color = locked ? '#52525b' : isCurrent ? '#fbbf24' : '#34d399';
          return (
            <g key={t.tier}>
              <title>{`Tier ${t.tier}: ${t.title} — gate ${t.skillGate.toFixed(2)}, ${t.wageBase} sparks/shift${locked ? ' (locked)' : ''}`}</title>
              <circle cx={nodeX} cy={y} r={isCurrent ? 8 : 6} fill={color} fillOpacity={locked ? 0.35 : 0.9} stroke={isCurrent ? '#fef3c7' : 'none'} strokeWidth={isCurrent ? 2 : 0} />
              <text x={nodeX + 18} y={y + 4} style={{ fontSize: 11 }} className={locked ? 'fill-zinc-500' : 'fill-zinc-100'}>
                {t.tier}. {t.title}
              </text>
              {t.isBranchPoint && (
                <text x={width - 34} y={y + 4} style={{ fontSize: 10 }} className="fill-sky-300">⑂</text>
              )}
              {t.isMastery && (
                <text x={width - 18} y={y + 4} style={{ fontSize: 10 }} className="fill-amber-300">★</text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default CareerLadderPath;
