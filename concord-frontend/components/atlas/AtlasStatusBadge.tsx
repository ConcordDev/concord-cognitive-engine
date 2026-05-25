'use client';

import {
  Shield, ShieldCheck, ShieldAlert, Archive, Ban,
  Lock, Globe, Quote, Store, Settings,
} from 'lucide-react';
import {
  ATLAS_STATUS_CONFIG,
  EPISTEMIC_CLASS_CONFIG,
  LICENSE_CONFIG,
  SCOPE_LABEL_CONFIG,
} from '../../lib/types/atlas';
import type {
  AtlasStatus,
  EpistemicClass,
  LicenseType,
  AtlasScope,
} from '../../lib/types/atlas';

// ── Status Badge ────────────────────────────────────────────────────────

const statusIcons: Record<AtlasStatus, typeof Shield> = {
  DRAFT:       Shield,
  PROPOSED:    Shield,
  VERIFIED:    ShieldCheck,
  DISPUTED:    ShieldAlert,
  DEPRECATED:  Archive,
  QUARANTINED: Ban,
};

interface StatusBadgeProps {
  status: AtlasStatus;
  size?: 'sm' | 'md';
}

export function AtlasStatusBadge({ status, size = 'sm' }: StatusBadgeProps) {
  const config = ATLAS_STATUS_CONFIG[status];
  if (!config) return null;

  const Icon = statusIcons[status] || Shield;
  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';
  const textSize = size === 'sm' ? 'text-xs' : 'text-sm';

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${config.bgColor} ${config.color} ${textSize}`}>
      <Icon className={iconSize} />
      {config.label}
    </span>
  );
}

// ── Epistemic Class Badge ───────────────────────────────────────────────

interface EpistemicBadgeProps {
  epistemicClass: EpistemicClass;
  showDescription?: boolean;
}

export function EpistemicClassBadge({ epistemicClass, showDescription = false }: EpistemicBadgeProps) {
  const config = EPISTEMIC_CLASS_CONFIG[epistemicClass];
  if (!config) return null;

  return (
    <span className={`inline-flex items-center gap-1 text-xs ${config.color}`}>
      <span className="font-medium">{config.label}</span>
      {showDescription && (
        <span className="text-gray-400">({config.description})</span>
      )}
    </span>
  );
}

// ── Scope Badge ─────────────────────────────────────────────────────────

interface ScopeBadgeProps {
  scope: AtlasScope;
  size?: 'sm' | 'md';
}

export function AtlasScopeBadge({ scope, size = 'sm' }: ScopeBadgeProps) {
  const config = SCOPE_LABEL_CONFIG[scope];
  if (!config) return null;

  const textSize = size === 'sm' ? 'text-xs' : 'text-sm';

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${config.bgColor} ${config.color} ${textSize}`}>
      {config.label}
    </span>
  );
}

// ── License Badge ───────────────────────────────────────────────────────

const licenseIcons: Record<string, typeof Lock> = {
  Lock, Globe, Quote, Store, Settings,
  Ban,
};

interface LicenseBadgeProps {
  licenseType: LicenseType;
  size?: 'sm' | 'md';
}

export function LicenseBadge({ licenseType, size = 'sm' }: LicenseBadgeProps) {
  const config = LICENSE_CONFIG[licenseType];
  if (!config) return null;

  const Icon = licenseIcons[config.icon] || Lock;
  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';
  const textSize = size === 'sm' ? 'text-xs' : 'text-sm';

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-lattice-elevated ${config.color} ${textSize}`}
      title={config.description}
    >
      <Icon className={iconSize} />
      {config.label}
    </span>
  );
}

// ── Confidence Badge (for Global/Marketplace references in Chat) ────────

interface ConfidenceBadgeProps {
  score: number;
  verified?: boolean;
  disputed?: boolean;
}

export function ConfidenceBadge({ score, verified = false, disputed = false }: ConfidenceBadgeProps) {
  const pct = Math.round(score * 100);
  const color = disputed
    ? 'text-yellow-400 bg-yellow-500/10'
    : verified
    ? 'text-green-400 bg-green-500/10'
    : pct >= 80
    ? 'text-blue-400 bg-blue-500/10'
    : pct >= 50
    ? 'text-gray-300 bg-gray-500/10'
    : 'text-gray-400 bg-gray-500/10';

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${color}`}>
      {verified && <ShieldCheck className="w-3 h-3" />}
      {disputed && <ShieldAlert className="w-3 h-3" />}
      {pct}%
      {disputed && <span className="text-yellow-500">disputed</span>}
    </span>
  );
}
