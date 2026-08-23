'use client';

/**
 * CitationNetworkDiagram — a real inline-SVG citation-network diagram for
 * one CourtListener opinion, wired to the real `law.citation-graph` macro
 * (CourtListener's `opinions-cited` viewset — see server/domains/law.js).
 * Left column: opinions this one CITES (real authority it relies on,
 * `direction: 'cites'`). Right column: opinions that CITE this one (real
 * influence it has had, `direction: 'citedBy'`). Center: the opinion being
 * viewed. Every node/edge is a real opinion id + real CourtListener
 * permalink — nothing invented, no placeholder rows, matching the same
 * in/out-column pattern used by the death-insurance InheritanceGraph and
 * the careers CareerLadderPath earlier in this feature-build pass.
 */

export interface CitationNetworkEdge {
  id: number | null;
  otherOpinionId: number | null;
  depth: number | null;
  otherOpinionUrl: string | null;
}

export interface CitationNetworkDiagramProps {
  centerLabel: string;
  centerUrl: string | null;
  cites: CitationNetworkEdge[];
  citedBy: CitationNetworkEdge[];
  citesTotalHits: number;
  citedByTotalHits: number;
}

const CITES_COLOR = '#fbbf24'; // amber — authority this opinion relies on
const CITED_BY_COLOR = '#22d3ee'; // cyan — influence this opinion has had

function shortLabel(id: number | null): string {
  return id != null ? `Opinion #${id}` : 'Unknown opinion';
}

export function CitationNetworkDiagram({
  centerLabel,
  centerUrl,
  cites,
  citedBy,
  citesTotalHits,
  citedByTotalHits,
}: CitationNetworkDiagramProps) {
  if (cites.length === 0 && citedBy.length === 0) return null;

  const ROW_H = 30;
  const rows = Math.max(cites.length, citedBy.length, 1);
  const height = rows * ROW_H + 50;
  const width = 560;
  const midX = width / 2;
  const leftX = 84;
  const rightX = width - 84;
  const midY = height / 2;

  const yFor = (i: number, count: number) => {
    const blockH = count * ROW_H;
    const offset = (height - blockH) / 2;
    return offset + i * ROW_H + ROW_H / 2;
  };

  return (
    <div className="mt-2 overflow-x-auto rounded-lg border border-lattice-border bg-lattice-void/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-wider text-gray-400">Citation network</p>
        <div className="flex items-center gap-3 text-[10px] text-gray-500">
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: CITES_COLOR }} /> Cites
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: CITED_BY_COLOR }} /> Cited by
          </span>
        </div>
      </div>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Citation network diagram">
        {/* Outbound edges: this opinion -> what it cites (left column) */}
        {cites.map((e, i) => {
          const y = yFor(i, cites.length);
          return (
            <path
              key={`cites-${e.id ?? i}`}
              d={`M ${midX - 14} ${midY} C ${midX - 40} ${midY}, ${midX - 40} ${y}, ${leftX + 10} ${y}`}
              fill="none"
              stroke={CITES_COLOR}
              strokeOpacity={0.45}
              strokeWidth={1.5}
            />
          );
        })}
        {/* Inbound edges: what cites this opinion -> this opinion (right column) */}
        {citedBy.map((e, i) => {
          const y = yFor(i, citedBy.length);
          return (
            <path
              key={`citedby-${e.id ?? i}`}
              d={`M ${rightX - 10} ${y} C ${midX + 40} ${y}, ${midX + 40} ${midY}, ${midX + 14} ${midY}`}
              fill="none"
              stroke={CITED_BY_COLOR}
              strokeOpacity={0.45}
              strokeWidth={1.5}
            />
          );
        })}

        {/* Left column: opinions this one cites */}
        {cites.map((e, i) => {
          const y = yFor(i, cites.length);
          const label = shortLabel(e.otherOpinionId);
          const node = (
            <g key={`cites-node-${e.id ?? i}`} transform={`translate(${leftX}, ${y})`}>
              <title>{`${label}${e.depth != null ? ` · cited ${e.depth}×` : ''}`}</title>
              <circle r={6} fill={CITES_COLOR} fillOpacity={0.85} />
              <text x={-10} y={4} textAnchor="end" style={{ fontSize: 10, fontFamily: 'monospace' }} className="fill-gray-300">
                {label}
              </text>
              {e.depth != null && (
                <text x={10} y={4} style={{ fontSize: 9, fontFamily: 'monospace' }} className="fill-gray-500">
                  ×{e.depth}
                </text>
              )}
            </g>
          );
          return e.otherOpinionUrl ? (
            <a key={`cites-a-${e.id ?? i}`} href={e.otherOpinionUrl} target="_blank" rel="noopener noreferrer">
              {node}
            </a>
          ) : node;
        })}

        {/* Right column: opinions that cite this one */}
        {citedBy.map((e, i) => {
          const y = yFor(i, citedBy.length);
          const label = shortLabel(e.otherOpinionId);
          const node = (
            <g key={`citedby-node-${e.id ?? i}`} transform={`translate(${rightX}, ${y})`}>
              <title>{`${label}${e.depth != null ? ` · cited ${e.depth}×` : ''}`}</title>
              <circle r={6} fill={CITED_BY_COLOR} fillOpacity={0.85} />
              {e.depth != null && (
                <text x={-10} y={4} textAnchor="end" style={{ fontSize: 9, fontFamily: 'monospace' }} className="fill-gray-500">
                  ×{e.depth}
                </text>
              )}
              <text x={10} y={4} style={{ fontSize: 10, fontFamily: 'monospace' }} className="fill-gray-300">
                {label}
              </text>
            </g>
          );
          return e.otherOpinionUrl ? (
            <a key={`citedby-a-${e.id ?? i}`} href={e.otherOpinionUrl} target="_blank" rel="noopener noreferrer">
              {node}
            </a>
          ) : node;
        })}

        {/* Center: this opinion */}
        <g transform={`translate(${midX}, ${midY})`}>
          <circle r={16} fill="#a78bfa" fillOpacity={0.9} stroke="#ede9fe" strokeWidth={2} />
          <text y={4} textAnchor="middle" style={{ fontSize: 9, fontWeight: 700 }} className="fill-gray-950">
            ⚖
          </text>
        </g>
      </svg>
      <p className="mt-1 truncate text-[10px] text-gray-500" title={centerLabel}>
        {centerUrl ? (
          <a href={centerUrl} target="_blank" rel="noopener noreferrer" className="hover:text-cyan-300 hover:underline">
            {centerLabel}
          </a>
        ) : (
          centerLabel
        )}
      </p>
      {(citesTotalHits > cites.length || citedByTotalHits > citedBy.length) && (
        <p className="mt-1 text-[10px] text-gray-600">
          Showing {cites.length} of {citesTotalHits.toLocaleString()} cited · {citedBy.length} of {citedByTotalHits.toLocaleString()} citing.
        </p>
      )}
    </div>
  );
}

export default CitationNetworkDiagram;
