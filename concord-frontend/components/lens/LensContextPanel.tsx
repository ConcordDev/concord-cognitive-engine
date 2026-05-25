'use client';

/**
 * LensContextPanel — Shared DTU context sidebar / panel for any lens.
 *
 * Renders a tier distribution bar and collapsible sections for
 * HYPER, MEGA, and regular DTUs. Designed to slot into the
 * secondary column of a lens layout or be used as a standalone panel.
 *
 * Usage:
 *   <LensContextPanel
 *     hyperDTUs={hyperDTUs}
 *     megaDTUs={megaDTUs}
 *     regularDTUs={regularDTUs}
 *     tierDistribution={tierDistribution}
 *   />
 */

import { useState, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { ds } from '@/lib/design-system';
import { ChevronDown, ChevronRight, Zap, Layers, FileText, ExternalLink } from 'lucide-react';
import type { DTU } from '@/lib/api/generated-types';
import type { TierDistribution } from '@/hooks/useLensDTUs';
import { FreshnessIndicator } from '@/components/common/FreshnessIndicator';

// ---- Types ----------------------------------------------------------------

interface LensContextPanelProps {
  /** HYPER-tier DTUs. */
  hyperDTUs: DTU[];
  /** MEGA-tier DTUs. */
  megaDTUs: DTU[];
  /** Regular-tier DTUs. */
  regularDTUs: DTU[];
  /** Tier distribution counts (hyper/mega/regular/total). */
  tierDistribution: TierDistribution;
  /** Callback when a DTU is clicked. */
  onSelectDTU?: (dtu: DTU) => void;
  /** Callback for the "publish" action on a DTU. */
  onPublish?: (dtu: DTU) => void;
  /** Optional header text override. Default "DTU Context". */
  title?: string;
  /** Extra content rendered below the tier bar (e.g. domain filter). */
  toolbar?: ReactNode;
  /** Additional class names. */
  className?: string;
}

// ---- Sub-components -------------------------------------------------------

/**
 * TierDistributionBar — Horizontal bar showing proportional tier sizes.
 */
function TierDistributionBar({ distribution }: { distribution: TierDistribution }) {
  const { hyper, mega, regular, total } = distribution;
  if (total === 0) {
    return (
      <div className="w-full h-2 rounded-full bg-lattice-elevated" />
    );
  }

  const pctHyper = (hyper / total) * 100;
  const pctMega = (mega / total) * 100;
  const pctRegular = (regular / total) * 100;

  return (
    <div className="space-y-2">
      {/* Bar */}
      <div className="w-full h-2 rounded-full bg-lattice-elevated overflow-hidden flex">
        {pctHyper > 0 && (
          <div
            className="h-full bg-neon-purple transition-all duration-300"
            style={{ width: `${pctHyper}%` }}
            title={`HYPER: ${hyper}`}
          />
        )}
        {pctMega > 0 && (
          <div
            className="h-full bg-neon-cyan transition-all duration-300"
            style={{ width: `${pctMega}%` }}
            title={`MEGA: ${mega}`}
          />
        )}
        {pctRegular > 0 && (
          <div
            className="h-full bg-gray-500 transition-all duration-300"
            style={{ width: `${pctRegular}%` }}
            title={`Regular: ${regular}`}
          />
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-gray-400">
        {hyper > 0 && (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-neon-purple inline-block" />
            HYPER {hyper}
          </span>
        )}
        {mega > 0 && (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-neon-cyan inline-block" />
            MEGA {mega}
          </span>
        )}
        {regular > 0 && (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-gray-500 inline-block" />
            Regular {regular}
          </span>
        )}
        <span className="ml-auto font-medium text-gray-300">{total} total</span>
      </div>
    </div>
  );
}

/**
 * TierSection — Collapsible section for a specific DTU tier.
 */
function TierSection({
  label,
  icon,
  dtus,
  color,
  defaultOpen = false,
  onSelectDTU,
  onPublish,
}: {
  label: string;
  icon: ReactNode;
  dtus: DTU[];
  color: string;
  defaultOpen?: boolean;
  onSelectDTU?: (dtu: DTU) => void;
  onPublish?: (dtu: DTU) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);

  if (dtus.length === 0) return null;

  return (
    <div className="space-y-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 w-full text-left text-sm font-medium text-gray-300 hover:text-white transition-colors py-1"
      >
        {open ? (
          <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
        )}
        <span className={`text-${color}`}>{icon}</span>
        <span>{label}</span>
        <span className="ml-auto text-xs text-gray-400">{dtus.length}</span>
      </button>

      {open && (
        <div className="ml-6 space-y-1">
          {dtus.map((dtu) => (
            <DTURow
              key={dtu.id}
              dtu={dtu}
              color={color}
              onSelect={onSelectDTU}
              onPublish={onPublish}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Compute a 0.0–1.0 freshness score from an updatedAt timestamp.
 * Uses exponential decay with a 30-day half-life matching context-engine.js weighting.
 * - <7 days: 0.8–1.0 (green)
 * - 7–30 days: 0.5–0.8 (cyan/warm)
 * - 30+ days: decays toward 0 (amber/red/stale)
 */
function computeTimeFreshness(updatedAt: string): number {
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  // Exponential decay with 30-day half-life
  const halfLife = 30;
  return Math.max(0, Math.min(1, Math.exp(-0.693 * ageDays / halfLife)));
}

/**
 * DTURow — Single DTU row within a tier section.
 */
function DTURow({
  dtu,
  color,
  onSelect,
  onPublish,
}: {
  dtu: DTU;
  color: string;
  onSelect?: (dtu: DTU) => void;
  onPublish?: (dtu: DTU) => void;
}) {
  return (
    <div
      className={cn(
        'group flex items-center gap-2 px-2 py-1.5 rounded-md text-sm',
        'hover:bg-lattice-elevated/60 transition-colors',
        onSelect && 'cursor-pointer',
      )}
      onClick={() => onSelect?.(dtu)}
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onKeyDown={(e) => {
        if (onSelect && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onSelect(dtu);
        }
      }}
    >
      <span className={`w-1.5 h-1.5 rounded-full bg-${color} shrink-0`} />
      <span className="truncate text-gray-300 group-hover:text-white flex-1">
        {dtu.title || dtu.id.slice(0, 8)}
      </span>

      {/* Freshness indicator — time-based scoring */}
      {dtu.updatedAt && (
        <FreshnessIndicator
          score={computeTimeFreshness(dtu.updatedAt)}
          size="sm"
        />
      )}

      {/* Tag chips */}
      {dtu.tags?.length > 0 && (
        <span className="hidden sm:inline-flex text-[10px] text-gray-400 truncate max-w-[80px]">
          {dtu.tags.slice(0, 2).join(', ')}
        </span>
      )}

      {/* Publish action */}
      {onPublish && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPublish(dtu);
          }}
          className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-400 hover:text-neon-cyan transition-opacity"
          title="Publish to marketplace"
        >
          <ExternalLink className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

// ---- Main Component -------------------------------------------------------

export function LensContextPanel({
  hyperDTUs,
  megaDTUs,
  regularDTUs,
  tierDistribution,
  onSelectDTU,
  onPublish,
  title = 'DTU Context',
  toolbar,
  className,
}: LensContextPanelProps) {
  const isEmpty =
    hyperDTUs.length === 0 && megaDTUs.length === 0 && regularDTUs.length === 0;

  return (
    <div className={cn(ds.panel, 'space-y-4', className)}>
      {/* Header */}
      <h3 className={ds.heading3}>{title}</h3>

      {/* Tier distribution bar */}
      <TierDistributionBar distribution={tierDistribution} />

      {/* Optional toolbar slot */}
      {toolbar}

      {/* Empty state */}
      {isEmpty && (
        <p className={cn(ds.textMuted, 'py-4 text-center')}>
          No DTUs in context. Create or ingest content to populate this lens.
        </p>
      )}

      {/* Tier sections */}
      <div className="space-y-3">
        <TierSection
          label="HYPER"
          icon={<Zap className="w-4 h-4" />}
          dtus={hyperDTUs}
          color="neon-purple"
          defaultOpen
          onSelectDTU={onSelectDTU}
          onPublish={onPublish}
        />

        <TierSection
          label="MEGA"
          icon={<Layers className="w-4 h-4" />}
          dtus={megaDTUs}
          color="neon-cyan"
          defaultOpen={hyperDTUs.length === 0}
          onSelectDTU={onSelectDTU}
          onPublish={onPublish}
        />

        <TierSection
          label="Regular"
          icon={<FileText className="w-4 h-4" />}
          dtus={regularDTUs}
          color="gray-400"
          defaultOpen={hyperDTUs.length === 0 && megaDTUs.length === 0}
          onSelectDTU={onSelectDTU}
          onPublish={onPublish}
        />
      </div>
    </div>
  );
}
