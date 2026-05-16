'use client';

import { useEffect, useState, useCallback } from 'react';
import { Map, X, Loader2, Swords } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface FactionNode {
  id: string;
  name: string;
  stance: string;
  momentum: number;
  color: string;
  cx: number;
  cy: number;
  radius: number;
}

export interface FactionRelation {
  a: string;
  b: string;
  kind: 'neutral' | 'tension' | 'truce' | 'war' | 'alliance' | 'tribute';
  score: number;
}

interface Props {
  worldId: string;
  open: boolean;
  onClose: () => void;
}

const RELATION_STYLE: Record<FactionRelation['kind'], { color: string; dash?: string; label: string }> = {
  neutral:  { color: '#6b7280', dash: '4,4', label: 'neutral' },
  tension:  { color: '#fb923c', dash: '6,3', label: 'tension' },
  truce:    { color: '#a3e635',               label: 'truce' },
  war:      { color: '#ef4444',               label: 'war' },
  alliance: { color: '#67e8f9',               label: 'alliance' },
  tribute:  { color: '#fcd34d', dash: '8,2', label: 'tribute' },
};

const STANCE_LABEL: Record<string, string> = {
  consolidate: 'Consolidating',
  expand:      'Expanding',
  war:         'At war',
  alliance:    'In alliance',
  rebuild:     'Rebuilding',
  isolation:   'Isolated',
};

export function FactionOverlay({ worldId, open, onClose }: Props) {
  const [factions, setFactions] = useState<FactionNode[]>([]);
  const [relations, setRelations] = useState<FactionRelation[]>([]);
  const [source, setSource] = useState<'live' | 'sample'>('sample');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.post('/api/lens/run', {
        domain: 'world',
        action: 'faction-overlay-data',
        input: { worldId },
      });
      const result = (res.data as {
        result?: { factions?: FactionNode[]; relations?: FactionRelation[]; source?: 'live' | 'sample' };
      })?.result;
      setFactions(result?.factions || []);
      setRelations(result?.relations || []);
      setSource(result?.source || 'sample');
    } catch (e) {
      console.error('[FactionOverlay] fetch failed', e);
    } finally {
      setLoading(false);
    }
  }, [worldId]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  if (!open) return null;

  const selectedNode = selected ? factions.find((f) => f.id === selected) : null;
  const selectedRelations = selectedNode
    ? relations.filter((r) => r.a === selected || r.b === selected)
    : [];

  return (
    <div className="fixed top-20 right-4 w-[420px] max-w-[100vw] z-40 bg-[#0d1117]/95 backdrop-blur border border-cyan-500/30 rounded-lg shadow-2xl overflow-hidden flex flex-col">
      <header className="px-4 py-2 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-violet-950/40 to-transparent">
        <div className="flex items-center gap-2">
          <Map className="w-4 h-4 text-violet-400" />
          <span className="text-xs uppercase font-semibold text-gray-200 tracking-wider">
            Faction overlay
          </span>
          <span
            className={cn(
              'text-[10px] px-1.5 py-0.5 rounded',
              source === 'live'
                ? 'bg-emerald-500/15 text-emerald-300'
                : 'bg-amber-500/15 text-amber-300',
            )}
          >
            {source}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-md hover:bg-white/5 text-gray-400"
          aria-label="Close faction overlay"
        >
          <X className="w-4 h-4" />
        </button>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-8 text-xs text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
        </div>
      ) : (
        <div className="flex flex-col">
          <svg viewBox="0 0 800 600" className="w-full bg-black/30">
            {/* Relations as lines under nodes */}
            {relations.map((r) => {
              const a = factions.find((f) => f.id === r.a);
              const b = factions.find((f) => f.id === r.b);
              if (!a || !b) return null;
              const style = RELATION_STYLE[r.kind];
              return (
                <line
                  key={`${r.a}-${r.b}`}
                  x1={a.cx}
                  y1={a.cy}
                  x2={b.cx}
                  y2={b.cy}
                  stroke={style.color}
                  strokeWidth={1 + Math.abs(r.score) * 3}
                  strokeDasharray={style.dash}
                  opacity={0.6}
                />
              );
            })}
            {/* Faction territory circles */}
            {factions.map((f) => (
              <g key={f.id} className="cursor-pointer" onClick={() => setSelected(f.id === selected ? null : f.id)}>
                <circle
                  cx={f.cx}
                  cy={f.cy}
                  r={f.radius}
                  fill={f.color}
                  fillOpacity={selected === f.id ? 0.35 : 0.18}
                  stroke={f.color}
                  strokeWidth={selected === f.id ? 3 : 1.5}
                />
                <text
                  x={f.cx}
                  y={f.cy}
                  fill="#f3f4f6"
                  fontSize="12"
                  fontWeight="600"
                  textAnchor="middle"
                  className="pointer-events-none select-none"
                >
                  {f.name}
                </text>
                <text
                  x={f.cx}
                  y={f.cy + 16}
                  fill="#9ca3af"
                  fontSize="10"
                  textAnchor="middle"
                  className="pointer-events-none select-none"
                >
                  {STANCE_LABEL[f.stance] || f.stance}
                </text>
              </g>
            ))}
          </svg>

          {selectedNode ? (
            <div className="px-4 py-3 border-t border-white/10 bg-black/40">
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: selectedNode.color }}
                />
                <span className="text-sm font-semibold text-gray-100">{selectedNode.name}</span>
                <span className="text-[10px] text-gray-500 ml-auto">
                  momentum {selectedNode.momentum >= 0 ? '+' : ''}
                  {selectedNode.momentum.toFixed(2)}
                </span>
              </div>
              <p className="text-xs text-gray-400 mb-2">
                Stance: <span className="text-gray-200">{STANCE_LABEL[selectedNode.stance] || selectedNode.stance}</span>
              </p>
              {selectedRelations.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Relations</p>
                  <ul className="space-y-1">
                    {selectedRelations.map((r) => {
                      const otherId = r.a === selectedNode.id ? r.b : r.a;
                      const other = factions.find((f) => f.id === otherId);
                      if (!other) return null;
                      const style = RELATION_STYLE[r.kind];
                      return (
                        <li
                          key={`${r.a}-${r.b}`}
                          className="flex items-center justify-between text-xs"
                        >
                          <span className="text-gray-300">{other.name}</span>
                          <span style={{ color: style.color }}>{style.label}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="px-4 py-3 border-t border-white/10 bg-black/40 text-[11px] text-gray-500 inline-flex items-center gap-2">
              <Swords className="w-3 h-3" />
              Click a faction to view its stance, momentum, and relations.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default FactionOverlay;
