'use client';

import React, { useRef, useEffect, useCallback } from 'react';
import type { District, PlacedBuildingDTU, InfrastructureDTU, ValidationStatus } from '@/lib/world-lens/types';

// ── Constants ───────────────────────────────────────────────────────

const TILE_W = 48;
const TILE_H = 24;
const HALF_W = TILE_W / 2;
const HALF_H = TILE_H / 2;

const INFRA_COLORS: Record<string, string> = {
  water: '#3B82F6',
  power: '#EAB308',
  drainage: '#22C55E',
  road: '#9CA3AF',
  data: '#A855F7',
};

const VALIDATION_COLORS: Record<ValidationStatus, string> = {
  validated: '#22C55E',
  experimental: '#EAB308',
  superseded: '#6B7280',
  foundation: '#3B82F6',
  'at-risk': '#EF4444',
};

const SOIL_COLORS: Record<string, string> = {
  clay: '#8B6914',
  sand: '#C2B280',
  rock: '#808080',
  loam: '#5C4033',
  gravel: '#A0A0A0',
};

interface DistrictViewportProps {
  district: District | null;
  selectedBuildingId: string | null;
  onBuildingClick: (building: PlacedBuildingDTU) => void;
  onInfrastructureClick: (infra: InfrastructureDTU) => void;
  onTerrainClick: (x: number, y: number) => void;
  showValidationOverlay: boolean;
  showWeatherOverlay: boolean;
  visibleLayers: Set<string>;
  zoom: number;
  rotation: 0 | 1 | 2 | 3; // 4 isometric angles
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export default function DistrictViewport({
  district,
  selectedBuildingId,
  onBuildingClick,
  onInfrastructureClick,
  onTerrainClick,
  showValidationOverlay,
  showWeatherOverlay,
  visibleLayers,
  zoom,
  rotation,
}: DistrictViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const panRef = useRef({ x: 0, y: 0, dragging: false, startX: 0, startY: 0 });

  const toScreen = useCallback((tileX: number, tileY: number): [number, number] => {
    const z = zoom;
    const tw = TILE_W * z;
    const th = TILE_H * z;
    const hw = tw / 2;
    const hh = th / 2;

    // Apply rotation
    let rx = tileX, ry = tileY;
    if (rotation === 1) { rx = tileY; ry = -tileX; }
    else if (rotation === 2) { rx = -tileX; ry = -tileY; }
    else if (rotation === 3) { rx = -tileY; ry = tileX; }

    return [
      (rx - ry) * hw + panRef.current.x,
      (rx + ry) * hh + panRef.current.y,
    ];
  }, [zoom, rotation]);

  const toTile = useCallback((screenX: number, screenY: number): [number, number] => {
    const z = zoom;
    const tw = TILE_W * z;
    const th = TILE_H * z;
    const hw = tw / 2;
    const hh = th / 2;

    const sx = screenX - panRef.current.x;
    const sy = screenY - panRef.current.y;
    let tileX = Math.floor((sx / hw + sy / hh) / 2);
    let tileY = Math.floor((sy / hh - sx / hw) / 2);

    // Reverse rotation
    if (rotation === 1) { const tmp = tileX; tileX = -tileY; tileY = tmp; }
    else if (rotation === 2) { tileX = -tileX; tileY = -tileY; }
    else if (rotation === 3) { const tmp = tileX; tileX = tileY; tileY = -tmp; }

    return [tileX, tileY];
  }, [zoom, rotation]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !district) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    const w = rect.width;
    const h = rect.height;

    // Center the grid
    const gridW = district.terrain.dimensions.width;
    const gridH = district.terrain.dimensions.height;
    if (panRef.current.x === 0 && panRef.current.y === 0) {
      panRef.current.x = w / 2;
      panRef.current.y = h / 4;
    }

    // Clear
    ctx.fillStyle = '#0a0f1a';
    ctx.fillRect(0, 0, w, h);

    const z = zoom;
    const tw = TILE_W * z;
    const th = TILE_H * z;

    // ── Draw terrain grid ─────────────────────────────────────
    for (let ty = 0; ty < gridH; ty++) {
      for (let tx = 0; tx < gridW; tx++) {
        const [sx, sy] = toScreen(tx, ty);
        if (sx < -tw || sx > w + tw || sy < -th || sy > h + th) continue;

        const cell = district.terrain.grid[ty]?.[tx];
        const baseColor = cell ? SOIL_COLORS[cell.soilType] || '#2a2a2a' : '#1a1a1a';

        // Elevation coloring
        const elev = cell ? cell.elevation / 15 : 0;
        const r = parseInt(baseColor.slice(1, 3), 16);
        const g = parseInt(baseColor.slice(3, 5), 16);
        const b = parseInt(baseColor.slice(5, 7), 16);
        const er = Math.min(255, r + elev * 30);
        const eg = Math.min(255, g + elev * 20);
        const eb = Math.min(255, b + elev * 10);

        // Diamond tile
        ctx.beginPath();
        ctx.moveTo(sx, sy - HALF_H * z);
        ctx.lineTo(sx + HALF_W * z, sy);
        ctx.lineTo(sx, sy + HALF_H * z);
        ctx.lineTo(sx - HALF_W * z, sy);
        ctx.closePath();
        ctx.fillStyle = `rgb(${er},${eg},${eb})`;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    }

    // ── Draw infrastructure ─────────────────────────────────
    const infraGroups = [
      { key: 'water', items: district.infrastructure.waterMains },
      { key: 'power', items: district.infrastructure.powerGrid },
      { key: 'drainage', items: district.infrastructure.drainage },
      { key: 'road', items: district.infrastructure.roads },
      { key: 'data', items: district.infrastructure.dataNetwork },
    ];

    for (const { key, items } of infraGroups) {
      if (!visibleLayers.has(key)) continue;
      const color = INFRA_COLORS[key];

      for (const infra of items) {
        if (infra.path.length < 2) continue;
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = key === 'road' ? 4 * z : 2 * z;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalAlpha = 0.7;

        const [startX, startY] = toScreen(infra.path[0].x, infra.path[0].y);
        ctx.moveTo(startX, startY);
        for (let i = 1; i < infra.path.length; i++) {
          const [px, py] = toScreen(infra.path[i].x, infra.path[i].y);
          ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // ── Draw buildings ──────────────────────────────────────
    const sortedBuildings = [...district.buildings].sort((a, b) =>
      (a.position.y + a.position.x) - (b.position.y + b.position.x)
    );

    for (const bldg of sortedBuildings) {
      const [sx, sy] = toScreen(bldg.position.x, bldg.position.y);
      if (sx < -60 || sx > w + 60 || sy < -80 || sy > h + 80) continue;

      const bw = 20 * z;
      const bh = 10 * z;
      const height = 35 * z;

      let color = '#4A90D9';
      if (showValidationOverlay) {
        color = VALIDATION_COLORS[bldg.validationStatus] || '#6B7280';
      }

      const isSelected = bldg.id === selectedBuildingId;
      if (isSelected) {
        // Selection glow
        ctx.shadowColor = '#00FFFF';
        ctx.shadowBlur = 15;
      }

      // Left face
      ctx.beginPath();
      ctx.moveTo(sx - bw, sy);
      ctx.lineTo(sx, sy + bh);
      ctx.lineTo(sx, sy + bh - height);
      ctx.lineTo(sx - bw, sy - height);
      ctx.closePath();
      ctx.fillStyle = hexToRgba(color, 0.7);
      ctx.fill();

      // Right face
      ctx.beginPath();
      ctx.moveTo(sx + bw, sy);
      ctx.lineTo(sx, sy + bh);
      ctx.lineTo(sx, sy + bh - height);
      ctx.lineTo(sx + bw, sy - height);
      ctx.closePath();
      ctx.fillStyle = hexToRgba(color, 0.5);
      ctx.fill();

      // Top face
      ctx.beginPath();
      ctx.moveTo(sx, sy - height - bh);
      ctx.lineTo(sx + bw, sy - height);
      ctx.lineTo(sx, sy + bh - height);
      ctx.lineTo(sx - bw, sy - height);
      ctx.closePath();
      ctx.fillStyle = hexToRgba(color, 0.9);
      ctx.fill();

      ctx.shadowBlur = 0;

      // Creator label
      if (z >= 0.8) {
        ctx.font = `${9 * z}px monospace`;
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.textAlign = 'center';
        ctx.fillText(bldg.creator, sx, sy - height - bh - 4 * z);
      }
    }

    // ── Weather overlay ─────────────────────────────────────
    if (showWeatherOverlay && district.weather) {
      const windDir = (district.weather.avgWindDirection * Math.PI) / 180;
      const windSpeed = district.weather.avgWindSpeed;

      // Wind arrows
      ctx.strokeStyle = 'rgba(100,200,255,0.3)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 8; i++) {
        const bx = 60 + (i * (w - 120)) / 7;
        const by = h - 40;
        const arrowLen = windSpeed * 1.5;
        const ex = bx + Math.cos(windDir) * arrowLen;
        const ey = by - Math.sin(windDir) * arrowLen;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        // Arrow head
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - Math.cos(windDir - 0.4) * 6, ey + Math.sin(windDir - 0.4) * 6);
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - Math.cos(windDir + 0.4) * 6, ey + Math.sin(windDir + 0.4) * 6);
        ctx.stroke();
      }

      // Weather info
      ctx.font = '11px monospace';
      ctx.fillStyle = 'rgba(100,200,255,0.6)';
      ctx.textAlign = 'left';
      ctx.fillText(`Wind: ${windSpeed} m/s | Rain: ${district.weather.annualRainfall}mm/yr | Seismic: ${district.weather.seismicRisk}`, 10, h - 10);
    }
  }, [district, selectedBuildingId, showValidationOverlay, showWeatherOverlay, visibleLayers, zoom, rotation, toScreen]);

  // ── Mouse handlers ────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !district) return;

    const handleMouseDown = (e: MouseEvent) => {
      panRef.current.dragging = true;
      panRef.current.startX = e.clientX - panRef.current.x;
      panRef.current.startY = e.clientY - panRef.current.y;
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (panRef.current.dragging) {
        panRef.current.x = e.clientX - panRef.current.startX;
        panRef.current.y = e.clientY - panRef.current.startY;
      }
    };

    const handleMouseUp = () => { panRef.current.dragging = false; };

    const handleClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const [tx, ty] = toTile(mx, my);

      // Check building click
      for (const bldg of district.buildings) {
        if (Math.abs(bldg.position.x - tx) < 2 && Math.abs(bldg.position.y - ty) < 2) {
          onBuildingClick(bldg);
          return;
        }
      }

      // Check infrastructure click
      const allInfra = [
        ...district.infrastructure.waterMains,
        ...district.infrastructure.powerGrid,
        ...district.infrastructure.drainage,
        ...district.infrastructure.roads,
        ...district.infrastructure.dataNetwork,
      ];
      for (const infra of allInfra) {
        for (const pt of infra.path) {
          if (Math.abs(pt.x - tx) < 1.5 && Math.abs(pt.y - ty) < 1.5) {
            onInfrastructureClick(infra);
            return;
          }
        }
      }

      onTerrainClick(tx, ty);
    };

    canvas.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('click', handleClick);

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('click', handleClick);
    };
  }, [district, toTile, onBuildingClick, onInfrastructureClick, onTerrainClick]);

  if (!district) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0a0f1a]">
        <p className="text-gray-400">No district loaded</p>
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      className="flex-1 w-full h-full cursor-grab active:cursor-grabbing"
      style={{ imageRendering: 'pixelated' }}
    />
  );
}
