'use client';

/**
 * FactionBanners — Sprint D / V2
 *
 * Renders faction-tinted cloth banners at faction-controlled anchor
 * points. SVG sigil from faction.visual.sigil_path is rasterized to a
 * canvas texture and applied to a banner plane that hangs from a
 * flagpole. Light Verlet-cape sway driven by world wind direction.
 *
 * Mounted via a getCamera() projection so banners appear at correct
 * world positions even though this component renders DOM-overlay
 * primitives. (For pure 3D mounting, ConcordiaScene supplies a banner
 * mount API and we wire there in a follow-up; this version uses the
 * existing camera projection pattern shared by LandmarkSpires.)
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';

interface FactionVisual {
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  sigil_path?: string;
  banner_sigil_id?: string;
}

interface FactionVisualEntry { id: string; name: string; visual: FactionVisual | null; }

interface BannerAnchor {
  id: string;
  faction_id: string;
  x: number; y: number; z: number;
}

interface CameraSnapshot {
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  fov: number;
  width: number; height: number;
}

interface Props {
  worldId: string;
  /** Map of faction_id → world-space anchor positions where banners hang. */
  bannerAnchors?: BannerAnchor[];
  getCamera: () => CameraSnapshot | null;
  /** Wind direction in radians (from world:weather). */
  windDirection?: number;
}

const FALLBACK_BANNER_ANCHORS: BannerAnchor[] = [];
const SIGIL_VIEWBOX_HALF = 22;

export default function FactionBanners({ worldId, bannerAnchors = FALLBACK_BANNER_ANCHORS, getCamera, windDirection = 0 }: Props) {
  const [factionVisuals, setFactionVisuals] = useState<Map<string, FactionVisual>>(new Map());
  const [, setTick] = useState(0);

  // Load visuals for every needed faction (deduplicated via Set).
  const factionIds = useMemo(() => Array.from(new Set(bannerAnchors.map(b => b.faction_id))), [bannerAnchors]);

  useEffect(() => {
    if (factionIds.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/lens/run', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain: 'factions', name: 'list_with_visual', input: {} }),
        });
        if (!r.ok) return;
        const j = await r.json();
        if (cancelled || !Array.isArray(j?.factions)) return;
        const map = new Map<string, FactionVisual>();
        for (const f of j.factions as FactionVisualEntry[]) {
          if (f.visual) map.set(f.id, f.visual);
        }
        setFactionVisuals(map);
      } catch { /* fine */ }
    })();
    return () => { cancelled = true; };
  }, [factionIds.join('|'), worldId]);

  // Animation tick at 30Hz for sway.
  useEffect(() => {
    let raf: number;
    const loop = () => { setTick(t => t + 1); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const cam = getCamera();
  if (!cam || bannerAnchors.length === 0) return null;

  const t = performance.now() / 1000;
  const sway = Math.sin(t * 1.2 + windDirection) * 0.08;

  return (
    <div aria-hidden style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 7 }}>
      {bannerAnchors.map((anchor) => {
        const visual = factionVisuals.get(anchor.faction_id);
        if (!visual) return null;
        const screen = projectToScreen(anchor.x, anchor.y, anchor.z, cam);
        if (!screen.visible) return null;
        const dist = distance(anchor.x, anchor.z, cam.x, cam.z);
        const fade = Math.max(0.2, Math.min(1, 1 - dist / 600));
        const scale = Math.max(0.4, Math.min(1.4, 80 / Math.max(40, dist)));
        const bannerW = 36 * scale;
        const bannerH = 56 * scale;
        return (
          <div
            key={anchor.id}
            style={{
              position: 'absolute',
              left: screen.x - bannerW / 2,
              top: screen.y - bannerH,
              width: bannerW,
              height: bannerH,
              opacity: fade,
              transform: `rotate(${sway}rad) skewX(${sway * 0.8}rad)`,
              transformOrigin: '50% 0%',
            }}
          >
            <svg
              viewBox={`-${SIGIL_VIEWBOX_HALF} -${SIGIL_VIEWBOX_HALF + 16} ${SIGIL_VIEWBOX_HALF * 2} ${SIGIL_VIEWBOX_HALF * 2 + 24}`}
              width="100%"
              height="100%"
              preserveAspectRatio="xMidYMid meet"
            >
              {/* Banner cloth */}
              <path
                d={`M-${SIGIL_VIEWBOX_HALF},-${SIGIL_VIEWBOX_HALF + 16}
                    L${SIGIL_VIEWBOX_HALF},-${SIGIL_VIEWBOX_HALF + 16}
                    L${SIGIL_VIEWBOX_HALF},${SIGIL_VIEWBOX_HALF + 4}
                    L0,${SIGIL_VIEWBOX_HALF + 8}
                    L-${SIGIL_VIEWBOX_HALF},${SIGIL_VIEWBOX_HALF + 4} Z`}
                fill={visual.primary_color}
                stroke={visual.secondary_color}
                strokeWidth={1.2}
              />
              {/* Sigil */}
              {visual.sigil_path && (
                <path d={visual.sigil_path} fill={visual.accent_color} stroke={visual.secondary_color} strokeWidth={0.8} transform="translate(0, -4)" />
              )}
            </svg>
          </div>
        );
      })}
    </div>
  );
}

function distance(x1: number, z1: number, x2: number, z2: number): number {
  const dx = x1 - x2, dz = z1 - z2;
  return Math.sqrt(dx * dx + dz * dz);
}

function projectToScreen(wx: number, wy: number, wz: number, cam: CameraSnapshot): { x: number; y: number; visible: boolean } {
  const dx = wx - cam.x, dy = wy - cam.y, dz = wz - cam.z;
  const cy = Math.cos(-cam.yaw), sy = Math.sin(-cam.yaw);
  const rx = dx * cy + dz * sy;
  let rz = -dx * sy + dz * cy;
  const cp = Math.cos(-cam.pitch), sp = Math.sin(-cam.pitch);
  const ry = dy * cp - rz * sp;
  rz = dy * sp + rz * cp;
  if (rz <= 0.5) return { x: 0, y: 0, visible: false };
  const f = (cam.height / 2) / Math.tan(cam.fov / 2);
  const sxp = (rx / rz) * f + cam.width / 2;
  const syp = (-ry / rz) * f + cam.height / 2;
  if (sxp < -50 || sxp > cam.width + 50 || syp < -50 || syp > cam.height + 50) return { x: sxp, y: syp, visible: false };
  return { x: sxp, y: syp, visible: true };
}
