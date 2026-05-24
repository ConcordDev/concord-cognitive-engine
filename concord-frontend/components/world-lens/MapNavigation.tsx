'use client';

import React, { useState, useCallback, useMemo } from 'react';
import {
  Map, MapPin, Navigation, ZoomIn, ZoomOut, Layers, Eye, EyeOff,
  ChevronRight, Crosshair, Users,
} from 'lucide-react';

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

// ── Types ──────────────────────────────────────────────────────────

export type MapMode = 'minimap' | 'district' | 'world';

export interface Position {
  x: number;
  y: number;
}

export interface BuildingMarker {
  id: string;
  position: Position;
  label: string;
  type: string;
}

export interface NPCMarker {
  id: string;
  position: Position;
  name: string;
  occupation: string;
}

export interface PlayerMarker {
  id: string;
  position: Position;
  name: string;
}

export interface Waypoint {
  id: string;
  position: Position;
  label: string;
}

export interface DistrictRegion {
  id: string;
  name: string;
  center: Position;
  playerCount: number;
  connections: string[];
}

type InfraLayer = 'water' | 'power' | 'drainage' | 'roads' | 'data';

interface MapNavigationProps {
  playerPosition: Position;
  district: string;
  buildings: BuildingMarker[];
  npcs: NPCMarker[];
  players: PlayerMarker[];
  waypoints: Waypoint[];
  onWaypointPlace: (pos: Position) => void;
  mapMode: MapMode;
  onMapModeChange?: (mode: MapMode) => void;
  districts?: DistrictRegion[];
}

// ── Infrastructure Colors ──────────────────────────────────────────

const infraColors: Record<InfraLayer, { color: string; label: string }> = {
  water: { color: 'text-blue-400', label: 'Water' },
  power: { color: 'text-yellow-400', label: 'Power' },
  drainage: { color: 'text-green-400', label: 'Drainage' },
  roads: { color: 'text-gray-400', label: 'Roads' },
  data: { color: 'text-purple-400', label: 'Data' },
};

const _infraBgColors: Record<InfraLayer, string> = {
  water: 'bg-blue-400',
  power: 'bg-yellow-400',
  drainage: 'bg-green-400',
  roads: 'bg-gray-400',
  data: 'bg-purple-400',
};

// ── Legend ──────────────────────────────────────────────────────────

function MapLegend() {
  return (
    <div className={`${panel} p-2 text-[10px] space-y-1`}>
      <div className="text-gray-400 font-medium mb-1">Legend</div>
      <div className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-white" />
        <span className="text-gray-300">You</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-blue-400" />
        <span className="text-gray-300">Players</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-gray-500" />
        <span className="text-gray-300">NPCs</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-amber-500" />
        <span className="text-gray-300">Buildings</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-red-400" />
        <span className="text-gray-300">Waypoints</span>
      </div>
    </div>
  );
}

// ── Minimap ────────────────────────────────────────────────────────

function Minimap({
  playerPosition,
  buildings,
  npcs,
  players,
  waypoints,
  onWaypointPlace,
}: {
  playerPosition: Position;
  buildings: BuildingMarker[];
  npcs: NPCMarker[];
  players: PlayerMarker[];
  waypoints: Waypoint[];
  onWaypointPlace: (pos: Position) => void;
}) {
  const scale = 0.2;

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - rect.left) / scale;
      const y = (e.clientY - rect.top) / scale;
      onWaypointPlace({ x, y });
    },
    [onWaypointPlace, scale],
  );

  return (
    <div
      className={`${panel} w-[200px] h-[200px] relative overflow-hidden cursor-crosshair`}
      onClick={handleClick} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
      {/* Buildings as amber dots */}
      {buildings.map((b) => (
        <div
          key={b.id}
          className="absolute w-1.5 h-1.5 rounded-full bg-amber-500/70"
          style={{ left: b.position.x * scale, top: b.position.y * scale }}
        />
      ))}
      {/* NPCs as gray dots */}
      {npcs.map((n) => (
        <div
          key={n.id}
          className="absolute w-1.5 h-1.5 rounded-full bg-gray-500"
          style={{ left: n.position.x * scale, top: n.position.y * scale }}
        />
      ))}
      {/* Other players as blue dots */}
      {players.map((p) => (
        <div
          key={p.id}
          className="absolute w-1.5 h-1.5 rounded-full bg-blue-400"
          style={{ left: p.position.x * scale, top: p.position.y * scale }}
        />
      ))}
      {/* Waypoints */}
      {waypoints.map((w) => (
        <div
          key={w.id}
          className="absolute w-2 h-2 rounded-full bg-red-400/80 border border-red-300"
          style={{ left: w.position.x * scale - 4, top: w.position.y * scale - 4 }}
        />
      ))}
      {/* Player position as white arrow */}
      <div
        className="absolute w-0 h-0 border-l-[5px] border-r-[5px] border-b-[10px] border-l-transparent border-r-transparent border-b-white drop-shadow-lg"
        style={{
          left: playerPosition.x * scale - 5,
          top: playerPosition.y * scale - 10,
        }}
      />
      {/* Mode hint */}
      <div className="absolute bottom-1 right-1 text-[9px] text-gray-500">
        <kbd className="px-1 py-0.5 rounded bg-white/10 text-gray-400">M</kbd> expand
      </div>
    </div>
  );
}

// ── District Map ───────────────────────────────────────────────────

function DistrictMap({
  playerPosition,
  buildings,
  npcs,
  players,
  waypoints,
  onWaypointPlace,
  infraLayers,
}: {
  playerPosition: Position;
  buildings: BuildingMarker[];
  npcs: NPCMarker[];
  players: PlayerMarker[];
  waypoints: Waypoint[];
  onWaypointPlace: (pos: Position) => void;
  infraLayers: Record<InfraLayer, boolean>;
}) {
  const [zoom, setZoom] = useState(1);
  const scale = 0.5 * zoom;

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - rect.left) / scale;
      const y = (e.clientY - rect.top) / scale;
      onWaypointPlace({ x, y });
    },
    [onWaypointPlace, scale],
  );

  return (
    <div className={`${panel} w-[50vw] h-[80vh] relative overflow-auto`}>
      {/* Zoom controls */}
      <div className="absolute top-2 right-2 z-10 flex flex-col gap-1">
        <button
          onClick={() => setZoom((z) => Math.min(z + 0.25, 3))}
          className="p-1 rounded bg-white/10 hover:bg-white/20 transition-colors"
        aria-label="Zoom in">
          <ZoomIn className="w-4 h-4 text-gray-300" />
        </button>
        <button
          onClick={() => setZoom((z) => Math.max(z - 0.25, 0.5))}
          className="p-1 rounded bg-white/10 hover:bg-white/20 transition-colors"
        aria-label="Zoom out">
          <ZoomOut className="w-4 h-4 text-gray-300" />
        </button>
        <div className="text-[9px] text-gray-500 text-center">{Math.round(zoom * 100)}%</div>
      </div>

      <div
        className="relative min-w-full min-h-full cursor-crosshair"
        onClick={handleClick} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
        {/* Infrastructure lines */}
        {infraLayers.water && (
          <div className="absolute inset-0 opacity-30">
            <div className="absolute top-[20%] left-[10%] w-[80%] h-0.5 bg-blue-400 rounded" />
            <div className="absolute top-[50%] left-[15%] w-[70%] h-0.5 bg-blue-400 rounded" />
          </div>
        )}
        {infraLayers.power && (
          <div className="absolute inset-0 opacity-30">
            <div className="absolute top-[30%] left-[5%] w-[90%] h-0.5 bg-yellow-400 rounded" />
          </div>
        )}
        {infraLayers.drainage && (
          <div className="absolute inset-0 opacity-30">
            <div className="absolute top-[60%] left-[10%] w-[80%] h-0.5 bg-green-400 rounded" />
          </div>
        )}
        {infraLayers.roads && (
          <div className="absolute inset-0 opacity-20">
            <div className="absolute top-[40%] left-0 w-full h-1 bg-gray-400 rounded" />
            <div className="absolute top-0 left-[40%] w-1 h-full bg-gray-400 rounded" />
          </div>
        )}
        {infraLayers.data && (
          <div className="absolute inset-0 opacity-30">
            <div className="absolute top-[70%] left-[20%] w-[60%] h-0.5 bg-purple-400 rounded" />
          </div>
        )}

        {/* Buildings with labels */}
        {buildings.map((b) => (
          <div
            key={b.id}
            className="absolute flex flex-col items-center"
            style={{ left: b.position.x * scale, top: b.position.y * scale }}
          >
            <div className="w-3 h-3 rounded-sm bg-amber-500/70 border border-amber-400/50" />
            <span className="text-[8px] text-gray-400 whitespace-nowrap mt-0.5">
              {b.label}
            </span>
          </div>
        ))}

        {/* NPCs */}
        {npcs.map((n) => (
          <div
            key={n.id}
            className="absolute flex flex-col items-center"
            style={{ left: n.position.x * scale, top: n.position.y * scale }}
          >
            <div className="w-2 h-2 rounded-full bg-gray-500" />
            <span className="text-[7px] text-gray-500 whitespace-nowrap">{n.name}</span>
          </div>
        ))}

        {/* Players */}
        {players.map((p) => (
          <div
            key={p.id}
            className="absolute"
            style={{ left: p.position.x * scale, top: p.position.y * scale }}
          >
            <div className="w-2.5 h-2.5 rounded-full bg-blue-400 border border-blue-300" />
          </div>
        ))}

        {/* Waypoints with distance */}
        {waypoints.map((w) => {
          const dx = w.position.x - playerPosition.x;
          const dy = w.position.y - playerPosition.y;
          const dist = Math.round(Math.sqrt(dx * dx + dy * dy));
          return (
            <div
              key={w.id}
              className="absolute flex flex-col items-center"
              style={{ left: w.position.x * scale - 6, top: w.position.y * scale - 6 }}
            >
              <MapPin className="w-3 h-3 text-red-400" />
              <span className="text-[8px] text-red-300">{dist}m</span>
            </div>
          );
        })}

        {/* Player arrow */}
        <div
          className="absolute z-10"
          style={{
            left: playerPosition.x * scale - 6,
            top: playerPosition.y * scale - 12,
          }}
        >
          <Navigation className="w-3 h-3 text-white drop-shadow-lg" />
        </div>
      </div>
    </div>
  );
}

// ── World Map ──────────────────────────────────────────────────────

function WorldMap({ districts }: { districts: DistrictRegion[] }) {
  const [zoom, setZoom] = useState(1);

  return (
    <div className={`${panel} fixed inset-4 z-50 overflow-auto`}>
      {/* Zoom controls */}
      <div className="absolute top-3 right-3 z-10 flex flex-col gap-1">
        <button
          onClick={() => setZoom((z) => Math.min(z + 0.25, 3))}
          className="p-1.5 rounded bg-white/10 hover:bg-white/20 transition-colors"
        aria-label="Zoom in">
          <ZoomIn className="w-4 h-4 text-gray-300" />
        </button>
        <button
          onClick={() => setZoom((z) => Math.max(z - 0.25, 0.5))}
          className="p-1.5 rounded bg-white/10 hover:bg-white/20 transition-colors"
        aria-label="Zoom out">
          <ZoomOut className="w-4 h-4 text-gray-300" />
        </button>
      </div>

      <div className="p-4">
        <h2 className="text-sm font-semibold text-cyan-400 mb-3">Concordia World Map</h2>

        <div className="relative" style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
          {/* Connection paths */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none">
            {districts.map((d) =>
              d.connections.map((connId) => {
                const target = districts.find((t) => t.id === connId);
                if (!target) return null;
                return (
                  <line
                    key={`${d.id}-${connId}`}
                    x1={d.center.x}
                    y1={d.center.y}
                    x2={target.center.x}
                    y2={target.center.y}
                    stroke="rgba(255,255,255,0.15)"
                    strokeWidth="1"
                    strokeDasharray="4 4"
                  />
                );
              }),
            )}
          </svg>

          {/* District regions */}
          {districts.map((d) => (
            <div
              key={d.id}
              className="absolute flex flex-col items-center group cursor-pointer"
              style={{ left: d.center.x - 40, top: d.center.y - 20 }}
            >
              <div className="w-20 h-14 rounded-lg border border-cyan-500/30 bg-cyan-500/10 flex flex-col items-center justify-center group-hover:bg-cyan-500/20 transition-colors">
                <span className="text-[10px] font-medium text-cyan-300">{d.name}</span>
                <span className="flex items-center gap-0.5 text-[9px] text-gray-400">
                  <Users className="w-2.5 h-2.5" />
                  {d.playerCount}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────

export default function MapNavigation({
  playerPosition,
  district,
  buildings,
  npcs,
  players,
  waypoints,
  onWaypointPlace,
  mapMode,
  onMapModeChange,
  districts = [],
}: MapNavigationProps) {
  const [infraLayers, setInfraLayers] = useState<Record<InfraLayer, boolean>>({
    water: false,
    power: false,
    drainage: false,
    roads: true,
    data: false,
  });
  const [showLegend, setShowLegend] = useState(false);

  const breadcrumb = useMemo(() => {
    return ['Concordia', district, 'Main Street'];
  }, [district]);

  const cycleMode = useCallback(() => {
    const modes: MapMode[] = ['minimap', 'district', 'world'];
    const idx = modes.indexOf(mapMode);
    onMapModeChange?.(modes[(idx + 1) % modes.length]);
  }, [mapMode, onMapModeChange]);

  const toggleInfra = useCallback((layer: InfraLayer) => {
    setInfraLayers((prev) => ({ ...prev, [layer]: !prev[layer] }));
  }, []);

  return (
    <div className="relative">
      {/* Navigation breadcrumb */}
      {mapMode !== 'minimap' && (
        <div className={`${panel} px-3 py-1.5 mb-2 inline-flex items-center gap-1 text-xs`}>
          {breadcrumb.map((crumb, i) => (
            <React.Fragment key={i}>
              {i > 0 && <ChevronRight className="w-3 h-3 text-gray-600" />}
              <span className={i === breadcrumb.length - 1 ? 'text-cyan-400' : 'text-gray-400'}>
                {crumb}
              </span>
            </React.Fragment>
          ))}
        </div>
      )}

      {/* Map mode toggle */}
      <div className="flex items-center gap-2 mb-2">
        <button
          onClick={cycleMode}
          className={`${panel} px-3 py-1.5 text-xs flex items-center gap-1.5 hover:bg-white/5 transition-colors`}
        >
          <Map className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-gray-300 capitalize">{mapMode}</span>
          <kbd className="ml-1 px-1 py-0.5 rounded bg-white/10 text-[9px] text-gray-500">M</kbd>
        </button>

        {/* Infrastructure toggles (district + world modes) */}
        {mapMode !== 'minimap' && (
          <div className="flex items-center gap-1">
            <Layers className="w-3.5 h-3.5 text-gray-500 mr-1" />
            {(Object.keys(infraColors) as InfraLayer[]).map((layer) => (
              <button
                key={layer}
                onClick={() => toggleInfra(layer)}
                className={`px-2 py-1 rounded text-[10px] border transition-colors ${
                  infraLayers[layer]
                    ? `${infraColors[layer].color} border-current bg-white/5`
                    : 'text-gray-600 border-white/5 hover:border-white/10'
                }`}
              >
                {infraColors[layer].label}
              </button>
            ))}
          </div>
        )}

        {/* Legend toggle */}
        <button
          onClick={() => setShowLegend((s) => !s)}
          className="p-1.5 rounded bg-white/5 hover:bg-white/10 transition-colors"
        >
          {showLegend ? (
            <EyeOff className="w-3.5 h-3.5 text-gray-400" />
          ) : (
            <Eye className="w-3.5 h-3.5 text-gray-400" />
          )}
        </button>
      </div>

      {/* Map views */}
      <div className="relative">
        {mapMode === 'minimap' && (
          <Minimap
            playerPosition={playerPosition}
            buildings={buildings}
            npcs={npcs}
            players={players}
            waypoints={waypoints}
            onWaypointPlace={onWaypointPlace}
          />
        )}

        {mapMode === 'district' && (
          <DistrictMap
            playerPosition={playerPosition}
            buildings={buildings}
            npcs={npcs}
            players={players}
            waypoints={waypoints}
            onWaypointPlace={onWaypointPlace}
            infraLayers={infraLayers}
          />
        )}

        {mapMode === 'world' && <WorldMap districts={districts} />}

        {/* Legend overlay */}
        {showLegend && (
          <div className="absolute top-2 left-2 z-20">
            <MapLegend />
          </div>
        )}
      </div>

      {/* Waypoint info */}
      {waypoints.length > 0 && mapMode !== 'world' && (
        <div className={`${panel} mt-2 px-3 py-1.5 text-[10px] flex items-center gap-2`}>
          <Crosshair className="w-3 h-3 text-red-400" />
          <span className="text-gray-400">
            {waypoints.length} waypoint{waypoints.length > 1 ? 's' : ''} set
          </span>
          {waypoints[0] && (
            <span className="text-gray-500 ml-auto">
              {Math.round(
                Math.sqrt(
                  (waypoints[0].position.x - playerPosition.x) ** 2 +
                    (waypoints[0].position.y - playerPosition.y) ** 2,
                ),
              )}
              m away
            </span>
          )}
        </div>
      )}
    </div>
  );
}
