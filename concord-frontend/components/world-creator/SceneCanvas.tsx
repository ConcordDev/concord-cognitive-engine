'use client';

/**
 * SceneCanvas — top-down 2D scene editor for a world-creator draft.
 *
 * Props, NPCs, spawn points and zones all carry x/z coords in the
 * [-250, 250] play box (the same coordinate space the world lens
 * uses). This is a dependency-free SVG plotter: click-to-place in the
 * active tool, drag a prop to move it, click an entity to select it.
 */

import { useCallback, useRef, useState } from 'react';

export interface SceneProp { id: string; kind: string; x: number; z: number; rotation: number; scale: number; }
export interface SceneSpawn { id: string; name: string; x: number; z: number; isDefault: boolean; }
export interface SceneZone { id: string; name: string; kind: string; x: number; z: number; radius: number; }
export interface SceneNpc { id: string; name: string; archetype: string; x: number; z: number; factionId: string | null; level: number; }

export type SceneTool = 'select' | 'prop' | 'spawn' | 'zone' | 'npc';

const BOX = 250; // half-extent
const VIEW = 560; // svg px

const PROP_GLYPH: Record<string, string> = {
  tree: '🌲', rock: '🪨', building: '🏛️', campfire: '🔥', well: '⛲', ruin: '🏚️',
  lamp: '💡', bridge: '🌉', statue: '🗿', fence: '🚧', crystal: '💎', altar: '⛩️',
};
const ARCH_GLYPH: Record<string, string> = {
  warrior: '⚔️', scholar: '📚', trader: '💰', mystic: '🔮', guard: '🛡️',
  healer: '➕', hunter: '🏹', wanderer: '🧭',
};
const ZONE_TONE: Record<string, string> = {
  safe: '#22c55e', hazard: '#ef4444', social: '#6366f1', combat: '#f97316',
  quest: '#eab308', neutral: '#a1a1aa',
};

export function SceneCanvas({
  props: sceneProps, spawns, zones, npcs,
  tool, selectedId, biomePalette,
  onCanvasClick, onSelect, onMove,
}: {
  props: SceneProp[];
  spawns: SceneSpawn[];
  zones: SceneZone[];
  npcs: SceneNpc[];
  tool: SceneTool;
  selectedId: string | null;
  biomePalette?: string[];
  onCanvasClick: (x: number, z: number) => void;
  onSelect: (kind: 'prop' | 'spawn' | 'zone' | 'npc', id: string) => void;
  onMove: (kind: 'prop', id: string, x: number, z: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ id: string } | null>(null);

  // world coord → svg px
  const px = (v: number) => ((v + BOX) / (BOX * 2)) * VIEW;
  // svg px → world coord
  const toWorld = useCallback((clientX: number, clientY: number): { x: number; z: number } => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, z: 0 };
    const sx = ((clientX - rect.left) / rect.width) * VIEW;
    const sy = ((clientY - rect.top) / rect.height) * VIEW;
    return {
      x: Math.round((sx / VIEW) * (BOX * 2) - BOX),
      z: Math.round((sy / VIEW) * (BOX * 2) - BOX),
    };
  }, []);

  const handleBgClick = useCallback((e: React.MouseEvent) => {
    if (tool === 'select') return;
    const { x, z } = toWorld(e.clientX, e.clientY);
    onCanvasClick(x, z);
  }, [tool, toWorld, onCanvasClick]);

  const handleDragMove = useCallback((e: React.MouseEvent) => {
    if (!drag) return;
    const { x, z } = toWorld(e.clientX, e.clientY);
    onMove('prop', drag.id, x, z);
  }, [drag, toWorld, onMove]);

  const fill = biomePalette && biomePalette.length >= 2 ? biomePalette[1] : '#1c1917';

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        className="w-full select-none rounded-lg border border-stone-700 bg-stone-950"
        style={{ aspectRatio: '1 / 1', cursor: tool === 'select' ? 'default' : 'crosshair' }}
        onClick={handleBgClick}
        onMouseMove={handleDragMove}
        onMouseUp={() => setDrag(null)}
        onMouseLeave={() => setDrag(null)}
      >
        {/* biome-tinted ground */}
        <rect x={0} y={0} width={VIEW} height={VIEW} fill={fill} opacity={0.25} />
        {/* grid */}
        {Array.from({ length: 11 }, (_, i) => {
          const p = (i / 10) * VIEW;
          return (
            <g key={`g${i}`} stroke="#44403c" strokeWidth={i === 5 ? 1.2 : 0.5} opacity={0.6}>
              <line x1={p} y1={0} x2={p} y2={VIEW} />
              <line x1={0} y1={p} x2={VIEW} y2={p} />
            </g>
          );
        })}

        {/* zones (drawn first, beneath entities) */}
        {zones.map(z => (
          <g key={z.id} onClick={(e) => { e.stopPropagation(); onSelect('zone', z.id); }} style={{ cursor: 'pointer' }}>
            <circle
              cx={px(z.x)} cy={px(z.z)}
              r={(z.radius / (BOX * 2)) * VIEW}
              fill={ZONE_TONE[z.kind] || '#a1a1aa'}
              fillOpacity={selectedId === z.id ? 0.28 : 0.14}
              stroke={ZONE_TONE[z.kind] || '#a1a1aa'}
              strokeWidth={selectedId === z.id ? 2 : 1}
              strokeDasharray="4 3"
            />
            <text x={px(z.x)} y={px(z.z)} textAnchor="middle" fontSize={9} fill="#e7e5e4">
              {z.name}
            </text>
          </g>
        ))}

        {/* props */}
        {sceneProps.map(p => (
          <g
            key={p.id}
            transform={`translate(${px(p.x)} ${px(p.z)})`}
            onClick={(e) => { e.stopPropagation(); onSelect('prop', p.id); }}
            onMouseDown={(e) => { if (tool === 'select') { e.stopPropagation(); setDrag({ id: p.id }); onSelect('prop', p.id); } }}
            style={{ cursor: tool === 'select' ? 'grab' : 'pointer' }}
          >
            {selectedId === p.id && <circle r={13} fill="none" stroke="#f59e0b" strokeWidth={1.5} />}
            <text textAnchor="middle" dominantBaseline="central" fontSize={16 * p.scale}>
              {PROP_GLYPH[p.kind] || '▪️'}
            </text>
          </g>
        ))}

        {/* npcs */}
        {npcs.map(n => (
          <g
            key={n.id}
            transform={`translate(${px(n.x)} ${px(n.z)})`}
            onClick={(e) => { e.stopPropagation(); onSelect('npc', n.id); }}
            style={{ cursor: 'pointer' }}
          >
            {selectedId === n.id && <circle r={13} fill="none" stroke="#f59e0b" strokeWidth={1.5} />}
            <circle r={9} fill="#0c0a09" stroke="#a78bfa" strokeWidth={1.4} />
            <text textAnchor="middle" dominantBaseline="central" fontSize={10}>
              {ARCH_GLYPH[n.archetype] || '🧑'}
            </text>
            <text textAnchor="middle" y={-13} fontSize={8} fill="#c4b5fd">{n.name}</text>
          </g>
        ))}

        {/* spawn points */}
        {spawns.map(s => (
          <g
            key={s.id}
            transform={`translate(${px(s.x)} ${px(s.z)})`}
            onClick={(e) => { e.stopPropagation(); onSelect('spawn', s.id); }}
            style={{ cursor: 'pointer' }}
          >
            {selectedId === s.id && <circle r={12} fill="none" stroke="#f59e0b" strokeWidth={1.5} />}
            <polygon
              points="0,-9 8,7 -8,7"
              fill={s.isDefault ? '#22c55e' : '#0ea5e9'}
              stroke="#0c0a09" strokeWidth={1}
            />
            <text textAnchor="middle" y={-12} fontSize={8} fill={s.isDefault ? '#86efac' : '#7dd3fc'}>
              {s.name}{s.isDefault ? ' ★' : ''}
            </text>
          </g>
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-stone-500">
        <span>−250m</span>
        <span>Top-down scene · {BOX * 2}m × {BOX * 2}m</span>
        <span>+250m</span>
      </div>
    </div>
  );
}
