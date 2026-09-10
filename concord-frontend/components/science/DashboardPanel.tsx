'use client';

/**
 * Science lab dashboard — pipeline meters + recent experiments.
 * Extracted from the fat science page (no behavior invented).
 */

import { useMemo } from 'react';
import {
  Activity,
  TestTubes,
  Wrench,
  GraduationCap,
  LineChart,
  AlertTriangle,
  FlaskConical,
  BookOpen,
  FileText,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import {
  type Experiment,
  type SampleData,
  type EquipmentData,
  type AnalysisData,
  type PublicationData,
  ALL_STATUSES,
  PUB_STATUSES,
  EQUIPMENT_CONDITIONS,
  STATUS_COLORS,
} from '@/components/science/science-types';

function statusBadge(status: string) {
  const color = STATUS_COLORS[status] || 'gray-400';
  return <span className={ds.badge(color)}>{status.replace(/_/g, ' ')}</span>;
}

export function DashboardPanel() {
  const { items: experiments } = useLensData<Experiment>('science', 'Experiment', { seed: [] });
  const { items: samples } = useLensData<SampleData>('science', 'Sample', { seed: [] });
  const { items: equipment } = useLensData<EquipmentData>('science', 'Equipment', { seed: [] });
  const { items: analyses } = useLensData<AnalysisData>('science', 'Analysis', { seed: [] });
  const { items: publications } = useLensData<PublicationData>('science', 'Publication', { seed: [] });

  const dashboardStats = useMemo(() => {
    const activeExperiments = experiments.filter((i) => i.meta.status === 'active').length;
    const samplesInInventory = samples.filter((i) => i.meta.status !== 'disposed').length;
    const eqDueCalibration = equipment.filter((i) => {
      const d = i.data as unknown as EquipmentData;
      if (!d.nextCalibration) return false;
      const next = new Date(d.nextCalibration);
      const now = new Date();
      const diff = (next.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      return diff <= 30;
    }).length;
    const pendingAnalyses = analyses.filter(
      (i) => i.meta.status === 'analyzing' || i.meta.status === 'active',
    ).length;
    const pubsThisYear = publications.filter((i) => {
      const d = i.data as unknown as PublicationData;
      return d.status === 'published' || i.meta.status === 'published';
    }).length;
    const hazardousSamples = samples.filter((i) => {
      const d = i.data as unknown as SampleData;
      return d.hazardClass && d.hazardClass !== 'none';
    }).length;
    return {
      activeExperiments,
      samplesInInventory,
      eqDueCalibration,
      pendingAnalyses,
      pubsThisYear,
      hazardousSamples,
    };
  }, [experiments, samples, equipment, analyses, publications]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 }} className="panel p-3 flex items-center gap-3">
          <FlaskConical className="w-5 h-5 text-neon-purple" />
          <div>
            <p className="text-lg font-bold">{experiments.length}</p>
            <p className="text-xs text-gray-400">Experiments</p>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="panel p-3 flex items-center gap-3">
          <BookOpen className="w-5 h-5 text-neon-green" />
          <div>
            <p className="text-lg font-bold">{publications.length}</p>
            <p className="text-xs text-gray-400">Published</p>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="panel p-3 flex items-center gap-3">
          <FileText className="w-5 h-5 text-neon-blue" />
          <div>
            <p className="text-lg font-bold">
              {publications.reduce(
                (sum, p) => sum + (((p.data as unknown as Record<string, unknown>)?.citations as number) || 0),
                0,
              )}
            </p>
            <p className="text-xs text-gray-400">Citations</p>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="panel p-3 flex items-center gap-3">
          <TestTubes className="w-5 h-5 text-neon-cyan" />
          <div>
            <p className="text-lg font-bold">{samples.length}</p>
            <p className="text-xs text-gray-400">Samples</p>
          </div>
        </motion.div>
      </div>

          {/* Key Metrics */}
          <div className={ds.grid4}>
            <div className={ds.panel}>
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-5 h-5 text-green-400" />
                <span className={ds.textMuted}>Active Experiments</span>
              </div>
              <p className="text-3xl font-bold text-white">{dashboardStats.activeExperiments}</p>
              <p className={ds.textMuted}>Currently running</p>
            </div>
            <div className={ds.panel}>
              <div className="flex items-center gap-2 mb-2">
                <TestTubes className="w-5 h-5 text-blue-400" />
                <span className={ds.textMuted}>Samples in Inventory</span>
              </div>
              <p className="text-3xl font-bold text-white">{dashboardStats.samplesInInventory}</p>
              <p className={ds.textMuted}>{dashboardStats.hazardousSamples} hazardous</p>
            </div>
            <div className={ds.panel}>
              <div className="flex items-center gap-2 mb-2">
                <Wrench className="w-5 h-5 text-yellow-400" />
                <span className={ds.textMuted}>Equipment Due Calibration</span>
              </div>
              <p
                className={cn(
                  'text-3xl font-bold',
                  dashboardStats.eqDueCalibration > 0 ? 'text-yellow-400' : 'text-white'
                )}
              >
                {dashboardStats.eqDueCalibration}
              </p>
              <p className={ds.textMuted}>Within 30 days</p>
            </div>
            <div className={ds.panel}>
              <div className="flex items-center gap-2 mb-2">
                <GraduationCap className="w-5 h-5 text-neon-cyan" />
                <span className={ds.textMuted}>Publications This Year</span>
              </div>
              <p className="text-3xl font-bold text-neon-cyan">{dashboardStats.pubsThisYear}</p>
              <p className={ds.textMuted}>Published papers</p>
            </div>
          </div>

          {/* Pending Analyses */}
          <div className={ds.grid2}>
            <div className={ds.panel}>
              <div className="flex items-center gap-2 mb-2">
                <LineChart className="w-5 h-5 text-neon-purple" />
                <span className={ds.textMuted}>Pending Analyses</span>
              </div>
              <p className="text-3xl font-bold text-neon-purple">{dashboardStats.pendingAnalyses}</p>
              <p className={ds.textMuted}>Awaiting completion</p>
            </div>
            <div className={ds.panel}>
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-5 h-5 text-red-400" />
                <span className={ds.textMuted}>Hazardous Samples</span>
              </div>
              <p className="text-3xl font-bold text-red-400">{dashboardStats.hazardousSamples}</p>
              <p className={ds.textMuted}>Require special handling</p>
            </div>
          </div>

          {/* Experiment Pipeline */}
          <div className={ds.panel}>
            <h3 className={cn(ds.heading3, 'mb-4')}>Experiment Pipeline</h3>
            <div className={ds.grid3}>
              {ALL_STATUSES.map((s) => {
                const count = experiments.filter((i) => i.meta.status === s).length;
                return (
                  <div
                    key={s}
                    className="flex items-center justify-between p-3 rounded-lg bg-lattice-elevated/30"
                  >
                    <span className="text-sm text-gray-300 capitalize">{s.replace(/_/g, ' ')}</span>
                    <span className={ds.badge(STATUS_COLORS[s] || 'gray-400')}>{count}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Recent experiments */}
          <div className={ds.panel}>
            <h3 className={cn(ds.heading3, 'mb-3')}>Recent Experiments</h3>
            {experiments.length === 0 ? (
              <p className={ds.textMuted}>No experiments recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {experiments.slice(0, 5).map((item) => {
                  const d = item.data as unknown as Experiment;
                  return (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-lattice-elevated/30 hover:bg-lattice-elevated/50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{item.title}</p>
                        <p className={cn(ds.textMuted, 'text-xs truncate')}>{d.hypothesis}</p>
                      </div>
                      {statusBadge(item.meta.status)}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Publication tracker summary */}
          <div className={ds.panel}>
            <h3 className={cn(ds.heading3, 'mb-3')}>Publication Pipeline</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
              {PUB_STATUSES.map((s) => {
                const count = publications.filter((i) => {
                  const d = i.data as unknown as PublicationData;
                  return d.status === s || i.meta.status === s;
                }).length;
                return (
                  <div key={s} className="text-center p-2 rounded-lg bg-lattice-elevated/30">
                    <p className="text-lg font-bold text-white">{count}</p>
                    <p className={cn(ds.textMuted, 'text-xs capitalize')}>{s.replace(/_/g, ' ')}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Equipment status overview */}
          <div className={ds.panel}>
            <h3 className={cn(ds.heading3, 'mb-3')}>Equipment Status</h3>
            <div className="space-y-2">
              {EQUIPMENT_CONDITIONS.map((c) => {
                const count = equipment.filter((i) => {
                  const d = i.data as unknown as EquipmentData;
                  return d.condition === c || i.meta.status === c;
                }).length;
                return (
                  <div key={c} className="flex items-center gap-3">
                    <span className="w-36 text-sm text-gray-400 capitalize">
                      {c.replace(/_/g, ' ')}
                    </span>
                    <div className="flex-1 h-2 bg-lattice-elevated rounded-full overflow-hidden">
                      <div
                        className={`h-full bg-${STATUS_COLORS[c] || 'gray-400'} rounded-full transition-all`}
                        style={{
                          width: `${equipment.length > 0 ? (count / equipment.length) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <span className={cn(ds.textMono, 'w-8 text-right')}>{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
    </div>
  );
}

export default DashboardPanel;
