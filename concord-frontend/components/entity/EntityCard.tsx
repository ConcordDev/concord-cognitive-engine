'use client';

/**
 * EntityCard — Citizen-style profile card for an emergent entity.
 *
 * Shows the entity's display name, honorific title, domain badge, DTU
 * production count, mastery level, and activity status. The avatar is
 * a deterministic gradient bubble seeded by the entity's name hash.
 *
 * Use anywhere an entity is surfaced in the UI — the registry, a list,
 * a detail panel, or a hover preview.
 */

import React from 'react';
import { resolveEntityName } from '@/lib/entity-naming';

export interface EntityCardEntity {
  id: string;
  name?: string | null;
  displayName?: string | null;
  fullTitle?: string | null;
  domain?: string | null;
  species?: string | null;
  role?: string | null;
  type?: string | null;
  status?: string | null;
  dtusCreated?: number;
  totalDTUs?: number;
  masteryLevel?: number;
  organMaturity?: number;
}

interface EntityCardProps {
  entity: EntityCardEntity;
  onClick?: () => void;
  className?: string;
}

const STATUS_STYLES: Record<string, { label: string; dot: string; text: string }> = {
  active:    { label: 'Active',    dot: 'bg-neon-green',  text: 'text-neon-green' },
  alive:     { label: 'Active',    dot: 'bg-neon-green',  text: 'text-neon-green' },
  exploring: { label: 'Exploring', dot: 'bg-neon-cyan',   text: 'text-neon-cyan'  },
  dormant:   { label: 'Dormant',   dot: 'bg-gray-500',    text: 'text-gray-400'   },
  idle:      { label: 'Idle',      dot: 'bg-gray-500',    text: 'text-gray-400'   },
  suspended: { label: 'Suspended', dot: 'bg-yellow-500',  text: 'text-yellow-400' },
  spawning:  { label: 'Spawning',  dot: 'bg-neon-purple', text: 'text-neon-purple'},
  dead:      { label: 'Retired',   dot: 'bg-red-500',     text: 'text-red-400'    },
};

export function EntityCard({ entity, onClick, className = '' }: EntityCardProps) {
  const resolved = resolveEntityName(entity);
  const dtus = entity.dtusCreated ?? entity.totalDTUs ?? 0;
  const mastery = entity.masteryLevel ?? entity.organMaturity ?? 0;
  const statusKey = String(entity.status || 'active').toLowerCase();
  const statusStyle = STATUS_STYLES[statusKey] || STATUS_STYLES.active;

  const Component = onClick ? 'button' : 'div';

  return (
    <Component
      onClick={onClick}
      className={`w-full text-left bg-lattice-surface border border-lattice-border rounded-xl p-4 transition-colors ${onClick ? 'hover:border-neon-cyan/60 cursor-pointer' : ''} ${className}`}
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-neon-cyan/30 to-neon-purple/30 flex items-center justify-center text-lg font-bold text-white flex-shrink-0">
          {resolved.displayName[0] || '?'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-white truncate">{resolved.displayName}</div>
          <div className="text-xs text-gray-400 truncate">{resolved.fullTitle}</div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className={`w-2 h-2 rounded-full ${statusStyle.dot}`} />
          <span className={`text-[10px] ${statusStyle.text}`}>{statusStyle.label}</span>
        </div>
      </div>

      <div className="mt-3 flex gap-2 flex-wrap">
        <span className="px-2 py-0.5 rounded text-xs bg-neon-cyan/10 text-neon-cyan">
          {resolved.domain}
        </span>
        <span className="px-2 py-0.5 rounded text-xs bg-neon-green/10 text-neon-green">
          {dtus} DTUs
        </span>
        {mastery > 0 && (
          <span className="px-2 py-0.5 rounded text-xs bg-neon-purple/10 text-neon-purple-bright">
            {Math.round(mastery * 100)}% mastery
          </span>
        )}
      </div>
    </Component>
  );
}

export default EntityCard;
