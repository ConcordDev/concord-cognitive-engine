'use client';

/**
 * RegionPolygonEditor — the real click-to-place-vertex visual polygon
 * editor the kingdoms lens's own "Found a Kingdom" form has disclosed as
 * planned "v1.1" since it shipped. Outputs the exact same `number[][]`
 * ([x,z] world-coordinate pairs) shape the backend already expects
 * (`POST /api/kingdoms` `regionPolygon`) — no backend change needed, this
 * only replaces the raw-JSON-paste input with a real drawing surface.
 *
 * Existing kingdoms' real region_polygon data (for the same world) is
 * drawn as reference context underneath the draft, so a founder can see
 * what's already claimed instead of drawing blind — real data, not a
 * decorative grid.
 */

import { useMemo, useState } from 'react';
import { X, RotateCcw, Trash2 } from 'lucide-react';

export interface ExistingRegion {
  id: string;
  name: string;
  region_polygon: number[][];
}

interface RegionPolygonEditorProps {
  value: number[][];
  onChange: (points: number[][]) => void;
  existingRegions?: ExistingRegion[];
}

const SIZE = 420;

function polygonPath(points: number[][], toPx: (p: number[]) => [number, number]): string {
  if (points.length === 0) return '';
  const px = points.map(toPx);
  return `M ${px.map(([x, y]) => `${x},${y}`).join(' L ')}${points.length >= 3 ? ' Z' : ''}`;
}

export function RegionPolygonEditor({ value, onChange, existingRegions = [] }: RegionPolygonEditorProps) {
  // Half-width of the visible world-coordinate window (e.g. 250 shows
  // -250..250 on each axis). Adjustable so a founder can zoom out for a
  // sprawling territory or in for a small precise claim.
  const [range, setRange] = useState(250);

  const toPx = (p: number[]): [number, number] => [
    ((p[0] + range) / (range * 2)) * SIZE,
    ((p[1] + range) / (range * 2)) * SIZE, // world z maps to screen y directly (top-down map convention)
  ];
  const toWorld = (px: number, py: number): number[] => [
    Math.round((px / SIZE) * (range * 2) - range),
    Math.round((py / SIZE) * (range * 2) - range),
  ];

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * SIZE;
    const py = ((e.clientY - rect.top) / rect.height) * SIZE;
    onChange([...value, toWorld(px, py)]);
  };

  const removePoint = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const undo = () => onChange(value.slice(0, -1));
  const clear = () => onChange([]);

  const gridLines = useMemo(() => {
    const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
    const step = range / 5;
    for (let w = -range; w <= range; w += step) {
      const [px] = toPx([w, 0]);
      lines.push({ x1: px, y1: 0, x2: px, y2: SIZE });
      const [, py] = toPx([0, w]);
      lines.push({ x1: 0, y1: py, x2: SIZE, y2: py });
    }
    return lines;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[10px] text-slate-400">
        <span>Click to place vertices ({value.length} so far, 3+ to close a region)</span>
        <label className="flex items-center gap-1">
          Range ±
          <input
            type="number"
            value={range}
            min={10}
            max={5000}
            step={10}
            onChange={(e) => setRange(Math.max(10, Number(e.target.value) || 250))}
            className="w-16 rounded bg-slate-800 px-1 py-0.5 text-slate-200"
          />
        </label>
      </div>
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width="100%"
        height={SIZE}
        className="cursor-crosshair rounded border border-slate-700 bg-slate-950"
        onClick={handleClick}
        role="img"
        aria-label="Region polygon drawing surface"
      >
        {gridLines.map((l, i) => (
          <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="#1e293b" strokeWidth={1} />
        ))}
        {/* Origin marker */}
        <circle cx={toPx([0, 0])[0]} cy={toPx([0, 0])[1]} r={2} fill="#475569" />

        {/* Existing kingdoms' real claimed regions — reference context, not decoration */}
        {existingRegions.map((r) => (
          <g key={r.id}>
            <path
              d={polygonPath(r.region_polygon, toPx)}
              fill="#f59e0b"
              fillOpacity={0.08}
              stroke="#f59e0b"
              strokeOpacity={0.35}
              strokeWidth={1}
              strokeDasharray="4 3"
            />
            {r.region_polygon[0] && (
              <text
                x={toPx(r.region_polygon[0])[0]}
                y={toPx(r.region_polygon[0])[1] - 4}
                fontSize={9}
                fill="#f59e0b"
                fillOpacity={0.6}
              >
                {r.name}
              </text>
            )}
          </g>
        ))}

        {/* Draft polygon in progress */}
        <path
          d={polygonPath(value, toPx)}
          fill={value.length >= 3 ? '#10b981' : 'none'}
          fillOpacity={0.2}
          stroke="#10b981"
          strokeWidth={2}
        />
        {value.map((p, i) => {
          const [x, y] = toPx(p);
          return <circle key={i} cx={x} cy={y} r={4} fill="#10b981" stroke="#052e1f" strokeWidth={1} />;
        })}
      </svg>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((p, i) => (
            <li
              key={i}
              className="flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300"
            >
              [{p[0]}, {p[1]}]
              <button type="button" onClick={() => removePoint(i)} aria-label={`Remove vertex ${i + 1}`}>
                <X className="h-2.5 w-2.5 text-slate-500 hover:text-rose-400" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={undo}
          disabled={value.length === 0}
          className="inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-1 text-[10px] text-slate-300 hover:border-slate-500 disabled:opacity-40"
        >
          <RotateCcw className="h-3 w-3" /> Undo last
        </button>
        <button
          type="button"
          onClick={clear}
          disabled={value.length === 0}
          className="inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-1 text-[10px] text-slate-300 hover:border-rose-500/50 disabled:opacity-40"
        >
          <Trash2 className="h-3 w-3" /> Clear
        </button>
      </div>
    </div>
  );
}

export default RegionPolygonEditor;
