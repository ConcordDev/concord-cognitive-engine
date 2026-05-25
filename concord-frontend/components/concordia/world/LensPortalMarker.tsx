'use client';

import React from 'react';
import { Lock } from 'lucide-react';

export interface LensPortal {
  id: string;
  lens_id: string;
  label: string;
  description?: string;
  district: string;
  x: number;
  y: number;
  building_type: string;
  required_skill_level: number;
  accessible: boolean;
  npc_name?: string;
  npc_title?: string;
  npc_greeting?: string;
}

interface LensPortalMarkerProps {
  portal: LensPortal;
  isNearby: boolean;
  onEnter: (portal: LensPortal) => void;
}

const LENS_ICONS: Record<string, string> = {
  studio: '🎵', architecture: '🏛️', code: '💻', research: '📚', materials: '⚗️',
  marketplace: '🏪', chat: '💬', graph: '🕸️', collab: '🤝', engineering: '⚙️',
  'game-design': '🎮', science: '🔬', 'film-studios': '🎬', music: '🎼',
  quantum: '⚛️', neuro: '🧠', philosophy: '🧘', linguistics: '🗣️', ml: '🤖', art: '🎨',
};

export function LensPortalMarker({ portal, isNearby, onEnter }: LensPortalMarkerProps) {
  const icon = LENS_ICONS[portal.lens_id] ?? '⬡';

  return (
    <div
      className="relative flex flex-col items-center cursor-pointer group"
      onClick={() => portal.accessible && isNearby && onEnter(portal)}
      title={portal.label} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
      {/* Portal building icon */}
      <div
        className={`
          w-10 h-10 rounded-xl flex items-center justify-center text-lg border transition-all duration-200
          ${portal.accessible
            ? isNearby
              ? 'bg-indigo-500/40 border-indigo-400/80 shadow-lg shadow-indigo-500/30 scale-110'
              : 'bg-indigo-500/20 border-indigo-400/40 group-hover:bg-indigo-500/30'
            : 'bg-gray-800/60 border-gray-600/40 opacity-50'}
        `}
      >
        {portal.accessible ? icon : <Lock className="w-4 h-4 text-gray-400" />}
      </div>

      {/* Label */}
      <span className={`text-[10px] mt-1 font-medium truncate max-w-[64px] text-center leading-tight ${
        portal.accessible ? 'text-white/70' : 'text-gray-600'
      }`}>
        {portal.label}
      </span>

      {/* Nearby prompt */}
      {isNearby && portal.accessible && (
        <div className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap bg-indigo-600 text-white text-[10px] font-semibold px-2 py-0.5 rounded-full shadow-lg animate-bounce">
          Press E to enter
        </div>
      )}

      {/* Locked tooltip */}
      {!portal.accessible && (
        <div className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap hidden group-hover:flex bg-gray-900 text-gray-400 text-[10px] px-2 py-0.5 rounded border border-gray-700">
          Skill ≥ {portal.required_skill_level} required
        </div>
      )}
    </div>
  );
}
