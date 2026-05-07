'use client';

import { useState, useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  Building2,
  Plus,
  Search,
  Trash2,
  BarChart3,
  MapPin,
  TreePine,
  Landmark,
  Route,
  Ruler,
  AlertTriangle,
  Map,
  Zap,
} from 'lucide-react';

const MapView = dynamic(() => import('@/components/common/MapView'), { ssr: false });
import { LensPageShell } from '@/components/lens/LensPageShell';

type ModeTab =
  | 'Dashboard'
  | 'Projects'
  | 'Zoning'
  | 'Infrastructure'
  | 'Transit'
  | 'GreenSpace'
  | 'Permits'
  | 'Map';

interface ProjectData {
  name: string;
  status: 'proposed' | 'approved' | 'in_progress' | 'completed' | 'rejected';
  type: 'residential' | 'commercial' | 'mixed_use' | 'industrial' | 'public' | 'green_space';
  district: string;
  area: number;
  budget: number;
  timeline: string;
  architect: string;
  densityUnits: number;
  environmentalImpact: 'low' | 'moderate' | 'significant';
  publicHearingDate: string;
  description: string;
  lat?: number;
  lng?: number;
}

interface ZoningData {
  zone: string;
  type: 'R1' | 'R2' | 'R3' | 'C1' | 'C2' | 'M1' | 'M2' | 'PD' | 'OS';
  maxHeight: number;
  far: number;
  lotCoverage: number;
  setback: { front: number; side: number; rear: number };
  parkingReq: string;
  status: 'active' | 'amendment_pending' | 'variance_granted';
  district: string;
}

interface InfraData {
  name: string;
  type: 'road' | 'bridge' | 'water' | 'sewer' | 'electric' | 'fiber' | 'stormwater';
  condition: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
  capacity: string;
  lastInspection: string;
  maintenanceDue: string;
  estimatedCost: number;
  district: string;
}

type ArtifactDataUnion = ProjectData | ZoningData | InfraData | Record<string, unknown>;

const MODE_TABS: { key: ModeTab; label: string; icon: typeof Building2 }[] = [
  { key: 'Dashboard', label: 'Dashboard', icon: BarChart3 },
  { key: 'Projects', label: 'Projects', icon: Building2 },
  { key: 'Zoning', label: 'Zoning', icon: Map },
  { key: 'Infrastructure', label: 'Infrastructure', icon: Route },
  { key: 'Transit', label: 'Transit', icon: Landmark },
  { key: 'GreenSpace', label: 'Green Space', icon: TreePine },
  { key: 'Permits', label: 'Permits', icon: Ruler },
  { key: 'Map', label: 'Map', icon: MapPin },
];

function getTypeForTab(tab: ModeTab): string {
  const map: Record<ModeTab, string> = {
    Dashboard: 'Project',
    Projects: 'Project',
    Zoning: 'Zone',
    Infrastructure: 'Infra',
    Transit: 'Transit',
    GreenSpace: 'GreenSpace',
    Permits: 'Permit',
    Map: 'Project',
  };
  return map[tab];
}

const STATUS_COLORS: Record<string, string> = {
  proposed: 'text-blue-400 bg-blue-400/10',
  approved: 'text-green-400 bg-green-400/10',
  in_progress: 'text-yellow-400 bg-yellow-400/10',
  completed: 'text-gray-400 bg-gray-400/10',
  rejected: 'text-red-400 bg-red-400/10',
  active: 'text-green-400 bg-green-400/10',
  amendment_pending: 'text-orange-400 bg-orange-400/10',
  variance_granted: 'text-purple-400 bg-purple-400/10',
  excellent: 'text-green-400 bg-green-400/10',
  good: 'text-blue-400 bg-blue-400/10',
  fair: 'text-yellow-400 bg-yellow-400/10',
  poor: 'text-orange-400 bg-orange-400/10',
  critical: 'text-red-400 bg-red-400/10',
};

export default function UrbanPlanningLensPage() {
  const [activeMode, setActiveMode] = useState<ModeTab>('Dashboard');
  const [searchQuery, setSearchQuery] = useState('');

  const currentType = getTypeForTab(activeMode);
  const { items, isLoading, isError, error, refetch, create, remove } =
    useLensData<ArtifactDataUnion>('urban-planning', currentType, {
      search: searchQuery || undefined,
    });

  const { items: projects } = useLensData<ProjectData>('urban-planning', 'Project', { seed: [] });
  const { items: infra } = useLensData<InfraData>('urban-planning', 'Infra', { seed: [] });

  const runAction = useRunArtifact('urban-planning');

  const handleAction = useCallback(
    async (action: string, artifactId?: string) => {
      const targetId = artifactId || items[0]?.id;
      if (!targetId) return;
      try {
        await runAction.mutateAsync({ id: targetId, action });
      } catch (err) {
        console.error('Action failed:', err);
      }
    },
    [items, runAction]
  );

  const stats = useMemo(
    () => ({
      activeProjects: projects.filter((p) =>
        ['approved', 'in_progress'].includes((p.data as ProjectData).status)
      ).length,
      totalProjects: projects.length,
      criticalInfra: infra.filter((i) =>
        ['poor', 'critical'].includes((i.data as InfraData).condition)
      ).length,
      totalInfra: infra.length,
    }),
    [projects, infra]
  );

  return (
    <LensPageShell
      domain="urban-planning"
      title="Urban Planning"
      description="Projects, zoning, infrastructure & transit planning"
      headerIcon={<Building2 className="w-5 h-5 text-emerald-400" />}
      isLoading={isLoading}
      isError={isError}
      error={error}
      onRetry={refetch}
      actions={
        runAction.isPending ? (
          <span className="text-xs text-neon-cyan animate-pulse">AI processing...</span>
        ) : undefined
      }
    >
      <div className="flex gap-1 bg-zinc-900 rounded-lg p-1 flex-wrap">
        {MODE_TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveMode(key)}
            className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors',
              activeMode === key ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'
            )}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Search ${currentType.toLowerCase()}s...`}
            className="w-full pl-9 pr-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-white placeholder-gray-500"
          />
        </div>
        <button
          onClick={() => create({ title: `New ${currentType}`, data: {} })}
          className="flex items-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm"
        >
          <Plus className="w-4 h-4" /> New {currentType}
        </button>
      </div>

      {activeMode === 'Dashboard' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              {
                label: 'Active Projects',
                value: stats.activeProjects,
                total: stats.totalProjects,
                color: 'emerald',
                icon: Building2,
              },
              {
                label: 'Critical Infrastructure',
                value: stats.criticalInfra,
                total: stats.totalInfra,
                color: 'red',
                icon: AlertTriangle,
              },
              {
                label: 'Total Zones',
                value: items.length,
                total: items.length,
                color: 'blue',
                icon: Map,
              },
              {
                label: 'Pending Permits',
                value: projects.filter((p) => (p.data as ProjectData).status === 'proposed').length,
                total: stats.totalProjects,
                color: 'amber',
                icon: Ruler,
              },
            ].map((s, i) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className="p-3 bg-zinc-900 rounded-lg border border-zinc-800"
              >
                <s.icon className={`w-4 h-4 text-${s.color}-400 mb-1`} />
                <p className={`text-2xl font-bold text-${s.color}-400`}>{s.value}</p>
                <p className="text-xs text-gray-400">{s.label}</p>
                <p className="text-xs text-gray-600">of {s.total} total</p>
              </motion.div>
            ))}
          </div>

          {/* Zoning Map Color Legend */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="p-4 bg-zinc-900 rounded-lg border border-zinc-800"
          >
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Landmark className="w-4 h-4 text-emerald-400" /> Zoning Classification Legend
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
              {[
                {
                  zone: 'R1 - Low Density Residential',
                  color: 'bg-green-500',
                  textColor: 'text-green-400',
                },
                {
                  zone: 'R2 - Medium Residential',
                  color: 'bg-green-600',
                  textColor: 'text-green-500',
                },
                {
                  zone: 'R3 - High Density Residential',
                  color: 'bg-green-700',
                  textColor: 'text-green-600',
                },
                {
                  zone: 'C1 - Neighborhood Commercial',
                  color: 'bg-blue-500',
                  textColor: 'text-blue-400',
                },
                {
                  zone: 'C2 - General Commercial',
                  color: 'bg-blue-600',
                  textColor: 'text-blue-500',
                },
                {
                  zone: 'M1 - Light Industrial',
                  color: 'bg-orange-500',
                  textColor: 'text-orange-400',
                },
                {
                  zone: 'M2 - Heavy Industrial',
                  color: 'bg-orange-600',
                  textColor: 'text-orange-500',
                },
                {
                  zone: 'PD - Planned Development',
                  color: 'bg-purple-500',
                  textColor: 'text-purple-400',
                },
                { zone: 'OS - Open Space', color: 'bg-emerald-500', textColor: 'text-emerald-400' },
              ].map((z) => (
                <div key={z.zone} className="flex items-center gap-2">
                  <div className={cn('w-4 h-4 rounded-sm flex-shrink-0', z.color)} />
                  <span className={cn('text-xs', z.textColor)}>{z.zone}</span>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      )}

      <AnimatePresence mode="popLayout">
        <div className="space-y-2">
          {items.map((item, i) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ delay: i * 0.05 }}
              className="p-4 bg-zinc-900 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-semibold text-white">{item.title}</h3>
                  {!!(item.data as Record<string, unknown>).status && (
                    <span
                      className={cn(
                        'text-xs px-2 py-0.5 rounded-full',
                        STATUS_COLORS[String((item.data as Record<string, unknown>).status)] ||
                          'text-gray-400 bg-gray-400/10'
                      )}
                    >
                      {String((item.data as Record<string, unknown>).status)}
                    </span>
                  )}
                  {!!(item.data as Record<string, unknown>).type && (
                    <span className="text-xs px-2 py-0.5 rounded-full text-emerald-400 bg-emerald-400/10">
                      {String((item.data as Record<string, unknown>).type)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleAction('analyze', item.id)}
                    className="p-1.5 hover:bg-zinc-800 rounded text-gray-500 hover:text-neon-cyan"
                  >
                    <Zap className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => remove(item.id)}
                    className="p-1.5 hover:bg-zinc-800 rounded text-gray-500 hover:text-red-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {!!(item.data as Record<string, unknown>).description && (
                <p className="text-xs text-gray-500 mt-2">
                  {String((item.data as Record<string, unknown>).description)}
                </p>
              )}
              {!!(item.data as Record<string, unknown>).district && (
                <p className="text-xs text-gray-600 mt-1 flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {String((item.data as Record<string, unknown>).district)}
                </p>
              )}
            </motion.div>
          ))}
          {items.length === 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-12 text-gray-500"
            >
              <Building2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No {currentType.toLowerCase()}s found</p>
            </motion.div>
          )}
        </div>
      </AnimatePresence>

      {activeMode === 'Map' && (
        <div className="p-4 bg-zinc-900 rounded-lg border border-zinc-800">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-emerald-400" /> Zoning & Project Map
          </h3>
          <MapView
            markers={projects
              .filter((p) => (p.data as ProjectData).lat && (p.data as ProjectData).lng)
              .map((p) => {
                const d = p.data as ProjectData;
                return {
                  lat: d.lat!,
                  lng: d.lng!,
                  label: p.title,
                  popup: `${d.type || ''} - ${d.status || ''}`,
                };
              })}
            className="h-[500px]"
          />
        </div>
      )}

      <UniversalActions domain="urban-planning" artifactId={items[0]?.id} />
    </LensPageShell>
  );
}
