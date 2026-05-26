'use client';

/**
 * PerkConstellation — Skyrim-style star-tree skill view.
 *
 * Full-screen overlay (toggle with K). Each skill/power category is
 * its own constellation, positioned around a central anchor. Within
 * a constellation, each entry is a star whose brightness scales with
 * level, connected by lines to neighbours of the same category.
 *
 * Pulls data from GET /api/character-sheet/me (powers + skills) and
 * lays them out deterministically — same input → same constellation,
 * so the player learns the shape of their tree.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

interface Entry {
  name: string;
  level: number;
  xp: number;
  xpToNext: number;
  category: string;
  kind: 'power' | 'skill';
}

interface Props {
  open: boolean;
  onClose: () => void;
}

const CATEGORY_COLOR: Record<string, string> = {
  // Skill categories
  combat:      '#fb923c',
  movement:    '#34d399',
  crafting:    '#fbbf24',
  social:      '#a78bfa',
  perception:  '#22d3ee',
  survival:    '#84cc16',
  magical:     '#c084fc',
  mental:      '#f9a8d4',
  performance: '#f472b6',
  technical:   '#2dd4bf',
  // Power categories
  physical:      '#fb7185',
  mental_power:  '#e879f9',
  transmutation: '#a855f7',
  energy:        '#22d3ee',
  support:       '#86efac',
  metaphysical:  '#facc15',
  amorphous:     '#f9a8d4',
};

interface Star { x: number; y: number; entry: Entry; }
interface Constellation {
  category: string;
  cx: number; cy: number;
  color: string;
  stars: Star[];
}

/** Deterministic hash-based RNG keyed by string. */
function seededAngle(seed: string, salt: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  h = (h * 9301 + salt * 49297 + 233280) | 0;
  return (Math.abs(h) % 360) * (Math.PI / 180);
}

export default function PerkConstellation({ open, onClose }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<Entry | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/character-sheet/me', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((data) => {
        if (data?.ok && data.sheet) {
          const out: Entry[] = [];
          for (const p of data.sheet.powers || []) {
            out.push({
              name: p.skill_type,
              level: p.level || 0,
              xp: p.xp || 0,
              xpToNext: p.xp_to_next || 100,
              category: p.power_category || 'amorphous',
              kind: 'power',
            });
          }
          for (const s of data.sheet.skills || []) {
            out.push({
              name: s.skill_type,
              level: s.level || 0,
              xp: s.xp || 0,
              xpToNext: s.xp_to_next || 100,
              category: s.skill_category || 'amorphous',
              kind: 'skill',
            });
          }
          setEntries(out);
          setError(null);
        } else {
          setError(data?.error || 'failed_to_load');
        }
      })
      .catch((e) => setError(String(e?.message || e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  // Layout: group entries by category, place each category's centroid on
  // a ring around the origin, then scatter each entry around its centroid
  // using a seeded angle so the constellation is stable across renders.
  const constellations = useMemo<Constellation[]>(() => {
    const byCategory = new Map<string, Entry[]>();
    for (const e of entries) {
      const list = byCategory.get(e.category) || [];
      list.push(e);
      byCategory.set(e.category, list);
    }
    const cats = [...byCategory.keys()].sort();
    const out: Constellation[] = [];
    const RING_R = 280;     // centroid distance from origin
    const SCATTER_R = 110;  // entry distance from centroid
    cats.forEach((cat, i) => {
      const ang = (i / Math.max(1, cats.length)) * 2 * Math.PI - Math.PI / 2;
      const cx = Math.cos(ang) * RING_R;
      const cy = Math.sin(ang) * RING_R;
      const list = byCategory.get(cat) || [];
      const stars = list.map((entry, idx) => {
        const a = seededAngle(entry.name, idx);
        const r = SCATTER_R * (0.4 + 0.6 * ((idx % 3) / 2));
        return {
          x: cx + Math.cos(a) * r,
          y: cy + Math.sin(a) * r,
          entry,
        };
      });
      out.push({
        category: cat,
        cx, cy,
        color: CATEGORY_COLOR[cat] || '#94a3b8',
        stars,
      });
    });
    return out;
  }, [entries]);

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const totalLevel = entries.reduce((s, e) => s + e.level, 0);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-md overflow-hidden">
      {/* Header */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-4 z-10">
        <h2 className="text-sm font-bold text-cyan-300 uppercase tracking-widest">Constellations</h2>
        <span className="text-[10px] text-slate-400 font-mono">total Lv {totalLevel}</span>
      </div>
      <button
        className="absolute top-3 right-3 text-slate-400 hover:text-white text-sm z-10"
        onClick={onClose}
      >
        ✕  Esc
      </button>

      {/* Background star-field */}
      <BackgroundStars />

      {/* Constellation canvas */}
      <div className="absolute inset-0 flex items-center justify-center">
        {loading && <div className="text-slate-400 text-sm">Loading constellations…</div>}
        {error && <div className="text-red-300 text-sm">{error}</div>}
        {!loading && !error && entries.length === 0 && (
          <div className="text-slate-400 text-sm text-center">
            No skills or powers yet. Train any skill in the world to seed your sky.
          </div>
        )}
        {!loading && !error && entries.length > 0 && (
          <svg
            width={900} height={720}
            viewBox="-450 -360 900 720"
            className="overflow-visible"
          >
            {/* Connecting lines per constellation (nearest-neighbour chain) */}
            {constellations.map((c) => (
              <g key={c.category}>
                {c.stars.slice(1).map((star, i) => {
                  const prev = c.stars[i];
                  return (
                    <line
                      key={i}
                      x1={prev.x} y1={prev.y} x2={star.x} y2={star.y}
                      stroke={c.color}
                      strokeOpacity={0.25}
                      strokeWidth={1}
                    />
                  );
                })}
              </g>
            ))}

            {/* Category centroid labels */}
            {constellations.map((c) => (
              <text
                key={`${c.category}-label`}
                x={c.cx} y={c.cy - 130}
                fill={c.color}
                fontSize={11}
                textAnchor="middle"
                style={{
                  fontFamily: 'monospace',
                  textTransform: 'uppercase',
                  letterSpacing: '0.15em',
                  opacity: 0.7,
                }}
              >
                {c.category.replace(/_/g, ' ')}
              </text>
            ))}

            {/* Stars */}
            {constellations.flatMap((c) =>
              c.stars.map((star, i) => {
                const lvl = star.entry.level;
                const radius = 3 + Math.min(lvl, 10) * 0.6;
                const glow = 4 + Math.min(lvl, 10) * 1.2;
                const isPower = star.entry.kind === 'power';
                return (
                  <g
                    key={`${c.category}-${i}`}
                    onMouseEnter={() => setHover(star.entry)}
                    onMouseLeave={() => setHover(null)}
                    style={{ cursor: 'pointer' }}
                  >
                    {/* Glow */}
                    <circle
                      cx={star.x} cy={star.y}
                      r={radius + glow}
                      fill={c.color}
                      opacity={0.18}
                    />
                    {/* Star body */}
                    <circle
                      cx={star.x} cy={star.y}
                      r={radius}
                      fill={isPower ? c.color : '#fff'}
                      stroke={c.color}
                      strokeWidth={isPower ? 0 : 1.5}
                    />
                    {/* Name label */}
                    <text
                      x={star.x} y={star.y + radius + 12}
                      fill="#cbd5e1"
                      fontSize={9}
                      textAnchor="middle"
                      style={{ pointerEvents: 'none' }}
                    >
                      {star.entry.name}
                    </text>
                  </g>
                );
              }),
            )}
          </svg>
        )}
      </div>

      {/* Hover detail */}
      {hover && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-slate-900/95 border border-cyan-500/40 rounded-md px-4 py-2 text-sm">
          <div className="flex items-center gap-3">
            <span
              className="font-semibold"
              style={{ color: CATEGORY_COLOR[hover.category] || '#fff' }}
            >
              {hover.name}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-slate-400">
              {hover.kind} · {hover.category}
            </span>
            <span className="text-[10px] font-mono text-slate-300">
              Lv {hover.level} · {hover.xp}/{hover.xpToNext} xp
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function BackgroundStars() {
  // 60 deterministic faint stars across the background — flavor only.
  const dots = useMemo(() => {
    const out: Array<{ x: number; y: number; r: number; o: number }> = [];
    let seed = 1729;
    const rand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (let i = 0; i < 60; i++) {
      out.push({ x: rand() * 100, y: rand() * 100, r: rand() * 1.2 + 0.3, o: rand() * 0.5 + 0.1 });
    }
    return out;
  }, []);
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none">
      {dots.map((d, i) => (
        <circle key={i} cx={`${d.x}%`} cy={`${d.y}%`} r={d.r} fill="#fff" opacity={d.o} />
      ))}
    </svg>
  );
}
