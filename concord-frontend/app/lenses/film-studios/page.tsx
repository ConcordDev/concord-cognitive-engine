'use client';

import { useState, useCallback, useMemo } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useLensDTUs } from '@/hooks/useLensDTUs';
import { useUIStore } from '@/store/ui';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Film, Plus, Search, Play, Users, Clock, Eye, TrendingUp, Clapperboard, Camera, Mic,
  Music, Layers, BarChart3, Share2, X, ChevronRight,
  Monitor, Globe, Sparkles, Loader2, DollarSign, Calendar,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { UniversalPlayer } from '@/components/media/UniversalPlayer';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { showToast } from '@/components/common/Toasts';

type FilmTab = 'discover' | 'my-films' | 'create' | 'analytics' | 'watch-parties';

interface FilmProject {
  id: string;
  title: string;
  type: string;
  status: string;
  duration?: number;
  resolution?: string;
  crew: { role: string; name: string }[];
  components: { type: string; label: string }[];
  createdAt: string;
}

export default function FilmStudiosPage() {
  useLensNav('film-studios');
  const queryClient = useQueryClient();
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('film-studios');
  const { contextDTUs, isLoading: dtusLoading } = useLensDTUs({ lens: 'film-studios' });

  const [tab, setTab] = useState<FilmTab>('discover');
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showFeatures, setShowFeatures] = useState(true);
  const [partyCode, setPartyCode] = useState('');
  const [partyActive, setPartyActive] = useState(false);
  const [previewFilm, setPreviewFilm] = useState<FilmProject | null>(null);
  const [uploadVideoUrl, setUploadVideoUrl] = useState<string | null>(null);

  // My films via useLensData (declared before action wiring to avoid used-before-declaration errors)
  const { items: myFilmItems, create: createFilmItem, isError: isError2, error: error2, refetch: refetch2 } = useLensData<Record<string, unknown>>('film-studios', 'film', { seed: [] });

  // Backend action wiring
  const runFilmAction = useRunArtifact('film-studios');
  const [filmActionResult, setFilmActionResult] = useState<Record<string, unknown> | null>(null);
  const [filmRunning, setFilmRunning] = useState<string | null>(null);

  const handleFilmAction = useCallback(async (action: string) => {
    const targetId = myFilmItems[0]?.id;
    if (!targetId) return;
    setFilmRunning(action);
    try {
      const res = await runFilmAction.mutateAsync({ id: targetId, action });
      if (res.ok === false) { setFilmActionResult({ _action: action, message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setFilmActionResult({ _action: action, ...(res.result as Record<string, unknown>) }); }
    } catch (e) { console.error(`Film action ${action} failed:`, e); setFilmActionResult({ message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
    setFilmRunning(null);
  }, [myFilmItems, runFilmAction]);

  // Form state
  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState('short_film');
  const [newResolution, setNewResolution] = useState('1080p');

  // Fetch constants from film-studio API
  const { data: constants } = useQuery({
    queryKey: ['film-studio', 'constants'],
    queryFn: () => apiHelpers.filmStudio.constants().then(r => r.data),
  });

  // Discover films
  const { data: discoveredFilms, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['film-studio', 'discover', searchQuery],
    queryFn: () => apiHelpers.filmStudio.discover({ q: searchQuery || undefined }).then(r => r.data?.films || r.data?.items || r.data || []).catch((e) => { console.warn('[FilmStudios] Query failed:', e?.message); return []; }),
    initialData: [],
  });
  const myFilms = useMemo(() => myFilmItems.map(i => ({ ...(i.data as unknown as FilmProject), id: i.id, title: i.title })), [myFilmItems]);

  // Create film mutation
  const createFilmMutation = useMutation({
    mutationFn: async (data: { title: string; type: string; resolution: string }) => {
      const resp = await apiHelpers.filmStudio.create(data);
      // Also persist as lens artifact
      await createFilmItem({ title: data.title, data: { ...data, status: 'draft', createdAt: new Date().toISOString() } });
      return resp.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['film-studio'] });
      setShowCreateModal(false);
      setNewTitle('');
      refetch2();
    },
    onError: () => {
      useUIStore.getState().addToast({ type: 'error', message: 'Operation failed. Please try again.' });
    },
  });

  const handleCreate = useCallback(() => {
    if (!newTitle.trim()) return;
    createFilmMutation.mutate({ title: newTitle, type: newType, resolution: newResolution });
  }, [newTitle, newType, newResolution, createFilmMutation]);

  const filmTypes = constants?.filmTypes || ['short_film', 'feature', 'documentary', 'music_video', 'series_episode', 'animation'];
  const resolutions = constants?.resolutions || ['720p', '1080p', '4K', '8K'];

  const TABS: { id: FilmTab; label: string; icon: typeof Film }[] = [
    { id: 'discover', label: 'Discover', icon: Globe },
    { id: 'my-films', label: 'My Films', icon: Film },
    { id: 'create', label: 'Create', icon: Plus },
    { id: 'watch-parties', label: 'Watch Parties', icon: Monitor },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  ];

  // Production pipeline helpers
  const PIPELINE_PHASES = [
    { key: 'pre-production', label: 'Pre-Prod', color: 'bg-yellow-400' },
    { key: 'production',     label: 'Production', color: 'bg-blue-400' },
    { key: 'post-production', label: 'Post-Prod', color: 'bg-orange-400' },
    { key: 'distribution',  label: 'Distribution', color: 'bg-green-400' },
  ] as const;

  const statusToPhase = (status?: string): number => {
    if (!status) return 0;
    const s = status.toLowerCase();
    if (s === 'distribution' || s === 'released') return 3;
    if (s === 'post-production' || s === 'post_production' || s === 'editing' || s === 'review') return 2;
    if (s === 'production' || s === 'filming' || s === 'shooting') return 1;
    return 0; // draft / pre-production
  };

  // Resolution badge helpers
  const resolutionBadge = (res?: string) => {
    if (!res) return null;
    const map: Record<string, { label: string; cls: string }> = {
      '8K':    { label: '8K',    cls: 'bg-cyan-400/20 text-cyan-300 border border-cyan-400/40' },
      '4K':    { label: '4K',    cls: 'bg-yellow-400/20 text-yellow-300 border border-yellow-400/40' },
      '1080p': { label: '1080p', cls: 'bg-gray-300/20 text-gray-300 border border-gray-400/30' },
      '720p':  { label: '720p',  cls: 'bg-gray-500/20 text-gray-400 border border-gray-500/30' },
    };
    const v = map[res] ?? { label: res, cls: 'bg-white/10 text-gray-400' };
    return <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-semibold', v.cls)}>{v.label}</span>;
  };

  // Film type gradient pill
  const typePill = (type?: string) => {
    if (!type) return null;
    return (
      <span className="text-[10px] px-2 py-0.5 rounded-full bg-gradient-to-r from-neon-purple/30 to-pink-500/30 border border-neon-purple/30 text-purple-200">
        {type.replace(/_/g, ' ')}
      </span>
    );
  };

  // Crew role icons
  const roleIcon = (role?: string) => {
    const r = (role || '').toLowerCase();
    if (r.includes('direct')) return <Camera className="w-3 h-3" />;
    if (r.includes('sound') || r.includes('audio')) return <Mic className="w-3 h-3" />;
    if (r.includes('music') || r.includes('composer')) return <Music className="w-3 h-3" />;
    if (r.includes('produc')) return <Clapperboard className="w-3 h-3" />;
    return <Users className="w-3 h-3" />;
  };

  // Analytics derived data
  const pipelineBreakdown = PIPELINE_PHASES.map((p, idx) => ({
    ...p,
    count: myFilms.filter(f => statusToPhase(f.status) === idx).length,
  }));

  const typeBreakdown = myFilms.reduce<Record<string, number>>((acc, f) => {
    const t = f.type || 'unknown';
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});

  return (
    <div data-lens-theme="film-studios" className="min-h-screen">
      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-purple-500/30 to-pink-500/30 border border-purple-500/20">
              <Film className="w-6 h-6 text-neon-purple" />
            </div>
            <h1 className="text-2xl font-bold">Film Studios</h1>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
          </div>
          <div className="flex items-center gap-2">
            <DTUExportButton domain="film-studios" data={{}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
            <button onClick={() => setShowFeatures(!showFeatures)} className="px-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded-lg hover:bg-white/10">
              Features
            </button>
            <button onClick={() => setShowCreateModal(true)} className="px-3 py-1.5 text-xs bg-neon-purple/20 border border-neon-purple/30 rounded-lg hover:bg-neon-purple/30 flex items-center gap-1">
              <Plus className="w-3 h-3" /> New Film
            </button>
          </div>
        </div>

        {showFeatures && <LensFeaturePanel lensId="film_studios" />}
        <RealtimeDataPanel data={realtimeData} insights={realtimeInsights} />
      <UniversalActions domain="film-studios" artifactId={null} compact />

        {/* Film Studio Actions */}
        <div className="panel p-4 space-y-3">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <Clapperboard className="w-4 h-4 text-neon-purple" />
            Production Actions
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[
              { action: 'budgetBreakdown',       label: 'Budget Breakdown',    icon: DollarSign, color: 'text-neon-green' },
              { action: 'scheduleShoot',         label: 'Schedule Shoot',      icon: Calendar,   color: 'text-neon-cyan' },
              { action: 'castAnalysis',          label: 'Cast Analysis',       icon: Users,      color: 'text-neon-purple' },
              { action: 'postProductionTimeline',label: 'Post Timeline',       icon: Layers,     color: 'text-yellow-400' },
            ].map(({ action, label, icon: Icon, color }) => (
              <button
                key={action}
                onClick={() => handleFilmAction(action)}
                disabled={!!filmRunning || !myFilmItems[0]?.id}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm hover:border-neon-purple/30 disabled:opacity-40 transition-colors"
              >
                {filmRunning === action ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className={`w-4 h-4 ${color}`} />}
                <span className="truncate text-xs">{label}</span>
              </button>
            ))}
          </div>

          {filmActionResult && (
            <div className="mt-3 rounded-lg bg-black/30 border border-white/10 p-4 relative">
              <button onClick={() => setFilmActionResult(null)} className="absolute top-3 right-3 text-gray-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>

              {/* budgetBreakdown */}
              {filmActionResult._action === 'budgetBreakdown' && (
                <div className="space-y-3">
                  <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Budget Breakdown</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white/5 rounded-lg p-3">
                      <p className="text-xs text-gray-400">Total Budget</p>
                      <p className="text-xl font-bold text-neon-green">${(filmActionResult.totalBudget as number || 0).toLocaleString()}</p>
                    </div>
                    <div className="bg-white/5 rounded-lg p-3">
                      <p className="text-xs text-gray-400">Tip</p>
                      <p className="text-xs text-gray-300">{filmActionResult.tip as string}</p>
                    </div>
                  </div>
                  {Array.isArray(filmActionResult.breakdown) && (
                    <div className="space-y-1.5">
                      {(filmActionResult.breakdown as {category:string;percentage:number;amount:number}[]).map(b => (
                        <div key={b.category} className="flex items-center gap-3 text-xs">
                          <span className="text-gray-400 w-40 capitalize">{b.category}</span>
                          <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                            <div className="h-full bg-neon-purple/60 rounded-full" style={{ width: `${b.percentage}%` }} />
                          </div>
                          <span className="text-white w-10 text-right">{b.percentage}%</span>
                          <span className="text-neon-green w-20 text-right font-mono">${b.amount.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* scheduleShoot */}
              {filmActionResult._action === 'scheduleShoot' && (
                <div className="space-y-3">
                  <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Shoot Schedule</p>
                  {(filmActionResult.message as string) ? <p className="text-sm text-gray-400">{filmActionResult.message as string}</p> : (
                    <>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {[
                          { label: 'Total Scenes', value: String(filmActionResult.totalScenes ?? 0), color: 'text-white' },
                          { label: 'Shoot Days', value: String(filmActionResult.totalShootDays ?? 0), color: 'text-neon-cyan' },
                          { label: 'Weeks', value: String(filmActionResult.totalWeeks ?? 0), color: 'text-neon-purple' },
                          { label: 'Scenes/Day', value: String(filmActionResult.avgScenesPerDay ?? 0), color: 'text-neon-green' },
                        ].map(({ label, value, color }) => (
                          <div key={label} className="bg-white/5 rounded-lg p-3 text-center">
                            <p className={`text-lg font-bold ${color}`}>{value}</p>
                            <p className="text-xs text-gray-400">{label}</p>
                          </div>
                        ))}
                      </div>
                      {Array.isArray(filmActionResult.locations) && (
                        <div className="space-y-1">
                          {(filmActionResult.locations as {location:string;scenes:number;estimatedDays:number}[]).map(loc => (
                            <div key={loc.location} className="flex items-center gap-3 text-xs px-2 py-1.5 rounded bg-white/5">
                              <span className="flex-1 text-white">{loc.location}</span>
                              <span className="text-gray-400">{loc.scenes} scenes</span>
                              <span className="text-neon-cyan">{loc.estimatedDays} days</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* castAnalysis */}
              {filmActionResult._action === 'castAnalysis' && (
                <div className="space-y-3">
                  <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Cast Analysis</p>
                  {(filmActionResult.message as string) ? <p className="text-sm text-gray-400">{filmActionResult.message as string}</p> : (
                    <>
                      <div className="grid grid-cols-3 gap-3">
                        {[
                          { label: 'Total Cast', value: String(filmActionResult.totalCast ?? 0), color: 'text-white' },
                          { label: 'Lead Roles', value: String(filmActionResult.leads ?? 0), color: 'text-neon-purple' },
                          { label: 'Budget', value: `$${(filmActionResult.totalCastBudget as number || 0).toLocaleString()}`, color: 'text-neon-green' },
                        ].map(({ label, value, color }) => (
                          <div key={label} className="bg-white/5 rounded-lg p-3 text-center">
                            <p className={`text-lg font-bold ${color}`}>{value}</p>
                            <p className="text-xs text-gray-400">{label}</p>
                          </div>
                        ))}
                      </div>
                      {filmActionResult.topCost && <p className="text-xs text-gray-400">Highest cost: <span className="text-neon-cyan">{filmActionResult.topCost as string}</span></p>}
                      {Array.isArray(filmActionResult.cast) && (
                        <div className="space-y-1 max-h-32 overflow-y-auto">
                          {(filmActionResult.cast as {name:string;role:string;scenes:number;totalCost:number}[]).map(c => (
                            <div key={c.name} className="flex items-center gap-3 text-xs px-2 py-1 rounded bg-white/5">
                              <span className="flex-1 text-white">{c.name}</span>
                              <span className="text-gray-400 capitalize">{c.role}</span>
                              <span className="text-neon-cyan">{c.scenes} scenes</span>
                              <span className="text-neon-green font-mono">${c.totalCost.toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* postProductionTimeline */}
              {filmActionResult._action === 'postProductionTimeline' && (
                <div className="space-y-3">
                  <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Post-Production Timeline</p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {[
                      { label: 'Runtime', value: `${filmActionResult.runtime ?? 0} min`, color: 'text-white' },
                      { label: 'VFX Shots', value: String(filmActionResult.vfxShots ?? 0), color: 'text-neon-cyan' },
                      { label: 'Total Weeks', value: String(filmActionResult.totalWeeks ?? 0), color: 'text-neon-green' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="bg-white/5 rounded-lg p-3 text-center">
                        <p className={`text-lg font-bold ${color}`}>{value}</p>
                        <p className="text-xs text-gray-400">{label}</p>
                      </div>
                    ))}
                  </div>
                  {Array.isArray(filmActionResult.phases) && (
                    <div className="space-y-2">
                      {(filmActionResult.phases as {phase:string;weeks:number}[]).map(ph => (
                        <div key={ph.phase} className="flex items-center gap-3 text-xs">
                          <span className="text-gray-400 w-36">{ph.phase}</span>
                          <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                            <div className="h-full bg-neon-purple/60 rounded-full" style={{ width: `${Math.min(100, ph.weeks / ((filmActionResult.totalWeeks as number) || 1) * 100)}%` }} />
                          </div>
                          <span className="text-neon-cyan w-16 text-right">{ph.weeks} weeks</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {!!filmActionResult.parallelizable && <p className="text-xs text-gray-500 italic">{String(filmActionResult.parallelizable)}</p>}
                  {!!filmActionResult.estimatedCompletion && <p className="text-xs text-neon-green">Completion: {String(filmActionResult.estimatedCompletion)}</p>}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-white/5 p-1 rounded-lg border border-white/10">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors', tab === t.id ? 'bg-neon-purple/20 text-neon-purple' : 'text-gray-400 hover:text-white hover:bg-white/5')}>
              <t.icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          ))}
        </div>

        {(isError || isError2) && <ErrorState error={error?.message || error2?.message} onRetry={() => { refetch(); refetch2(); }} />}

        {/* Discover */}
        {tab === 'discover' && (
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search films, creators, genres..." className="w-full pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-neon-purple/50" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {(discoveredFilms as FilmProject[]).map((film: FilmProject, idx: number) => (
                <motion.div
                  key={film.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.04 }}
                  whileHover={{ scale: 1.02 }}
                  className="relative bg-white/5 border border-white/10 rounded-lg p-4 hover:border-neon-purple/30 transition-colors cursor-pointer"
                >
                  {idx === 0 && (
                    <div className="absolute -top-2 left-3 flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-r from-yellow-500/80 to-orange-500/80 text-[10px] font-bold text-black">
                      <Sparkles className="w-2.5 h-2.5" /> Featured
                    </div>
                  )}
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="font-medium text-sm pr-2">{film.title}</h3>
                    {resolutionBadge(film.resolution)}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 mb-2">
                    {typePill(film.type)}
                    {film.duration && (
                      <span className="text-[10px] text-gray-500 flex items-center gap-0.5"><Clock className="w-2.5 h-2.5" />{Math.round(film.duration / 60)}m</span>
                    )}
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => setPreviewFilm(film)} className="flex-1 text-xs py-1.5 bg-neon-purple/20 rounded hover:bg-neon-purple/30 flex items-center justify-center gap-1"><Play className="w-3 h-3" /> Preview</button>
                    <button onClick={() => { navigator.clipboard?.writeText(window.location.href).then(() => showToast('success', 'Link copied to clipboard')).catch(() => showToast('error', 'Failed to copy link')); }} className="text-xs py-1.5 px-2 bg-white/5 rounded hover:bg-white/10"><Share2 className="w-3 h-3" /></button>
                  </div>
                </motion.div>
              ))}
              {!isLoading && (discoveredFilms as FilmProject[]).length === 0 && (
                <div className="col-span-full text-center py-12 text-gray-500 text-sm">No films found. Create your first film to get started.</div>
              )}
            </div>
          </div>
        )}

        {/* My Films */}
        {tab === 'my-films' && (
          <div className="space-y-4">
            {myFilms.length === 0 ? (
              <div className="text-center py-16 text-gray-500">
                <Film className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No films yet. Create your first project.</p>
                <button onClick={() => setShowCreateModal(true)} className="mt-3 px-4 py-2 text-xs bg-neon-purple/20 rounded-lg hover:bg-neon-purple/30">Create Film</button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {myFilms.map(film => {
                  const phaseIdx = statusToPhase(film.status);
                  const crewCount = film.crew?.length ?? 0;
                  const componentCount = film.components?.length ?? 0;
                  return (
                    <motion.div key={film.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="bg-white/5 border border-white/10 rounded-lg p-4 hover:border-neon-purple/20 transition-colors">
                      <div className="flex items-start justify-between mb-1">
                        <h3 className="font-medium text-sm">{film.title}</h3>
                        <div className="flex items-center gap-1.5">
                          {resolutionBadge(film.resolution)}
                          <span className={cn('text-[10px] px-1.5 py-0.5 rounded', film.status === 'draft' || !film.status ? 'bg-gray-500/20 text-gray-400' : 'bg-green-500/20 text-green-400')}>
                            {film.status || 'draft'}
                          </span>
                        </div>
                      </div>
                      <div className="mb-3">{typePill(film.type)}</div>

                      {/* Production Pipeline */}
                      <div className="mb-3">
                        <div className="flex items-center gap-1 mb-1.5">
                          {PIPELINE_PHASES.map((phase, i) => (
                            <div key={phase.key} className="flex items-center gap-1 flex-1">
                              <div className={cn('flex-1 h-1.5 rounded-full transition-all', i <= phaseIdx ? phase.color : 'bg-white/10')} />
                              {i < PIPELINE_PHASES.length - 1 && (
                                <ChevronRight className={cn('w-2.5 h-2.5 shrink-0', i < phaseIdx ? 'text-gray-400' : 'text-gray-600')} />
                              )}
                            </div>
                          ))}
                        </div>
                        <div className="flex justify-between text-[9px] text-gray-500 px-0.5">
                          {PIPELINE_PHASES.map((phase, i) => (
                            <span key={phase.key} className={cn('truncate', i === phaseIdx ? 'text-white/70 font-medium' : '')}>{phase.label}</span>
                          ))}
                        </div>
                      </div>

                      {/* Crew & Components buttons with count badges */}
                      <div className="flex gap-2">
                        <button onClick={() => { apiHelpers.filmStudio.components(film.id).then(r => { const count = r.data?.length ?? r.data?.components?.length ?? 0; showToast('success', `Loaded ${count} component(s)`); }).catch(() => showToast('error', 'Failed to load components')); }} className="flex-1 text-xs py-1.5 bg-white/5 rounded hover:bg-white/10 flex items-center justify-center gap-1.5 group">
                          <Layers className="w-3 h-3 text-gray-400 group-hover:text-white transition-colors" />
                          <span>Components</span>
                          {componentCount > 0 && (
                            <span className="ml-auto px-1.5 py-0.5 rounded-full bg-neon-purple/20 text-neon-purple text-[9px] font-bold">{componentCount}</span>
                          )}
                        </button>
                        <button onClick={() => { apiHelpers.filmStudio.crew(film.id).then(r => { const count = r.data?.length ?? r.data?.crew?.length ?? 0; showToast('success', `Loaded ${count} crew member(s)`); }).catch(() => showToast('error', 'Failed to load crew')); }} className="flex-1 text-xs py-1.5 bg-white/5 rounded hover:bg-white/10 flex items-center justify-center gap-1.5 group">
                          {film.crew && film.crew.length > 0 ? roleIcon(film.crew[0]?.role) : <Users className="w-3 h-3 text-gray-400 group-hover:text-white transition-colors" />}
                          <span>Crew</span>
                          {crewCount > 0 && (
                            <span className="ml-auto px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 text-[9px] font-bold">{crewCount}</span>
                          )}
                        </button>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Create tab */}
        {tab === 'create' && (
          <div className="max-w-md mx-auto bg-white/5 border border-white/10 rounded-lg p-6 space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2"><Clapperboard className="w-5 h-5 text-neon-purple" /> New Film Project</h2>
            <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Film title" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-neon-purple/50" />
            <select value={newType} onChange={e => setNewType(e.target.value)} className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none">
              {(filmTypes as string[]).map((t: string) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </select>
            <select value={newResolution} onChange={e => setNewResolution(e.target.value)} className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none">
              {(resolutions as string[]).map((r: string) => <option key={r} value={r}>{r}</option>)}
            </select>
            {/* Video file upload */}
            <div className="space-y-1.5">
              <label className="text-xs text-gray-400 flex items-center gap-1.5"><Camera className="w-3 h-3" /> Upload Video</label>
              <input
                type="file"
                accept="video/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    if (uploadVideoUrl) URL.revokeObjectURL(uploadVideoUrl);
                    setUploadVideoUrl(URL.createObjectURL(file));
                  }
                }}
                className="w-full text-xs text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:bg-neon-purple/20 file:text-neon-purple hover:file:bg-neon-purple/30"
              />
              {uploadVideoUrl && (
                <video src={uploadVideoUrl} controls className="w-full rounded-lg border border-white/10 mt-2" style={{ maxHeight: '200px' }} />
              )}
            </div>
            <button onClick={handleCreate} disabled={!newTitle.trim() || createFilmMutation.isPending} className="w-full py-2 bg-neon-purple/20 border border-neon-purple/30 rounded-lg text-sm hover:bg-neon-purple/30 disabled:opacity-50">
              {createFilmMutation.isPending ? 'Creating...' : 'Create Film'}
            </button>
          </div>
        )}

        {/* Watch Parties */}
        {tab === 'watch-parties' && (
          <div className="max-w-md mx-auto space-y-4">
            {/* Live status panel */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Monitor className="w-4 h-4 text-neon-purple" />
                  <span className="font-medium text-sm">Watch Party</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={cn('w-2 h-2 rounded-full', partyActive ? 'bg-green-400 animate-pulse' : 'bg-gray-500')} />
                  <span className="text-xs text-gray-400">{partyActive ? 'Live' : 'Idle'}</span>
                </div>
              </div>

              {/* Viewer count placeholder */}
              <div className="flex items-center gap-4 px-3 py-2.5 bg-white/5 rounded-lg">
                <div className="flex items-center gap-1.5 text-xs text-gray-400">
                  <Eye className="w-3.5 h-3.5" />
                  <span>{partyActive ? '— viewers' : '0 viewers'}</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-gray-400">
                  <Users className="w-3.5 h-3.5" />
                  <span>No guests yet</span>
                </div>
                {partyActive && (
                  <div className="flex items-center gap-1 ml-auto">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                    <span className="text-[10px] text-red-400 font-medium">LIVE</span>
                  </div>
                )}
              </div>

              {/* Party code input */}
              <div className="space-y-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-wider">Party Code</label>
                <div className="flex gap-2">
                  <input
                    value={partyCode}
                    onChange={e => setPartyCode(e.target.value.toUpperCase())}
                    placeholder="e.g. FILM-4829"
                    maxLength={9}
                    className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm font-mono tracking-widest focus:outline-none focus:border-neon-purple/50 placeholder:tracking-normal placeholder:font-sans placeholder:text-gray-600"
                  />
                  <button
                    onClick={() => useUIStore.getState().addToast({ type: 'success', message: `Joining party ${partyCode}...` })}
                    disabled={partyCode.length < 4}
                    className="px-3 py-2 text-xs bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 disabled:opacity-40"
                  >
                    Join
                  </button>
                </div>
              </div>

              <div className="border-t border-white/10 pt-3">
                <button
                  onClick={() => {
                    setPartyActive(true);
                    apiHelpers.filmStudio.watchParty.create({ title: 'New Watch Party' })
                      .then(() => useUIStore.getState().addToast({ type: 'success', message: 'Watch party started!' }))
                      .catch(() => useUIStore.getState().addToast({ type: 'error', message: 'Failed to create watch party' }));
                  }}
                  className="w-full py-2 text-xs bg-gradient-to-r from-neon-purple/20 to-pink-500/20 border border-neon-purple/30 rounded-lg hover:from-neon-purple/30 hover:to-pink-500/30 flex items-center justify-center gap-1.5"
                >
                  <Play className="w-3 h-3" /> Start Watch Party
                </button>
              </div>
            </div>
            <p className="text-xs text-center text-gray-600">Create synchronized viewing sessions for your films. Invite collaborators and audiences.</p>
          </div>
        )}

        {/* Analytics */}
        {tab === 'analytics' && (
          <div className="space-y-4">
            {/* Top stat row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Gradient total-films card */}
              <div className="relative overflow-hidden bg-gradient-to-br from-purple-500/20 to-pink-500/10 border border-neon-purple/20 rounded-xl p-4">
                <div className="absolute inset-0 bg-gradient-to-br from-purple-600/5 to-transparent pointer-events-none" />
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs text-gray-400 mb-1">Total Films</div>
                    <div className="text-3xl font-bold">{myFilms.length}</div>
                  </div>
                  <div className="p-2 rounded-lg bg-neon-purple/20">
                    <Film className="w-5 h-5 text-neon-purple" />
                  </div>
                </div>
                <div className="mt-2 text-[10px] text-gray-500">{dtusLoading ? '…' : `${contextDTUs.length} DTU${contextDTUs.length !== 1 ? 's' : ''} linked`}</div>
              </div>

              {/* DTU activity */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs text-gray-400 mb-1">DTU Activity</div>
                    <div className="text-3xl font-bold">{contextDTUs.length}</div>
                  </div>
                  <div className="p-2 rounded-lg bg-white/5">
                    <TrendingUp className="w-5 h-5 text-green-400" />
                  </div>
                </div>
                <div className="mt-2 text-[10px] text-gray-500">Knowledge units tracked</div>
              </div>

              {/* Live status */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs text-gray-400 mb-1">Stream Status</div>
                    <div className={cn('text-3xl font-bold', isLive ? 'text-green-400' : 'text-gray-500')}>{isLive ? 'Live' : 'Offline'}</div>
                  </div>
                  <div className={cn('p-2 rounded-lg', isLive ? 'bg-green-500/20' : 'bg-white/5')}>
                    <Globe className={cn('w-5 h-5', isLive ? 'text-green-400' : 'text-gray-500')} />
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-1">
                  <span className={cn('w-1.5 h-1.5 rounded-full', isLive ? 'bg-green-400 animate-pulse' : 'bg-gray-600')} />
                  <span className="text-[10px] text-gray-500">{isLive ? 'Realtime updates active' : 'Realtime inactive'}</span>
                </div>
              </div>
            </div>

            {/* Production pipeline breakdown */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Clapperboard className="w-4 h-4 text-neon-purple" />
                <span className="text-sm font-medium">Production Pipeline</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {pipelineBreakdown.map(phase => (
                  <div key={phase.key} className="bg-white/5 rounded-lg p-3 text-center">
                    <div className={cn('w-2.5 h-2.5 rounded-full mx-auto mb-1.5', phase.color)} />
                    <div className="text-xl font-bold">{phase.count}</div>
                    <div className="text-[10px] text-gray-500 mt-0.5">{phase.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Film type distribution */}
            {Object.keys(typeBreakdown).length > 0 && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <BarChart3 className="w-4 h-4 text-neon-purple" />
                  <span className="text-sm font-medium">Film Type Distribution</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(typeBreakdown).map(([type, count]) => (
                    <div key={type} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gradient-to-r from-neon-purple/10 to-pink-500/10 border border-neon-purple/20 rounded-lg">
                      <span className="text-xs text-gray-300">{type.replace(/_/g, ' ')}</span>
                      <span className="text-xs font-bold text-neon-purple">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Create modal */}
        <AnimatePresence>
          {showCreateModal && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCreateModal(false)}>
              <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} className="bg-gray-900 border border-white/10 rounded-lg p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-semibold">Create Film</h3>
                  <button onClick={() => setShowCreateModal(false)}><X className="w-4 h-4" /></button>
                </div>
                <div className="space-y-3">
                  <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Film title" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
                  <select value={newType} onChange={e => setNewType(e.target.value)} className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm">
                    {(filmTypes as string[]).map((t: string) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                  </select>
                  <button onClick={handleCreate} disabled={!newTitle.trim()} className="w-full py-2 bg-neon-purple/20 rounded-lg text-sm hover:bg-neon-purple/30 disabled:opacity-50">
                    {createFilmMutation.isPending ? 'Creating...' : 'Create'}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Video Preview Modal */}
        <AnimatePresence>
          {previewFilm && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-8"
              onClick={() => setPreviewFilm(null)}
            >
              <motion.div
                initial={{ scale: 0.9 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0.9 }}
                className="bg-gray-900 border border-white/10 rounded-xl w-full max-w-4xl overflow-hidden"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                  <div className="flex items-center gap-2">
                    <Film className="w-4 h-4 text-neon-purple" />
                    <span className="font-medium text-sm">{previewFilm.title}</span>
                    {previewFilm.resolution && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-neon-purple/20 text-neon-purple">{previewFilm.resolution}</span>
                    )}
                  </div>
                  <button onClick={() => setPreviewFilm(null)} className="p-1 rounded hover:bg-white/10"><X className="w-4 h-4" /></button>
                </div>
                <div className="p-4">
                  <UniversalPlayer
                    mediaDTU={{
                      id: previewFilm.id,
                      title: previewFilm.title,
                      mediaType: 'video',
                      hlsManifest: `/api/film-studio/${previewFilm.id}/stream`,
                      thumbnail: `/api/film-studio/${previewFilm.id}/thumbnail`,
                      duration: previewFilm.duration || 0,
                      resolution: { width: previewFilm.resolution === '4k' ? 3840 : previewFilm.resolution === '1440p' ? 2560 : 1920, height: previewFilm.resolution === '4k' ? 2160 : previewFilm.resolution === '1440p' ? 1440 : 1080 },
                      engagement: { views: 0, likes: 0, comments: 0, shares: 0 },
                    }}
                    autoplay
                  />
                </div>
                {/* Clip Timeline */}
                <div className="border-t border-white/10 px-4 py-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Layers className="w-3.5 h-3.5 text-gray-400" />
                    <span className="text-xs text-gray-400 font-medium">Timeline</span>
                  </div>
                  <div className="relative h-10 bg-white/5 rounded-lg border border-white/10 overflow-hidden">
                    {/* Time ruler */}
                    <div className="absolute inset-x-0 top-0 h-3 flex">
                      {Array.from({ length: 10 }).map((_, i) => (
                        <div key={i} className="flex-1 border-r border-white/10 px-1">
                          <span className="text-[8px] text-gray-600">{Math.round(((previewFilm.duration || 120) / 10) * i)}s</span>
                        </div>
                      ))}
                    </div>
                    {/* Video track */}
                    <div className="absolute inset-x-1 bottom-1 h-4 bg-gradient-to-r from-neon-purple/40 to-pink-500/40 rounded border border-neon-purple/30">
                      <div className="absolute inset-0 flex items-center px-2">
                        <span className="text-[8px] text-white/70 truncate">{previewFilm.title}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
