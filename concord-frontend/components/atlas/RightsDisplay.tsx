'use client';

import {
  Shield, Eye, Quote, GitBranch, Share2,
  DollarSign, Store, ArrowRightLeft, Lock, Fingerprint,
  CheckCircle, XCircle,
} from 'lucide-react';
import type {
  ArtifactRights,
  OriginRecord,
  LicenseProfile,
  RightsAction,
} from '../../lib/types/atlas';
import { LicenseBadge, AtlasScopeBadge } from './AtlasStatusBadge';

// ── Rights Display Panel ────────────────────────────────────────────────

interface RightsDisplayProps {
  rights: ArtifactRights;
  origin?: OriginRecord | null;
  compact?: boolean;
}

export function RightsDisplay({ rights, origin, compact = false }: RightsDisplayProps) {
  if (compact) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <LicenseBadge licenseType={rights.license_type} size="sm" />
        <AtlasScopeBadge scope={rights.origin_lane} size="sm" />
        {origin && <span title="Origin verified"><Fingerprint className="w-3 h-3 text-gray-400" /></span>}
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-lattice-elevated border border-lattice-border p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-neon-cyan" />
          <h4 className="text-sm font-medium text-white">Artifact Rights</h4>
        </div>
        <LicenseBadge licenseType={rights.license_type} size="md" />
      </div>

      {/* License Permissions */}
      {rights.license_profile && (
        <LicensePermissionsGrid profile={rights.license_profile} />
      )}

      {/* Hashes */}
      <div className="space-y-2">
        <HashRow label="Content" hash={rights.content_hash} />
        <HashRow label="Evidence" hash={rights.evidence_hash} />
        <HashRow label="Lineage" hash={rights.lineage_hash} />
      </div>

      {/* Origin */}
      <div className="flex items-center justify-between text-xs text-gray-400">
        <div className="flex items-center gap-2">
          <AtlasScopeBadge scope={rights.origin_lane} size="sm" />
          <span>Stamped {new Date(rights.stamped_at).toLocaleDateString()}</span>
        </div>
        <span className="font-mono text-gray-600">by {rights.creator_id}</span>
      </div>

      {/* Proof of Origin */}
      {origin && <OriginPanel origin={origin} />}
    </div>
  );
}

// ── License Permissions Grid ────────────────────────────────────────────

interface LicensePermissionsGridProps {
  profile: LicenseProfile;
}

function LicensePermissionsGrid({ profile }: LicensePermissionsGridProps) {
  const permissions = [
    { label: 'Attribution Required', value: profile.attribution_required, icon: Quote },
    { label: 'Derivatives Allowed', value: profile.derivative_allowed, icon: GitBranch },
    { label: 'Commercial Use', value: profile.commercial_use_allowed, icon: DollarSign },
    { label: 'Redistribution', value: profile.redistribution_allowed, icon: Share2 },
    { label: 'Royalty Required', value: profile.royalty_required, icon: Store },
  ];

  return (
    <div className="grid grid-cols-2 gap-2">
      {permissions.map(({ label, value, icon: Icon }) => (
        <div
          key={label}
          className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${
            value
              ? 'bg-green-500/5 text-green-400'
              : 'bg-gray-500/5 text-gray-400'
          }`}
        >
          <Icon className="w-3.5 h-3.5 shrink-0" />
          <span className="flex-1">{label}</span>
          {value ? (
            <CheckCircle className="w-3.5 h-3.5" />
          ) : (
            <XCircle className="w-3.5 h-3.5" />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Origin Panel ────────────────────────────────────────────────────────

interface OriginPanelProps {
  origin: OriginRecord;
}

function OriginPanel({ origin }: OriginPanelProps) {
  return (
    <div className="bg-lattice-deep rounded p-3 border border-lattice-border space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium text-neon-green">
        <Fingerprint className="w-4 h-4" />
        Proof of Origin
      </div>
      <div className="grid grid-cols-1 gap-1 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-gray-400 w-16">Created</span>
          <span className="text-gray-300">{new Date(origin.created_at).toLocaleString()}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-400 w-16">Creator</span>
          <span className="text-gray-300 font-mono">{origin.creator_id}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-400 w-16">Hash</span>
          <span className="text-gray-400 font-mono truncate">{origin.content_hash}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-400 w-16">Fingerprint</span>
          <span className="text-gray-400 font-mono truncate">{origin.origin_fingerprint}</span>
        </div>
      </div>
    </div>
  );
}

// ── Hash Row ────────────────────────────────────────────────────────────

function HashRow({ label, hash }: { label: string; hash: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <Lock className="w-3 h-3 text-gray-600" />
      <span className="text-gray-400 w-16">{label}</span>
      <span className="text-gray-400 font-mono truncate flex-1">{hash}</span>
    </div>
  );
}

// ── Rights Action Check Display ─────────────────────────────────────────

interface RightsActionCheckProps {
  action: RightsAction;
  allowed: boolean;
  reason?: string;
}

const actionIcons: Record<string, typeof Eye> = {
  VIEW: Eye,
  CITE: Quote,
  DERIVE: GitBranch,
  REDISTRIBUTE: Share2,
  COMMERCIAL_USE: DollarSign,
  LIST_ON_MARKET: Store,
  TRANSFER: ArrowRightLeft,
};

const actionLabels: Record<string, string> = {
  VIEW: 'View',
  CITE: 'Cite',
  DERIVE: 'Derive',
  REDISTRIBUTE: 'Redistribute',
  COMMERCIAL_USE: 'Commercial Use',
  LIST_ON_MARKET: 'List on Market',
  TRANSFER: 'Transfer',
};

export function RightsActionCheck({ action, allowed, reason }: RightsActionCheckProps) {
  const Icon = actionIcons[action] || Eye;
  const label = actionLabels[action] || action;

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded text-sm ${
        allowed
          ? 'bg-green-500/5 text-green-400 border border-green-500/20'
          : 'bg-red-500/5 text-red-400 border border-red-500/20'
      }`}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className="font-medium">{label}</span>
      <span className="flex-1" />
      {allowed ? (
        <CheckCircle className="w-4 h-4" />
      ) : (
        <XCircle className="w-4 h-4" />
      )}
      {reason && !allowed && (
        <span className="text-xs text-gray-400 max-w-[200px] truncate">{reason}</span>
      )}
    </div>
  );
}
