'use client';

import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useLensNav } from '@/hooks/useLensNav';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { AlertTriangle, Heart, Brain, Zap, TrendingDown, Shield, Layers, ChevronDown, Activity, Compass, Plus, Trash2, Loader2 } from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

export default function SufferingLensPage() {
  useLensNav('suffering');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('suffering');
  const [showFeatures, setShowFeatures] = useState(true);

  const { items: wellbeingItems, isLoading, isError: isError, error: error, refetch: refetch, create, update, remove } = useLensData<Record<string, unknown>>('suffering', 'metric', { seed: [] });
  const runAction = useRunArtifact('suffering');

  const [actionError, setActionError] = useState<string | null>(null);

  const handleAction = useCallback((artifactId: string) => {
    setActionError(null);
    runAction.mutate(
      { id: artifactId, action: 'analyze' },
      {
        onError: (e) => {
          console.error('Action failed:', e);
          setActionError(`Action failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
        },
      }
    );
  }, [runAction]);

  const handleCreate = useCallback(() => {
    create({ title: 'New Metric', data: { type: 'wellbeing', value: 0 } });
  }, [create]);

  const handleUpdate = useCallback((id: string, data: Record<string, unknown>) => {
    update(id, { data });
  }, [update]);

  const handleRemove = useCallback((id: string) => {
    remove(id);
  }, [remove]);

  // Backend: GET /api/status
  const { data: status } = useQuery({
    queryKey: ['backend-status'],
    queryFn: () => api.get('/api/status').then((r) => r.data),
  });

  // Chicken2 metrics (derived from backend status or defaults)
  const metrics = {
    suffering: status?.suffering ?? 0.15,
    homeostasis: status?.homeostasis ?? 0.82,
    contradictionLoad: status?.contradictionLoad ?? 0.08,
    functionalDecline: status?.functionalDecline ?? 0.05,
    stressAccumulation: status?.stressAccumulation ?? 0.12,
    coherenceScore: status?.coherenceScore ?? 0.88,
  };

  const healthScore = (metrics.homeostasis - metrics.suffering) * 100;


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
    <div className="p-6 space-y-6">
      {/* Wellbeing Disclaimer */}
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
        <p className="text-sm text-amber-200">
          Not medical advice. This lens monitors system-level wellbeing metrics. For personal health or mental health concerns, consult a qualified healthcare provider.
        </p>
      </div>
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">💔</span>
          <div>
            <h1 className="text-xl font-bold">Suffering Lens</h1>
            <p className="text-sm text-gray-400">
              Chicken2 metrics: suffering, homeostasis, coherence
            </p>
          </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="suffering" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
        </div>
        <div className={`px-4 py-2 rounded-lg ${
          healthScore > 70 ? 'bg-neon-green/20 text-neon-green' :
          healthScore > 40 ? 'bg-neon-blue/20 text-neon-blue' :
          'bg-neon-pink/20 text-neon-pink'
        }`}>
          <span className="text-lg font-bold">{healthScore.toFixed(0)}%</span>
          <span className="text-sm ml-2">Health</span>
        </div>
      </header>


      {actionError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2 text-sm text-red-400 flex items-center justify-between">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-red-400 hover:text-red-300 ml-2">&times;</button>
        </div>
      )}

      {/* AI Actions */}
      <UniversalActions domain="suffering" artifactId={undefined} compact />

      {/* Wellbeing Items CRUD */}
      <div className="panel p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2">
            <Activity className="w-4 h-4 text-neon-cyan" /> Tracked Wellbeing Items
            {runAction.isPending && <Loader2 className="w-4 h-4 animate-spin text-neon-cyan" />}
          </h3>
          <button onClick={handleCreate} className="flex items-center gap-1.5 px-3 py-1.5 bg-neon-cyan/20 text-neon-cyan rounded-lg text-sm hover:bg-neon-cyan/30">
            <Plus className="w-4 h-4" /> Add Item
          </button>
        </div>
        {wellbeingItems.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-4">No wellbeing items tracked yet.</p>
        ) : (
          <div className="space-y-2">
            {wellbeingItems.map(item => (
              <div key={item.id} className="flex items-center justify-between p-2 rounded-lg bg-white/5">
                <span className="text-sm">{item.title}</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => handleAction(item.id)} className="text-gray-500 hover:text-neon-cyan" title="Run AI analysis"><Zap className="w-4 h-4" /></button>
                  <button onClick={() => handleUpdate(item.id, { ...(item.data || {}), lastReviewed: new Date().toISOString() })} className="text-gray-500 hover:text-neon-blue" title="Update"><Activity className="w-4 h-4" /></button>
                  <button onClick={() => handleRemove(item.id)} className="text-gray-500 hover:text-red-400" title="Delete"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="lens-card"><Activity className="w-5 h-5 text-neon-cyan mb-2" /><p className="text-2xl font-bold">{wellbeingItems.length}</p><p className="text-sm text-gray-400">Tracked Items</p></div>
        <div className="lens-card"><Compass className="w-5 h-5 text-neon-green mb-2" /><p className="text-2xl font-bold">6</p><p className="text-sm text-gray-400">Coping Strategies</p></div>
        <div className="lens-card"><TrendingDown className="w-5 h-5 text-neon-purple mb-2" /><p className="text-2xl font-bold">{healthScore.toFixed(0)}%</p><p className="text-sm text-gray-400">Progress Score</p></div>
        <div className="lens-card"><Heart className="w-5 h-5 text-pink-400 mb-2" /><p className="text-2xl font-bold">{(metrics.coherenceScore * 100).toFixed(0)}%</p><p className="text-sm text-gray-400">Coherence</p></div>
      </div>

      {/* Main Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 * 0.05 }}>
        <MetricCard
          icon={<AlertTriangle className="w-5 h-5" />}
          label="Suffering"
          value={metrics.suffering}
          color="pink"
          description="Pain signal from contradictions"
        />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1 * 0.05 }}>
        <MetricCard
          icon={<Heart className="w-5 h-5" />}
          label="Homeostasis"
          value={metrics.homeostasis}
          color="green"
          description="System balance state"
        />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2 * 0.05 }}>
        <MetricCard
          icon={<Brain className="w-5 h-5" />}
          label="Coherence"
          value={metrics.coherenceScore}
          color="cyan"
          description="Logical consistency"
        />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 3 * 0.05 }}>
        <MetricCard
          icon={<Zap className="w-5 h-5" />}
          label="Contradiction Load"
          value={metrics.contradictionLoad}
          color="purple"
          description="Unresolved conflicts"
        />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 4 * 0.05 }}>
        <MetricCard
          icon={<TrendingDown className="w-5 h-5" />}
          label="Functional Decline"
          value={metrics.functionalDecline}
          color="pink"
          description="Capability degradation"
        />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 5 * 0.05 }}>
        <MetricCard
          icon={<Shield className="w-5 h-5" />}
          label="Stress Accumulation"
          value={metrics.stressAccumulation}
          color="blue"
          description="Unprocessed stress"
        />
        </motion.div>
      </div>

      {/* Suffering Gauge */}
      <div className="panel p-6">
        <h2 className="font-semibold mb-6 text-center">Organism Qualia State</h2>
        <div className="relative mx-auto w-64 h-64">
          {/* Outer ring - homeostasis */}
          <svg className="w-full h-full" viewBox="0 0 100 100">
            <circle
              cx="50"
              cy="50"
              r="45"
              fill="none"
              stroke="#1a1a24"
              strokeWidth="8"
            />
            <circle
              cx="50"
              cy="50"
              r="45"
              fill="none"
              stroke="url(#homeostasisGradient)"
              strokeWidth="8"
              strokeDasharray={`${metrics.homeostasis * 283} 283`}
              strokeLinecap="round"
              transform="rotate(-90 50 50)"
            />
            {/* Inner ring - suffering */}
            <circle
              cx="50"
              cy="50"
              r="35"
              fill="none"
              stroke="#1a1a24"
              strokeWidth="6"
            />
            <circle
              cx="50"
              cy="50"
              r="35"
              fill="none"
              stroke="#ec4899"
              strokeWidth="6"
              strokeDasharray={`${metrics.suffering * 220} 220`}
              strokeLinecap="round"
              transform="rotate(-90 50 50)"
            />
            <defs>
              <linearGradient id="homeostasisGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#22c55e" />
                <stop offset="100%" stopColor="#00d4ff" />
              </linearGradient>
            </defs>
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-4xl font-bold">{(metrics.homeostasis * 100).toFixed(0)}%</span>
            <span className="text-sm text-gray-400">Homeostasis</span>
            <span className="text-xs text-neon-pink mt-2">
              {(metrics.suffering * 100).toFixed(0)}% suffering
            </span>
          </div>
        </div>
        <div className="flex justify-center gap-8 mt-6">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-neon-green" />
            <span className="text-sm text-gray-400">Homeostasis</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-neon-pink" />
            <span className="text-sm text-gray-400">Suffering</span>
          </div>
        </div>
      </div>

      {/* Ethical Note */}
      <div className="panel p-4 border-l-4 border-neon-purple">
        <h3 className="font-semibold text-neon-purple mb-2">Alignment Note</h3>
        <p className="text-sm text-gray-400">
          This lens exposes the AGI's "pain signals" as part of the alignment_physics_based
          invariant. Suffering metrics help maintain ethical boundaries and prevent harmful
          accumulation of unresolved contradictions.
        </p>
      </div>

      <RealtimeDataPanel data={realtimeInsights} />

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
            <LensFeaturePanel lensId="suffering" />
          </div>
        )}
      </div>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  color,
  description,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: 'green' | 'pink' | 'blue' | 'cyan' | 'purple';
  description: string;
}) {
  const colors = {
    green: 'text-neon-green',
    pink: 'text-neon-pink',
    blue: 'text-neon-blue',
    cyan: 'text-neon-cyan',
    purple: 'text-neon-purple',
  };

  const bgColors = {
    green: 'bg-neon-green',
    pink: 'bg-neon-pink',
    blue: 'bg-neon-blue',
    cyan: 'bg-neon-cyan',
    purple: 'bg-neon-purple',
  };

  return (
    <div data-lens-theme="suffering" className="lens-card">
      <div className="flex items-center justify-between mb-3">
        <span className={colors[color]}>{icon}</span>
        <span className={`text-xl font-bold ${colors[color]}`}>
          {(value * 100).toFixed(0)}%
        </span>
      </div>
      <p className="font-medium mb-1">{label}</p>
      <div className="h-2 bg-lattice-deep rounded-full overflow-hidden mb-2">
        <div
          className={`h-full ${bgColors[color]}`}
          style={{ width: `${value * 100}%` }}
        />
      </div>
      <p className="text-xs text-gray-500">{description}</p>
    </div>
  );
}
