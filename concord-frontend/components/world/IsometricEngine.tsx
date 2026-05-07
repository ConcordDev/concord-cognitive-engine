'use client';

import React, { useRef, useEffect, useCallback } from 'react';

// --- Types ---

interface NPC {
  id: string;
  name: string;
  type: 'merchant' | 'quest_giver' | 'guard' | 'civilian' | 'entity';
  position: { x: number; y: number };
  district: string;
  questAvailable?: boolean;
  questComplete?: boolean;
}

interface PlayerPosition {
  userId: string;
  username: string;
  x: number;
  y: number;
  direction: string;
  district: string;
  avatarColor?: string;
}

interface IsometricEngineProps {
  playerPosition: { x: number; y: number };
  onPlayerMove: (x: number, y: number) => void;
  npcs: NPC[];
  nearbyPlayers: PlayerPosition[];
  onDistrictEnter: (district: { id: string; name: string; lens: string }) => void;
  onBuildingClick: (district: { id: string; name: string; lens: string }) => void;
  onNPCClick: (npc: NPC) => void;
  onPlayerClick: (player: PlayerPosition) => void;
  activeDistrict: string | null;
  factionTerritories?: Record<string, string>;
  wantedLevel?: number;
  dayNightCycle?: number;
}

interface DistrictDef {
  id: string;
  name: string;
  lens: string;
  gx: number;
  gy: number;
  w: number;
  h: number;
  color: string;
}

// --- Constants ---

const TILE_W = 64;
const TILE_H = 32;
const HALF_W = TILE_W / 2;
const HALF_H = TILE_H / 2;
const BASE_W = 960;
const BASE_H = 640;
const GRID_SIZE = 22;
const MOVE_SPEED = 0.1;
const CAMERA_LAG = 0.08;
const BANNER_DURATION = 3000;

const DISTRICTS: DistrictDef[] = [
  { id: 'council',     name: 'Council Hall',       lens: 'government',  gx: 5, gy: 0, w: 3, h: 3, color: '#8B5CF6' },
  { id: 'research',    name: 'Research Campus',     lens: 'research',    gx: 2, gy: 2, w: 3, h: 3, color: '#3B82F6' },
  { id: 'music',       name: 'Music Quarter',       lens: 'music',       gx: 8, gy: 2, w: 3, h: 3, color: '#EC4899' },
  { id: 'finance',     name: 'Finance Tower',       lens: 'finance',     gx: 2, gy: 5, w: 3, h: 3, color: '#10B981' },
  { id: 'art',         name: 'Art Quarter',         lens: 'art',         gx: 8, gy: 5, w: 3, h: 3, color: '#F59E0B' },
  { id: 'legal',       name: 'Legal District',      lens: 'legal',       gx: 2, gy: 8, w: 3, h: 3, color: '#6366F1' },
  { id: 'code',        name: 'Code Workshop',       lens: 'code',        gx: 8, gy: 8, w: 3, h: 3, color: '#14B8A6' },
  { id: 'marketplace', name: 'Marketplace Square',  lens: 'marketplace', gx: 4, gy: 10, w: 5, h: 4, color: '#F97316' },
  { id: 'trades',      name: 'Trades Workshop',     lens: 'trades',      gx: 1, gy: 13, w: 3, h: 3, color: '#78716C' },
  { id: 'health',      name: 'Health Clinic',       lens: 'healthcare',  gx: 9, gy: 13, w: 3, h: 3, color: '#EF4444' },
  { id: 'news',        name: 'News Tower',          lens: 'news',        gx: 1, gy: 16, w: 3, h: 3, color: '#0EA5E9' },
  { id: 'feed',        name: 'Feed Plaza',          lens: 'feed',        gx: 9, gy: 16, w: 3, h: 3, color: '#A855F7' },
  { id: 'forum',       name: 'Forum Arena',         lens: 'forum',       gx: 2, gy: 19, w: 3, h: 3, color: '#D946EF' },
  { id: 'education',   name: 'Education Hall',      lens: 'education',   gx: 8, gy: 19, w: 3, h: 3, color: '#22D3EE' },
];

const NPC_COLORS: Record<string, string> = {
  merchant: '#FFD700',
  guard: '#4488FF',
  quest_giver: '#FFEE44',
  civilian: '#AAAAAA',
  entity: '#00FFFF',
};

// --- Helpers ---

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function districtAt(tx: number, ty: number): DistrictDef | null {
  for (const d of DISTRICTS) {
    if (tx >= d.gx && tx < d.gx + d.w && ty >= d.gy && ty < d.gy + d.h) return d;
  }
  return null;
}

// --- Component ---

export default function IsometricEngine({
  playerPosition,
  onPlayerMove,
  npcs,
  nearbyPlayers,
  onDistrictEnter,
  onBuildingClick,
  onNPCClick,
  onPlayerClick,
  activeDistrict,
  factionTerritories,
  dayNightCycle = 0.5,
}: IsometricEngineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Refs to avoid stale closures in the animation loop for frequently-changing props
  const onPlayerMoveRef = useRef(onPlayerMove);
  const onDistrictEnterRef = useRef(onDistrictEnter);
  const onBuildingClickRef = useRef(onBuildingClick);
  const onNPCClickRef = useRef(onNPCClick);
  const onPlayerClickRef = useRef(onPlayerClick);
  const npcsRef = useRef(npcs);
  const nearbyPlayersRef = useRef(nearbyPlayers);
  const activeDistrictRef = useRef(activeDistrict);
  const factionTerritoriesRef = useRef(factionTerritories);
  const dayNightCycleRef = useRef(dayNightCycle);

  useEffect(() => { onPlayerMoveRef.current = onPlayerMove; }, [onPlayerMove]);
  useEffect(() => { onDistrictEnterRef.current = onDistrictEnter; }, [onDistrictEnter]);
  useEffect(() => { onBuildingClickRef.current = onBuildingClick; }, [onBuildingClick]);
  useEffect(() => { onNPCClickRef.current = onNPCClick; }, [onNPCClick]);
  useEffect(() => { onPlayerClickRef.current = onPlayerClick; }, [onPlayerClick]);
  useEffect(() => { npcsRef.current = npcs; }, [npcs]);
  useEffect(() => { nearbyPlayersRef.current = nearbyPlayers; }, [nearbyPlayers]);
  useEffect(() => { activeDistrictRef.current = activeDistrict; }, [activeDistrict]);
  useEffect(() => { factionTerritoriesRef.current = factionTerritories; }, [factionTerritories]);
  useEffect(() => { dayNightCycleRef.current = dayNightCycle; }, [dayNightCycle]);

  const stateRef = useRef({
    px: playerPosition.x,
    py: playerPosition.y,
    tx: playerPosition.x,
    ty: playerPosition.y,
    cx: playerPosition.x,
    cy: playerPosition.y,
    keys: new Set<string>(),
    lastDistrict: null as string | null,
    bannerText: '',
    bannerTimer: 0,
    lastClickTime: 0,
    lastClickX: 0,
    lastClickY: 0,
    groundCache: null as HTMLCanvasElement | null,
    groundCacheCx: -9999,
    groundCacheCy: -9999,
  });

  // Sync prop changes
  useEffect(() => {
    stateRef.current.tx = playerPosition.x;
    stateRef.current.ty = playerPosition.y;
  }, [playerPosition.x, playerPosition.y]);

  const toScreen = useCallback((tileX: number, tileY: number, offX: number, offY: number): [number, number] => {
    return [
      (tileX - tileY) * HALF_W + offX,
      (tileX + tileY) * HALF_H + offY,
    ];
  }, []);

  const toTile = useCallback((screenX: number, screenY: number, offX: number, offY: number): [number, number] => {
    const sx = screenX - offX;
    const sy = screenY - offY;
    return [
      Math.floor((sx / HALF_W + sy / HALF_H) / 2),
      Math.floor((sy / HALF_H - sx / HALF_W) / 2),
    ];
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    if (!ctx) return;

    canvas.width = BASE_W;
    canvas.height = BASE_H;

    const s = stateRef.current;
    let animId = 0;

    // --- Input ---
    const onKeyDown = (e: KeyboardEvent) => { s.keys.add(e.key.toLowerCase()); };
    const onKeyUp = (e: KeyboardEvent) => { s.keys.delete(e.key.toLowerCase()); };

    const handleClick = (cx: number, cy: number, isDouble: boolean) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = BASE_W / rect.width;
      const scaleY = BASE_H / rect.height;
      const mx = (cx - rect.left) * scaleX;
      const my = (cy - rect.top) * scaleY;
      const offX = BASE_W / 2 - (s.cx - s.cy) * HALF_W;
      const offY = BASE_H / 2 - (s.cx + s.cy) * HALF_H + 80;
      const [tileX, tileY] = toTile(mx, my, offX, offY);

      if (isDouble) {
        const d = districtAt(tileX, tileY);
        if (d) { onBuildingClickRef.current({ id: d.id, name: d.name, lens: d.lens }); return; }
      }

      // Check NPC click
      for (const npc of npcsRef.current) {
        const [nx, ny] = toScreen(npc.position.x, npc.position.y, offX, offY);
        if (Math.abs(mx - nx) < 12 && Math.abs(my - ny) < 12) { onNPCClickRef.current(npc); return; }
      }

      // Check player click
      for (const p of nearbyPlayersRef.current) {
        const [px, py] = toScreen(p.x, p.y, offX, offY);
        if (Math.abs(mx - px) < 12 && Math.abs(my - py) < 12) { onPlayerClickRef.current(p); return; }
      }

      // Move to tile
      if (tileX >= 0 && tileX < GRID_SIZE && tileY >= 0 && tileY < GRID_SIZE) {
        s.tx = tileX + 0.5;
        s.ty = tileY + 0.5;
        onPlayerMoveRef.current(s.tx, s.ty);
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      const now = Date.now();
      const isDouble = now - s.lastClickTime < 350 &&
        Math.abs(e.clientX - s.lastClickX) < 10 &&
        Math.abs(e.clientY - s.lastClickY) < 10;
      s.lastClickTime = now;
      s.lastClickX = e.clientX;
      s.lastClickY = e.clientY;
      handleClick(e.clientX, e.clientY, isDouble);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        const t = e.touches[0];
        handleClick(t.clientX, t.clientY, false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('touchstart', onTouchStart, { passive: true });

    // --- Drawing helpers ---

    function drawDiamond(ctx: CanvasRenderingContext2D, sx: number, sy: number, fill: string, stroke?: string) {
      ctx.beginPath();
      ctx.moveTo(sx, sy - HALF_H);
      ctx.lineTo(sx + HALF_W, sy);
      ctx.lineTo(sx, sy + HALF_H);
      ctx.lineTo(sx - HALF_W, sy);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 0.5; ctx.stroke(); }
    }

    function drawBuilding(ctx: CanvasRenderingContext2D, sx: number, sy: number, color: string, h: number) {
      const bw = 28;
      const bh = 14;
      // Left face
      ctx.beginPath();
      ctx.moveTo(sx - bw, sy);
      ctx.lineTo(sx, sy + bh);
      ctx.lineTo(sx, sy + bh - h);
      ctx.lineTo(sx - bw, sy - h);
      ctx.closePath();
      ctx.fillStyle = hexToRgba(color, 0.7);
      ctx.fill();
      // Right face
      ctx.beginPath();
      ctx.moveTo(sx + bw, sy);
      ctx.lineTo(sx, sy + bh);
      ctx.lineTo(sx, sy + bh - h);
      ctx.lineTo(sx + bw, sy - h);
      ctx.closePath();
      ctx.fillStyle = hexToRgba(color, 0.5);
      ctx.fill();
      // Top face
      ctx.beginPath();
      ctx.moveTo(sx, sy - h - bh);
      ctx.lineTo(sx + bw, sy - h);
      ctx.lineTo(sx, sy + bh - h);
      ctx.lineTo(sx - bw, sy - h);
      ctx.closePath();
      ctx.fillStyle = hexToRgba(color, 0.9);
      ctx.fill();
    }

    // --- Ground cache ---

    function renderGroundCache(offX: number, offY: number): HTMLCanvasElement {
      const gc = document.createElement('canvas');
      gc.width = BASE_W;
      gc.height = BASE_H;
      const gctx = gc.getContext('2d')!;
      for (let ty = 0; ty < GRID_SIZE; ty++) {
        for (let tx = 0; tx < GRID_SIZE; tx++) {
          const [sx, sy] = toScreen(tx, ty, offX, offY);
          if (sx < -TILE_W || sx > BASE_W + TILE_W || sy < -TILE_H || sy > BASE_H + TILE_H) continue;
          drawDiamond(gctx, sx, sy, '#1a2a1a', '#2a3a2a');
          const d = districtAt(tx, ty);
          if (d) drawDiamond(gctx, sx, sy, hexToRgba(d.color, 0.15));
        }
      }
      return gc;
    }

    // --- Main loop ---

    function frame() {
      // WASD input
      if (s.keys.has('w') || s.keys.has('arrowup'))    { s.ty -= MOVE_SPEED; s.tx -= MOVE_SPEED; }
      if (s.keys.has('s') || s.keys.has('arrowdown'))   { s.ty += MOVE_SPEED; s.tx += MOVE_SPEED; }
      if (s.keys.has('a') || s.keys.has('arrowleft'))   { s.tx -= MOVE_SPEED; s.ty += MOVE_SPEED; }
      if (s.keys.has('d') || s.keys.has('arrowright'))  { s.tx += MOVE_SPEED; s.ty -= MOVE_SPEED; }

      if (s.keys.size > 0) onPlayerMoveRef.current(s.tx, s.ty);

      // Lerp player toward target
      s.px = lerp(s.px, s.tx, 0.12);
      s.py = lerp(s.py, s.ty, 0.12);

      // Camera follow
      s.cx = lerp(s.cx, s.px, CAMERA_LAG);
      s.cy = lerp(s.cy, s.py, CAMERA_LAG);

      const offX = BASE_W / 2 - (s.cx - s.cy) * HALF_W;
      const offY = BASE_H / 2 - (s.cx + s.cy) * HALF_H + 80;

      // District detection
      const curDist = districtAt(Math.floor(s.px), Math.floor(s.py));
      const curId = curDist?.id ?? null;
      if (curId !== s.lastDistrict) {
        s.lastDistrict = curId;
        if (curDist) {
          onDistrictEnterRef.current({ id: curDist.id, name: curDist.name, lens: curDist.lens });
          s.bannerText = curDist.name;
          s.bannerTimer = Date.now();
        }
      }

      // Refresh ground cache if camera moved enough
      if (!s.groundCache ||
          Math.abs(s.cx - s.groundCacheCx) > 1.5 ||
          Math.abs(s.cy - s.groundCacheCy) > 1.5) {
        s.groundCache = renderGroundCache(offX, offY);
        s.groundCacheCx = s.cx;
        s.groundCacheCy = s.cy;
      }

      // --- Draw ---
      ctx.fillStyle = '#0a0a0f';
      ctx.fillRect(0, 0, BASE_W, BASE_H);

      // Day/night tint
      const nightAlpha = Math.max(0, 0.3 - Math.abs(dayNightCycleRef.current - 0.5) * 0.6);

      // Ground (cached)
      ctx.drawImage(s.groundCache, 0, 0);

      // Faction territories overlay
      if (factionTerritoriesRef.current) {
        for (const [key, color] of Object.entries(factionTerritoriesRef.current)) {
          const [ftx, fty] = key.split(',').map(Number);
          const [sx, sy] = toScreen(ftx, fty, offX, offY);
          if (sx < -TILE_W || sx > BASE_W + TILE_W || sy < -TILE_H || sy > BASE_H + TILE_H) continue;
          drawDiamond(ctx, sx, sy, hexToRgba(color, 0.2));
        }
      }

      // Buildings + labels (sorted by Y for depth)
      const sortedDistricts = [...DISTRICTS].sort((a, b) =>
        (a.gy + a.h / 2 + a.gx + a.w / 2) - (b.gy + b.h / 2 + b.gx + b.w / 2)
      );

      for (const d of sortedDistricts) {
        const bcx = d.gx + d.w / 2;
        const bcy = d.gy + d.h / 2;
        const [sx, sy] = toScreen(bcx, bcy, offX, offY);
        if (sx < -80 || sx > BASE_W + 80 || sy < -80 || sy > BASE_H + 80) continue;

        const bldgH = d.id === 'marketplace' ? 50 : 40;
        drawBuilding(ctx, sx, sy, d.color, bldgH);

        // Label
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(d.name, sx, sy - bldgH - 8);

        // Active district highlight
        if (activeDistrictRef.current === d.id) {
          ctx.strokeStyle = d.color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(sx, sy - bldgH / 2, 30, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // NPCs
      for (const npc of npcsRef.current) {
        const [nx, ny] = toScreen(npc.position.x, npc.position.y, offX, offY);
        if (nx < -20 || nx > BASE_W + 20 || ny < -20 || ny > BASE_H + 20) continue;

        const col = NPC_COLORS[npc.type] || '#AAAAAA';
        ctx.beginPath();
        ctx.arc(nx, ny, 4, 0, Math.PI * 2);
        ctx.fillStyle = col;
        ctx.fill();

        // Entity glow
        if (npc.type === 'entity') {
          ctx.beginPath();
          ctx.arc(nx, ny, 8, 0, Math.PI * 2);
          ctx.strokeStyle = hexToRgba('#00FFFF', 0.4);
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // Quest indicators
        if (npc.questAvailable) {
          ctx.font = '12px sans-serif';
          ctx.fillStyle = '#FF4444';
          ctx.textAlign = 'center';
          ctx.fillText('❗', nx, ny - 10);
        } else if (npc.questComplete) {
          ctx.font = '12px sans-serif';
          ctx.fillStyle = '#FFFF00';
          ctx.textAlign = 'center';
          ctx.fillText('❓', nx, ny - 10);
        }

        // Name
        ctx.font = '8px sans-serif';
        ctx.fillStyle = '#cccccc';
        ctx.textAlign = 'center';
        ctx.fillText(npc.name, nx, ny + 12);
      }

      // Other players
      for (const p of nearbyPlayersRef.current) {
        const [px, py] = toScreen(p.x, p.y, offX, offY);
        if (px < -20 || px > BASE_W + 20 || py < -20 || py > BASE_H + 20) continue;
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fillStyle = p.avatarColor || '#888888';
        ctx.fill();
        ctx.font = '9px sans-serif';
        ctx.fillStyle = '#dddddd';
        ctx.textAlign = 'center';
        ctx.fillText(p.username, px, py - 10);
      }

      // Player avatar
      const [plx, ply] = toScreen(s.px, s.py, offX, offY);
      ctx.beginPath();
      ctx.arc(plx, ply, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#00FFFF';
      ctx.fill();
      ctx.strokeStyle = '#00AAAA';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Direction indicator (triangle pointing toward target)
      const dx = s.tx - s.px;
      const dy = s.ty - s.py;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 0.05) {
        const angle = Math.atan2(dy, dx);
        const triX = plx + Math.cos(angle) * 10;
        const triY = ply + Math.sin(angle) * 10;
        ctx.beginPath();
        ctx.moveTo(triX + Math.cos(angle) * 4, triY + Math.sin(angle) * 4);
        ctx.lineTo(triX + Math.cos(angle + 2.3) * 3, triY + Math.sin(angle + 2.3) * 3);
        ctx.lineTo(triX + Math.cos(angle - 2.3) * 3, triY + Math.sin(angle - 2.3) * 3);
        ctx.closePath();
        ctx.fillStyle = '#00FFFF';
        ctx.fill();
      }

      // Night overlay
      if (nightAlpha > 0.01) {
        ctx.fillStyle = `rgba(0,0,30,${nightAlpha})`;
        ctx.fillRect(0, 0, BASE_W, BASE_H);
      }

      // District banner
      if (s.bannerText && Date.now() - s.bannerTimer < BANNER_DURATION) {
        const elapsed = Date.now() - s.bannerTimer;
        const alpha = elapsed < 300 ? elapsed / 300 : elapsed > BANNER_DURATION - 500 ? (BANNER_DURATION - elapsed) / 500 : 1;
        ctx.fillStyle = `rgba(10,10,20,${0.8 * alpha})`;
        const tw = ctx.measureText(s.bannerText).width;
        ctx.fillRect(BASE_W / 2 - tw / 2 - 20, 20, tw + 40, 36);
        ctx.font = 'bold 16px sans-serif';
        ctx.fillStyle = `rgba(255,255,255,${alpha})`;
        ctx.textAlign = 'center';
        ctx.fillText(s.bannerText, BASE_W / 2, 44);
      }

      animId = requestAnimationFrame(frame);
    }

    animId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('touchstart', onTouchStart);
    };
    // All frequently-changing values are read via refs inside the animation loop,
    // so this effect only needs to run once on mount.
  }, [toScreen, toTile]);

  return (
    <div style={{ width: '100%', height: '100%', overflow: 'hidden', background: '#0a0a0f' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block', imageRendering: 'pixelated' }}
        tabIndex={0}
      />
    </div>
  );
}
