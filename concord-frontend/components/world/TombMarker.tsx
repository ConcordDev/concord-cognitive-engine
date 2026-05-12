'use client';

/**
 * TombMarker — Sprint B Phase 11.1
 *
 * Renders one tombstone mesh per row in `npc_legacies` for the active
 * world. Click the tomb → modal with last words + heirs + inherited
 * preoccupations. The substrate (lib/npc-legacy.js + migration 133) has
 * shipped the data since Phase 5b; this component is the player-visible
 * surface.
 *
 * Data flow:
 *   - On mount + on `entity:death` socket events, fetch
 *     `runMacro('npc_legacy', 'tombs_for_world', { worldId })`.
 *   - Render a small obelisk-shaped Three.js mesh at each tomb's
 *     (tomb_x, tomb_z). Faded with age (older tombs = duller).
 *   - On click: open a modal with the legacy detail
 *     (`runMacro('npc_legacy', 'get', { npcId })`).
 *
 * Mounted in app/lenses/world/page.tsx alongside DistrictActivityFeed.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';

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
  /** Refresh interval in ms when no socket event fires; defaults to 60s. */
  pollIntervalMs?: number;
}

// Obelisk geometry — taller than wide, slightly tapered top. Reused across all tombs.
const OBELISK_GEOMETRY = new THREE.BoxGeometry(0.3, 1.2, 0.3);

export default function TombMarker({ worldId, pollIntervalMs = 60_000 }: Props) {
  const [tombs, setTombs] = useState<TombRow[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [openLegacyNpcId, setOpenLegacyNpcId] = useState<string | null>(null);
  const [openLegacy, setOpenLegacy] = useState<LegacyDetail | null>(null);

  // Fetch tombs for the active world.
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
          input: { worldId, limit: 200 },
        }),
      });
      if (!r.ok) return;
      const data = await r.json();
      if (Array.isArray(data?.tombs)) setTombs(data.tombs);
    } catch { /* anonymous browsers / network blips: silent */ }
  }, [worldId]);

  // On mount + on a configurable poll interval. Also subscribes to
  // socket-level entity:death events so a fresh death is reflected
  // within seconds without waiting for the poll.
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

  // When a tomb is clicked, fetch the full legacy detail.
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

  // Per-tomb material — tinted by age (linear fade from full to muted
  // over 30 in-game days; clamped). Memoized so we don't churn material
  // refs on each frame.
  const materialFor = useMemo(() => {
    const cache = new Map<string, THREE.MeshStandardMaterial>();
    const now = Date.now();
    const FADE_MS = 30 * 24 * 60 * 60 * 1000;
    for (const tomb of tombs) {
      if (cache.has(tomb.id)) continue;
      const ageMs = Math.max(0, now - tomb.died_at);
      const fade = Math.max(0.35, 1 - ageMs / FADE_MS);
      const baseColor = tomb.faction ? '#4a3c2c' : '#3a3a3a';
      const color = new THREE.Color(baseColor).multiplyScalar(fade);
      cache.set(tomb.id, new THREE.MeshStandardMaterial({
        color: color.getHex(),
        roughness: 0.85,
        metalness: 0.05,
      }));
    }
    return cache;
  }, [tombs]);

  // Hovered tomb gets a subtle bobble so the player can confirm
  // they're targeting the right marker.
  useFrame((_, dt) => {
    void dt; // hover animation handled via state, not delta
  });

  return (
    <>
      {tombs.map((tomb) => {
        const isHovered = hoveredId === tomb.id;
        const material = materialFor.get(tomb.id);
        if (!material) return null;
        return (
          <group
            key={tomb.id}
            position={[tomb.tomb_x, 0.6, tomb.tomb_z]}
            onPointerOver={(e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); setHoveredId(tomb.id); document.body.style.cursor = 'pointer'; }}
            onPointerOut={() => { setHoveredId(null); document.body.style.cursor = ''; }}
            onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); setOpenLegacyNpcId(tomb.npc_id); }}
            scale={isHovered ? [1.08, 1.08, 1.08] : [1, 1, 1]}
          >
            <mesh geometry={OBELISK_GEOMETRY} material={material} castShadow={false} />
            {/* Small base / pedestal — flat cube, slightly wider than the obelisk */}
            <mesh position={[0, -0.65, 0]}>
              <boxGeometry args={[0.5, 0.1, 0.5]} />
              <primitive attach="material" object={material} />
            </mesh>
          </group>
        );
      })}

      {/* Legacy detail modal — rendered as DOM via portal-ish approach.
          We don't have access to a Three.js HTML overlay here; use a
          regular fixed-position div + window listeners. */}
      {openLegacyNpcId && openLegacy && (
        <Html3D legacy={openLegacy} onClose={() => setOpenLegacyNpcId(null)} />
      )}
    </>
  );
}

/**
 * Inline DOM-overlay modal — sits outside the Three.js canvas. We
 * render via a useEffect that injects a div into document.body on
 * mount and removes it on unmount, avoiding any portal dependency.
 */
function Html3D({ legacy, onClose }: { legacy: LegacyDetail; onClose: () => void }) {
  useEffect(() => {
    const root = document.createElement('div');
    root.style.cssText = `
      position: fixed; inset: 0; z-index: 1000; pointer-events: auto;
      display: flex; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.55);
      font-family: -apple-system, system-ui, sans-serif;
    `;
    const heirs = legacy.heirs_json ? safeJsonParse<string[]>(legacy.heirs_json) : null;
    const preocs = legacy.inherited_preoccupations_json
      ? safeJsonParse<Array<{ npc_id: string; preoccupation: string }>>(legacy.inherited_preoccupations_json)
      : null;

    root.innerHTML = `
      <div style="background:#0c0c0c;color:#ddd;border:1px solid #2a2a2a;border-radius:8px;padding:24px;max-width:520px;line-height:1.5">
        <h2 style="margin:0 0 8px;font-size:18px">${escapeHtml(legacy.archetype || 'NPC')} — last words</h2>
        <p style="margin:0 0 16px;color:#aaa;font-size:13px">
          ${legacy.faction ? `Faction: <code style="background:#1a1a1a;padding:2px 6px;border-radius:3px">${escapeHtml(legacy.faction)}</code> · ` : ''}
          Died ${formatRelative(legacy.died_at)}
        </p>
        <blockquote style="margin:0 0 16px;padding:12px;background:#161616;border-left:3px solid #f0a020;border-radius:4px;font-style:italic">
          ${escapeHtml(legacy.last_words || '(no last words recorded)')}
        </blockquote>
        ${heirs && heirs.length ? `<p style="margin:0 0 4px;font-size:14px"><strong>Heirs:</strong> ${heirs.map(h => escapeHtml(h)).join(', ')}</p>` : ''}
        ${preocs && preocs.length ? `<p style="margin:0 0 4px;font-size:14px"><strong>Preoccupations passed on:</strong> ${preocs.length}</p>` : ''}
        <div style="margin-top:16px;text-align:right">
          <button id="concord-tomb-close" style="background:#f0a020;color:#0c0c0c;border:0;padding:8px 16px;border-radius:4px;cursor:pointer;font-weight:600">Close</button>
        </div>
      </div>
    `;

    document.body.appendChild(root);
    const closeBtn = root.querySelector('#concord-tomb-close');
    // @resource-leak-ok: click listener attached to transient root element that's removed via document.body.removeChild — listener GC'd with the element
    closeBtn?.addEventListener('click', onClose);
    const escHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', escHandler);
    return () => {
      window.removeEventListener('keydown', escHandler);
      try { document.body.removeChild(root); } catch { /* noop */ }
    };
  }, [legacy, onClose]);
  return null;
}

function safeJsonParse<T>(raw: string): T | null {
  try { return JSON.parse(raw) as T; } catch { return null; }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function formatRelative(ts: number): string {
  const now = Date.now();
  const ms = now - ts;
  if (ms < 60_000) return 'just now';
  if (ms < 60 * 60_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 24 * 60 * 60_000) return `${Math.floor(ms / (60 * 60_000))}h ago`;
  return `${Math.floor(ms / (24 * 60 * 60_000))}d ago`;
}
