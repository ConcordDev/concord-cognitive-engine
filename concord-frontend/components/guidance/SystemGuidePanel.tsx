'use client';

/**
 * SystemGuidePanel — Always-visible guidance sidebar panel.
 *
 * Shows:
 * - System health summary (DB, storage, job queue)
 * - Context-aware suggestions
 * - First-win progress
 * - Recent activity feed (inline)
 * - Quick actions
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import {
  Lightbulb,
  CheckCircle,
  Circle,
  ChevronRight,
  Activity,
  AlertTriangle,
  Minimize2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface HealthData {
  ok: boolean;
  dbWritable: boolean;
  storageWritable: boolean;
  jobQueue: Record<string, number>;
  recentErrors: number;
  counts: Record<string, number>;
  uptime: number;
  authMode: string;
}

interface Suggestion {
  id: string;
  priority: number;
  title: string;
  description: string;
  action: string;
  icon: string;
}

interface FirstWinStep {
  id: string;
  label: string;
  completed: boolean;
}

interface FirstWinData {
  steps: FirstWinStep[];
  allDone: boolean;
  completedCount: number;
}

interface EventItem {
  id: string;
  type: string;
  summary: string;
  createdAt: string;
  undoToken: string | null;
  scope: string;
  entityType: string | null;
}

function SystemGuidePanel() {
  const [collapsed, setCollapsed] = useState(false);

  const { data: health } = useQuery<HealthData>({
    queryKey: ['system-health'],
    queryFn: async () => (await api.get('/api/system/health')).data,
    refetchInterval: 15_000,
    retry: 1,
  });

  const { data: suggestionsData } = useQuery<{ suggestions: Suggestion[] }>({
    queryKey: ['guidance-suggestions'],
    queryFn: async () => (await api.get('/api/guidance/suggestions')).data,
    refetchInterval: 30_000,
  });

  const { data: firstWin } = useQuery<FirstWinData>({
    queryKey: ['guidance-first-win'],
    queryFn: async () => (await api.get('/api/guidance/first-win')).data,
    refetchInterval: 30_000,
  });

  const { data: eventsData } = useQuery<{ items: EventItem[] }>({
    queryKey: ['guidance-events-recent'],
    queryFn: async () => (await api.get('/api/events/paginated', { params: { limit: 8 } })).data,
    refetchInterval: 10_000,
  });

  const suggestions = suggestionsData?.suggestions || [];
  const events = eventsData?.items || [];
  const showFirstWin = firstWin && !firstWin.allDone;

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="fixed top-20 right-4 z-30 p-2 rounded-lg bg-lattice-surface border border-lattice-border hover:bg-lattice-border/50 transition-colors"
        title="Expand Guide"
      >
        <Lightbulb className="w-4 h-4 text-neon-blue" />
      </button>
    );
  }

  return (
    <div className="fixed top-16 right-0 z-30 w-72 h-[calc(100vh-4rem)] bg-lattice-surface border-l border-lattice-border overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-lattice-border sticky top-0 bg-lattice-surface z-10">
        <span className="text-sm font-medium text-white flex items-center gap-1.5">
          <Lightbulb className="w-4 h-4 text-neon-blue" />
          Guide
        </span>
        <button
          onClick={() => setCollapsed(true)}
          className="text-gray-500 hover:text-white"
          aria-label="Collapse guide panel"
        >
          <Minimize2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Health strip */}
      <div className="px-3 py-2 border-b border-lattice-border/50">
        <div className="flex items-center gap-2 text-xs">
          <HealthDot ok={health?.dbWritable} label="DB" />
          <HealthDot ok={health?.storageWritable} label="Storage" />
          <HealthDot ok={health?.ok} label="API" />
          {(health?.recentErrors || 0) > 0 && (
            <span className="ml-auto text-amber-400 flex items-center gap-0.5">
              <AlertTriangle className="w-3 h-3" />
              {health?.recentErrors}
            </span>
          )}
        </div>
        {health?.counts && (
          <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500">
            {Object.entries(health.counts).map(([k, v]) => (
              <span key={k}>
                {k}: {v}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* First-win wizard */}
      {showFirstWin && (
        <div className="px-3 py-2 border-b border-lattice-border/50">
          <div className="text-xs font-medium text-neon-green mb-1.5">
            Getting Started ({firstWin.completedCount}/{firstWin.steps.length})
          </div>
          <div className="space-y-1">
            {firstWin.steps.map((step) => (
              <div key={step.id} className="flex items-center gap-1.5 text-xs">
                {step.completed ? (
                  <CheckCircle className="w-3.5 h-3.5 text-neon-green" />
                ) : (
                  <Circle className="w-3.5 h-3.5 text-gray-600" />
                )}
                <span
                  className={cn(step.completed ? 'text-gray-500 line-through' : 'text-gray-300')}
                >
                  {step.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="px-3 py-2 border-b border-lattice-border/50">
          <div className="text-xs font-medium text-gray-400 mb-1.5">Suggestions</div>
          <div className="space-y-1.5">
            {suggestions.slice(0, 3).map((s) => (
              <div
                key={s.id}
                className="flex items-start gap-2 p-1.5 rounded bg-neon-blue/5 border border-neon-blue/10 text-xs cursor-pointer hover:bg-neon-blue/10 transition-colors"
              >
                <ChevronRight className="w-3 h-3 text-neon-blue mt-0.5 flex-shrink-0" />
                <div>
                  <div className="text-white font-medium">{s.title}</div>
                  <div className="text-gray-500 mt-0.5">{s.description}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Activity feed */}
      <div className="px-3 py-2">
        <div className="text-xs font-medium text-gray-400 mb-1.5 flex items-center gap-1">
          <Activity className="w-3 h-3" />
          Recent Activity
        </div>
        {events.length === 0 ? (
          <p className="text-xs text-gray-600">No recent events</p>
        ) : (
          <div className="space-y-1">
            {events.map((evt) => (
              <div key={evt.id} className="text-xs p-1 rounded hover:bg-lattice-border/30">
                <div className="flex items-center gap-1">
                  <span className="font-mono text-gray-600">{formatTime(evt.createdAt)}</span>
                  {evt.undoToken && (
                    <span className="text-neon-blue text-[10px]" title="Undoable">
                      undo
                    </span>
                  )}
                </div>
                <div className="text-gray-400 truncate">{evt.summary || evt.type}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function HealthDot({ ok, label }: { ok?: boolean; label: string }) {
  return (
    <span className="flex items-center gap-0.5 text-xs">
      <span
        className={cn(
          'w-1.5 h-1.5 rounded-full',
          ok === true ? 'bg-neon-green' : ok === false ? 'bg-red-500' : 'bg-gray-600'
        )}
      />
      <span className="text-gray-500">{label}</span>
    </span>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso.slice(11, 16);
  }
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedSystemGuidePanel = withErrorBoundary(SystemGuidePanel);
export { _WrappedSystemGuidePanel as SystemGuidePanel };
