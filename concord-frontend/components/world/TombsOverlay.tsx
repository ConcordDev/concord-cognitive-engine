'use client';

/**
 * TombsOverlay — Sprint B.5 mount-up
 *
 * The original 3D TombMarker was authored against R3F's `<Canvas>`,
 * but the live ConcordiaScene runs an imperative Three.js setup
 * (raw <canvas> ref + scene root managed by hand). This overlay
 * surfaces the same npc_legacies data as a DOM panel so players
 * see their world's death log while the proper 3D obelisk integration
 * follows in a later commit.
 *
 * Reads from `npc_legacy.tombs_for_world` and `npc_legacy.get` macros
 * (server/domains/npc-legacy.js, registered in publicReadDomains).
 *
 * Refresh on:
 *   - mount
 *   - every 90s (poll fallback)
 *   - every `entity:death` socket event (immediate)
 *
 * Click a tomb row → opens a modal with the deceased's last words +
 * heirs + inherited preoccupations.
 */

import { useCallback, useEffect, useState } from 'react';

interface TombRow {
  id: string;
  npc_id: string;
  tomb_x: number;
  tomb_z: number;
  last_words: string;
  faction: string | null;
  archetype: string | null;
  died_at: number;
}

interface LegacyDetail {
  npc_id: string;
  last_words: string;
  heirs_json: string | null;
  inherited_preoccupations_json: string | null;
  faction: string | null;
  archetype: string | null;
  died_at: number;
}

interface Props {
  worldId: string;
  pollIntervalMs?: number;
}

export default function TombsOverlay({ worldId, pollIntervalMs = 90_000 }: Props) {
  const [tombs, setTombs] = useState<TombRow[]>([]);
  const [collapsed, setCollapsed] = useState(true);
  const [openLegacyNpcId, setOpenLegacyNpcId] = useState<string | null>(null);
  const [openLegacy, setOpenLegacy] = useState<LegacyDetail | null>(null);

  const refresh = useCallback(async () => {
    if (!worldId) return;
    try {
      const r = await fetch('/api/lens/run', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'npc_legacy',
          name: 'tombs_for_world',
          input: { worldId, limit: 100 },
        }),
      });
      if (!r.ok) return;
      const data = await r.json();
      if (Array.isArray(data?.tombs)) setTombs(data.tombs);
    } catch { /* anonymous browsers / network blips: silent */ }
  }, [worldId]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(refresh, pollIntervalMs);
    const onDeath = () => { void refresh(); };
    window.addEventListener('entity:death', onDeath);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('entity:death', onDeath);
    };
  }, [refresh, pollIntervalMs]);

  // Fetch full legacy detail when the player clicks a tomb.
  useEffect(() => {
    if (!openLegacyNpcId) { setOpenLegacy(null); return; }
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch('/api/lens/run', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            domain: 'npc_legacy',
            name: 'get',
            input: { npcId: openLegacyNpcId },
          }),
        });
        if (!r.ok) return;
        const data = await r.json();
        if (!cancelled && data?.legacy) setOpenLegacy(data.legacy as LegacyDetail);
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [openLegacyNpcId]);

  if (tombs.length === 0) return null;

  return (
    <>
      {/* Floating panel — bottom-left, collapsible. Mirrors the
          aesthetic of the EmergentEventFeed panel. */}
      <div
        className={`absolute left-4 bottom-32 z-30 max-h-[40vh] overflow-hidden rounded border border-zinc-800 bg-zinc-950/90 backdrop-blur text-xs text-zinc-200 ${
          collapsed ? 'w-44' : 'w-80'
        }`}
        style={{ pointerEvents: 'auto' }}
      >
        <button
          type="button"
          className="w-full flex items-center justify-between px-3 py-2 hover:bg-zinc-900 text-left"
          onClick={() => setCollapsed((c) => !c)}
        >
          <span className="font-medium text-stone-300">
            Tombs — {tombs.length}
          </span>
          <span className="text-zinc-500">{collapsed ? '▸' : '▾'}</span>
        </button>
        {!collapsed && (
          <div className="border-t border-zinc-800 max-h-[36vh] overflow-y-auto">
            {tombs.slice(0, 50).map((tomb) => (
              <button
                key={tomb.id}
                type="button"
                className="w-full text-left px-3 py-2 hover:bg-zinc-900 border-b border-zinc-900 last:border-b-0"
                onClick={() => setOpenLegacyNpcId(tomb.npc_id)}
              >
                <div className="text-stone-200 truncate">
                  {tomb.archetype || 'Unknown'}{tomb.faction ? ` · ${tomb.faction}` : ''}
                </div>
                <div className="text-zinc-500 truncate text-[11px]">
                  {tomb.last_words ? `"${tomb.last_words}"` : '(no last words)'}
                </div>
                <div className="text-zinc-600 text-[10px] mt-0.5">
                  {formatRelative(tomb.died_at)}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Modal — opens when the player clicks a tomb. */}
      {openLegacyNpcId && openLegacy && (
        <LegacyModal legacy={openLegacy} onClose={() => setOpenLegacyNpcId(null)} />
      )}
    </>
  );
}

function LegacyModal({ legacy, onClose }: { legacy: LegacyDetail; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const heirs = legacy.heirs_json ? safeJsonParse<string[]>(legacy.heirs_json) : null;
  const preocs = legacy.inherited_preoccupations_json
    ? safeJsonParse<Array<{ npc_id: string; preoccupation: string }>>(legacy.inherited_preoccupations_json)
    : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55"
      style={{ pointerEvents: 'auto' }}
      onClick={onClose}
    >
      <div
        className="bg-zinc-950 border border-zinc-800 rounded-lg p-6 max-w-lg text-zinc-200 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-medium mb-2">
          {legacy.archetype || 'NPC'} — last words
        </h2>
        <p className="text-zinc-500 text-xs mb-4">
          {legacy.faction && (
            <>Faction: <code className="bg-zinc-900 px-1.5 py-0.5 rounded">{legacy.faction}</code> · </>
          )}
          Died {formatRelative(legacy.died_at)}
        </p>
        <blockquote className="bg-zinc-900 border-l-[3px] border-amber-500 rounded px-3 py-2 italic text-stone-100 mb-4">
          {legacy.last_words || '(no last words recorded)'}
        </blockquote>
        {heirs && heirs.length > 0 && (
          <p className="text-sm mb-1">
            <strong className="text-stone-200">Heirs:</strong> {heirs.join(', ')}
          </p>
        )}
        {preocs && preocs.length > 0 && (
          <p className="text-sm mb-1">
            <strong className="text-stone-200">Preoccupations passed on:</strong> {preocs.length}
          </p>
        )}
        <div className="text-right mt-4">
          <button
            type="button"
            className="bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold px-4 py-2 rounded"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function safeJsonParse<T>(raw: string): T | null {
  try { return JSON.parse(raw) as T; } catch { return null; }
}

function formatRelative(ts: number): string {
  const now = Date.now();
  const ms = now - ts;
  if (ms < 60_000) return 'just now';
  if (ms < 60 * 60_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 24 * 60 * 60_000) return `${Math.floor(ms / (60 * 60_000))}h ago`;
  return `${Math.floor(ms / (24 * 60 * 60_000))}d ago`;
}
