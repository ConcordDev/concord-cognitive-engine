'use client';

/**
 * FederationBadge — compact status indicator for federation/cross-instance
 * state. Used inline anywhere a DTU, marketplace listing, governance vote,
 * or world event may have come from (or been mirrored to) a peer instance.
 *
 * Status maps directly onto the federation backend (`server/lib/federation.js`)
 * instance state machine.
 */

import React from 'react';
import { Globe, GitMerge, AlertTriangle, Pause, CircleDashed } from 'lucide-react';

import { cn } from '@/lib/utils';

export type FederationStatus =
  | 'local'
  | 'mirrored'
  | 'remote'
  | 'pending'
  | 'suspended'
  | 'failed';

export interface FederationBadgeProps {
  status: FederationStatus;
  /** Short instance label, e.g. "MIT Lab" or "berlin-hack.space". */
  instanceName?: string;
  /** Last successful sync, ISO string or pre-formatted ("2h ago"). */
  lastSync?: string;
  /** Optional federation tier — controls visual emphasis. */
  tier?: 'public' | 'trusted' | 'private';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_TEXT = { sm: 'text-[10px]', md: 'text-xs', lg: 'text-sm' } as const;
const SIZE_ICON = { sm: 'w-3 h-3', md: 'w-3.5 h-3.5', lg: 'w-4 h-4' } as const;

const STATUS_CONFIG: Record<
  FederationStatus,
  { icon: typeof Globe; label: string; classes: string; dot: string }
> = {
  local: {
    icon: CircleDashed,
    label: 'Local',
    classes: 'bg-gray-500/10 text-gray-300 border-gray-500/30',
    dot: 'bg-gray-400',
  },
  mirrored: {
    icon: GitMerge,
    label: 'Mirrored',
    classes: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
    dot: 'bg-cyan-400',
  },
  remote: {
    icon: Globe,
    label: 'Remote',
    classes: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    dot: 'bg-emerald-400',
  },
  pending: {
    icon: CircleDashed,
    label: 'Pending',
    classes: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    dot: 'bg-amber-400',
  },
  suspended: {
    icon: Pause,
    label: 'Suspended',
    classes: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
    dot: 'bg-orange-400',
  },
  failed: {
    icon: AlertTriangle,
    label: 'Sync failed',
    classes: 'bg-red-500/15 text-red-300 border-red-500/30',
    dot: 'bg-red-400',
  },
};

const TIER_RING: Record<NonNullable<FederationBadgeProps['tier']>, string> = {
  public: '',
  trusted: 'ring-1 ring-cyan-500/30',
  private: 'ring-1 ring-purple-500/30',
};

function FederationBadgeInner({
  status,
  instanceName,
  lastSync,
  tier,
  size = 'md',
  className,
}: FederationBadgeProps) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;
  const tooltip = [
    config.label,
    instanceName,
    lastSync ? `last sync ${lastSync}` : null,
    tier ? `${tier} tier` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-medium',
        config.classes,
        SIZE_TEXT[size],
        tier ? TIER_RING[tier] : '',
        className
      )}
      title={tooltip}
      aria-label={tooltip}
      role="status"
    >
      <Icon className={SIZE_ICON[size]} aria-hidden="true" />
      <span className="truncate max-w-[120px]">{instanceName ?? config.label}</span>
      {lastSync && (
        <span className="opacity-70 text-[10px] font-normal">{lastSync}</span>
      )}
    </span>
  );
}

export const FederationBadge = React.memo(FederationBadgeInner);
export default FederationBadge;
