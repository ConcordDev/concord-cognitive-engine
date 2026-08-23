'use client';

/**
 * InheritanceGraph — a real inline-SVG lineage diagram over this account's
 * actual inheritance pacts. Left column: pacts naming YOU as a beneficiary
 * (money flowing in). Center: you. Right column: beneficiaries named on
 * pacts YOU wrote (money flowing out). Every node/edge here is real pact
 * data (id, sharePct, status) — nothing invented, no placeholder shape.
 */

import type { Pact } from './types';

interface InheritanceGraphProps {
  written: Pact[];
  beneficiaryOf: Pact[];
}

const STATUS_COLOR: Record<Pact['status'], string> = {
  active: '#34d399',
  expired: '#fbbf24',
  revoked: '#71717a',
  fired: '#fb7185',
};

interface Row {
  key: string;
  label: string;
  sharePct: number;
  status: Pact['status'];
}

function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 14)}…` : id;
}

export function InheritanceGraph({ written, beneficiaryOf }: InheritanceGraphProps) {
  // Flatten every beneficiary across every pact you wrote into one row per
  // (pact, beneficiary) — a single beneficiary can appear on multiple pacts.
  const outRows: Row[] = written.flatMap((p) =>
    p.beneficiaries.map((b) => ({
      key: `${p.id}:${b.userId}`,
      label: shortId(b.userId),
      sharePct: b.sharePct,
      status: p.status,
    })),
  );
  // One row per pact where you're a named beneficiary.
  const inRows: Row[] = beneficiaryOf.map((p) => ({
    key: p.id,
    label: shortId(p.insuredUserId),
    sharePct: p.myShare?.sharePct ?? 0,
    status: p.status,
  }));

  if (outRows.length === 0 && inRows.length === 0) return null;

  const ROW_H = 34;
  const rows = Math.max(inRows.length, outRows.length, 1);
  const height = rows * ROW_H + 40;
  const width = 460;
  const midX = width / 2;
  const leftX = 70;
  const rightX = width - 70;

  const yFor = (i: number, count: number) => {
    // Center the shorter column's rows vertically against the full height.
    const blockH = count * ROW_H;
    const offset = (height - blockH) / 2;
    return offset + i * ROW_H + ROW_H / 2;
  };

  return (
    <div className="mb-6 overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
      <p className="mb-2 text-[10px] uppercase tracking-wider text-zinc-400">Inheritance graph</p>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Inheritance pact graph">
        {/* Inbound edges: insurer -> you */}
        {inRows.map((r, i) => {
          const y = yFor(i, inRows.length);
          const midY = height / 2;
          return (
            <path
              key={`in-${r.key}`}
              d={`M ${leftX + 10} ${y} C ${midX - 40} ${y}, ${midX - 40} ${midY}, ${midX - 14} ${midY}`}
              fill="none"
              stroke={STATUS_COLOR[r.status]}
              strokeOpacity={0.45}
              strokeWidth={1.5}
            />
          );
        })}
        {/* Outbound edges: you -> beneficiary */}
        {outRows.map((r, i) => {
          const y = yFor(i, outRows.length);
          const midY = height / 2;
          return (
            <path
              key={`out-${r.key}`}
              d={`M ${midX + 14} ${midY} C ${midX + 40} ${midY}, ${midX + 40} ${y}, ${rightX - 10} ${y}`}
              fill="none"
              stroke={STATUS_COLOR[r.status]}
              strokeOpacity={0.45}
              strokeWidth={1.5}
            />
          );
        })}

        {/* Left column: pacts naming you as beneficiary */}
        {inRows.map((r, i) => {
          const y = yFor(i, inRows.length);
          return (
            <g key={`in-node-${r.key}`} transform={`translate(${leftX}, ${y})`}>
              <title>{`${r.label} insures you · ${r.sharePct}% · ${r.status}`}</title>
              <circle r={6} fill={STATUS_COLOR[r.status]} fillOpacity={0.85} />
              <text x={-10} y={4} textAnchor="end" style={{ fontSize: 10, fontFamily: 'monospace' }} className="fill-zinc-300">
                {r.label}
              </text>
              <text x={10} y={4} style={{ fontSize: 9, fontFamily: 'monospace' }} className="fill-zinc-500">
                {r.sharePct}%
              </text>
            </g>
          );
        })}

        {/* Right column: beneficiaries you named */}
        {outRows.map((r, i) => {
          const y = yFor(i, outRows.length);
          return (
            <g key={`out-node-${r.key}`} transform={`translate(${rightX}, ${y})`}>
              <title>{`You insure ${r.label} · ${r.sharePct}% · ${r.status}`}</title>
              <circle r={6} fill={STATUS_COLOR[r.status]} fillOpacity={0.85} />
              <text x={-10} y={4} textAnchor="end" style={{ fontSize: 9, fontFamily: 'monospace' }} className="fill-zinc-500">
                {r.sharePct}%
              </text>
              <text x={10} y={4} style={{ fontSize: 10, fontFamily: 'monospace' }} className="fill-zinc-300">
                {r.label}
              </text>
            </g>
          );
        })}

        {/* Center: you */}
        <g transform={`translate(${midX}, ${height / 2})`}>
          <circle r={16} fill="#a78bfa" fillOpacity={0.9} stroke="#ede9fe" strokeWidth={2} />
          <text y={4} textAnchor="middle" style={{ fontSize: 10, fontWeight: 700 }} className="fill-zinc-950">
            You
          </text>
        </g>
      </svg>
    </div>
  );
}

export default InheritanceGraph;
