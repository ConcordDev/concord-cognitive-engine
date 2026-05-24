'use client';

import React, { useState } from 'react';
import {
  Hammer, ShieldAlert, Clock, BarChart3, Scale, GitMerge, Key,
  ChevronDown, ChevronUp,
} from 'lucide-react';

export interface EmergentEntity {
  id?: string;
  role?: string;
  name?: string;
  state?: string;
  status?: string;
  active?: boolean;
  activity?: string;
  reputation?: number;
  contributions?: number;
  totalContributions?: number;
  lastAction?: string;
  lastActionAt?: string;
  lastActivity?: string;
  trust?: number;
  capabilities?: string[];
  cognitiveSignature?: Record<string, unknown>;
  boundaries?: string[];
}

const ROLE_CONFIG: Record<string, { icon: typeof Hammer; color: string; label: string }> = {
  builder: { icon: Hammer, color: 'neon-green', label: 'Builder' },
  critic: { icon: ShieldAlert, color: 'red-400', label: 'Critic' },
  historian: { icon: Clock, color: 'amber-400', label: 'Historian' },
  economist: { icon: BarChart3, color: 'neon-blue', label: 'Economist' },
  ethicist: { icon: Scale, color: 'neon-purple', label: 'Ethicist' },
  synthesizer: { icon: GitMerge, color: 'neon-cyan', label: 'Synthesizer' },
  cipher: { icon: Key, color: 'white', label: 'Cipher' },
};

function getStateLabel(state?: string): { label: string; colorClass: string } {
  switch (state) {
    case 'active':
    case 'thinking':
      return { label: 'Thinking', colorClass: 'text-neon-cyan bg-neon-cyan/20' };
    case 'governing':
      return { label: 'Governing', colorClass: 'text-neon-purple bg-neon-purple/20' };
    case 'idle':
      return { label: 'Idle', colorClass: 'text-gray-400 bg-gray-500/20' };
    default:
      return { label: state || 'Unknown', colorClass: 'text-gray-400 bg-gray-500/20' };
  }
}

function deriveDisplayName(emergent: EmergentEntity, roleLabel: string): string {
  // If the entity has a specific name that isn't just a generic role label, use it
  if (emergent.name && !['Global Synthesizer', 'Global Builder', 'Global Critic', 'Global Historian', 'Global Economist', 'Global Ethicist', 'Global Cipher'].includes(emergent.name)) {
    return emergent.name;
  }
  // Generate a unique display name from role + id suffix
  const idSuffix = emergent.id ? emergent.id.slice(-4) : '';
  return idSuffix ? `${roleLabel}-${idSuffix}` : roleLabel;
}

function EmergentCardInner({ emergent }: { emergent: EmergentEntity }) {
  const [expanded, setExpanded] = useState(false);
  const role = emergent.role?.toLowerCase() || 'unknown';
  const config = ROLE_CONFIG[role] || { icon: Key, color: 'gray-400', label: role };
  const Icon = config.icon;
  const stateInfo = getStateLabel(emergent.state || emergent.status || (emergent.active === true ? 'active' : emergent.active === false ? 'idle' : undefined));
  const reputation = emergent.reputation ?? emergent.trust ?? 0;
  const contributions = emergent.contributions ?? emergent.totalContributions ?? 0;

  return (
    <div className="rounded-lg border border-lattice-border bg-lattice-surface/50 p-3 hover:border-lattice-border/80 transition-colors">
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className={`w-10 h-10 rounded-lg bg-${config.color}/20 border border-${config.color}/30 flex items-center justify-center flex-shrink-0`}>
          <Icon className={`w-5 h-5 text-${config.color}`} />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-white truncate">
              {deriveDisplayName(emergent, config.label)}
            </h3>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${stateInfo.colorClass}`}>
              {stateInfo.label}
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">{config.label}</p>

          {/* Stats row */}
          <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
            <span title="Reputation">
              Rep: <span className="text-gray-200 font-mono">{(reputation * 100).toFixed(0)}%</span>
            </span>
            <span title="Contributions">
              DTUs: <span className="text-gray-200 font-mono">{contributions}</span>
            </span>
          </div>

          {/* Last action */}
          {(emergent.lastAction || emergent.activity || emergent.lastActivity) && (
            <p className="text-[11px] text-gray-400 mt-1 truncate">
              {emergent.lastAction || emergent.activity || emergent.lastActivity}
              {emergent.lastActionAt && (
                <span className="ml-1 text-gray-600">
                  {new Date(emergent.lastActionAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </p>
          )}
        </div>

        {/* Expand toggle */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="p-1 text-gray-400 hover:text-gray-300 transition-colors"
          aria-label={expanded ? 'Collapse details' : 'Expand details'}
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-lattice-border space-y-2">
          {emergent.capabilities && emergent.capabilities.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Capabilities</p>
              <div className="flex flex-wrap gap-1">
                {emergent.capabilities.map((cap) => (
                  <span key={cap} className="px-1.5 py-0.5 text-[10px] rounded bg-lattice-deep text-gray-400">
                    {cap}
                  </span>
                ))}
              </div>
            </div>
          )}
          {emergent.boundaries && emergent.boundaries.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Behavioral Boundaries</p>
              <div className="flex flex-wrap gap-1">
                {emergent.boundaries.map((b) => (
                  <span key={b} className="px-1.5 py-0.5 text-[10px] rounded bg-red-500/10 text-red-400">
                    {b}
                  </span>
                ))}
              </div>
            </div>
          )}
          {emergent.cognitiveSignature && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Cognitive Signature</p>
              <pre className="text-[10px] text-gray-400 bg-lattice-deep rounded p-2 overflow-x-auto">
                {JSON.stringify(emergent.cognitiveSignature, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const EmergentCard = React.memo(EmergentCardInner);
