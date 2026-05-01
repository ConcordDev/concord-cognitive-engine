'use client';

import React, { useState, useEffect } from 'react';
import { X, Loader2, Lock, Unlock, Users, Layers, AlertTriangle, DoorOpen } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface RoomOccupant {
  id: string;
  name: string;
  archetype: string;
  jobType?: string;
}

interface Room {
  id: string;
  name: string;
  type: string;
  floor: number;
  accessible: boolean;
  reason?: string;
  occupants: RoomOccupant[];
  furniture?: string[];
}

interface BuildingInteriorProps {
  buildingId: string;
  buildingName: string;
  worldId: string;
  onClose: () => void;
  onNPCClick?: (npc: RoomOccupant) => void;
}

// ── Room type styling ──────────────────────────────────────────────────────────

const ROOM_STYLE: Record<string, { bg: string; border: string; label: string }> = {
  main_hall: { bg: 'bg-amber-900/20', border: 'border-amber-600/30', label: 'Main Hall' },
  shop_floor: { bg: 'bg-emerald-900/20', border: 'border-emerald-600/30', label: 'Shop Floor' },
  workshop: { bg: 'bg-orange-900/20', border: 'border-orange-600/30', label: 'Workshop' },
  storage: { bg: 'bg-gray-800/30', border: 'border-gray-600/20', label: 'Storage' },
  office: { bg: 'bg-blue-900/20', border: 'border-blue-600/30', label: 'Office' },
  residence: { bg: 'bg-purple-900/20', border: 'border-purple-600/30', label: 'Residence' },
  kitchen: { bg: 'bg-red-900/20', border: 'border-red-600/30', label: 'Kitchen' },
  cellar: { bg: 'bg-stone-900/30', border: 'border-stone-600/20', label: 'Cellar' },
  guard_post: { bg: 'bg-red-900/20', border: 'border-red-500/30', label: 'Guard Post' },
  lab: { bg: 'bg-teal-900/20', border: 'border-teal-600/30', label: 'Laboratory' },
  library: { bg: 'bg-indigo-900/20', border: 'border-indigo-600/30', label: 'Library' },
  common_room: { bg: 'bg-yellow-900/20', border: 'border-yellow-600/30', label: 'Common Room' },
  default: { bg: 'bg-white/5', border: 'border-white/10', label: 'Room' },
};

const ARCHETYPE_EMOJI: Record<string, string> = {
  guard: '🛡',
  soldier: '⚔',
  merchant: '🛒',
  blacksmith: '🔨',
  mage: '🔮',
  priest: '✨',
  detective: '🔍',
  criminal: '🗡',
  bandit: '💀',
  farmer: '🌾',
  innkeeper: '🍺',
  scholar: '📚',
  hunter: '🏹',
  alchemist: '⚗',
  default: '👤',
};

const FURNITURE_EMOJI: Record<string, string> = {
  counter: '🪣',
  shelf: '📦',
  bed: '🛏',
  table: '🪑',
  forge: '🔥',
  cauldron: '⚗',
  bookcase: '📚',
  chest: '📦',
  barrel: '🛢',
  default: '·',
};

// ── Component ─────────────────────────────────────────────────────────────────

export function BuildingInterior({
  buildingId,
  buildingName,
  worldId,
  onClose,
  onNPCClick,
}: BuildingInteriorProps) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFloor, setActiveFloor] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/worlds/${worldId}/buildings/${buildingId}/interior`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) {
          setError(data.error || 'Could not enter building');
          return;
        }
        setRooms(data.rooms || []);
        setActiveFloor(Math.min(...(data.rooms || []).map((r: Room) => r.floor)));
      })
      .catch(() => setError('Could not reach server.'))
      .finally(() => setLoading(false));
  }, [buildingId, worldId]);

  const floors = [...new Set(rooms.map((r) => r.floor))].sort((a, b) => a - b);
  const floorRooms = rooms.filter((r) => r.floor === activeFloor);
  const totalOccupants = floorRooms.reduce((s, r) => s + r.occupants.length, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
      <div className="pointer-events-auto w-full max-w-2xl bg-black/95 border border-white/15 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10 flex-shrink-0">
          <DoorOpen className="w-5 h-5 text-amber-400" />
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-white truncate">{buildingName}</h2>
            <p className="text-[11px] text-white/40">Interior view</p>
          </div>
          {totalOccupants > 0 && (
            <div className="flex items-center gap-1 text-[11px] text-white/50">
              <Users className="w-3 h-3" /> {totalOccupants}
            </div>
          )}
          <button onClick={onClose} className="text-white/30 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Floor tabs */}
        {floors.length > 1 && (
          <div className="flex gap-1 px-5 py-2 border-b border-white/5 flex-shrink-0">
            {floors.map((f) => (
              <button
                key={f}
                onClick={() => setActiveFloor(f)}
                className={`flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md transition-colors ${
                  activeFloor === f
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                }`}
              >
                <Layers className="w-2.5 h-2.5" />
                {f === 0 ? 'Ground' : f < 0 ? `B${Math.abs(f)}` : `Floor ${f}`}
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && (
            <div className="flex items-center gap-2 text-white/40 text-sm py-8 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Entering building…
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-red-400/80 text-sm py-8 justify-center">
              <AlertTriangle className="w-4 h-4" /> {error}
            </div>
          )}

          {!loading && !error && floorRooms.length === 0 && (
            <div className="text-center text-white/30 text-sm py-8">
              No rooms visible on this floor.
            </div>
          )}

          {!loading && !error && (
            <div className="grid grid-cols-2 gap-3">
              {floorRooms.map((room) => {
                const style = ROOM_STYLE[room.type] ?? ROOM_STYLE.default;
                return (
                  <div
                    key={room.id}
                    className={`${style.bg} border ${style.border} rounded-xl p-3 ${!room.accessible ? 'opacity-60' : ''}`}
                  >
                    {/* Room header */}
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {room.accessible ? (
                          <Unlock className="w-3 h-3 text-white/30 flex-shrink-0" />
                        ) : (
                          <Lock className="w-3 h-3 text-red-400/60 flex-shrink-0" />
                        )}
                        <span className="text-xs font-medium text-white/80 truncate">
                          {room.name}
                        </span>
                      </div>
                      <span className="text-[9px] text-white/30 flex-shrink-0 capitalize">
                        {style.label}
                      </span>
                    </div>

                    {/* Access denied reason */}
                    {!room.accessible && room.reason && (
                      <p className="text-[10px] text-red-400/60 italic mb-2 leading-tight">
                        {room.reason}
                      </p>
                    )}

                    {/* Furniture */}
                    {room.furniture && room.furniture.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {room.furniture.map((f, i) => (
                          <span key={i} className="text-[10px] text-white/30" title={f}>
                            {FURNITURE_EMOJI[f] ?? FURNITURE_EMOJI.default}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Occupants */}
                    {room.occupants.length > 0 ? (
                      <div className="flex flex-col gap-1 mt-1">
                        {room.occupants.map((occ) => (
                          <button
                            key={occ.id}
                            onClick={() => room.accessible && onNPCClick?.(occ)}
                            disabled={!room.accessible}
                            className={`flex items-center gap-1.5 text-left w-full rounded-md px-1.5 py-1 transition-colors ${
                              room.accessible
                                ? 'hover:bg-white/10 cursor-pointer'
                                : 'cursor-not-allowed'
                            }`}
                          >
                            <span className="text-sm">
                              {ARCHETYPE_EMOJI[occ.archetype] ?? ARCHETYPE_EMOJI.default}
                            </span>
                            <div className="min-w-0">
                              <div className="text-[11px] text-white/80 truncate">{occ.name}</div>
                              {occ.jobType && (
                                <div className="text-[9px] text-white/30 truncate">
                                  {occ.jobType}
                                </div>
                              )}
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      room.accessible && <p className="text-[10px] text-white/20 italic">Empty</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
