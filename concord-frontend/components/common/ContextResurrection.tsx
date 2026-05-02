'use client';

/**
 * ContextResurrection — Welcome back banner with cognitive context.
 *
 * When user returns after being away, reconstructs their cognitive context:
 * - Time since last activity
 * - Last working domain
 * - Stale DTU alerts
 * - XP/streak status
 * - Active goals progress
 *
 * Dismissible. Only shows once per session.
 */

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ds } from '@/lib/design-system';
import Link from 'next/link';
import { Brain, X, ArrowRight, Flame, AlertTriangle, Sparkles, Target, Zap } from 'lucide-react';

interface ResurrectionContext {
  isNewUser?: boolean;
  welcome: string;
  lastDomain: string | null;
  lastDTUTitle: string | null;
  recentDTUs: Array<{ id: string; title: string; domain: string; freshness: number }>;
  staleDTUs: Array<{ id: string; title: string; freshness: number }>;
  xp: { totalXP: number; level: number; title: string; streak: number };
  ghostInsights: Array<{ type: string; content: string }>;
  activeGoals: Array<{ id: string; title: string; progress: number }>;
  stats: { totalDTUs: number; domains: number };
}

function ContextResurrection() {
  const [dismissed, setDismissed] = useState(false);
  const [shown, setShown] = useState(false);

  // Check if already dismissed this session
  useEffect(() => {
    const sessionKey = `concord_resurrection_${new Date().toISOString().slice(0, 10)}`;
    if (sessionStorage.getItem(sessionKey)) {
      setDismissed(true);
    }
    setShown(true);
  }, []);

  const { data } = useQuery<{ ok: boolean; context: ResurrectionContext }>({
    queryKey: ['context-resurrection'],
    queryFn: async () => {
      const { data } = await api.get('/api/context/resurrect');
      return data;
    },
    enabled: shown && !dismissed,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const handleDismiss = () => {
    setDismissed(true);
    const sessionKey = `concord_resurrection_${new Date().toISOString().slice(0, 10)}`;
    try {
      sessionStorage.setItem(sessionKey, 'true');
    } catch {}
  };

  if (dismissed || !data?.context) return null;

  const ctx = data.context;

  // Brand-new users have no history to resurrect — don't fake it.
  // The ChooseYourUniverse / onboarding flow handles first-run UX.
  if (ctx.isNewUser) return null;
  // Also guard against partial data (no last session AND no stats) so
  // we don't render an empty panel with placeholder fields.
  if (!ctx.lastDomain && !ctx.lastDTUTitle && (!ctx.stats || ctx.stats.totalDTUs === 0)) {
    return null;
  }

  return (
    <div
      className={cn(
        ds.panel,
        'relative border-neon-cyan/30 bg-gradient-to-r from-lattice-surface to-neon-cyan/5'
      )}
    >
      {/* Dismiss button */}
      <button
        onClick={handleDismiss}
        aria-label="Dismiss welcome message"
        className="absolute top-3 right-3 p-1 text-gray-500 hover:text-white rounded transition-colors"
      >
        <X className="w-4 h-4" />
      </button>

      {/* Welcome message */}
      <div className="flex items-start gap-3 mb-4">
        <Brain className="w-6 h-6 text-neon-cyan mt-0.5 shrink-0" />
        <div>
          <h3 className="text-lg font-semibold text-white">{ctx.welcome}</h3>
          {ctx.lastDomain && ctx.lastDTUTitle && (
            <p className="text-sm text-gray-400 mt-1">
              You were last working on <span className="text-neon-cyan">{ctx.lastDomain}</span>:
              &ldquo;{ctx.lastDTUTitle}&rdquo;
            </p>
          )}
        </div>
      </div>

      {/* Quick stats */}
      <div className="flex flex-wrap items-center gap-4 mb-4 text-sm">
        <span className="flex items-center gap-1.5 text-gray-300">
          <Zap className="w-4 h-4 text-neon-blue" />
          {ctx.stats.totalDTUs} DTUs across {ctx.stats.domains} domains
        </span>
        {ctx.xp.streak > 0 && (
          <span className="flex items-center gap-1.5 text-amber-400">
            <Flame className="w-4 h-4" />
            {ctx.xp.streak}-day streak
          </span>
        )}
        <span className="flex items-center gap-1.5 text-neon-cyan">
          <Sparkles className="w-4 h-4" />
          {ctx.xp.title} (Lv {ctx.xp.level})
        </span>
      </div>

      {/* Alerts row */}
      <div className="flex flex-wrap gap-3">
        {/* Stale DTUs */}
        {ctx.staleDTUs.length > 0 && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-400/10 border border-amber-400/20 text-sm">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="text-amber-300">
              {ctx.staleDTUs.length} stale DTU{ctx.staleDTUs.length > 1 ? 's' : ''} need attention
            </span>
          </div>
        )}

        {/* Ghost insights */}
        {ctx.ghostInsights.length > 0 && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-neon-cyan/10 border border-neon-cyan/20 text-sm">
            <Sparkles className="w-4 h-4 text-neon-cyan shrink-0" />
            <span className="text-neon-cyan">{ctx.ghostInsights[0].content}</span>
          </div>
        )}

        {/* Active goals */}
        {ctx.activeGoals.length > 0 && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-neon-green/10 border border-neon-green/20 text-sm">
            <Target className="w-4 h-4 text-neon-green shrink-0" />
            <span className="text-neon-green">
              {ctx.activeGoals.length} active goal{ctx.activeGoals.length > 1 ? 's' : ''} —
              {ctx.activeGoals[0].title} ({ctx.activeGoals[0].progress}%)
            </span>
          </div>
        )}

        {/* Continue button */}
        {ctx.lastDomain && (
          <Link
            href={`/lenses/${ctx.lastDomain}`}
            onClick={handleDismiss}
            className={cn(
              ds.btnSmall,
              'text-neon-cyan border border-neon-cyan/30 hover:bg-neon-cyan/20'
            )}
          >
            Continue in {ctx.lastDomain}
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        )}
      </div>
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedContextResurrection = withErrorBoundary(ContextResurrection);
export { _WrappedContextResurrection as ContextResurrection };
