'use client';

/**
 * XPWidget — Knowledge XP display for header bar.
 *
 * Shows current XP level, progress bar, streak counter, and title.
 * Clickable to expand into full gamification dashboard.
 *
 * Usage:
 *   <XPWidget />                // Inline header widget
 *   <XPWidget expanded />       // Full dashboard view
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { Flame, Zap, Trophy, TrendingUp, ChevronDown, ChevronUp } from 'lucide-react';

interface XPProfile {
  totalXP: number;
  level: number;
  title: string;
  streak: { current: number; longest: number; lastActiveDate: string | null; freezesUsed: number };
  xpToNextLevel: number;
  nextLevelTitle: string;
  xpProgress: number;
  xpRequired: number;
}

interface HeatmapDay {
  date: string;
  dtus: number;
  actions: number;
  xp: number;
}

interface XPWidgetProps {
  expanded?: boolean;
  className?: string;
}

function XPWidget({ expanded: defaultExpanded = false, className }: XPWidgetProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const { data: profile } = useQuery<{ ok: boolean } & XPProfile>({
    queryKey: ['xp-profile'],
    queryFn: async () => {
      const { data } = await api.get('/api/xp/profile');
      return data;
    },
    staleTime: 30000,
  });

  const { data: heatmapData } = useQuery<{
    ok: boolean;
    heatmap: HeatmapDay[];
    streak: XPProfile['streak'];
  }>({
    queryKey: ['xp-heatmap'],
    queryFn: async () => {
      const { data } = await api.get('/api/xp/heatmap?days=90');
      return data;
    },
    enabled: expanded,
    staleTime: 60000,
  });

  if (!profile) return null;

  const progressPercent =
    profile.xpRequired > 0 ? Math.round((profile.xpProgress / profile.xpRequired) * 100) : 0;

  return (
    <div className={cn('relative', className)}>
      {/* Inline widget */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all text-sm',
          'hover:bg-lattice-elevated border border-transparent hover:border-lattice-border',
          expanded && 'bg-lattice-elevated border-lattice-border'
        )}
      >
        {/* Streak fire */}
        {profile.streak.current > 0 && (
          <span className="flex items-center gap-0.5 text-amber-400">
            <Flame className="w-3.5 h-3.5" />
            <span className="text-xs font-bold">{profile.streak.current}</span>
          </span>
        )}
        {/* Level + XP */}
        <span className="flex items-center gap-1 text-neon-cyan">
          <Zap className="w-3.5 h-3.5" />
          <span className="text-xs font-medium">{profile.title}</span>
        </span>
        {/* Progress mini-bar */}
        <div className="w-12 h-1.5 bg-lattice-void rounded-full overflow-hidden">
          <div
            className="h-full bg-neon-cyan rounded-full transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        {expanded ? (
          <ChevronUp className="w-3 h-3 text-gray-500" />
        ) : (
          <ChevronDown className="w-3 h-3 text-gray-500" />
        )}
      </button>

      {/* Expanded dashboard */}
      {expanded && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-lattice-surface border border-lattice-border rounded-xl shadow-2xl z-50 overflow-hidden">
          {/* Header */}
          <div className="p-4 border-b border-lattice-border">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Trophy className="w-5 h-5 text-neon-cyan" />
                <span className="font-semibold text-white">{profile.title}</span>
                <span className="text-xs text-gray-500">Lv {profile.level}</span>
              </div>
              <span className="text-sm font-mono text-neon-cyan">
                {profile.totalXP.toLocaleString()} XP
              </span>
            </div>
            {/* Progress bar */}
            <div className="space-y-1">
              <div className="h-2 bg-lattice-void rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-neon-blue to-neon-cyan rounded-full transition-all duration-500"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-gray-500">
                <span>
                  {profile.xpProgress.toLocaleString()} / {profile.xpRequired.toLocaleString()}
                </span>
                <span>Next: {profile.nextLevelTitle}</span>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-px bg-lattice-border">
            <div className="bg-lattice-surface p-3 text-center">
              <Flame className="w-4 h-4 text-amber-400 mx-auto mb-1" />
              <p className="text-lg font-bold text-white">{profile.streak.current}</p>
              <p className="text-[10px] text-gray-500">Day Streak</p>
            </div>
            <div className="bg-lattice-surface p-3 text-center">
              <TrendingUp className="w-4 h-4 text-neon-green mx-auto mb-1" />
              <p className="text-lg font-bold text-white">{profile.streak.longest}</p>
              <p className="text-[10px] text-gray-500">Best Streak</p>
            </div>
            <div className="bg-lattice-surface p-3 text-center">
              <Zap className="w-4 h-4 text-neon-cyan mx-auto mb-1" />
              <p className="text-lg font-bold text-white">{profile.level}</p>
              <p className="text-[10px] text-gray-500">Level</p>
            </div>
          </div>

          {/* Contribution heatmap */}
          {heatmapData?.heatmap && (
            <div className="p-3">
              <p className="text-[11px] text-gray-500 mb-2">90-day contribution heatmap</p>
              <div className="flex flex-wrap gap-[2px]">
                {heatmapData.heatmap.map((day) => {
                  const intensity =
                    day.xp > 100 ? 4 : day.xp > 50 ? 3 : day.xp > 20 ? 2 : day.xp > 0 ? 1 : 0;
                  const colors = [
                    'bg-lattice-void',
                    'bg-neon-green/20',
                    'bg-neon-green/40',
                    'bg-neon-green/60',
                    'bg-neon-green/80',
                  ];
                  return (
                    <div
                      key={day.date}
                      className={cn('w-2.5 h-2.5 rounded-[2px]', colors[intensity])}
                      title={`${day.date}: ${day.xp} XP, ${day.dtus} DTUs`}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedXPWidget = withErrorBoundary(XPWidget);
export { _WrappedXPWidget as XPWidget };
