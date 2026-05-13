'use client';

/**
 * PersonalAgentPanel — Shows proactive insights from the user's personal AI agent.
 * Meeting preps, overdue alerts, workout adjustments, meal reminders.
 */

import { useState, useEffect, useCallback } from 'react';
import { Bot, RefreshCw } from 'lucide-react';
import { agentStatus, agentTick } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';

interface AgentInsight {
  type: 'meeting_prep' | 'overdue_alert' | 'workout_adjustment' | 'meal_reminder';
  suggestion: string;
  event?: { title: string; hoursUntil: number };
  items?: { name: string }[];
}

interface PersonalAgentPanelProps {
  socket?: {
    on: (event: string, handler: (data: unknown) => void) => void;
    off: (event: string, handler: (data: unknown) => void) => void;
  };
  onAction?: (insight: AgentInsight) => void;
}

export function PersonalAgentPanel({ socket, onAction }: PersonalAgentPanelProps) {
  const [insights, setInsights] = useState<AgentInsight[]>([]);
  const [statusData, setStatusData] = useState<{ active?: boolean; lastTick?: string } | null>(null);
  const [ticking, setTicking] = useState(false);

  // Load agent status on mount
  useEffect(() => {
    agentStatus()
      .then(data => {
        setStatusData(data);
        if (data?.insights) setInsights(data.insights);
      })
      .catch(() => { /* agent may not be active yet */ });
  }, []);

  // Listen for real-time insight updates via socket
  useEffect(() => {
    if (!socket) return;
    const handler = (data: unknown) => {
      const d = data as { insights: AgentInsight[] };
      if (d?.insights) setInsights(d.insights);
    };
    socket.on('agent:insights', handler);
    return () => {
      socket.off('agent:insights', handler);
    };
  }, [socket]);

  // Manual tick to request fresh insights from the agent
  const handleTick = useCallback(async () => {
    setTicking(true);
    try {
      const data = await agentTick();
      if (data?.insights) setInsights(data.insights);
    } catch (e) { console.error('[Agent] Failed to fetch insights:', e); useUIStore.getState().addToast({ type: 'error', message: 'Failed to refresh agent insights' }); }
    finally { setTicking(false); }
  }, []);

  if (insights.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-zinc-400 flex items-center gap-2">
          <Bot className="w-4 h-4 text-purple-400" />
          Your Agent
          {statusData && (
            <span className={`ml-1 text-xs ${statusData.active ? 'text-green-400' : 'text-zinc-600'}`}>
              {statusData.active ? '● Active' : '○ Inactive'}
            </span>
          )}
        </h3>
        {statusData?.lastTick && (
          <span className="text-[10px] text-zinc-600">
            Last tick: {new Date(statusData.lastTick).toLocaleTimeString()}
          </span>
        )}
        <button
          onClick={handleTick}
          disabled={ticking}
          className="p-1 text-zinc-500 hover:text-purple-400 transition-colors"
          title="Refresh insights"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${ticking ? 'animate-spin' : ''}`} />
        </button>
      </div>
      {insights.map((insight, i) => (
        <div
          key={i}
          className="p-3 rounded-lg bg-zinc-800/50 border border-zinc-700
            hover:border-purple-500/30 transition-colors"
        >
          <p className="text-sm text-zinc-200">{insight.suggestion}</p>
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => onAction?.(insight)}
              className="text-xs px-2 py-1 rounded bg-purple-500/10
                text-purple-400 border border-purple-500/30
                hover:bg-purple-500/20 transition-colors"
            >
              Do it
            </button>
            <button
              onClick={() => { window.dispatchEvent(new CustomEvent('agent:insight-defer', { detail: { insight } })); }}
              className="text-xs px-2 py-1 rounded bg-zinc-800
              text-zinc-500 border border-zinc-700
              hover:bg-zinc-700 transition-colors"
            >
              Later
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
