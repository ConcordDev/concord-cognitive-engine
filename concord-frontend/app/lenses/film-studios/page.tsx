'use client';

import { useState, useCallback, useMemo } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, apiHelpers } from '@/lib/api/client';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useLensDTUs } from '@/hooks/useLensDTUs';
import { useUIStore } from '@/store/ui';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Film, Plus, Search, Play, Users, Star, Clock, Eye,
  DollarSign, TrendingUp, Clapperboard, Camera, Mic,
  Music, Layers, BarChart3, Share2, Gift, X, ChevronRight,
  Monitor, Globe, Award, Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

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
  const { latestData: realtimeData, alerts: _alerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('film-studios');
  const { contextDTUs, isLoading: dtusLoading } = useLensDTUs({ lens: 'film-studios' });

  const [tab, setTab] = useState<FilmTab>('discover');
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showFeatures, setShowFeatures] = useState(false);
  const [partyCode, setPartyCode] = useState('');
  const [partyActive, setPartyActive] = useState(false);

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
    queryFn: () => apiHelpers.filmStudio.discover({ q: searchQuery || undefined }).then(r => r.data?.films || r.data?.items || r.data || []).catch(() => []),
    initialData: [],
  });

  // My films via useLensData
  const { items: myFilmItems, create: createFilmItem, isError: isError2, error: error2, refetch: refetch2 } = useLensData<Record<string, unknown>>('film-studios', 'film', { seed: [] });
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
                    <button className="flex-1 text-xs py-1.5 bg-neon-purple/20 rounded hover:bg-neon-purple/30 flex items-center justify-center gap-1"><Play className="w-3 h-3" /> Preview</button>
                    <button className="text-xs py-1.5 px-2 bg-white/5 rounded hover:bg-white/10"><Share2 className="w-3 h-3" /></button>
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
                        <button className="flex-1 text-xs py-1.5 bg-white/5 rounded hover:bg-white/10 flex items-center justify-center gap-1.5 group">
                          <Layers className="w-3 h-3 text-gray-400 group-hover:text-white transition-colors" />
                          <span>Components</span>
                          {componentCount > 0 && (
                            <span className="ml-auto px-1.5 py-0.5 rounded-full bg-neon-purple/20 text-neon-purple text-[9px] font-bold">{componentCount}</span>
                          )}
                        </button>
                        <button className="flex-1 text-xs py-1.5 bg-white/5 rounded hover:bg-white/10 flex items-center justify-center gap-1.5 group">
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
      </div>
    </div>
  );
}
