'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import {
  Shield, Plus, Search, Trash2, BarChart3,
  Layers, ChevronDown, MapPin,
  Siren, FileText, Scale, BadgeCheck,
  Eye, Fingerprint, Gavel, Zap,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

type ModeTab = 'Dashboard' | 'Cases' | 'Incidents' | 'Officers' | 'Evidence' | 'Patrols' | 'Warrants';

interface CaseData {
  caseNumber: string;
  type: 'criminal' | 'civil' | 'traffic' | 'domestic' | 'narcotics' | 'fraud' | 'homicide' | 'theft';
  status: 'open' | 'active' | 'closed' | 'cold' | 'pending_court' | 'suspended';
  priority: 'low' | 'medium' | 'high' | 'critical';
  detective: string;
  openedDate: string;
  description: string;
  suspects: number;
  witnesses: number;
  evidenceCount: number;
  jurisdiction: string;
  statute: string;
}

interface IncidentData {
  incidentNumber: string;
  type: 'disturbance' | 'accident' | 'assault' | 'burglary' | 'robbery' | 'dui' | 'missing_person' | 'shots_fired';
  status: 'dispatched' | 'en_route' | 'on_scene' | 'resolved' | 'report_filed';
  priority: 'P1' | 'P2' | 'P3' | 'P4';
  location: string;
  reportedAt: string;
  respondingOfficers: string[];
  narrative: string;
  callerInfo: string;
}

interface OfficerData {
  badgeNumber: string;
  name: string;
  rank: string;
  unit: string;
  status: 'on_duty' | 'off_duty' | 'on_leave' | 'administrative' | 'training';
  shift: 'day' | 'swing' | 'night';
  assignedBeat: string;
  yearsService: number;
  certifications: string[];
  fitnessStatus: string;
}

type ArtifactDataUnion = CaseData | IncidentData | OfficerData | Record<string, unknown>;

const MODE_TABS: { key: ModeTab; label: string; icon: typeof Shield }[] = [
  { key: 'Dashboard', label: 'Dashboard', icon: BarChart3 },
  { key: 'Cases', label: 'Cases', icon: FileText },
  { key: 'Incidents', label: 'Incidents', icon: Siren },
  { key: 'Officers', label: 'Officers', icon: BadgeCheck },
  { key: 'Evidence', label: 'Evidence', icon: Eye },
  { key: 'Patrols', label: 'Patrols', icon: MapPin },
  { key: 'Warrants', label: 'Warrants', icon: Scale },
];

function getTypeForTab(tab: ModeTab): string {
  const map: Record<ModeTab, string> = {
    Dashboard: 'Case', Cases: 'Case', Incidents: 'Incident',
    Officers: 'Officer', Evidence: 'Evidence', Patrols: 'Patrol', Warrants: 'Warrant',
  };
  return map[tab];
}

const STATUS_COLORS: Record<string, string> = {
  open: 'text-blue-400 bg-blue-400/10', active: 'text-green-400 bg-green-400/10',
  closed: 'text-gray-400 bg-gray-400/10', cold: 'text-cyan-400 bg-cyan-400/10',
  pending_court: 'text-yellow-400 bg-yellow-400/10', suspended: 'text-orange-400 bg-orange-400/10',
  dispatched: 'text-blue-400 bg-blue-400/10', en_route: 'text-yellow-400 bg-yellow-400/10',
  on_scene: 'text-green-400 bg-green-400/10', resolved: 'text-gray-400 bg-gray-400/10',
  report_filed: 'text-purple-400 bg-purple-400/10',
  on_duty: 'text-green-400 bg-green-400/10', off_duty: 'text-gray-400 bg-gray-400/10',
  on_leave: 'text-blue-400 bg-blue-400/10', administrative: 'text-orange-400 bg-orange-400/10',
  training: 'text-purple-400 bg-purple-400/10',
  P1: 'text-red-400 bg-red-400/10', P2: 'text-orange-400 bg-orange-400/10',
  P3: 'text-yellow-400 bg-yellow-400/10', P4: 'text-blue-400 bg-blue-400/10',
};

export default function LawEnforcementLensPage() {
  useLensNav('law-enforcement');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('law-enforcement');

  const [activeMode, setActiveMode] = useState<ModeTab>('Dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFeatures, setShowFeatures] = useState(true);

  const currentType = getTypeForTab(activeMode);
  const { items, isLoading, isError, error, refetch, create, remove } =
    useLensData<ArtifactDataUnion>('law-enforcement', currentType, { search: searchQuery || undefined });

  const { items: cases } = useLensData<CaseData>('law-enforcement', 'Case', { seed: [] });
  const { items: incidents } = useLensData<IncidentData>('law-enforcement', 'Incident', { seed: [] });
  const { items: officers } = useLensData<OfficerData>('law-enforcement', 'Officer', { seed: [] });

  const runAction = useRunArtifact('law-enforcement');

  const handleAction = useCallback(async (action: string, artifactId?: string) => {
    const targetId = artifactId || items[0]?.id;
    if (!targetId) return;
    try {
      await runAction.mutateAsync({ id: targetId, action });
    } catch (err) {
      console.error('Action failed:', err);
    }
  }, [items, runAction]);

  const stats = useMemo(() => ({
    openCases: cases.filter(c => ['open', 'active'].includes((c.data as CaseData).status)).length,
    totalCases: cases.length,
    activeIncidents: incidents.filter(i => ['dispatched', 'en_route', 'on_scene'].includes((i.data as IncidentData).status)).length,
    onDuty: officers.filter(o => (o.data as OfficerData).status === 'on_duty').length,
    totalOfficers: officers.length,
  }), [cases, incidents, officers]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading law enforcement systems...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return <div className="flex items-center justify-center h-full p-8"><ErrorState error={error?.message} onRetry={refetch} /></div>;
  }

  return (
    <div data-lens-theme="law-enforcement" className={cn(ds.pageContainer, 'space-y-4')}>
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-600/20 flex items-center justify-center">
            <Shield className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Law Enforcement</h1>
            <p className="text-sm text-gray-400">Cases, incidents, officers, evidence & patrol management</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {runAction.isPending && <span className="text-xs text-neon-cyan animate-pulse">AI processing...</span>}
          <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
          <DTUExportButton domain="law-enforcement" data={realtimeData || {}} compact />
        </div>
      </header>

      <div className="flex gap-1 bg-zinc-900 rounded-lg p-1 flex-wrap">
        {MODE_TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setActiveMode(key)}
            className={cn('flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors',
              activeMode === key ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300')}>
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            placeholder={`Search ${currentType.toLowerCase()}s...`}
            className="w-full pl-9 pr-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-white placeholder-gray-500" />
        </div>
        <button onClick={() => create({ title: `New ${currentType}`, data: {} })} className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm">
          <Plus className="w-4 h-4" /> New {currentType}
        </button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800">
          <div className="flex items-center gap-2 mb-1"><Fingerprint className="w-4 h-4 text-blue-400" /></div>
          <p className="text-2xl font-bold text-blue-400">{stats.openCases}</p>
          <p className="text-xs text-gray-400">Active Cases</p>
        </div>
        <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800">
          <div className="flex items-center gap-2 mb-1"><BadgeCheck className="w-4 h-4 text-green-400" /></div>
          <p className="text-2xl font-bold text-green-400">{stats.onDuty}</p>
          <p className="text-xs text-gray-400">Officers Assigned</p>
        </div>
        <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800">
          <div className="flex items-center gap-2 mb-1"><Siren className="w-4 h-4 text-red-400" /></div>
          <p className="text-2xl font-bold text-red-400">{stats.activeIncidents}</p>
          <p className="text-xs text-gray-400">Active Incidents</p>
        </div>
        <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800">
          <div className="flex items-center gap-2 mb-1"><Gavel className="w-4 h-4 text-yellow-400" /></div>
          <p className="text-2xl font-bold text-yellow-400">{cases.filter(c => (c.data as CaseData).priority === 'critical' || (c.data as CaseData).priority === 'high').length}</p>
          <p className="text-xs text-gray-400">High Priority</p>
        </div>
      </div>

      {activeMode === 'Dashboard' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Open Cases', value: stats.openCases, total: stats.totalCases, color: 'blue' },
            { label: 'Active Incidents', value: stats.activeIncidents, total: incidents.length, color: 'red' },
            { label: 'On Duty', value: stats.onDuty, total: stats.totalOfficers, color: 'green' },
          ].map(s => (
            <div key={s.label} className="p-3 bg-zinc-900 rounded-lg border border-zinc-800">
              <p className={`text-2xl font-bold text-${s.color}-400`}>{s.value}</p>
              <p className="text-xs text-gray-400">{s.label}</p>
              <p className="text-xs text-gray-600">of {s.total} total</p>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {items.map((item, index) => (
          <motion.div key={item.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className="p-4 bg-zinc-900 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-semibold text-white">{item.title}</h3>
                {!!(item.data as Record<string, unknown>).status && (
                  <span className={cn('text-xs px-2 py-0.5 rounded-full', STATUS_COLORS[String((item.data as Record<string, unknown>).status)] || 'text-gray-400 bg-gray-400/10')}>
                    {String((item.data as Record<string, unknown>).status)}
                  </span>
                )}
                {!!(item.data as Record<string, unknown>).priority && (
                  <span className={cn('text-xs px-2 py-0.5 rounded-full', STATUS_COLORS[String((item.data as Record<string, unknown>).priority)] || 'text-gray-400 bg-gray-400/10')}>
                    {String((item.data as Record<string, unknown>).priority)}
                  </span>
                )}
              </div>
              <button onClick={e => { e.stopPropagation(); handleAction('analyze', item.id); }} className="p-1.5 hover:bg-zinc-800 rounded text-gray-500 hover:text-neon-cyan">
                <Zap className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => remove(item.id)} className="p-1.5 hover:bg-zinc-800 rounded text-gray-500 hover:text-red-400">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            {!!(item.data as Record<string, unknown>).description && (
              <p className="text-xs text-gray-500 mt-2">{String((item.data as Record<string, unknown>).description)}</p>
            )}
          </motion.div>
        ))}
        {items.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <Shield className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>No {currentType.toLowerCase()} records found</p>
          </div>
        )}
      </div>

      <UniversalActions domain="law-enforcement" artifactId={items[0]?.id} />
      <RealtimeDataPanel data={insights} />

      <div className="border-t border-white/10">
        <button onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg">
          <span className="flex items-center gap-2"><Layers className="w-4 h-4" /> Lens Features</span>
          <ChevronDown className={cn('w-4 h-4 transition-transform', showFeatures && 'rotate-180')} />
        </button>
        {showFeatures && <div className="px-4 pb-4"><LensFeaturePanel lensId="law-enforcement" /></div>}
      </div>
    </div>
  );
}
