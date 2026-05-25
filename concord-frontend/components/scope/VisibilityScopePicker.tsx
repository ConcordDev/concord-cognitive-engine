'use client';

/**
 * VisibilityScopePicker — Who can see this post?
 *
 * Lets a user pick the federation tier for a DTU they're about to
 * create (or editing after the fact). The five options map directly
 * to the backend's `visibilityScope` input on dtu.create:
 *
 *   private   — only you (not shared at all)
 *   local     — only you, but treated as "working draft" in feeds
 *   regional  — people in your declared region only
 *   national  — people in your declared country only
 *   global    — everyone, worldwide (council approval required for
 *               true global promotion; selecting this here just
 *               requests it)
 *
 * If the user hasn't declared a region/nation yet, the regional /
 * national options are disabled with a tooltip pointing them to
 * settings. `onOpenLocationSettings` lets the caller wire an
 * "Update location" link to whatever UI they use for settings.
 *
 * Controlled component — caller owns `value` and passes `onChange`.
 */

import React from 'react';
import { Lock, Home, MapPin, Flag, Globe, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

export type VisibilityScope =
  | 'private'
  | 'local'
  | 'regional'
  | 'national'
  | 'global';

export interface VisibilityScopePickerProps {
  value: VisibilityScope;
  onChange: (scope: VisibilityScope) => void;
  /** User's declared region. If null, regional option is disabled. */
  declaredRegional?: string | null;
  /** User's declared nation. If null, national option is disabled. */
  declaredNational?: string | null;
  /** Called when user clicks the "Set location" nudge. */
  onOpenLocationSettings?: () => void;
  /** Compact (row) or full (grid) layout. */
  layout?: 'row' | 'grid';
  /** Disabled state (e.g. during save). */
  disabled?: boolean;
  className?: string;
}

interface ScopeOption {
  id: VisibilityScope;
  label: string;
  description: (regional?: string | null, national?: string | null) => string;
  icon: React.ComponentType<{ className?: string; size?: number | string }>;
  color: string;
  requires?: 'regional' | 'national';
}

const SCOPE_OPTIONS: ScopeOption[] = [
  {
    id: 'private',
    label: 'Private',
    description: () => 'Only you can see this',
    icon: Lock,
    color: 'text-gray-400 border-gray-500/30 bg-gray-500/5',
  },
  {
    id: 'local',
    label: 'Local',
    description: () => 'Just you, but saved as a working draft',
    icon: Home,
    color: 'text-neon-green border-neon-green/30 bg-neon-green/5',
  },
  {
    id: 'regional',
    label: 'Regional',
    description: (regional) =>
      regional ? `Everyone in ${regional}` : 'People in your region',
    icon: MapPin,
    color: 'text-neon-cyan border-neon-cyan/30 bg-neon-cyan/5',
    requires: 'regional',
  },
  {
    id: 'national',
    label: 'National',
    description: (_, national) =>
      national ? `Everyone in ${national}` : 'People in your country',
    icon: Flag,
    color: 'text-neon-purple border-neon-purple/30 bg-neon-purple/5',
    requires: 'national',
  },
  {
    id: 'global',
    label: 'Global',
    description: () => 'The whole federation (council-reviewed)',
    icon: Globe,
    color: 'text-neon-blue border-neon-blue/30 bg-neon-blue/5',
  },
];

export function VisibilityScopePicker({
  value,
  onChange,
  declaredRegional,
  declaredNational,
  onOpenLocationSettings,
  layout = 'grid',
  disabled,
  className,
}: VisibilityScopePickerProps) {
  const needsLocationNudge =
    (!declaredRegional || !declaredNational) && !disabled;

  const isOptionDisabled = (opt: ScopeOption): boolean => {
    if (disabled) return true;
    if (opt.requires === 'regional' && !declaredRegional) return true;
    if (opt.requires === 'national' && !declaredNational) return true;
    return false;
  };

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between">
        <label className="text-xs uppercase tracking-wide text-gray-400">
          Who can see this?
        </label>
        {needsLocationNudge && onOpenLocationSettings && (
          <button
            type="button"
            onClick={onOpenLocationSettings}
            className="inline-flex items-center gap-1 text-xs text-neon-cyan hover:text-neon-blue transition-colors"
          >
            <Info className="w-3 h-3" />
            Set your location
          </button>
        )}
      </div>

      <div
        className={cn(
          layout === 'grid'
            ? 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2'
            : 'flex flex-wrap gap-2',
        )}
      >
        {SCOPE_OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const isActive = value === opt.id;
          const optDisabled = isOptionDisabled(opt);
          return (
            <button
              key={opt.id}
              type="button"
              disabled={optDisabled}
              onClick={() => !optDisabled && onChange(opt.id)}
              className={cn(
                'group flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-all',
                isActive
                  ? `${opt.color} ring-2 ring-current/40`
                  : 'border-lattice-border bg-lattice-surface/40 text-gray-300 hover:border-neon-cyan/30',
                optDisabled && 'opacity-40 cursor-not-allowed',
              )}
              title={
                optDisabled
                  ? `Declare your ${opt.requires} in settings to use this option`
                  : undefined
              }
              aria-pressed={isActive}
            >
              <div className="flex items-center gap-2">
                <Icon className="w-4 h-4" />
                <span className="text-sm font-medium">{opt.label}</span>
              </div>
              <span className="text-[10px] text-gray-400 group-hover:text-gray-400 leading-tight">
                {opt.description(declaredRegional, declaredNational)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default VisibilityScopePicker;
