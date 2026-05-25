'use client';

/**
 * PathStepCard
 * ------------
 * Single learning-path step card. Classifies the step (proof, experiment,
 * study, discuss, build, explore), shows readiness/effort, and exposes a
 * "Start" action that fires when the learner is ready to engage with the DTU.
 */

import { motion } from 'framer-motion';
import {
  BookOpen,
  FlaskConical,
  Hammer,
  MessageCircle,
  Compass,
  Shield,
  Play,
  Clock,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type PathStepKind =
  | 'proof'
  | 'experiment'
  | 'study'
  | 'discuss'
  | 'build'
  | 'explore';

export interface PathStep {
  id?: string;
  order: number;
  dtuId?: string;
  title: string;
  kind?: PathStepKind | string;
  domain?: string;
  readiness?: number; // 0..1
  estimatedMinutes?: number;
  summary?: string;
}

export interface PathStepCardProps {
  step: PathStep;
  onStart?: (step: PathStep) => void;
  starting?: boolean;
  className?: string;
}

const KIND_META: Record<
  PathStepKind,
  { label: string; icon: LucideIcon; color: string; bg: string; border: string }
> = {
  proof: {
    label: 'Proof',
    icon: Shield,
    color: 'text-neon-purple',
    bg: 'bg-purple-500/10',
    border: 'border-purple-400/30',
  },
  experiment: {
    label: 'Experiment',
    icon: FlaskConical,
    color: 'text-neon-cyan',
    bg: 'bg-cyan-500/10',
    border: 'border-cyan-400/30',
  },
  study: {
    label: 'Study',
    icon: BookOpen,
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-400/30',
  },
  discuss: {
    label: 'Discuss',
    icon: MessageCircle,
    color: 'text-neon-pink',
    bg: 'bg-pink-500/10',
    border: 'border-pink-400/30',
  },
  build: {
    label: 'Build',
    icon: Hammer,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-400/30',
  },
  explore: {
    label: 'Explore',
    icon: Compass,
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-400/30',
  },
};

function resolveKind(kind?: string): PathStepKind {
  if (!kind) return 'study';
  const k = kind.toLowerCase();
  if (k in KIND_META) return k as PathStepKind;
  return 'study';
}

export function PathStepCard({
  step,
  onStart,
  starting = false,
  className,
}: PathStepCardProps) {
  const kind = resolveKind(step.kind as string | undefined);
  const meta = KIND_META[kind];
  const Icon = meta.icon;
  const readinessPct = Math.round(Math.max(0, Math.min(1, step.readiness ?? 0)) * 100);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'relative rounded-xl border bg-lattice-surface p-4 transition-colors',
        meta.border,
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div
            className={cn(
              'flex items-center justify-center w-10 h-10 rounded-lg shrink-0',
              meta.bg,
            )}
          >
            <Icon className={cn('w-5 h-5', meta.color)} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] uppercase tracking-wider text-gray-400">
                Step {step.order}
              </span>
              <span
                className={cn(
                  'text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded',
                  meta.bg,
                  meta.color,
                )}
              >
                {meta.label}
              </span>
              {step.domain && (
                <span className="text-[10px] uppercase text-gray-400">
                  {step.domain}
                </span>
              )}
            </div>
            <h4 className="text-sm font-semibold text-white truncate">
              {step.title}
            </h4>
            {step.summary && (
              <p className="text-xs text-gray-400 mt-1 line-clamp-2">
                {step.summary}
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          disabled={starting}
          onClick={() => onStart?.(step)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors shrink-0',
            meta.border,
            meta.color,
            meta.bg,
            'hover:brightness-125 disabled:opacity-50',
          )}
        >
          <Play className="w-3 h-3" />
          {starting ? 'Starting...' : 'Start'}
        </button>
      </div>

      <div className="mt-3 flex items-center gap-4 text-xs text-gray-400">
        <div className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          <span>{step.estimatedMinutes ?? 15} min</span>
        </div>
        <div className="flex-1 flex items-center gap-2 min-w-0">
          <span className="text-[10px] uppercase text-gray-400">Readiness</span>
          <div className="flex-1 h-1.5 bg-lattice-bg rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-amber-400 to-emerald-400"
              style={{ width: `${readinessPct}%` }}
            />
          </div>
          <span className="text-[10px] text-gray-400 w-8 text-right">
            {readinessPct}%
          </span>
        </div>
      </div>
    </motion.div>
  );
}

export default PathStepCard;
