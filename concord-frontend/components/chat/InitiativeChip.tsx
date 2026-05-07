'use client';

/**
 * InitiativeChip — Renders proactive initiative messages in the chat rail.
 *
 * Features:
 *   - Animated slide-in entry from bottom
 *   - Color-coded by trigger type (discovery=blue, citation=gold, check_in=gray,
 *     pending_work=orange, world_event=purple, reflection=green, morning=warm)
 *   - Dismiss button, action buttons, time-ago display, priority indicator
 *   - Reports user interactions back to the initiative API
 *
 * Part of Concord Spec 2 — Conversational Initiative (Living Chat).
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils';
import { showToast } from '@/components/common/Toasts';
import {
  X,
  Sparkles,
  Quote,
  Heart,
  Clock,
  Globe,
  Brain,
  Sun,
  AlertCircle,
  Eye,
  MessageCircle,
  ArrowUpRight,
  Zap,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────

export type TriggerType =
  | 'substrateDiscovery'
  | 'citationAlert'
  | 'genuineCheckIn'
  | 'pendingWorkReminder'
  | 'worldEventConnection'
  | 'reflectiveFollowUp'
  | 'morningContext'
  | 'doubleText';

export type InitiativePriority = 'high' | 'normal' | 'low';

export interface Initiative {
  id: string;
  triggerType: TriggerType | string;
  message: string;
  priority: InitiativePriority;
  score: number;
  status: string;
  channel?: string;
  metadata?: Record<string, unknown>;
  deliveredAt?: string;
  createdAt: string;
}

interface InitiativeChipProps {
  initiative: Initiative;
  onDismiss: (id: string) => void;
  onAction: (id: string, action: string, payload?: Record<string, unknown>) => void;
  onRespond: (id: string) => void;
  compact?: boolean;
  className?: string;
}

// ── Trigger Type Configuration ─────────────────────────────────────────

interface TriggerConfig {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  bgColor: string;
  borderColor: string;
  textColor: string;
  accentColor: string;
  glowColor: string;
  actions: { label: string; action: string; primary?: boolean }[];
}

const TRIGGER_CONFIGS: Record<string, TriggerConfig> = {
  substrateDiscovery: {
    icon: Sparkles,
    label: 'Discovery',
    bgColor: 'bg-blue-950/60',
    borderColor: 'border-blue-500/40',
    textColor: 'text-blue-100',
    accentColor: 'text-blue-400',
    glowColor: 'shadow-blue-500/10',
    actions: [
      { label: 'Check it out', action: 'view_dtu', primary: true },
      { label: 'Tell me more', action: 'explain' },
    ],
  },
  citationAlert: {
    icon: Quote,
    label: 'Citation',
    bgColor: 'bg-yellow-950/60',
    borderColor: 'border-yellow-500/40',
    textColor: 'text-yellow-100',
    accentColor: 'text-yellow-400',
    glowColor: 'shadow-yellow-500/10',
    actions: [
      { label: 'See citation', action: 'view_citation', primary: true },
      { label: 'View my DTU', action: 'view_dtu' },
    ],
  },
  genuineCheckIn: {
    icon: Heart,
    label: 'Check-in',
    bgColor: 'bg-zinc-800/60',
    borderColor: 'border-zinc-600/40',
    textColor: 'text-zinc-200',
    accentColor: 'text-zinc-400',
    glowColor: 'shadow-zinc-500/10',
    actions: [
      { label: 'Catch me up', action: 'catch_up', primary: true },
      { label: "I'm here!", action: 'acknowledge' },
    ],
  },
  pendingWorkReminder: {
    icon: Clock,
    label: 'Pending Work',
    bgColor: 'bg-orange-950/60',
    borderColor: 'border-orange-500/40',
    textColor: 'text-orange-100',
    accentColor: 'text-orange-400',
    glowColor: 'shadow-orange-500/10',
    actions: [
      { label: "Let's finish it", action: 'resume_work', primary: true },
      { label: 'Remind later', action: 'snooze' },
    ],
  },
  worldEventConnection: {
    icon: Globe,
    label: 'World Event',
    bgColor: 'bg-purple-950/60',
    borderColor: 'border-purple-500/40',
    textColor: 'text-purple-100',
    accentColor: 'text-purple-400',
    glowColor: 'shadow-purple-500/10',
    actions: [
      { label: 'Analyze', action: 'analyze_event', primary: true },
      { label: 'Tell me more', action: 'explain' },
    ],
  },
  reflectiveFollowUp: {
    icon: Brain,
    label: 'Reflection',
    bgColor: 'bg-emerald-950/60',
    borderColor: 'border-emerald-500/40',
    textColor: 'text-emerald-100',
    accentColor: 'text-emerald-400',
    glowColor: 'shadow-emerald-500/10',
    actions: [
      { label: 'Tell me more', action: 'expand_thought', primary: true },
      { label: 'Interesting', action: 'acknowledge' },
    ],
  },
  morningContext: {
    icon: Sun,
    label: 'Morning',
    bgColor: 'bg-amber-950/50',
    borderColor: 'border-amber-500/30',
    textColor: 'text-amber-100',
    accentColor: 'text-amber-400',
    glowColor: 'shadow-amber-500/10',
    actions: [
      { label: 'Morning brief', action: 'morning_brief', primary: true },
      { label: 'Show updates', action: 'show_updates' },
    ],
  },
  doubleText: {
    icon: MessageCircle,
    label: 'Follow-up',
    bgColor: 'bg-cyan-950/60',
    borderColor: 'border-cyan-500/40',
    textColor: 'text-cyan-100',
    accentColor: 'text-cyan-400',
    glowColor: 'shadow-cyan-500/10',
    actions: [
      { label: 'Got it', action: 'acknowledge', primary: true },
    ],
  },
};

const DEFAULT_TRIGGER_CONFIG: TriggerConfig = {
  icon: Zap,
  label: 'Initiative',
  bgColor: 'bg-zinc-800/60',
  borderColor: 'border-zinc-600/40',
  textColor: 'text-zinc-200',
  accentColor: 'text-zinc-400',
  glowColor: 'shadow-zinc-500/10',
  actions: [
    { label: 'Tell me more', action: 'explain', primary: true },
  ],
};

// ── Priority Indicator ─────────────────────────────────────────────────

function PriorityDot({ priority }: { priority: string }) {
  const colorMap: Record<string, string> = {
    high: 'bg-red-400 shadow-red-400/50',
    normal: 'bg-blue-400 shadow-blue-400/50',
    low: 'bg-zinc-500 shadow-zinc-500/50',
  };

  const pulseMap: Record<string, string> = {
    high: 'animate-pulse',
    normal: '',
    low: '',
  };

  const color = colorMap[priority] || colorMap.normal;
  const pulse = pulseMap[priority] || '';

  return (
    <span
      className={cn('inline-block w-1.5 h-1.5 rounded-full shadow-sm', color, pulse)}
      title={`Priority: ${priority}`}
      aria-label={`${priority} priority`}
    />
  );
}

// ── Main Component ─────────────────────────────────────────────────────

export function InitiativeChip({
  initiative,
  onDismiss,
  onAction,
  onRespond,
  compact = false,
  className,
}: InitiativeChipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [hasBeenSeen, setHasBeenSeen] = useState(false);
  const chipRef = useRef<HTMLDivElement>(null);

  const config = TRIGGER_CONFIGS[initiative.triggerType] || DEFAULT_TRIGGER_CONFIG;
  const Icon = config.icon;

  // Slide-in animation on mount
  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  // Mark as seen after a brief delay (report read to backend)
  useEffect(() => {
    if (!hasBeenSeen && isVisible) {
      const timer = setTimeout(() => {
        setHasBeenSeen(true);
        fetch(`/api/initiative/pending`, { method: 'GET' }).catch(err => { console.error('[Initiative] Failed to fetch pending:', err); showToast('error', 'Action failed'); });
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isVisible, hasBeenSeen]);

  const handleDismiss = useCallback(() => {
    setIsExiting(true);
    // Report dismissal to backend
    fetch(`/api/initiative/dismiss/${initiative.id}`, { method: 'POST' }).catch(err => { console.error('[Initiative] Failed to dismiss:', err); showToast('error', 'Action failed'); });
    setTimeout(() => {
      onDismiss(initiative.id);
    }, 300);
  }, [initiative.id, onDismiss]);

  const handleAction = useCallback((action: string) => {
    onAction(initiative.id, action, initiative.metadata as Record<string, unknown>);
    // Report response to backend
    fetch(`/api/initiative/${initiative.id}/respond`, { method: 'POST' }).catch(err => { console.error('[Initiative] Failed to respond:', err); showToast('error', 'Action failed'); });
    onRespond(initiative.id);
  }, [initiative.id, initiative.metadata, onAction, onRespond]);

  // ── Compact mode for tight spaces ────────────────────────────────

  if (compact) {
    return (
      <div
        ref={chipRef}
        className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-lg border transition-all duration-300',
          config.bgColor,
          config.borderColor,
          config.glowColor,
          'shadow-sm',
          isVisible && !isExiting
            ? 'opacity-100 translate-y-0'
            : 'opacity-0 translate-y-4',
          className,
        )}
      >
        <Icon className={cn('w-3.5 h-3.5 shrink-0', config.accentColor)} />
        <p className={cn('text-xs truncate flex-1', config.textColor)}>
          {initiative.message}
        </p>
        <button
          onClick={handleDismiss}
          className="p-0.5 rounded hover:bg-white/10 text-zinc-500 hover:text-zinc-300 transition-colors"
          aria-label="Dismiss initiative"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    );
  }

  // ── Full mode ────────────────────────────────────────────────────

  return (
    <div
      ref={chipRef}
      role="alert"
      aria-live="polite"
      className={cn(
        'relative rounded-xl border transition-all duration-300 ease-out',
        config.bgColor,
        config.borderColor,
        config.glowColor,
        'shadow-md',
        isVisible && !isExiting
          ? 'opacity-100 translate-y-0 scale-100'
          : 'opacity-0 translate-y-8 scale-95',
        className,
      )}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-white/5">
        <div className="flex items-center gap-2">
          <Icon className={cn('w-4 h-4', config.accentColor)} />
          <span className={cn('text-xs font-medium', config.accentColor)}>
            {config.label}
          </span>
          <PriorityDot priority={initiative.priority} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-500">
            {formatRelativeTime(initiative.createdAt)}
          </span>
          <button
            onClick={handleDismiss}
            className="p-1 rounded-md hover:bg-white/10 text-zinc-500 hover:text-zinc-300 transition-colors"
            aria-label="Dismiss initiative"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Message body */}
      <div className="px-3.5 py-3">
        <p className={cn('text-sm leading-relaxed', config.textColor)}>
          {initiative.message}
        </p>

        {/* Metadata details (optional, shown for specific trigger types) */}
        {initiative.metadata && renderMetadata(initiative.triggerType, initiative.metadata, config)}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 px-3.5 pb-3">
        {config.actions.map((action) => (
          <button
            key={action.action}
            onClick={() => handleAction(action.action)}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
              action.primary
                ? cn(config.bgColor, config.borderColor, config.accentColor, 'border hover:brightness-125')
                : 'bg-zinc-800/50 border border-zinc-700/50 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600',
            )}
          >
            {action.primary && <ArrowUpRight className="w-3 h-3" />}
            {action.label}
          </button>
        ))}
      </div>

      {/* High relevance indicator (subtle, top-right area) */}
      {initiative.score > 0.7 && (
        <div
          className="absolute top-2 right-10 flex items-center gap-1"
          title={`Relevance score: ${Math.round(initiative.score * 100)}%`}
        >
          <AlertCircle className="w-3 h-3 text-zinc-600" />
        </div>
      )}
    </div>
  );
}

// ── Metadata Rendering ─────────────────────────────────────────────────

function renderMetadata(
  triggerType: string,
  metadata: Record<string, unknown>,
  config: TriggerConfig,
): React.ReactNode {
  switch (triggerType) {
    case 'substrateDiscovery': {
      const score = metadata.cretiScore as number | undefined;
      const domain = metadata.domain as string | undefined;
      const totalNew = metadata.totalNew as number | undefined;
      if (!score && !domain) return null;

      return (
        <div className="mt-2 flex items-center gap-3 text-[10px]">
          {score !== undefined && (
            <span className={cn('flex items-center gap-1', config.accentColor)}>
              <Sparkles className="w-2.5 h-2.5" />
              CRETI: {score}
            </span>
          )}
          {domain && (
            <span className="text-zinc-500">
              Domain: {domain}
            </span>
          )}
          {totalNew !== undefined && totalNew > 1 && (
            <span className="text-zinc-500">
              +{totalNew - 1} more
            </span>
          )}
        </div>
      );
    }

    case 'citationAlert': {
      const totalCitations = metadata.totalCitations as number | undefined;
      const citingDtuTitle = metadata.citingDtuTitle as string | undefined;
      if (!totalCitations && !citingDtuTitle) return null;

      return (
        <div className="mt-2 space-y-1 text-[10px]">
          {citingDtuTitle && (
            <div className="flex items-center gap-1 text-zinc-400">
              <Quote className="w-2.5 h-2.5" />
              <span className="truncate">Cited in: {citingDtuTitle}</span>
            </div>
          )}
          {totalCitations !== undefined && totalCitations > 1 && (
            <div className="flex items-center gap-1 text-zinc-500">
              <Eye className="w-2.5 h-2.5" />
              {totalCitations} citation{totalCitations !== 1 ? 's' : ''} total
            </div>
          )}
        </div>
      );
    }

    case 'pendingWorkReminder': {
      const pendingCount = metadata.pendingCount as number | undefined;
      const daysAgo = metadata.daysAgo as number | undefined;
      const dtuTitle = metadata.dtuTitle as string | undefined;
      if (!pendingCount && !daysAgo) return null;

      return (
        <div className="mt-2 flex items-center gap-3 text-[10px]">
          {daysAgo !== undefined && (
            <span className={cn('flex items-center gap-1', config.accentColor)}>
              <Clock className="w-2.5 h-2.5" />
              {daysAgo}d idle
            </span>
          )}
          {dtuTitle && (
            <span className="text-zinc-400 truncate max-w-[150px]">
              {dtuTitle}
            </span>
          )}
          {pendingCount !== undefined && pendingCount > 1 && (
            <span className="text-zinc-500">
              {pendingCount} pending item{pendingCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      );
    }

    case 'worldEventConnection': {
      const eventTitle = metadata.eventTitle as string | undefined;
      const matchedDomains = metadata.matchedDomains as string[] | undefined;
      if (!eventTitle && !matchedDomains) return null;

      return (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
          {matchedDomains && matchedDomains.length > 0 && matchedDomains.map((d) => (
            <span
              key={d}
              className="px-1.5 py-0.5 rounded-full bg-purple-900/40 text-purple-400"
            >
              {d}
            </span>
          ))}
        </div>
      );
    }

    case 'morningContext': {
      const summary = metadata.overnightSummary as {
        newDtus?: number;
        domains?: string[];
      } | undefined;
      if (!summary) return null;

      return (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
          {summary.newDtus !== undefined && summary.newDtus > 0 && (
            <span className={cn('px-1.5 py-0.5 rounded-full', config.bgColor, config.accentColor)}>
              {summary.newDtus} new DTU{summary.newDtus !== 1 ? 's' : ''}
            </span>
          )}
          {summary.domains && summary.domains.length > 0 && summary.domains.map((d) => (
            <span
              key={d}
              className="px-1.5 py-0.5 rounded-full bg-zinc-800/50 text-zinc-500"
            >
              {d}
            </span>
          ))}
        </div>
      );
    }

    case 'reflectiveFollowUp': {
      const topic = metadata.topic as string | undefined;
      const confidence = metadata.confidence as number | undefined;
      if (!topic && confidence === undefined) return null;

      return (
        <div className="mt-2 flex items-center gap-3 text-[10px]">
          {topic && (
            <span className={cn('flex items-center gap-1', config.accentColor)}>
              <Brain className="w-2.5 h-2.5" />
              Re: {topic}
            </span>
          )}
          {confidence !== undefined && (
            <span className="text-zinc-500">
              Confidence: {Math.round(confidence * 100)}%
            </span>
          )}
        </div>
      );
    }

    default:
      return null;
  }
}

// ── Initiative List Component ──────────────────────────────────────────

interface InitiativeListProps {
  initiatives: Initiative[];
  onDismiss: (id: string) => void;
  onAction: (id: string, action: string, payload?: Record<string, unknown>) => void;
  onRespond: (id: string) => void;
  maxVisible?: number;
  compact?: boolean;
  className?: string;
}

export function InitiativeList({
  initiatives,
  onDismiss,
  onAction,
  onRespond,
  maxVisible = 3,
  compact = false,
  className,
}: InitiativeListProps) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? initiatives : initiatives.slice(0, maxVisible);
  const overflow = initiatives.length - maxVisible;

  if (visible.length === 0) return null;

  return (
    <div className={cn('space-y-2 px-2 py-2', className)}>
      {visible.map((initiative) => (
        <InitiativeChip
          key={initiative.id}
          initiative={initiative}
          onDismiss={onDismiss}
          onAction={onAction}
          onRespond={onRespond}
          compact={compact}
        />
      ))}
      {overflow > 0 && (
        <div className="text-center">
          <button
            className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
            onClick={() => setShowAll((prev) => !prev)}
          >
            {showAll ? 'Show fewer' : `+${overflow} more initiative${overflow !== 1 ? 's' : ''}`}
          </button>
        </div>
      )}
    </div>
  );
}

export default InitiativeChip;
