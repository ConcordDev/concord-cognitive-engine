'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  Clock, Plus, Search, Trash2, Eye, Layers, ChevronDown,
  Globe, BookOpen, Users, Flag, MapPin, ArrowRight, Scroll, Calendar, Zap, Loader2,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ModeTab = 'Events' | 'Periods' | 'Figures' | 'Sources' | 'Timeline' | 'Dashboard';
type ArtifactType = 'Event' | 'Period' | 'Figure' | 'Source';
type Region = 'global' | 'europe' | 'asia' | 'africa' | 'americas' | 'middle_east' | 'oceania' | 'other';

interface HistoryArtifact {
  artifactType: ArtifactType;
  region: Region;
  description: string;
  date?: string;
  endDate?: string;
  era?: string;
  significance?: string;
  causes?: string[];
  consequences?: string[];
  relatedEvents?: string[];
  participants?: string[];
  location?: string;
  sourceType?: 'primary' | 'secondary' | 'tertiary';
  reliability?: 'high' | 'medium' | 'low' | 'disputed';
  tags?: string[];
}

/* ------------------------------------------------------------------ */
/*  Tab Config                                                         */
/* ------------------------------------------------------------------ */

const MODE_TABS: { id: ModeTab; label: string; icon: typeof Clock; type: ArtifactType }[] = [
  { id: 'Events', label: 'Events', icon: Flag, type: 'Event' },
  { id: 'Periods', label: 'Periods', icon: Clock, type: 'Period' },
  { id: 'Figures', label: 'Figures', icon: Users, type: 'Figure' },
  { id: 'Sources', label: 'Sources', icon: BookOpen, type: 'Source' },
  { id: 'Timeline', label: 'Timeline', icon: ArrowRight, type: 'Event' },
  { id: 'Dashboard', label: 'Dashboard', icon: Globe, type: 'Event' },
];

const REGION_COLORS: Record<Region, string> = {
  global: 'text-neon-cyan',
  europe: 'text-blue-400',
  asia: 'text-yellow-400',
  africa: 'text-orange-400',
  americas: 'text-green-400',
  middle_east: 'text-red-400',
  oceania: 'text-teal-400',
  other: 'text-gray-400',
};

/* ------------------------------------------------------------------ */
/*  Page Component                                                     */
/* ------------------------------------------------------------------ */

export default function HistoryLensPage() {
  useLensNav('history');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('history');

  const [activeTab, setActiveTab] = useState<ModeTab>('Events');
  const [searchQuery, setSearchQuery] = useState('');
  const [regionFilter, setRegionFilter] = useState<Region | ''>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showFeatures, setShowFeatures] = useState(true);

  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formRegion, setFormRegion] = useState<Region>('global');
  const [formDescription, setFormDescription] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formEndDate, setFormEndDate] = useState('');
  const [formLocation, setFormLocation] = useState('');

  const currentType = MODE_TABS.find(t => t.id === activeTab)?.type || 'Event';

  const { items, isLoading, isError, error, refetch, create, update, remove } = useLensData<HistoryArtifact>('history', currentType, {
    seed: [],
  });

  // All items for dashboard counts
  const { items: events } = useLensData<HistoryArtifact>('history', 'Event', { seed: [] });
  const { items: periods } = useLensData<HistoryArtifact>('history', 'Period', { seed: [] });
  const { items: figures } = useLensData<HistoryArtifact>('history', 'Figure', { seed: [] });
  const { items: sources } = useLensData<HistoryArtifact>('history', 'Source', { seed: [] });

  const runArtifact = useRunArtifact('history');

  const handleAction = useCallback((artifactId: string) => {
    runArtifact.mutate({ id: artifactId, action: 'analyze' });
  }, [runArtifact]);

  // Filtering
  const filtered = useMemo(() => {
    let list = [...items];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(i => i.title.toLowerCase().includes(q) || i.data.description?.toLowerCase().includes(q));
    }
    if (regionFilter) {
      list = list.filter(i => i.data.region === regionFilter);
    }
    // Sort by date if available
    list.sort((a, b) => (a.data.date || '').localeCompare(b.data.date || ''));
    return list;
  }, [items, searchQuery, regionFilter]);

  const selected = useMemo(() => items.find(i => i.id === selectedId), [items, selectedId]);

  // Timeline items (sorted events with dates)
  const timelineItems = useMemo(() => {
    return events
      .filter(e => e.data.date)
      .sort((a, b) => (a.data.date || '').localeCompare(b.data.date || ''));
  }, [events]);

  const handleCreate = () => {
    if (!formTitle.trim()) return;
    create({
      title: formTitle,
      data: {
        artifactType: currentType,
        region: formRegion,
        description: formDescription,
        date: formDate || undefined,
        endDate: formEndDate || undefined,
        location: formLocation || undefined,
      },
    });
    setFormTitle('');
    setFormDescription('');
    setFormDate('');
    setFormEndDate('');
    setFormLocation('');
    setShowCreate(false);
  };

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={(error as Error)?.message} onRetry={() => refetch()} />
      </div>
    );
  }

  return (
    <div data-lens-theme="history" className="p-6 space-y-6">
      <header className="flex items-center gap-3">
        <Clock className="w-6 h-6 text-neon-cyan" />
        <div>
          <h1 className="text-xl font-bold">History</h1>
          <p className="text-sm text-gray-400">
            Events, periods, figures, and historical sources
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap ml-auto">
          {runArtifact.isPending && <Loader2 className="w-4 h-4 animate-spin text-neon-cyan" />}
          <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
          <DTUExportButton domain="history" data={realtimeData || {}} compact />
          {realtimeAlerts.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
              {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <UniversalActions domain="history" artifactId={selectedId} compact />
      </header>

      {/* Tabs */}
      <div className="flex gap-1 flex-wrap pb-1">
        {MODE_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setSelectedId(null); }}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors',
              activeTab === tab.id
                ? 'bg-neon-cyan/20 text-neon-cyan'
                : 'text-gray-400 hover:text-white hover:bg-lattice-surface/50'
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Quick Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: Flag, label: 'Events', value: events.length, color: 'text-neon-cyan' },
          { icon: Clock, label: 'Periods', value: periods.length, color: 'text-neon-purple' },
          { icon: Users, label: 'Figures', value: figures.length, color: 'text-blue-400' },
          { icon: BookOpen, label: 'Sources', value: sources.length, color: 'text-green-400' },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className="lens-card"
          >
            <stat.icon className={cn('w-5 h-5 mb-2', stat.color)} />
            <p className="text-2xl font-bold">{stat.value}</p>
            <p className="text-sm text-gray-400">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Era Filter Badges */}
      {activeTab !== 'Dashboard' && activeTab !== 'Timeline' && (() => {
        const eras = [...new Set(items.map(i => i.data.era).filter(Boolean))];
        return eras.length > 0 ? (
          <div className="flex gap-2 flex-wrap">
            <Scroll className="w-4 h-4 text-gray-500 mt-0.5" />
            {eras.map(era => (
              <button
                key={era}
                onClick={() => setSearchQuery(searchQuery === era ? '' : era!)}
                className={cn(
                  'text-xs px-2.5 py-1 rounded-full border transition-colors',
                  searchQuery === era
                    ? 'bg-neon-cyan/20 border-neon-cyan/50 text-neon-cyan'
                    : 'border-lattice-border text-gray-400 hover:text-white hover:border-gray-500'
                )}
              >
                {era}
              </button>
            ))}
          </div>
        ) : null;
      })()}

      {/* Dashboard Tab */}
      {activeTab === 'Dashboard' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="grid grid-cols-1 md:grid-cols-2 gap-4"
        >
          <div className="panel p-4">
            <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-neon-cyan" /> Recent Timeline
            </h3>
            <div className="space-y-2">
              {events.filter(e => e.data.date).sort((a, b) => (b.data.date || '').localeCompare(a.data.date || '')).slice(0, 5).map(e => (
                <div key={e.id} className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-neon-cyan w-20 shrink-0">{e.data.date}</span>
                  <span className="text-gray-300 truncate">{e.title}</span>
                </div>
              ))}
              {events.filter(e => e.data.date).length === 0 && <p className="text-xs text-gray-500">No dated events yet.</p>}
            </div>
          </div>
          <div className="panel p-4">
            <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
              <Globe className="w-4 h-4 text-blue-400" /> By Region
            </h3>
            <div className="space-y-2">
              {Object.entries(
                events.reduce<Record<string, number>>((acc, e) => { acc[e.data.region] = (acc[e.data.region] || 0) + 1; return acc; }, {})
              ).sort((a, b) => b[1] - a[1]).map(([region, count]) => (
                <div key={region} className="flex items-center justify-between text-xs">
                  <span className={cn(REGION_COLORS[region as Region] || 'text-gray-400', 'capitalize')}>{region.replace(/_/g, ' ')}</span>
                  <span className="text-gray-400">{count}</span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      )}

      {/* Timeline Tab */}
      {activeTab === 'Timeline' && (
        <div className="space-y-1">
          {timelineItems.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <Clock className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p className="text-sm">No events with dates yet. Add events with dates to see a timeline.</p>
            </div>
          ) : (
            <div className="relative pl-8 space-y-4">
              <div className="absolute left-3 top-0 bottom-0 w-0.5 bg-lattice-border" />
              {timelineItems.map((item, idx) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className="relative cursor-pointer"
                  onClick={() => { setSelectedId(item.id); setActiveTab('Events'); }}
                >
                  <div className="absolute -left-5 top-1.5 w-3 h-3 rounded-full bg-neon-cyan border-2 border-lattice-deep" />
                  <div className="p-3 rounded-lg bg-lattice-surface/50 border border-lattice-border hover:border-neon-cyan/30 transition-colors">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono text-neon-cyan">{item.data.date}</span>
                      {item.data.endDate && <span className="text-xs text-gray-500">to {item.data.endDate}</span>}
                      <span className={cn('text-xs', REGION_COLORS[item.data.region] || 'text-gray-400')}>
                        {item.data.region?.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <h3 className="text-sm font-medium text-white">{item.title}</h3>
                    <p className="text-xs text-gray-400 mt-1 line-clamp-2">{item.data.description}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab !== 'Dashboard' && activeTab !== 'Timeline' && (
        <>
          {/* Toolbar */}
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search..."
                className="w-full pl-10 pr-4 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-neon-cyan"
              />
            </div>
            <select
              value={regionFilter}
              onChange={e => setRegionFilter(e.target.value as Region | '')}
              className="px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm text-white"
            >
              <option value="">All Regions</option>
              <option value="global">Global</option>
              <option value="europe">Europe</option>
              <option value="asia">Asia</option>
              <option value="africa">Africa</option>
              <option value="americas">Americas</option>
              <option value="middle_east">Middle East</option>
              <option value="oceania">Oceania</option>
            </select>
            <button
              onClick={() => setShowCreate(!showCreate)}
              className="btn-neon flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" /> New {currentType}
            </button>
            <span className="text-sm text-gray-500 ml-auto">{filtered.length} item{filtered.length !== 1 ? 's' : ''}</span>
          </div>

          {/* Create Form */}
          {showCreate && (
            <div className="panel p-4 space-y-3">
              <h3 className="font-semibold text-sm">New {currentType}</h3>
              <input
                value={formTitle}
                onChange={e => setFormTitle(e.target.value)}
                placeholder="Title..."
                className="input-lattice w-full"
              />
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={formRegion}
                  onChange={e => setFormRegion(e.target.value as Region)}
                  className="input-lattice"
                >
                  <option value="global">Global</option>
                  <option value="europe">Europe</option>
                  <option value="asia">Asia</option>
                  <option value="africa">Africa</option>
                  <option value="americas">Americas</option>
                  <option value="middle_east">Middle East</option>
                  <option value="oceania">Oceania</option>
                </select>
                <input
                  value={formLocation}
                  onChange={e => setFormLocation(e.target.value)}
                  placeholder="Location..."
                  className="input-lattice"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input
                  value={formDate}
                  onChange={e => setFormDate(e.target.value)}
                  placeholder="Date (e.g. 1776, 500 BCE)..."
                  className="input-lattice"
                />
                <input
                  value={formEndDate}
                  onChange={e => setFormEndDate(e.target.value)}
                  placeholder="End date (optional)..."
                  className="input-lattice"
                />
              </div>
              <textarea
                value={formDescription}
                onChange={e => setFormDescription(e.target.value)}
                placeholder="Description..."
                className="input-lattice w-full h-24 resize-none"
              />
              <div className="flex gap-2">
                <button onClick={handleCreate} disabled={!formTitle.trim()} className="btn-neon">Create</button>
                <button onClick={() => setShowCreate(false)} className="text-sm text-gray-400 hover:text-white">Cancel</button>
              </div>
            </div>
          )}

          {/* Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-2">
              {isLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map(i => <div key={i} className="h-20 bg-lattice-surface animate-pulse rounded-lg" />)}
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-16 text-gray-500">
                  <Clock className="w-12 h-12 mx-auto mb-4 opacity-30" />
                  <p className="text-sm">No {currentType.toLowerCase()}s yet. Create one to get started.</p>
                </div>
              ) : (
                filtered.map((item, idx) => (
                  <motion.button
                    key={item.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.04 }}
                    onClick={() => setSelectedId(item.id)}
                    className={cn(
                      'w-full text-left p-4 rounded-lg border transition-colors',
                      selectedId === item.id
                        ? 'bg-lattice-surface border-neon-cyan/50'
                        : 'bg-lattice-surface/50 border-lattice-border hover:border-gray-600'
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="text-sm font-medium text-white">{item.title}</h3>
                        <p className="text-xs text-gray-400 mt-1 line-clamp-2">{item.data.description}</p>
                        <div className="flex items-center gap-2 mt-2">
                          {item.data.date && <span className="text-xs font-mono text-neon-cyan">{item.data.date}</span>}
                          <span className={cn('text-xs', REGION_COLORS[item.data.region] || 'text-gray-400')}>
                            {item.data.region?.replace(/_/g, ' ')}
                          </span>
                          {item.data.location && (
                            <span className="text-xs text-gray-500 flex items-center gap-0.5">
                              <MapPin className="w-3 h-3" /> {item.data.location}
                            </span>
                          )}
                        </div>
                      </div>
                      <Eye className="w-4 h-4 text-gray-600 flex-shrink-0 mt-1" />
                    </div>
                  </motion.button>
                ))
              )}
            </div>

            {/* Detail Panel */}
            <div className="panel p-4 space-y-4 sticky top-4">
              {selected ? (
                <>
                  <div className="flex items-center justify-between">
                    <h2 className="font-semibold text-white">{selected.title}</h2>
                    <div className="flex items-center gap-2">
                      <button onClick={() => handleAction(selected.id)} className="text-gray-500 hover:text-neon-cyan" title="Run AI analysis"><Zap className="w-4 h-4" /></button>
                      <button onClick={() => update(selected.id, { data: { ...selected.data, lastReviewed: new Date().toISOString() } as unknown as Partial<HistoryArtifact> })} className="text-gray-500 hover:text-blue-400" title="Update"><Eye className="w-4 h-4" /></button>
                      <button onClick={() => remove(selected.id)} className="text-red-400 hover:text-red-300">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {selected.data.date && <span className="text-xs font-mono text-neon-cyan">{selected.data.date}</span>}
                    {selected.data.endDate && <span className="text-xs text-gray-500">to {selected.data.endDate}</span>}
                    <span className={cn('text-xs', REGION_COLORS[selected.data.region] || 'text-gray-400')}>
                      {selected.data.region?.replace(/_/g, ' ')}
                    </span>
                  </div>
                  {selected.data.location && (
                    <p className="text-xs text-gray-400 flex items-center gap-1">
                      <MapPin className="w-3 h-3" /> {selected.data.location}
                    </p>
                  )}
                  <p className="text-sm text-gray-300 whitespace-pre-wrap">{selected.data.description}</p>
                  {selected.data.significance && (
                    <div>
                      <h3 className="text-xs font-medium text-gray-400 mb-1">Significance</h3>
                      <p className="text-xs text-gray-300">{selected.data.significance}</p>
                    </div>
                  )}
                  {selected.data.causes && selected.data.causes.length > 0 && (
                    <div>
                      <h3 className="text-xs font-medium text-gray-400 mb-1">Causes</h3>
                      <ul className="space-y-1">
                        {selected.data.causes.map((c, i) => (
                          <li key={i} className="text-xs text-gray-300 pl-3 border-l-2 border-neon-cyan/30">{c}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {selected.data.consequences && selected.data.consequences.length > 0 && (
                    <div>
                      <h3 className="text-xs font-medium text-gray-400 mb-1">Consequences</h3>
                      <ul className="space-y-1">
                        {selected.data.consequences.map((c, i) => (
                          <li key={i} className="text-xs text-gray-300 pl-3 border-l-2 border-orange-400/30">{c}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {selected.data.participants && selected.data.participants.length > 0 && (
                    <div>
                      <h3 className="text-xs font-medium text-gray-400 mb-1">Key Participants</h3>
                      <div className="flex flex-wrap gap-1">
                        {selected.data.participants.map((p, i) => (
                          <span key={i} className="text-xs px-1.5 py-0.5 rounded bg-lattice-deep text-gray-300">{p}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {selected.data.sourceType && (
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <span>Source: {selected.data.sourceType}</span>
                      {selected.data.reliability && (
                        <span className={cn(
                          'px-1.5 py-0.5 rounded',
                          selected.data.reliability === 'high' ? 'bg-green-400/10 text-green-400' :
                          selected.data.reliability === 'medium' ? 'bg-yellow-400/10 text-yellow-400' :
                          selected.data.reliability === 'disputed' ? 'bg-red-400/10 text-red-400' :
                          'bg-gray-400/10 text-gray-400'
                        )}>
                          {selected.data.reliability}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="text-xs text-gray-500 pt-2 border-t border-lattice-border">
                    Created {new Date(selected.createdAt).toLocaleDateString()}
                  </div>
                </>
              ) : (
                <div className="text-center py-12 text-gray-500">
                  <Clock className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">Select an item to view details</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Real-time Data Panel */}
      {realtimeData && (
        <RealtimeDataPanel
          domain="history"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}

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
            <LensFeaturePanel lensId="history" />
          </div>
        )}
      </div>
    </div>
  );
}
