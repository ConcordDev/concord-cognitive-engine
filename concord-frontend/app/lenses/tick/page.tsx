'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Clock,
  Zap,
  Activity,
  Play,
  Pause,
  RefreshCw,
  Heart,
  AlertTriangle,
  CheckCircle,
  TrendingUp,
  BarChart3,
  Timer,
  Layers,
  ChevronDown,
  Eye,
  Gauge,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { X } from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

interface TickEvent {
  id: string;
  type: string;
  signal: number;
  stress: number;
  timestamp: string;
  organ?: string;
}

type TickViewTab = 'stream' | 'stats' | 'timeline' | 'health';

// ============================================================================
// Heartbeat Pulse Visualization
// ============================================================================

function HeartbeatPulse({ isLive, lastTickTime }: { isLive: boolean; lastTickTime: number | null }) {
  const [pulse, setPulse] = useState(false);
  const prevTickRef = useRef<number | null>(null);

  useEffect(() => {
    if (lastTickTime && lastTickTime !== prevTickRef.current) {
      prevTickRef.current = lastTickTime;
      setPulse(true);
      const timeout = setTimeout(() => setPulse(false), 400);
      return () => clearTimeout(timeout);
    }
  }, [lastTickTime]);

  return (
    <div className="flex items-center gap-3">
      <div className="relative flex items-center justify-center">
        {/* Outer ring pulse */}
        <div
          className={`absolute w-12 h-12 rounded-full transition-all duration-500 ${
            pulse ? 'scale-150 opacity-0' : 'scale-100 opacity-0'
          }`}
          style={{ backgroundColor: isLive ? 'rgba(0,255,200,0.2)' : 'rgba(107,114,128,0.1)' }}
        />
        {/* Inner pulse ring */}
        <div
          className={`absolute w-10 h-10 rounded-full transition-all duration-300 ${
            pulse ? 'scale-125 opacity-0' : 'scale-100 opacity-0'
          }`}
          style={{ backgroundColor: isLive ? 'rgba(0,255,200,0.3)' : 'rgba(107,114,128,0.15)' }}
        />
        {/* Core heartbeat dot */}
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200 ${
            pulse ? 'scale-110' : 'scale-100'
          }`}
          style={{
            backgroundColor: isLive ? (pulse ? 'rgba(0,255,200,0.4)' : 'rgba(0,255,200,0.15)') : 'rgba(107,114,128,0.1)',
            boxShadow: pulse && isLive ? '0 0 20px rgba(0,255,200,0.4)' : 'none',
          }}
        >
          <Heart
            className={`w-4 h-4 transition-all duration-200 ${pulse ? 'scale-125' : 'scale-100'}`}
            style={{ color: isLive ? '#00ffc8' : '#6b7280' }}
            fill={pulse && isLive ? '#00ffc8' : 'none'}
          />
        </div>
      </div>
      <div>
        <p className="text-sm font-medium" style={{ color: isLive ? '#00ffc8' : '#6b7280' }}>
          {isLive ? 'Live' : 'Paused'}
        </p>
        <p className="text-[10px] text-gray-600 font-mono">
          {lastTickTime ? `Last: ${new Date(lastTickTime).toLocaleTimeString()}` : 'Waiting...'}
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// ECG-style Heartbeat Line Canvas
// ============================================================================

function HeartbeatLineCanvas({ ticks, isLive }: { ticks: TickEvent[]; isLive: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offsetRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = canvas.offsetWidth * 2;
    canvas.height = canvas.offsetHeight * 2;
    ctx.scale(2, 2);

    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    const midY = h / 2;

    // Background
    ctx.fillStyle = 'rgba(5,5,16,0.9)';
    ctx.fillRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 0.5;
    for (let y = 0; y < h; y += 20) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    for (let x = 0; x < w; x += 20) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    if (ticks.length === 0) {
      // Flat line
      ctx.beginPath();
      ctx.moveTo(0, midY);
      ctx.lineTo(w, midY);
      ctx.strokeStyle = 'rgba(107,114,128,0.3)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      return;
    }

    // Draw ECG-like trace
    const displayTicks = ticks.slice(0, 60);
    const segmentWidth = w / Math.max(displayTicks.length, 1);

    ctx.beginPath();
    ctx.moveTo(0, midY);

    displayTicks.forEach((tick, i) => {
      const x = i * segmentWidth;
      const amplitude = tick.signal * (h * 0.35);
      const stressBoost = tick.stress * (h * 0.1);

      // ECG-like pattern per tick: small bump, big spike, recovery
      const p1 = x + segmentWidth * 0.15;
      const p2 = x + segmentWidth * 0.3;
      const p3 = x + segmentWidth * 0.45;
      const p4 = x + segmentWidth * 0.55;
      const p5 = x + segmentWidth * 0.75;

      ctx.lineTo(p1, midY - amplitude * 0.2);           // small P-wave bump
      ctx.lineTo(p2, midY + stressBoost * 0.3);          // small dip
      ctx.lineTo(p3, midY - amplitude - stressBoost);     // main QRS spike up
      ctx.lineTo(p4, midY + amplitude * 0.4);             // recovery dip
      ctx.lineTo(p5, midY - amplitude * 0.15);            // T-wave bump
      ctx.lineTo(x + segmentWidth, midY);                 // return to baseline
    });

    // Gradient stroke
    const gradient = ctx.createLinearGradient(0, 0, w, 0);
    gradient.addColorStop(0, 'rgba(0,255,200,0.3)');
    gradient.addColorStop(0.5, isLive ? '#00ffc8' : '#6b7280');
    gradient.addColorStop(1, isLive ? '#00ffc8' : '#6b7280');
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Glow effect
    ctx.shadowColor = isLive ? '#00ffc8' : '#6b7280';
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.shadowBlur = 0;

    offsetRef.current += 1;
  }, [ticks, isLive]);

  return <canvas ref={canvasRef} className="w-full h-full" />;
}

// ============================================================================
// Event Timeline Canvas
// ============================================================================

function EventTimelineCanvas({ ticks }: { ticks: TickEvent[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || ticks.length < 2) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = canvas.offsetWidth * 2;
    canvas.height = canvas.offsetHeight * 2;
    ctx.scale(2, 2);

    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    const padding = { top: 20, bottom: 30, left: 50, right: 20 };
    const plotW = w - padding.left - padding.right;
    const plotH = h - padding.top - padding.bottom;

    // Background
    ctx.fillStyle = 'rgba(5,5,16,0.8)';
    ctx.fillRect(0, 0, w, h);

    const timestamps = ticks.map(t => new Date(t.timestamp).getTime());
    const minT = Math.min(...timestamps);
    const maxT = Math.max(...timestamps);
    const timeRange = maxT - minT || 1;

    // Draw timeline axis
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left, h - padding.bottom);
    ctx.lineTo(w - padding.right, h - padding.bottom);
    ctx.stroke();

    // Y-axis label
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('signal', padding.left - 8, padding.top + 10);
    ctx.fillText('stress', padding.left - 8, padding.top + plotH * 0.6 + 10);

    // Time labels
    ctx.textAlign = 'center';
    const tickCount = 5;
    for (let i = 0; i <= tickCount; i++) {
      const t = minT + (timeRange * i / tickCount);
      const x = padding.left + (plotW * i / tickCount);
      ctx.fillText(new Date(t).toLocaleTimeString(), x, h - 8);

      ctx.strokeStyle = 'rgba(255,255,255,0.03)';
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, h - padding.bottom);
      ctx.stroke();
    }

    // Plot events as dots along timeline
    const typeColors: Record<string, string> = {
      kernel: '#00ffc8',
      error: '#ef4444',
      warning: '#eab308',
      info: '#3b82f6',
      synthesis: '#a855f7',
    };

    ticks.forEach(tick => {
      const ts = new Date(tick.timestamp).getTime();
      const x = padding.left + ((ts - minT) / timeRange) * plotW;
      const signalY = padding.top + (1 - tick.signal) * plotH * 0.45;
      const stressY = padding.top + plotH * 0.55 + (1 - tick.stress) * plotH * 0.4;
      const color = typeColors[tick.type] || '#00ffc8';

      // Signal dot
      ctx.beginPath();
      ctx.arc(x, signalY, 3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.7;
      ctx.fill();
      ctx.globalAlpha = 1;

      // Stress dot (smaller, below)
      ctx.beginPath();
      ctx.arc(x, stressY, 2, 0, Math.PI * 2);
      ctx.fillStyle = tick.stress > 0.2 ? '#ef4444' : '#6b7280';
      ctx.globalAlpha = 0.5;
      ctx.fill();
      ctx.globalAlpha = 1;
    });

    // Divider between signal and stress
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top + plotH * 0.5);
    ctx.lineTo(w - padding.right, padding.top + plotH * 0.5);
    ctx.stroke();
    ctx.setLineDash([]);

  }, [ticks]);

  return <canvas ref={canvasRef} className="w-full h-full" />;
}

// ============================================================================
// Main Page Component
// ============================================================================

export default function TickLensPage() {
  useLensNav('tick');
  const { latestData: realtimeData, isLive: rtIsLive, lastUpdated, insights } = useRealtimeLens('tick');
  const [isLive, setIsLive] = useState(true);
  const [tickHistory, setTickHistory] = useState<TickEvent[]>([]);
  const [activeTab, setActiveTab] = useState<TickViewTab>('stream');
  const [showFeatures, setShowFeatures] = useState(true);
  const { items: tickItems } = useLensData<Record<string, unknown>>('tick', 'heartbeat');
  const runTickAction = useRunArtifact('tick');
  const [tickActionResult, setTickActionResult] = useState<{ action: string; result: Record<string, unknown> } | null>(null);
  const [tickActiveAction, setTickActiveAction] = useState<string | null>(null);

  const handleTickAction = useCallback(async (action: string) => {
    const id = tickItems[0]?.id;
    if (!id) return;
    setTickActiveAction(action);
    try {
      const res = await runTickAction.mutateAsync({ id, action });
      if (res.ok) setTickActionResult({ action, result: res.result as Record<string, unknown> });
    } finally {
      setTickActiveAction(null);
    }
  }, [tickItems, runTickAction]);

  // Backend: GET /api/events for tick history
  const { data: events, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['events'],
    queryFn: () => api.get('/api/events').then((r) => r.data),
    refetchInterval: isLive ? 2000 : false,
  });

  // Track the last event set to avoid unnecessary re-renders
  const prevEventIdsRef = useRef<string>('');

  // Derive tick events from real event data (no random values)
  useEffect(() => {
    if (events?.events) {
      const eventIds = events.events
        .slice(0, 50)
        .map((e: Record<string, unknown>) => e.id || '')
        .join(',');
      if (eventIds === prevEventIdsRef.current) return;
      prevEventIdsRef.current = eventIds;

      const ticks: TickEvent[] = events.events.slice(0, 50).map((e: Record<string, unknown>, i: number) => ({
        id: (e.id as string) || `tick-${i}`,
        type: (e.type as string) || 'kernel',
        signal: Number(e.severity ?? e.priority ?? 0.5),
        stress: Number(e.stress ?? e.urgency ?? (e.type === 'error' ? 0.25 : 0.1)),
        timestamp: (e.at as string) || (e.timestamp as string) || new Date().toISOString(),
        organ: (e.source as string) || (e.domain as string) || 'unknown',
      }));
      setTickHistory(ticks);
    }
  }, [events]);

  // ---- Computed Statistics ----
  const stats = useMemo(() => {
    if (tickHistory.length === 0) {
      return {
        avgSignal: 0,
        avgStress: 0,
        minSignal: 0,
        maxSignal: 0,
        minStress: 0,
        maxStress: 0,
        avgInterval: 0,
        minInterval: 0,
        maxInterval: 0,
        missedTicks: 0,
        totalTicks: 0,
        typeBreakdown: {} as Record<string, number>,
        organBreakdown: {} as Record<string, number>,
      };
    }

    const signals = tickHistory.map(t => t.signal);
    const stresses = tickHistory.map(t => t.stress);
    const avgSignal = signals.reduce((s, v) => s + v, 0) / signals.length;
    const avgStress = stresses.reduce((s, v) => s + v, 0) / stresses.length;

    // Interval calculation
    const timestamps = tickHistory
      .map(t => new Date(t.timestamp).getTime())
      .filter(t => !isNaN(t))
      .sort((a, b) => a - b);

    const intervals: number[] = [];
    for (let i = 1; i < timestamps.length; i++) {
      intervals.push(timestamps[i] - timestamps[i - 1]);
    }

    const avgInterval = intervals.length > 0 ? intervals.reduce((s, v) => s + v, 0) / intervals.length : 0;
    const minInterval = intervals.length > 0 ? Math.min(...intervals) : 0;
    const maxInterval = intervals.length > 0 ? Math.max(...intervals) : 0;

    // Detect missed ticks: intervals > 3x average
    const missedTicks = avgInterval > 0 ? intervals.filter(i => i > avgInterval * 3).length : 0;

    // Type breakdown
    const typeBreakdown: Record<string, number> = {};
    const organBreakdown: Record<string, number> = {};
    tickHistory.forEach(t => {
      typeBreakdown[t.type] = (typeBreakdown[t.type] || 0) + 1;
      if (t.organ) organBreakdown[t.organ] = (organBreakdown[t.organ] || 0) + 1;
    });

    return {
      avgSignal,
      avgStress,
      minSignal: Math.min(...signals),
      maxSignal: Math.max(...signals),
      minStress: Math.min(...stresses),
      maxStress: Math.max(...stresses),
      avgInterval,
      minInterval,
      maxInterval,
      missedTicks,
      totalTicks: tickHistory.length,
      typeBreakdown,
      organBreakdown,
    };
  }, [tickHistory]);

  // ---- Health Derivation ----
  const healthStatus = useMemo(() => {
    if (tickHistory.length < 3) return { level: 'unknown' as const, message: 'Insufficient data', score: 0 };

    let score = 100;

    // Penalize high average stress
    if (stats.avgStress > 0.3) score -= 20;
    else if (stats.avgStress > 0.15) score -= 10;

    // Penalize low average signal
    if (stats.avgSignal < 0.2) score -= 15;

    // Penalize missed ticks
    score -= stats.missedTicks * 10;

    // Penalize high interval variance
    if (stats.maxInterval > 0 && stats.minInterval > 0) {
      const ratio = stats.maxInterval / stats.minInterval;
      if (ratio > 10) score -= 20;
      else if (ratio > 5) score -= 10;
    }

    // Penalize error-type events
    const errorCount = stats.typeBreakdown['error'] || 0;
    score -= errorCount * 5;

    score = Math.max(0, Math.min(100, score));

    const level = score >= 80 ? 'healthy' as const
      : score >= 50 ? 'degraded' as const
      : 'critical' as const;

    const message = level === 'healthy' ? 'System operating normally'
      : level === 'degraded' ? 'Some irregularities detected'
      : 'Significant issues detected';

    return { level, message, score };
  }, [tickHistory.length, stats]);

  const lastTickTime = tickHistory.length > 0
    ? new Date(tickHistory[0].timestamp).getTime()
    : null;

  const formatMs = useCallback((ms: number) => {
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div data-lens-theme="tick" className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <HeartbeatPulse isLive={isLive} lastTickTime={lastTickTime} />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">Tick Lens</h1>
              <LiveIndicator isLive={rtIsLive} lastUpdated={lastUpdated} />
            </div>
            <p className="text-sm text-gray-400">
              Real-time kernel tick stream and system health monitoring
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DTUExportButton domain="tick" data={{}} compact />
          <button
            onClick={() => setIsLive(!isLive)}
            className={`btn-neon ${isLive ? 'green' : ''}`}
          >
            {isLive ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            <span className="ml-2">{isLive ? 'Live' : 'Paused'}</span>
          </button>
        </div>
      </header>

      <RealtimeDataPanel domain="tick" data={realtimeData} isLive={rtIsLive} lastUpdated={lastUpdated} insights={insights} compact />

      {/* Quick Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 * 0.05 }} className="panel p-3 flex items-center gap-3">
          <Zap className="w-5 h-5 text-neon-cyan" />
          <div>
            <p className="text-lg font-bold">{stats.totalTicks}</p>
            <p className="text-xs text-gray-500">Ticks Processed</p>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1 * 0.05 }} className="panel p-3 flex items-center gap-3">
          <Gauge className="w-5 h-5 text-neon-green" />
          <div>
            <p className="text-lg font-bold">{formatMs(stats.avgInterval)}</p>
            <p className="text-xs text-gray-500">Avg Interval</p>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2 * 0.05 }} className="panel p-3 flex items-center gap-3">
          <Eye className="w-5 h-5 text-neon-purple" />
          <div>
            <p className="text-lg font-bold">{Object.keys(stats.organBreakdown).length}</p>
            <p className="text-xs text-gray-500">Active Watchers</p>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 3 * 0.05 }} className="panel p-3 flex items-center gap-3">
          <Heart className="w-5 h-5 text-neon-pink" />
          <div>
            <p className="text-lg font-bold">{healthStatus.score}%</p>
            <p className="text-xs text-gray-500">Health Score</p>
          </div>
        </motion.div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {([
          { id: 'stream' as TickViewTab, icon: Activity, label: 'Stream' },
          { id: 'stats' as TickViewTab, icon: BarChart3, label: 'Statistics' },
          { id: 'timeline' as TickViewTab, icon: Timer, label: 'Timeline' },
          { id: 'health' as TickViewTab, icon: Heart, label: 'Health' },
        ]).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm transition-all ${
              activeTab === tab.id
                ? 'bg-neon-purple/20 text-neon-purple border border-neon-purple/30'
                : 'bg-lattice-surface text-gray-400 hover:text-gray-300'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ================================================================ */}
      {/* STREAM TAB */}
      {/* ================================================================ */}
      {activeTab === 'stream' && (
        <>
          {/* Tick Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="lens-card">
              <Clock className="w-5 h-5 text-neon-blue mb-2" />
              <p className="text-2xl font-bold">{tickHistory.length}</p>
              <p className="text-sm text-gray-400">Total Ticks</p>
            </div>
            <div className="lens-card">
              <Zap className="w-5 h-5 text-neon-green mb-2" />
              <p className="text-2xl font-bold">{(stats.avgSignal * 100).toFixed(0)}%</p>
              <p className="text-sm text-gray-400">Avg Signal</p>
            </div>
            <div className="lens-card">
              <Activity className="w-5 h-5 text-neon-pink mb-2" />
              <p className="text-2xl font-bold">{(stats.avgStress * 100).toFixed(0)}%</p>
              <p className="text-sm text-gray-400">Avg Stress</p>
            </div>
            <div className="lens-card">
              <RefreshCw className={`w-5 h-5 text-neon-cyan mb-2 ${isLive ? 'animate-spin' : ''}`} />
              <p className="text-2xl font-bold">{isLive ? '2s' : '\u2014'}</p>
              <p className="text-sm text-gray-400">Refresh Rate</p>
            </div>
          </div>

          {/* Heartbeat ECG Visualization */}
          <div className="panel p-4">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <Heart className="w-4 h-4 text-neon-green" />
              Heartbeat Monitor
            </h2>
            <div className="h-40 rounded-lg overflow-hidden border border-white/5">
              <HeartbeatLineCanvas ticks={tickHistory} isLive={isLive} />
            </div>
            <div className="flex justify-between text-xs text-gray-500 mt-2">
              <span>Oldest</span>
              <span className="text-gray-600">
                {isLive && <span className="inline-block w-1.5 h-1.5 rounded-full bg-neon-green mr-1 animate-pulse" />}
                {tickHistory.length} events
              </span>
              <span>Most Recent</span>
            </div>
          </div>

          {/* Signal Wave Visualization */}
          <div className="panel p-4">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <Activity className="w-4 h-4 text-neon-blue" />
              Signal Wave
            </h2>
            <div className="h-32 flex items-end gap-1">
              {tickHistory.slice(0, 40).map((tick) => (
                <div
                  key={tick.id}
                  className="flex-1 bg-gradient-to-t from-neon-blue to-neon-cyan rounded-t transition-all"
                  style={{
                    height: `${tick.signal * 100}%`,
                    opacity: 0.5 + (tick.signal * 0.5),
                  }}
                />
              ))}
            </div>
            <div className="flex justify-between text-xs text-gray-500 mt-2">
              <span>Oldest</span>
              <span>Most Recent</span>
            </div>
          </div>

          {/* Tick Event Log */}
          <div className="panel p-4">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <Clock className="w-4 h-4 text-neon-purple" />
              Tick Event Log
            </h2>
            <div className="space-y-2 max-h-80 overflow-auto">
              {tickHistory.slice(0, 20).map((tick, index) => (
                <motion.div
                  key={tick.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="flex items-center justify-between p-3 bg-lattice-deep rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <span className={`w-2 h-2 rounded-full ${
                      tick.stress > 0.2 ? 'bg-neon-pink' : 'bg-neon-green'
                    }`} />
                    <div>
                      <p className="text-sm font-medium">{tick.type}</p>
                      <p className="text-xs text-gray-400">{tick.organ}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-mono text-neon-cyan">
                      {(tick.signal * 100).toFixed(0)}%
                    </p>
                    <p className="text-xs text-gray-400">
                      {new Date(tick.timestamp).toLocaleTimeString()}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ================================================================ */}
      {/* STATISTICS TAB */}
      {/* ================================================================ */}
      {activeTab === 'stats' && (
        <div className="space-y-6">
          {/* Core metrics grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="lens-card">
              <Zap className="w-5 h-5 text-neon-green mb-2" />
              <p className="text-2xl font-bold">{(stats.avgSignal * 100).toFixed(1)}%</p>
              <p className="text-sm text-gray-400">Avg Signal</p>
              <p className="text-xs text-gray-600 mt-1">
                Min: {(stats.minSignal * 100).toFixed(0)}% / Max: {(stats.maxSignal * 100).toFixed(0)}%
              </p>
            </div>
            <div className="lens-card">
              <Activity className="w-5 h-5 text-neon-pink mb-2" />
              <p className="text-2xl font-bold">{(stats.avgStress * 100).toFixed(1)}%</p>
              <p className="text-sm text-gray-400">Avg Stress</p>
              <p className="text-xs text-gray-600 mt-1">
                Min: {(stats.minStress * 100).toFixed(0)}% / Max: {(stats.maxStress * 100).toFixed(0)}%
              </p>
            </div>
            <div className="lens-card">
              <Timer className="w-5 h-5 text-neon-blue mb-2" />
              <p className="text-2xl font-bold">{formatMs(stats.avgInterval)}</p>
              <p className="text-sm text-gray-400">Avg Interval</p>
              <p className="text-xs text-gray-600 mt-1">
                Min: {formatMs(stats.minInterval)} / Max: {formatMs(stats.maxInterval)}
              </p>
            </div>
            <div className="lens-card">
              <AlertTriangle className="w-5 h-5 text-neon-orange mb-2" />
              <p className="text-2xl font-bold">{stats.missedTicks}</p>
              <p className="text-sm text-gray-400">Missed Ticks</p>
              <p className="text-xs text-gray-600 mt-1">
                Gap &gt; 3x avg interval
              </p>
            </div>
          </div>

          {/* Type breakdown */}
          <div className="panel p-4">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-neon-cyan" />
              Event Type Distribution
            </h2>
            <div className="space-y-2">
              {Object.entries(stats.typeBreakdown)
                .sort(([, a], [, b]) => b - a)
                .map(([type, count]) => {
                  const pct = stats.totalTicks > 0 ? (count / stats.totalTicks) * 100 : 0;
                  return (
                    <div key={type} className="flex items-center gap-3">
                      <span className="text-xs font-mono text-gray-400 w-24 truncate">{type}</span>
                      <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-neon-blue to-neon-cyan"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono text-gray-500 w-16 text-right">
                        {count} ({pct.toFixed(0)}%)
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>

          {/* Organ breakdown */}
          <div className="panel p-4">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-neon-purple" />
              Source / Organ Distribution
            </h2>
            <div className="space-y-2">
              {Object.entries(stats.organBreakdown)
                .sort(([, a], [, b]) => b - a)
                .map(([organ, count]) => {
                  const pct = stats.totalTicks > 0 ? (count / stats.totalTicks) * 100 : 0;
                  return (
                    <div key={organ} className="flex items-center gap-3">
                      <span className="text-xs font-mono text-gray-400 w-24 truncate">{organ}</span>
                      <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-neon-purple to-neon-pink"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono text-gray-500 w-16 text-right">
                        {count} ({pct.toFixed(0)}%)
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* TIMELINE TAB */}
      {/* ================================================================ */}
      {activeTab === 'timeline' && (
        <div className="space-y-6">
          <div className="panel p-4">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <Timer className="w-4 h-4 text-neon-cyan" />
              Event Timeline
            </h2>
            <div className="h-64 rounded-lg overflow-hidden border border-white/5">
              <EventTimelineCanvas ticks={tickHistory} />
            </div>
            <div className="flex items-center gap-4 mt-3 text-[10px] text-gray-500">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-neon-green" /> Signal (upper)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500" /> Stress (lower)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-neon-blue" /> Info
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-neon-purple" /> Synthesis
              </span>
            </div>
          </div>

          {/* Scrollable event list with timestamps */}
          <div className="panel p-4">
            <h2 className="font-semibold mb-4">Event Sequence</h2>
            <div className="relative max-h-96 overflow-auto">
              {/* Timeline line */}
              <div className="absolute left-4 top-0 bottom-0 w-px bg-white/5" />
              <div className="space-y-1 pl-10">
                {tickHistory.map((tick, i) => {
                  const prevTick = tickHistory[i + 1];
                  const gap = prevTick
                    ? new Date(tick.timestamp).getTime() - new Date(prevTick.timestamp).getTime()
                    : 0;
                  const isGap = gap > stats.avgInterval * 3 && stats.avgInterval > 0;
                  return (
                    <div key={tick.id} className="relative">
                      {/* Timeline dot */}
                      <div
                        className={`absolute -left-[26px] top-3 w-2.5 h-2.5 rounded-full border ${
                          tick.stress > 0.2
                            ? 'bg-red-500/50 border-red-500'
                            : 'bg-neon-green/50 border-neon-green'
                        }`}
                      />
                      <div className={`flex items-center justify-between p-2 rounded-lg hover:bg-white/[0.02] ${
                        isGap ? 'border-l-2 border-yellow-500/30' : ''
                      }`}>
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] font-mono text-gray-600 w-20">
                            {new Date(tick.timestamp).toLocaleTimeString()}
                          </span>
                          <span className="text-xs font-medium text-gray-300">{tick.type}</span>
                          <span className="text-[10px] text-gray-600">{tick.organ}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs font-mono">
                          <span className="text-neon-cyan">{(tick.signal * 100).toFixed(0)}%</span>
                          <span className={tick.stress > 0.2 ? 'text-red-400' : 'text-gray-600'}>
                            S:{(tick.stress * 100).toFixed(0)}%
                          </span>
                          {isGap && (
                            <span className="text-yellow-500 text-[10px]">gap: {formatMs(gap)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* HEALTH TAB */}
      {/* ================================================================ */}
      {activeTab === 'health' && (
        <div className="space-y-6">
          {/* Overall health banner */}
          <div className={`panel p-6 border-l-4 ${
            healthStatus.level === 'healthy'
              ? 'border-l-green-500'
              : healthStatus.level === 'degraded'
              ? 'border-l-yellow-500'
              : 'border-l-red-500'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                {healthStatus.level === 'healthy' ? (
                  <CheckCircle className="w-8 h-8 text-green-400" />
                ) : healthStatus.level === 'degraded' ? (
                  <AlertTriangle className="w-8 h-8 text-yellow-400" />
                ) : (
                  <AlertTriangle className="w-8 h-8 text-red-400" />
                )}
                <div>
                  <h2 className="text-lg font-bold capitalize">{healthStatus.level}</h2>
                  <p className="text-sm text-gray-400">{healthStatus.message}</p>
                </div>
              </div>
              <div className="text-right">
                <p className={`text-4xl font-bold font-mono ${
                  healthStatus.score >= 80 ? 'text-green-400'
                  : healthStatus.score >= 50 ? 'text-yellow-400'
                  : 'text-red-400'
                }`}>
                  {healthStatus.score}
                </p>
                <p className="text-xs text-gray-500">Health Score</p>
              </div>
            </div>
          </div>

          {/* Health indicators grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {[
              {
                label: 'Tick Regularity',
                value: stats.avgInterval > 0 && stats.maxInterval > 0
                  ? Math.max(0, 100 - ((stats.maxInterval / stats.minInterval - 1) * 10))
                  : 0,
                good: 'Consistent intervals',
                bad: 'Irregular intervals',
                icon: Timer,
              },
              {
                label: 'Stress Level',
                value: Math.max(0, 100 - stats.avgStress * 200),
                good: 'Low stress',
                bad: 'Elevated stress',
                icon: Activity,
              },
              {
                label: 'Signal Strength',
                value: stats.avgSignal * 100,
                good: 'Strong signals',
                bad: 'Weak signals',
                icon: Zap,
              },
              {
                label: 'Error Rate',
                value: stats.totalTicks > 0
                  ? Math.max(0, 100 - ((stats.typeBreakdown['error'] || 0) / stats.totalTicks) * 500)
                  : 100,
                good: 'No errors',
                bad: 'Errors detected',
                icon: AlertTriangle,
              },
              {
                label: 'Tick Coverage',
                value: stats.totalTicks > 0 ? Math.min(100, (stats.totalTicks / 50) * 100) : 0,
                good: 'Sufficient data',
                bad: 'Insufficient data',
                icon: BarChart3,
              },
              {
                label: 'Gap Detection',
                value: Math.max(0, 100 - stats.missedTicks * 20),
                good: 'No gaps',
                bad: `${stats.missedTicks} gaps detected`,
                icon: Clock,
              },
            ].map(indicator => {
              const pct = Math.min(100, Math.max(0, indicator.value));
              const statusColor = pct >= 80 ? 'text-green-400' : pct >= 50 ? 'text-yellow-400' : 'text-red-400';
              const barColor = pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-yellow-500' : 'bg-red-500';
              return (
                <div key={indicator.label} className="panel p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <indicator.icon className={`w-4 h-4 ${statusColor}`} />
                      <span className="text-xs font-medium">{indicator.label}</span>
                    </div>
                    <span className={`text-sm font-mono font-bold ${statusColor}`}>
                      {pct.toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-[10px] text-gray-600 mt-2">
                    {pct >= 70 ? indicator.good : indicator.bad}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tick Actions Panel */}
      <div className="p-4 border-t border-lattice-border bg-lattice-surface/30">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
            <Zap className="w-4 h-4 text-neon-cyan" />
            Tick Actions
          </h3>
          {tickActionResult && (
            <button onClick={() => setTickActionResult(null)} className="p-1 rounded hover:bg-lattice-elevated text-gray-400">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2 mb-3">
          {(['healthPulse', 'loadPredict', 'rhythmAnalysis'] as const).map((action) => (
            <button
              key={action}
              onClick={() => handleTickAction(action)}
              disabled={!tickItems[0]?.id || tickActiveAction !== null}
              className="px-3 py-1.5 text-sm rounded-lg bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/30 hover:bg-neon-cyan/20 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {tickActiveAction === action ? (
                <div className="w-3 h-3 border border-neon-cyan border-t-transparent rounded-full animate-spin" />
              ) : null}
              {action === 'healthPulse' ? 'Health Pulse' : action === 'loadPredict' ? 'Load Predict' : 'Rhythm Analysis'}
            </button>
          ))}
        </div>
        {tickActionResult && (
          <div className="panel p-3 space-y-2 text-sm">
            {tickActionResult.action === 'healthPulse' && (() => {
              const r = tickActionResult.result;
              const status = String(r.systemStatus ?? 'unknown');
              const statusColor = status === 'healthy' ? 'text-neon-green' : status === 'degraded' ? 'text-yellow-400' : 'text-red-400';
              const summary = r.summary as Record<string, unknown> | undefined;
              return (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 text-xs">System Status:</span>
                    <span className={`text-xs font-semibold uppercase ${statusColor}`}>{status}</span>
                    <span className="text-gray-400 text-xs ml-2">Avg Health: <span className="text-white">{String(r.avgHealthScore ?? 0)}</span></span>
                  </div>
                  {summary && (
                    <div className="flex gap-4 text-xs">
                      <span className="text-neon-green">Healthy: {String(summary.healthy ?? 0)}</span>
                      <span className="text-yellow-400">Degraded: {String(summary.degraded ?? 0)}</span>
                      <span className="text-red-400">Critical: {String(summary.critical ?? 0)}</span>
                      <span className="text-gray-400">Dead: {String(summary.dead ?? 0)}</span>
                    </div>
                  )}
                </div>
              );
            })()}
            {tickActionResult.action === 'loadPredict' && (() => {
              const r = tickActionResult.result;
              const predictions = r.predictions as Record<string, Record<string, unknown>> | undefined;
              const keys = predictions ? Object.keys(predictions).slice(0, 3) : [];
              return (
                <div className="space-y-2">
                  <div className="text-xs text-gray-400">Data Points: <span className="text-white">{String(r.dataPoints ?? 0)}</span></div>
                  <div className="space-y-1">
                    {keys.map((key) => {
                      const pred = predictions![key];
                      const dir = String(pred.trendDirection ?? 'stable');
                      const dirColor = dir === 'increasing' ? 'text-red-400' : dir === 'decreasing' ? 'text-neon-green' : 'text-gray-300';
                      return (
                        <div key={key} className="flex items-center justify-between text-xs bg-lattice-elevated px-2 py-1 rounded">
                          <span className="text-gray-300 capitalize">{key}</span>
                          <span className="text-white">{String(pred.currentValue ?? 0)}</span>
                          <span className={dirColor}>{dir}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
            {tickActionResult.action === 'rhythmAnalysis' && (() => {
              const r = tickActionResult.result;
              const spectral = r.spectralAnalysis as Record<string, unknown> | undefined;
              const dominant = Array.isArray(r.dominantFrequencies) ? (r.dominantFrequencies as Array<Record<string, unknown>>)[0] : null;
              return (
                <div className="space-y-2">
                  {spectral && (
                    <div className="flex flex-wrap gap-3 text-xs">
                      <span className="text-gray-400">Rhythm: <span className="text-neon-cyan font-medium">{String(spectral.rhythmType ?? '-').replace(/_/g, ' ')}</span></span>
                      <span className="text-gray-400">Primary Period: <span className="text-white">{String(spectral.primaryPeriod ?? '-')}</span></span>
                      <span className="text-gray-400">Concentration: <span className="text-white">{String(spectral.spectralConcentration ?? 0)}%</span></span>
                    </div>
                  )}
                  {dominant && <div className="text-xs text-gray-400">Dominant Freq: <span className="text-white">{String(dominant.frequency ?? 0)} Hz</span> (period: <span className="text-white">{String(dominant.periodHuman ?? '-')}</span>)</div>}
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* Lens Features */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Lens Features & Capabilities
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} />
        </button>
        {showFeatures && (
          <div className="px-4 pb-4">
            <LensFeaturePanel lensId="tick" />
          </div>
        )}
      </div>
    </div>
  );
}
