'use client';

/**
 * BestiaryPanel — Wave 2 / T1.2. Per-player log of creatures the player
 * has seen / tamed / bred. Toggle with B. Each entry shows the procedural
 * creature mesh as a small WebGL thumbnail next to the species ref +
 * sightings + first-seen date.
 *
 * Three tabs:
 *   Discovered — hybrids + authored species sighted (kind in 'hybrid'|'authored')
 *   Tamed      — companions the player tamed (kind = 'tamed')
 *   Bred       — offspring the player bred (kind = 'bred')
 *
 * Reads from /api/lens/run domain=bestiary. Refreshes on
 * `concordia:bestiary-changed` event.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface Discovery {
  id: string;
  world_id: string;
  kind: 'hybrid' | 'authored' | 'tamed' | 'bred';
  species_ref: string;
  first_seen_at: number;
  last_seen_at: number;
  sightings: number;
  meta_json: string | null;
  meta: Record<string, unknown> | null;
}

interface Stats { hybrid: number; authored: number; tamed: number; bred: number; total: number; }

type Tab = 'discovered' | 'tamed' | 'bred';

interface Props {
  onClose?: () => void;
}

const TAB_LABEL: Record<Tab, string> = {
  discovered: 'Discovered',
  tamed:      'Tamed',
  bred:       'Bred',
};

const KIND_FOR_TAB: Record<Tab, Array<Discovery['kind']>> = {
  discovered: ['hybrid', 'authored'],
  tamed:      ['tamed'],
  bred:       ['bred'],
};

const KIND_GLYPH: Record<Discovery['kind'], string> = {
  hybrid:   '✦',
  authored: '◇',
  tamed:    '♥',
  bred:     '⚭',
};

async function callMacro<T = unknown>(domain: string, name: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await fetch('/api/lens/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ domain, name, input }),
    });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch { return null; }
}

export default function BestiaryPanel({ onClose }: Props) {
  const [tab, setTab] = useState<Tab>('discovered');
  const [discoveries, setDiscoveries] = useState<Discovery[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [listRes, statsRes] = await Promise.all([
      callMacro<{ ok: boolean; discoveries: Discovery[] }>('bestiary', 'list', { limit: 200 }),
      callMacro<{ ok: boolean; stats: Stats }>('bestiary', 'stats', {}),
    ]);
    if (listRes?.ok) setDiscoveries(listRes.discoveries ?? []);
    if (statsRes?.ok) setStats(statsRes.stats ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const onChange = () => { void refresh(); };
    window.addEventListener('concordia:bestiary-changed', onChange);
    return () => window.removeEventListener('concordia:bestiary-changed', onChange);
  }, [refresh]);

  const filtered = useMemo(() => {
    const kinds = new Set<Discovery['kind']>(KIND_FOR_TAB[tab]);
    return discoveries.filter((d) => kinds.has(d.kind));
  }, [discoveries, tab]);

  return (
    <div className="bg-slate-950/95 border border-emerald-500/30 rounded-lg p-4 backdrop-blur-md w-[440px] max-h-[80vh] flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold text-emerald-300 uppercase tracking-wider">Bestiary</h3>
        {onClose && <button onClick={onClose} className="text-slate-400 hover:text-white text-sm">✕</button>}
      </div>

      {stats && (
        <div className="text-[10px] text-slate-400 mb-2 font-mono">
          {stats.total} total · {stats.hybrid} hybrid · {stats.authored} authored · {stats.tamed} tamed · {stats.bred} bred
        </div>
      )}

      <div className="flex gap-1 mb-3">
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 px-2 py-1 rounded text-[10px] uppercase tracking-wider transition-colors ${
              tab === t
                ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/40'
                : 'bg-slate-900/60 text-slate-400 border border-white/5 hover:bg-slate-800/60'
            }`}
          >
            {TAB_LABEL[t]} · {KIND_FOR_TAB[t].reduce((n, k) => n + (stats?.[k] ?? 0), 0)}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto pr-1">
        {loading && <div className="text-xs text-slate-400 text-center py-6">Loading…</div>}
        {!loading && filtered.length === 0 && (
          <div className="text-xs text-slate-400 text-center py-8 leading-relaxed">
            {tab === 'discovered' && 'No species encountered yet — wander until you see one.'}
            {tab === 'tamed' && 'No companions yet — get close to a creature and offer food.'}
            {tab === 'bred' && 'No offspring yet — tame two creatures and breed them.'}
          </div>
        )}
        <div className="space-y-1.5">
          {filtered.map((d) => (
            <BestiaryEntry key={d.id} entry={d} />
          ))}
        </div>
      </div>

      <div className="mt-3 pt-2 border-t border-white/5 text-[10px] text-slate-500 leading-relaxed">
        Sightings auto-debounce within 60s · breed two companions to spawn a procedural hybrid
      </div>
    </div>
  );
}

function BestiaryEntry({ entry }: { entry: Discovery }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Render a small 3D thumbnail when the entry mounts. Re-uses the same
  // procedural mesh builder as the in-world hybrids.
  useEffect(() => {
    if (!canvasRef.current) return;
    let mounted = true;

    (async () => {
      try {
        const THREE = await import('three');
        const { buildCreatureMesh } = await import('@/lib/world-lens/hybrid-creatures');
        if (!mounted || !canvasRef.current) return;

        const w = 80, h = 80;
        const renderer = new THREE.WebGLRenderer({ canvas: canvasRef.current, alpha: true, antialias: false });
        renderer.setSize(w, h);
        renderer.setClearColor(0x000000, 0);

        const scene = new THREE.Scene();
        scene.add(new THREE.AmbientLight(0xffffff, 0.6));
        const dir = new THREE.DirectionalLight(0xffffff, 0.8);
        dir.position.set(2, 3, 2);
        scene.add(dir);

        const camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 50);
        camera.position.set(2.5, 1.8, 2.5);
        camera.lookAt(0, 0.5, 0);

        const meta = entry.meta || {};
        const blueprint = {
          id: entry.species_ref,
          topology: (meta.topology as string) || 'quadruped',
          massKg: Number(meta.mass) || 30,
          heightM: 1.0,
          worldId: entry.world_id,
        };
        const mesh = buildCreatureMesh(blueprint);
        scene.add(mesh);

        let raf: number | null = null;
        const tick = () => {
          if (!mounted) return;
          mesh.rotation.y += 0.01;
          renderer.render(scene, camera);
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);

        cleanupRef.current = () => {
          if (raf != null) cancelAnimationFrame(raf);
          try { renderer.dispose(); } catch { /* ok */ }
        };
      } catch { /* preview is best-effort */ }
    })();

    return () => {
      mounted = false;
      try { cleanupRef.current?.(); } catch { /* ok */ }
    };
  }, [entry.id, entry.species_ref, entry.meta, entry.world_id]);

  const firstSeen = new Date(entry.first_seen_at * 1000);
  const meta = entry.meta || {};
  const label = (meta.topology as string) || entry.kind;

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded border border-white/5 bg-slate-900/50">
      <canvas ref={canvasRef} width={80} height={80} className="rounded bg-slate-800/40" />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold text-white truncate">
          <span className="text-emerald-300 mr-1">{KIND_GLYPH[entry.kind]}</span>
          {entry.species_ref}
        </div>
        <div className="text-[10px] text-slate-400 truncate">
          {label.replace(/_/g, ' ')} · {entry.sightings} sighting{entry.sightings === 1 ? '' : 's'}
        </div>
        <div className="text-[9px] text-slate-500 font-mono">
          {entry.kind} · {firstSeen.toLocaleDateString()}
        </div>
      </div>
    </div>
  );
}
