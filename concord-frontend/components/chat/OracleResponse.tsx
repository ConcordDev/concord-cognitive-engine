'use client';

/**
 * OracleResponse — flagship UI for Oracle Engine responses.
 *
 * Renders a rich, tabbed visualization of an Oracle Engine response:
 * answer, confidence meter, sources, computations, cross-domain
 * connections, epistemic breakdown, pipeline phase stats, warnings
 * and action buttons (cite / share / download as DTU).
 *
 * Uses the existing lattice dark theme, framer-motion for transitions,
 * and lucide icons. The main answer is rendered through the existing
 * MessageRenderer component to match the rest of the chat UI.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDtuSurface } from '@/hooks/useDtuSurface';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  FileText,
  Cpu,
  Network,
  Eye,
  Layers,
  AlertTriangle,
  Quote,
  Share2,
  Download,
  ChevronDown,
  ChevronRight,
  Check,
  Coins,
  Users,
  Hash,
  Activity,
  HelpCircle,
  BadgeCheck,
  Scale,
  ShieldAlert,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import MessageRenderer from '@/components/chat/MessageRenderer';
import type {
  OracleResponseData,
  OracleComputation,
  OracleConnection,
  OracleEpistemicBreakdown,
  OraclePhases,
  OraclePhaseStats,
} from '@/hooks/useOracleSolve';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface OracleResponseProps {
  response: OracleResponseData;
  onOpenDTU?: (dtuId: string) => void;
  onCite?: (response: OracleResponseData) => void;
  onShare?: (response: OracleResponseData) => void;
  onDownloadDTU?: (response: OracleResponseData) => void;
  className?: string;
}

type TabId = 'sources' | 'computations' | 'connections' | 'epistemic' | 'phases';

interface TabDef {
  id: TabId;
  label: string;
  icon: React.ComponentType<{ className?: string; size?: number | string }>;
  count?: number;
  available: boolean;
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function clampConfidence(c: number): number {
  if (!Number.isFinite(c)) return 0;
  if (c < 0) return 0;
  if (c > 1) return 1;
  return c;
}

function confidencePct(c: number): number {
  return Math.round(clampConfidence(c) * 100);
}

function confidenceTone(c: number): {
  label: string;
  bar: string;
  text: string;
  ring: string;
  glow: string;
} {
  const pct = confidencePct(c);
  if (pct >= 85) {
    return {
      label: 'High',
      bar: 'from-emerald-400 via-neon-cyan to-emerald-300',
      text: 'text-emerald-300',
      ring: 'ring-emerald-400/40',
      glow: 'shadow-[0_0_20px_rgba(34,197,94,0.35)]',
    };
  }
  if (pct >= 60) {
    return {
      label: 'Solid',
      bar: 'from-neon-cyan via-sky-400 to-neon-blue',
      text: 'text-neon-cyan',
      ring: 'ring-neon-cyan/40',
      glow: 'shadow-[0_0_20px_rgba(0,212,255,0.35)]',
    };
  }
  if (pct >= 35) {
    return {
      label: 'Tentative',
      bar: 'from-amber-400 via-orange-400 to-amber-300',
      text: 'text-amber-300',
      ring: 'ring-amber-400/40',
      glow: 'shadow-[0_0_20px_rgba(245,158,11,0.35)]',
    };
  }
  return {
    label: 'Low',
    bar: 'from-rose-500 via-pink-500 to-rose-400',
    text: 'text-rose-300',
    ring: 'ring-rose-400/40',
    glow: 'shadow-[0_0_20px_rgba(244,63,94,0.35)]',
  };
}

function domainFromDtuId(id: string): string {
  // DTU IDs are usually "<domain>:<slug>" or "<domain>/<slug>".
  // Fall back to first token or "core".
  const m = id.match(/^([A-Za-z0-9_-]+)[:\/]/);
  if (m) return m[1];
  const parts = id.split('-');
  if (parts.length > 1) return parts[0];
  return 'core';
}

const DOMAIN_PALETTE: Record<string, string> = {
  math: 'text-neon-cyan bg-neon-cyan/10 border-neon-cyan/30',
  physics: 'text-sky-300 bg-sky-400/10 border-sky-400/30',
  biology: 'text-emerald-300 bg-emerald-400/10 border-emerald-400/30',
  chemistry: 'text-lime-300 bg-lime-400/10 border-lime-400/30',
  history: 'text-amber-300 bg-amber-400/10 border-amber-400/30',
  philosophy: 'text-fuchsia-300 bg-fuchsia-400/10 border-fuchsia-400/30',
  economics: 'text-yellow-300 bg-yellow-400/10 border-yellow-400/30',
  code: 'text-neon-purple bg-neon-purple/10 border-neon-purple/30',
  core: 'text-gray-300 bg-white/5 border-white/15',
};

function domainBadgeClasses(domain: string): string {
  const key = domain.toLowerCase();
  return DOMAIN_PALETTE[key] || 'text-neon-pink bg-neon-pink/10 border-neon-pink/30';
}

// ──────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────

function ConfidenceMeter({ confidence }: { confidence: number }) {
  const pct = confidencePct(confidence);
  const tone = confidenceTone(confidence);
  return (
    <div className="flex items-center gap-3 min-w-[200px]">
      <div className="flex-1">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-gray-400 mb-1">
          <span>Confidence</span>
          <span className={cn('font-mono font-semibold', tone.text)}>{pct}%</span>
        </div>
        <div className="relative h-2 rounded-full bg-lattice-bg overflow-hidden border border-lattice-border">
          <motion.div
            className={cn(
              'absolute inset-y-0 left-0 rounded-full bg-gradient-to-r',
              tone.bar
            )}
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.7, ease: 'easeOut' }}
          />
        </div>
      </div>
      <span
        className={cn(
          'px-2 py-0.5 rounded-full text-[10px] font-medium border bg-black/30',
          tone.text,
          tone.ring,
          'ring-1'
        )}
      >
        {tone.label}
      </span>
    </div>
  );
}

function RoyaltyChip({
  total,
  recipients,
}: {
  total: number;
  recipients: number;
}) {
  return (
    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-amber-400/30 bg-amber-400/10 text-amber-200 text-xs">
      <Coins className="w-3.5 h-3.5" />
      <span className="font-mono font-semibold">{total.toLocaleString()}</span>
      <span className="text-amber-200/70">royalties</span>
      <span className="mx-1 text-amber-300/40">·</span>
      <Users className="w-3 h-3 opacity-70" />
      <span className="font-mono">{recipients}</span>
    </div>
  );
}

function DtuChip({
  id,
  onClick,
}: {
  id: string;
  onClick?: () => void;
}) {
  const domain = domainFromDtuId(id);
  const palette = domainBadgeClasses(domain);
  // Phase 7 — fire-and-forget surface record so DownstreamBadge can
  // show "used in chat" counts. Mounted once per id via ref-dedup.
  const { record } = useDtuSurface();
  const recordedRef = useRef(false);
  useEffect(() => {
    if (!id || recordedRef.current) return;
    recordedRef.current = true;
    void record({ dtuId: id, lensId: 'chat', surfaceKind: 'citation_chip' });
  }, [id, record]);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex items-center gap-2 px-3 py-2 rounded-xl border text-left transition-all',
        'bg-lattice-bg hover:bg-lattice-elevated border-lattice-border hover:border-neon-cyan/40',
        'hover:shadow-[0_0_18px_rgba(0,212,255,0.2)]'
      )}
      title={`Open DTU ${id}`}
    >
      <span
        className={cn(
          'text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-md border font-semibold',
          palette
        )}
      >
        {domain}
      </span>
      <span className="font-mono text-xs text-gray-200 group-hover:text-white truncate max-w-[180px]">
        {id}
      </span>
      <Hash className="w-3 h-3 text-gray-500 group-hover:text-neon-cyan ml-auto" />
    </button>
  );
}

function ComputationRow({ comp, index }: { comp: OracleComputation; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const hasProof = !!comp.proof && comp.proof.trim().length > 0;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className="rounded-xl border border-lattice-border bg-lattice-bg overflow-hidden"
    >
      <button
        type="button"
        onClick={() => hasProof && setExpanded((v) => !v)}
        className={cn(
          'w-full flex items-start gap-3 p-3 text-left',
          hasProof && 'hover:bg-lattice-elevated cursor-pointer'
        )}
        disabled={!hasProof}
      >
        <div className="mt-0.5 w-8 h-8 rounded-lg bg-neon-purple/15 border border-neon-purple/30 flex items-center justify-center flex-shrink-0">
          <Cpu className="w-4 h-4 text-neon-purple" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] uppercase tracking-wider text-neon-purple font-semibold">
              {comp.module}
            </span>
            {hasProof && (
              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-300/80">
                <BadgeCheck className="w-3 h-3" /> proof available
              </span>
            )}
          </div>
          <div className="text-sm text-gray-200 font-mono break-words">
            {comp.result}
          </div>
        </div>
        {hasProof && (
          <ChevronDown
            className={cn(
              'w-4 h-4 text-gray-500 mt-1 transition-transform',
              expanded && 'rotate-180 text-neon-cyan'
            )}
          />
        )}
      </button>
      <AnimatePresence initial={false}>
        {hasProof && expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="px-3 pb-3">
              <div className="rounded-lg border border-neon-purple/20 bg-black/40 p-3">
                <div className="text-[10px] uppercase tracking-wider text-neon-purple/80 mb-1.5 flex items-center gap-1">
                  <Scale className="w-3 h-3" /> Proof
                </div>
                <pre className="text-xs text-gray-200 font-mono whitespace-pre-wrap break-words leading-relaxed">
                  {comp.proof}
                </pre>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function ConnectionCard({
  connection,
  index,
}: {
  connection: OracleConnection;
  index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="relative rounded-xl border border-neon-pink/25 bg-gradient-to-br from-neon-pink/10 via-lattice-bg to-neon-purple/10 p-4 overflow-hidden"
    >
      <div className="absolute inset-0 pointer-events-none opacity-20 bg-[radial-gradient(circle_at_top_right,rgba(236,72,153,0.35),transparent_60%)]" />
      <div className="relative">
        <div className="flex items-center gap-2 mb-2">
          <Network className="w-4 h-4 text-neon-pink" />
          <span className="text-[10px] uppercase tracking-wider text-neon-pink font-semibold">
            {connection.domain}
          </span>
        </div>
        <p className="text-sm text-gray-100 leading-relaxed">{connection.insight}</p>
      </div>
    </motion.div>
  );
}

const EPISTEMIC_STYLES: Record<
  keyof OracleEpistemicBreakdown,
  { label: string; border: string; text: string; bg: string; icon: React.ComponentType<{ className?: string; size?: number | string }> }
> = {
  known: {
    label: 'Known',
    border: 'border-emerald-400/40',
    text: 'text-emerald-300',
    bg: 'bg-emerald-400/5',
    icon: BadgeCheck,
  },
  probable: {
    label: 'Probable',
    border: 'border-neon-cyan/40',
    text: 'text-neon-cyan',
    bg: 'bg-neon-cyan/5',
    icon: Activity,
  },
  uncertain: {
    label: 'Uncertain',
    border: 'border-amber-400/40',
    text: 'text-amber-300',
    bg: 'bg-amber-400/5',
    icon: HelpCircle,
  },
  unknown: {
    label: 'Unknown',
    border: 'border-rose-500/40',
    text: 'text-rose-300',
    bg: 'bg-rose-500/5',
    icon: ShieldAlert,
  },
};

function EpistemicSection({
  bucket,
  items,
}: {
  bucket: keyof OracleEpistemicBreakdown;
  items: string[];
}) {
  const style = EPISTEMIC_STYLES[bucket];
  const Icon = style.icon;
  return (
    <div
      className={cn(
        'rounded-xl border p-4',
        style.border,
        style.bg
      )}
    >
      <div className="flex items-center gap-2 mb-3">
        <Icon className={cn('w-4 h-4', style.text)} />
        <span
          className={cn(
            'text-[10px] uppercase tracking-[0.2em] font-semibold',
            style.text
          )}
        >
          {style.label}
        </span>
        <span className="ml-auto text-[10px] font-mono text-gray-500">
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-gray-500 italic">Nothing in this bucket.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item, i) => (
            <li
              key={i}
              className="flex items-start gap-2 text-sm text-gray-200 leading-snug"
            >
              <span
                className={cn('mt-1.5 w-1 h-1 rounded-full flex-shrink-0', style.text.replace('text-', 'bg-'))}
              />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PhaseRow({
  name,
  stats,
  index,
}: {
  name: string;
  stats: OraclePhaseStats;
  index: number;
}) {
  const [open, setOpen] = useState(false);
  const duration =
    typeof stats.durationMs === 'number' ? `${stats.durationMs.toFixed(0)}ms` : null;
  const items =
    typeof stats.itemsProcessed === 'number' ? `${stats.itemsProcessed} items` : null;
  const conf =
    typeof stats.confidence === 'number'
      ? `${Math.round(clampConfidence(stats.confidence) * 100)}%`
      : null;
  const extraKeys = Object.keys(stats).filter(
    (k) => !['durationMs', 'itemsProcessed', 'confidence', 'notes'].includes(k)
  );
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className="rounded-xl border border-lattice-border bg-lattice-bg overflow-hidden"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 p-3 text-left hover:bg-lattice-elevated transition-colors"
      >
        <div className="w-7 h-7 rounded-lg bg-neon-cyan/10 border border-neon-cyan/30 flex items-center justify-center flex-shrink-0">
          <span className="text-[10px] font-mono text-neon-cyan font-bold">
            {String(index + 1).padStart(2, '0')}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-gray-100 capitalize font-medium">{name}</div>
          <div className="flex gap-3 text-[10px] text-gray-500 font-mono mt-0.5">
            {duration && <span>⏱ {duration}</span>}
            {items && <span>▦ {items}</span>}
            {conf && <span>⦿ {conf}</span>}
          </div>
        </div>
        <ChevronRight
          className={cn(
            'w-4 h-4 text-gray-500 transition-transform',
            open && 'rotate-90 text-neon-cyan'
          )}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <div className="px-3 pb-3">
              <div className="rounded-lg border border-lattice-border bg-black/30 p-3 space-y-1.5">
                {stats.notes && (
                  <p className="text-xs text-gray-300 leading-relaxed">
                    {stats.notes}
                  </p>
                )}
                {extraKeys.length > 0 && (
                  <div className="grid grid-cols-2 gap-2">
                    {extraKeys.map((k) => (
                      <div
                        key={k}
                        className="rounded-md border border-lattice-border/60 bg-lattice-bg px-2 py-1 text-[11px]"
                      >
                        <div className="text-[9px] uppercase tracking-wider text-gray-500">
                          {k}
                        </div>
                        <div className="font-mono text-gray-200 truncate">
                          {typeof stats[k] === 'object'
                            ? JSON.stringify(stats[k])
                            : String(stats[k])}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {!stats.notes && extraKeys.length === 0 && (
                  <p className="text-[11px] text-gray-500 italic">
                    No additional telemetry for this phase.
                  </p>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ──────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────

export default function OracleResponse({
  response,
  onOpenDTU,
  onCite,
  onShare,
  onDownloadDTU,
  className,
}: OracleResponseProps) {
  const {
    answer,
    confidence,
    sources,
    computations,
    connections,
    dtuId,
    royalties,
    epistemicBreakdown,
    warnings,
    phases,
  } = response;

  const tone = confidenceTone(confidence);

  const tabs: TabDef[] = useMemo(() => {
    const phaseCount = phases
      ? Object.values(phases).filter((p) => p !== undefined).length
      : 0;
    const epistemicCount = epistemicBreakdown
      ? (epistemicBreakdown.known?.length || 0) +
        (epistemicBreakdown.probable?.length || 0) +
        (epistemicBreakdown.uncertain?.length || 0) +
        (epistemicBreakdown.unknown?.length || 0)
      : 0;
    return [
      {
        id: 'sources',
        label: 'Sources',
        icon: FileText,
        count: sources.length,
        available: true,
      },
      {
        id: 'computations',
        label: 'Computations',
        icon: Cpu,
        count: computations.length,
        available: computations.length > 0,
      },
      {
        id: 'connections',
        label: 'Connections',
        icon: Network,
        count: connections.length,
        available: connections.length > 0,
      },
      {
        id: 'epistemic',
        label: 'Epistemic',
        icon: Eye,
        count: epistemicCount,
        available: !!epistemicBreakdown,
      },
      {
        id: 'phases',
        label: 'Phases',
        icon: Layers,
        count: phaseCount,
        available: !!phases && phaseCount > 0,
      },
    ];
  }, [sources.length, computations.length, connections.length, epistemicBreakdown, phases]);

  const firstAvailableTab =
    (tabs.find((t) => t.available)?.id as TabId) || 'sources';
  const [activeTab, setActiveTab] = useState<TabId>(firstAvailableTab);
  const [copied, setCopied] = useState(false);

  const handleCite = () => {
    if (onCite) {
      onCite(response);
      return;
    }
    // Default cite action — copy a formatted citation line
    const citation = dtuId
      ? `[Oracle · ${dtuId} · ${confidencePct(confidence)}% conf]`
      : `[Oracle · ${confidencePct(confidence)}% conf]`;
    try {
      navigator.clipboard?.writeText(`${citation}\n${answer}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable
    }
  };

  const handleShare = () => {
    if (onShare) {
      onShare(response);
      return;
    }
    // Default share — clipboard copy of answer + url
    try {
      navigator.clipboard?.writeText(answer);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // noop
    }
  };

  const handleDownload = () => {
    if (onDownloadDTU) {
      onDownloadDTU(response);
      return;
    }
    try {
      const blob = new Blob([JSON.stringify(response, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `oracle-${dtuId || 'response'}-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // noop
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className={cn(
        'relative rounded-2xl border border-lattice-border bg-lattice-surface overflow-hidden',
        'shadow-[0_0_40px_rgba(168,85,247,0.08)]',
        className
      )}
    >
      {/* Animated gradient ring */}
      <div className="pointer-events-none absolute inset-0 rounded-2xl opacity-60">
        <div className="absolute inset-0 rounded-2xl bg-[radial-gradient(circle_at_top_left,rgba(168,85,247,0.15),transparent_55%),radial-gradient(circle_at_bottom_right,rgba(0,212,255,0.12),transparent_55%)]" />
      </div>

      <div className="relative">
        {/* Warnings banner */}
        {warnings && warnings.length > 0 && (
          <div className="px-5 pt-4">
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-start gap-3 rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-amber-200"
            >
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[10px] uppercase tracking-wider font-semibold mb-1">
                  Oracle warnings
                </div>
                <ul className="space-y-1 text-xs leading-relaxed">
                  {warnings.map((w, i) => (
                    <li key={i}>• {w}</li>
                  ))}
                </ul>
              </div>
            </motion.div>
          </div>
        )}

        {/* Header */}
        <div className="px-5 pt-4 pb-3 flex flex-wrap items-start gap-3">
          <div className="flex items-center gap-2">
            <div
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 rounded-full border',
                'border-neon-purple/40 bg-neon-purple/10 text-neon-purple',
                'ring-1 ring-neon-purple/20',
                tone.glow
              )}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span className="text-[11px] font-semibold uppercase tracking-wider">
                Oracle
              </span>
            </div>
            {dtuId && (
              <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-neon-cyan/30 bg-neon-cyan/10 text-neon-cyan text-[11px] font-mono">
                <Hash className="w-3 h-3" />
                {dtuId}
              </div>
            )}
            {royalties && royalties.total > 0 && (
              <RoyaltyChip total={royalties.total} recipients={royalties.recipients} />
            )}
          </div>
          <div className="ml-auto">
            <ConfidenceMeter confidence={confidence} />
          </div>
        </div>

        {/* Main answer */}
        <div className="px-5 pb-4">
          <div className="rounded-xl border border-lattice-border bg-lattice-bg/60 p-4 text-gray-100">
            <MessageRenderer content={answer} />
          </div>
        </div>

        {/* Tabs */}
        <div className="border-t border-lattice-border bg-lattice-bg/30">
          <div className="px-2 pt-2 flex flex-wrap gap-1 overflow-x-auto">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => tab.available && setActiveTab(tab.id)}
                  disabled={!tab.available}
                  className={cn(
                    'relative flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-all',
                    tab.available
                      ? 'text-gray-400 hover:text-white hover:bg-white/5 cursor-pointer'
                      : 'text-gray-600 cursor-not-allowed opacity-50',
                    isActive && tab.available && 'text-neon-cyan bg-neon-cyan/10'
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                  {typeof tab.count === 'number' && (
                    <span
                      className={cn(
                        'px-1.5 py-0.5 rounded-full text-[9px] font-mono',
                        isActive
                          ? 'bg-neon-cyan/20 text-neon-cyan'
                          : 'bg-white/5 text-gray-500'
                      )}
                    >
                      {tab.count}
                    </span>
                  )}
                  {isActive && (
                    <motion.div
                      layoutId="oracle-tab-underline"
                      className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-gradient-to-r from-neon-purple via-neon-cyan to-neon-pink"
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* Tab body */}
          <div className="px-5 py-4 min-h-[120px]">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
              >
                {activeTab === 'sources' && (
                  <SourcesTab sources={sources} onOpenDTU={onOpenDTU} />
                )}
                {activeTab === 'computations' && (
                  <ComputationsTab computations={computations} />
                )}
                {activeTab === 'connections' && (
                  <ConnectionsTab connections={connections} />
                )}
                {activeTab === 'epistemic' && (
                  <EpistemicTab breakdown={epistemicBreakdown} />
                )}
                {activeTab === 'phases' && <PhasesTab phases={phases} />}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* Action bar */}
        <div className="border-t border-lattice-border px-5 py-3 flex flex-wrap items-center gap-2 bg-lattice-bg/40">
          <button
            type="button"
            onClick={handleCite}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-neon-cyan border border-neon-cyan/30 bg-neon-cyan/10 hover:bg-neon-cyan/20 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Quote className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied' : 'Cite this answer'}</span>
          </button>
          <button
            type="button"
            onClick={handleShare}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-gray-300 border border-lattice-border hover:bg-white/5 hover:text-white transition-colors"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>Share</span>
          </button>
          <button
            type="button"
            onClick={handleDownload}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-neon-purple border border-neon-purple/30 bg-neon-purple/10 hover:bg-neon-purple/20 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download as DTU</span>
          </button>
          <div className="ml-auto text-[10px] text-gray-500 font-mono">
            Oracle Engine · 6-phase pipeline
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ──────────────────────────────────────────────
// Tab body components
// ──────────────────────────────────────────────

function SourcesTab({
  sources,
  onOpenDTU,
}: {
  sources: string[];
  onOpenDTU?: (id: string) => void;
}) {
  if (sources.length === 0) {
    return (
      <div className="text-xs text-gray-500 italic py-6 text-center">
        No sources were cited for this answer.
      </div>
    );
  }
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-3">
        {sources.length} cited DTU{sources.length === 1 ? '' : 's'}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {sources.map((id) => (
          <DtuChip key={id} id={id} onClick={() => onOpenDTU?.(id)} />
        ))}
      </div>
    </div>
  );
}

function ComputationsTab({ computations }: { computations: OracleComputation[] }) {
  if (computations.length === 0) {
    return (
      <div className="text-xs text-gray-500 italic py-6 text-center">
        No compute modules were invoked.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {computations.map((c, i) => (
        <ComputationRow key={`${c.module}-${i}`} comp={c} index={i} />
      ))}
    </div>
  );
}

function ConnectionsTab({ connections }: { connections: OracleConnection[] }) {
  if (connections.length === 0) {
    return (
      <div className="text-xs text-gray-500 italic py-6 text-center">
        No cross-domain connections were surfaced.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {connections.map((c, i) => (
        <ConnectionCard key={`${c.domain}-${i}`} connection={c} index={i} />
      ))}
    </div>
  );
}

function EpistemicTab({
  breakdown,
}: {
  breakdown?: OracleEpistemicBreakdown;
}) {
  if (!breakdown) {
    return (
      <div className="text-xs text-gray-500 italic py-6 text-center">
        No epistemic breakdown available.
      </div>
    );
  }
  const buckets: Array<keyof OracleEpistemicBreakdown> = [
    'known',
    'probable',
    'uncertain',
    'unknown',
  ];
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {buckets.map((bucket) => (
        <EpistemicSection
          key={bucket}
          bucket={bucket}
          items={breakdown[bucket] || []}
        />
      ))}
    </div>
  );
}

function PhasesTab({ phases }: { phases?: OraclePhases }) {
  if (!phases) {
    return (
      <div className="text-xs text-gray-500 italic py-6 text-center">
        No phase telemetry available.
      </div>
    );
  }
  // Preserve canonical pipeline order when present
  const canonicalOrder = [
    'analysis',
    'knowledge',
    'computations',
    'connections',
    'synthesis',
    'validation',
  ];
  const present = Object.entries(phases).filter(
    ([, v]) => v !== undefined
  ) as Array<[string, OraclePhaseStats]>;
  present.sort(([a], [b]) => {
    const ai = canonicalOrder.indexOf(a);
    const bi = canonicalOrder.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  if (present.length === 0) {
    return (
      <div className="text-xs text-gray-500 italic py-6 text-center">
        No phase telemetry available.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {present.map(([name, stats], i) => (
        <PhaseRow key={name} name={name} stats={stats} index={i} />
      ))}
    </div>
  );
}
