'use client';

import React, { useMemo } from 'react';
import { Clock, GitBranch, Zap, Crown, Ghost, ExternalLink } from 'lucide-react';
import { ProvenanceBadge } from './ProvenanceBadge';
import { TierBadge } from './TierBadge';
import { ScopeBadge } from '@/components/platform/ScopeControls';

interface DTU {
  id: string;
  tier: 'regular' | 'mega' | 'hyper' | 'shadow';
  summary: string;
  timestamp: string;
  resonance?: number;
  parentId?: string;
  childCount?: number;
  tags?: string[];
  scope?: string;
  source?: string;
  classification?: string;
  meta?: Record<string, unknown>;
}

interface DTUEmpireCardProps {
  dtu: DTU;
  onClick?: (dtu: DTU) => void;
  compact?: boolean;
  showLineage?: boolean;
}

/**
 * Determine display scope for a DTU (Local / Global / Creative).
 * Uses tier, source, and classification fields.
 */
function getDtuScopeDisplay(dtu: DTU): { label: string; color: string; textColor: string } {
  if (dtu.tier === 'shadow') return { label: 'Creative', color: 'bg-purple-500/20', textColor: 'text-purple-400' };
  if (dtu.classification === 'scaffold') return { label: 'Creative', color: 'bg-purple-500/20', textColor: 'text-purple-400' };
  if (dtu.tier === 'mega' || dtu.tier === 'hyper') return { label: 'Global', color: 'bg-amber-500/20', textColor: 'text-amber-400' };
  if (dtu.source === 'seed' || dtu.source === 'sovereign' || dtu.source === 'bootstrap') return { label: 'Global', color: 'bg-amber-500/20', textColor: 'text-amber-400' };
  if (dtu.source === 'autogen' || dtu.source === 'dream' || dtu.source === 'autogen.pipeline') return { label: 'Creative', color: 'bg-purple-500/20', textColor: 'text-purple-400' };
  return { label: 'Local', color: 'bg-blue-500/20', textColor: 'text-blue-400' };
}

const tierConfig = {
  regular: {
    icon: Zap,
    color: 'text-neon-blue',
    bg: 'bg-neon-blue/10',
    border: 'border-neon-blue/30',
    label: 'Regular',
  },
  mega: {
    icon: Crown,
    color: 'text-neon-purple',
    bg: 'bg-neon-purple/10',
    border: 'border-neon-purple/30',
    label: 'Mega',
  },
  hyper: {
    icon: Zap,
    color: 'text-neon-pink',
    bg: 'bg-neon-pink/10',
    border: 'border-neon-pink/30',
    label: 'Hyper',
  },
  shadow: {
    icon: Ghost,
    color: 'text-gray-400',
    bg: 'bg-gray-500/10',
    border: 'border-gray-500/30',
    label: 'Shadow',
  },
};

function DTUEmpireCardInner({
  dtu,
  onClick,
  compact = false,
  showLineage = true,
}: DTUEmpireCardProps) {
  const config = tierConfig[dtu.tier];
  const TierIcon = config.icon;
  const scopeDisplay = getDtuScopeDisplay(dtu);

  const formattedTime = useMemo(() => {
    const date = new Date(dtu.timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }, [dtu.timestamp]);

  if (compact) {
    return (
      <button
        onClick={() => onClick?.(dtu)}
        className={`w-full text-left p-3 rounded-lg border ${config.border} ${config.bg} hover:bg-opacity-20 transition-all`}
      >
        <div className="flex items-center gap-2">
          <TierIcon className={`w-4 h-4 ${config.color}`} />
          <span className="flex-1 truncate text-sm">{dtu.summary}</span>
          <span className="text-xs text-gray-500">{formattedTime}</span>
        </div>
      </button>
    );
  }

  return (
    <div
      onClick={() => onClick?.(dtu)}
      className={`lens-card cursor-pointer border ${config.border} hover:${config.bg} transition-all group`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`p-1.5 rounded ${config.bg}`}>
            <TierIcon className={`w-4 h-4 ${config.color}`} />
          </div>
          <TierBadge tier={dtu.tier} showRegular size="sm" />
          <ScopeBadge scope={dtu.scope || scopeDisplay.label.toLowerCase()} />
          <ProvenanceBadge source={dtu.source} model={dtu.meta?.model as string} authority={dtu.meta?.authority as string} />
        </div>
        <button className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-white">
          <ExternalLink className="w-4 h-4" />
        </button>
      </div>

      {/* Summary */}
      <p className="text-sm text-gray-200 mb-3 line-clamp-2">{dtu.summary}</p>

      {/* Tags */}
      {dtu.tags && dtu.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {dtu.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="text-xs px-2 py-0.5 bg-lattice-elevated rounded-full text-gray-400"
            >
              #{tag}
            </span>
          ))}
          {dtu.tags.length > 3 && (
            <span className="text-xs text-gray-500">+{dtu.tags.length - 3}</span>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-gray-500">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {formattedTime}
          </span>
          {showLineage && dtu.childCount !== undefined && dtu.childCount > 0 && (
            <span className="flex items-center gap-1">
              <GitBranch className="w-3 h-3" />
              {dtu.childCount} children
            </span>
          )}
        </div>

        {/* Resonance indicator */}
        {dtu.resonance !== undefined && (
          <div className="flex items-center gap-1">
            <div
              className={`w-2 h-2 rounded-full ${
                dtu.resonance > 0.8
                  ? 'bg-resonance-peak animate-pulse'
                  : dtu.resonance > 0.6
                  ? 'bg-resonance-high'
                  : dtu.resonance > 0.4
                  ? 'bg-resonance-mid'
                  : 'bg-resonance-low'
              }`}
            />
            <span>{(dtu.resonance * 100).toFixed(0)}%</span>
          </div>
        )}
      </div>
    </div>
  );
}

export const DTUEmpireCard = React.memo(DTUEmpireCardInner);
