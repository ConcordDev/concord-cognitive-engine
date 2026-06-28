'use client';

import { useState, useCallback, useRef} from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import dynamic from 'next/dynamic';

const Excalidraw = dynamic(
  () => import('@excalidraw/excalidraw').then(mod => ({ default: mod.Excalidraw })),
  { ssr: false },
);
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { useLensDTUs } from '@/hooks/useLensDTUs';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Palette, Search, Upload,
  Eye, ShoppingBag, DollarSign, Sparkles,
  Paintbrush, X,
  BarChart3, Globe, Layers,
  Loader2, XCircle, Zap, Ruler, Tag,
  Users, FolderPlus, Bookmark, Briefcase, Star, User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { WikimediaArt } from '@/components/artistry/WikimediaArt';
import { ProjectStudio } from '@/components/artistry/ProjectStudio';
import { PortfolioProfile } from '@/components/artistry/PortfolioProfile';
import { CommunityNetwork } from '@/components/artistry/CommunityNetwork';
import { Collections } from '@/components/artistry/Collections';
import { DisciplineSearch } from '@/components/artistry/DisciplineSearch';
import { JobBoard } from '@/components/artistry/JobBoard';
import { CuratedGalleries } from '@/components/artistry/CuratedGalleries';

type ArtistryTab =
  | 'feed' | 'projects' | 'profile' | 'network' | 'collections'
  | 'discover' | 'jobs' | 'galleries' | 'assets' | 'marketplace' | 'studio' | 'stats';
type FeedMode = 'chronological' | 'discovery';

export default function ArtistryLensPage() {
  useLensNav('artistry');
  const queryClient = useQueryClient();
  const { latestData: realtimeData, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('artistry');
  const { contextDTUs, isLoading: dtusLoading } = useLensDTUs({ lens: 'artistry' });

  // Backend action wiring
  const runAction = useRunArtifact('artistry');
  const { items: artistryItems } = useLensData<Record<string, unknown>>('artistry', 'artwork', { seed: [] });
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [isRunning, setIsRunning] = useState<string | null>(null);

  const handleArtistryAction = async (action: string) => {
    const targetId = artistryItems[0]?.id;
    if (!targetId) return;
    setIsRunning(action);
    try {
      const res = await runAction.mutateAsync({ id: targetId, action });
      if (res.ok === false) { setActionResult({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setActionResult(res.result as Record<string, unknown>); }
    } catch (e) { console.error(`Action ${action} failed:`, e); setActionResult({ message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
    setIsRunning(null);
  };

  const [tab, setTab] = useState<ArtistryTab>('feed');


  // Lens-scoped keyboard commands (auto-wired by codemod).
  const searchInputRef = useRef<HTMLInputElement>(null);

  useLensCommand(

    [

      { id: 'tab-marketplace', keys: 'm', description: 'Marketplace', category: 'navigation', action: () => setTab('marketplace') },

      { id: 'tab-studio', keys: 's', description: 'Studio', category: 'navigation', action: () => setTab('studio') },

      { id: 'tab-feed', keys: 'f', description: 'Feed', category: 'navigation', action: () => setTab('feed') },

      { id: 'tab-assets', keys: 'a', description: 'Assets', category: 'navigation', action: () => setTab('assets') },

      { id: 'tab-projects', keys: 'p', description: 'Projects', category: 'navigation', action: () => setTab('projects') },

      { id: 'tab-network', keys: 'n', description: 'Network', category: 'navigation', action: () => setTab('network') },

      { id: 'tab-jobs', keys: 'j', description: 'Jobs', category: 'navigation', action: () => setTab('jobs') },

      { id: 'tab-discover', keys: 'd', description: 'Discover', category: 'navigation', action: () => setTab('discover') },

      { id: 'tab-stats', keys: 't', description: 'Stats', category: 'navigation', action: () => setTab('stats') },      { id: "focus-search", keys: "/", description: "Focus search", category: "navigation", action: () => searchInputRef.current?.focus() },


    ],

    { lensId: 'artistry' }

  );
  const [searchQuery, setSearchQuery] = useState('');
  const [showFeatures, setShowFeatures] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [feedMode, setFeedMode] = useState<FeedMode>('chronological');

  // Upload form
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadType, setUploadType] = useState('illustration');
  const [uploadTags, setUploadTags] = useState('');

  // Assets from API — the primary list channel wired to ErrorState/refetch.
  // Do NOT swallow the failure into an empty resolve: catching → `return []`
  // makes the promise resolve, so `isError` stays permanently false and the
  // ErrorState (and its working Retry) below is dead — a load failure would
  // read as an honest-but-wrong "No assets found." Re-throw so React Query
  // surfaces `isError`, while `initialData` keeps the first render populated-safe.
  const { data: assets, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['artistry', 'assets', searchQuery],
    queryFn: () => apiHelpers.artistry.assets.list({ search: searchQuery || undefined }).then(r => r.data?.assets || []),
    initialData: [],
  });

  // Styles / Mediums
  const { data: styles } = useQuery({
    queryKey: ['artistry', 'styles'],
    queryFn: () => apiHelpers.artistry.genres().then(r => r.data?.genres || []).catch((e) => { console.warn('[Artistry] Query failed:', e?.message); return []; }),
    initialData: [],
  });

  // Asset types
  const { data: assetTypes } = useQuery({
    queryKey: ['artistry', 'asset-types'],
    queryFn: () => apiHelpers.artistry.assetTypes().then(r => r.data?.types || []).catch((e) => { console.warn('[Artistry] Query failed:', e?.message); return []; }),
    initialData: [],
  });

  // Marketplace artworks
  const { data: marketplaceArt } = useQuery({
    queryKey: ['artistry', 'marketplace', 'art'],
    queryFn: () => apiHelpers.artistry.marketplace.art.list().then(r => r.data?.art || r.data?.items || []).catch((e) => { console.warn('[Artistry] Query failed:', e?.message); return []; }),
    initialData: [],
    enabled: tab === 'marketplace',
  });

  // Studio projects
  const { data: studioProjects } = useQuery({
    queryKey: ['artistry', 'studio', 'projects'],
    queryFn: () => apiHelpers.artistry.studio.projects.list().then(r => r.data?.projects || []).catch((e) => { console.warn('[Artistry] Query failed:', e?.message); return []; }),
    initialData: [],
    enabled: tab === 'studio',
  });

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => apiHelpers.artistry.assets.create(data as { type: string; title?: string; tags?: string[] }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['artistry', 'assets'] });
      setShowUpload(false);
      setUploadTitle('');
      setUploadTags('');
    },
    onError: () => {
      useUIStore.getState().addToast({ type: 'error', message: 'Operation failed. Please try again.' });
    },
  });

  const handleUpload = useCallback(() => {
    uploadMutation.mutate({
      type: uploadType,
      title: uploadTitle || 'Untitled',
      tags: uploadTags.split(',').map(t => t.trim()).filter(Boolean),
    });
  }, [uploadTitle, uploadType, uploadTags, uploadMutation]);

  const TABS: { id: ArtistryTab; label: string; icon: typeof Palette }[] = [
    { id: 'feed', label: 'Feed', icon: Globe },
    { id: 'projects', label: 'Projects', icon: FolderPlus },
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'network', label: 'Network', icon: Users },
    { id: 'collections', label: 'Collections', icon: Bookmark },
    { id: 'discover', label: 'Discover', icon: Search },
    { id: 'jobs', label: 'Jobs', icon: Briefcase },
    { id: 'galleries', label: 'Galleries', icon: Star },
    { id: 'assets', label: 'Assets', icon: Layers },
    { id: 'marketplace', label: 'Marketplace', icon: ShoppingBag },
    { id: 'studio', label: 'Studio', icon: Paintbrush },
    { id: 'stats', label: 'Stats', icon: BarChart3 },
  ];

  return (
    <LensShell lensId="artistry" asMain={false}>
      <FirstRunTour lensId="artistry" />
      <ManifestActionBar />
      <DepthBadge lensId="artistry" size="sm" className="ml-2" />
    <div data-lens-theme="artistry" className="min-h-screen">
      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Palette className="w-6 h-6 text-neon-pink" />
            <h1 className="text-2xl font-bold">Artistry</h1>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
          </div>
          <div className="flex items-center gap-2">
            <DTUExportButton domain="artistry" data={{}} compact />
            <button onClick={() => setShowFeatures(!showFeatures)} className="px-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded-lg hover:bg-white/10">Features</button>
            <button onClick={() => setShowUpload(true)} className="px-3 py-1.5 text-xs bg-neon-pink/20 border border-neon-pink/30 rounded-lg hover:bg-neon-pink/30 flex items-center gap-1">
              <Upload className="w-3 h-3" /> Upload
            </button>
          </div>
        </div>

        {showFeatures && <LensFeaturePanel lensId="artistry" />}
        <RealtimeDataPanel data={realtimeData} insights={realtimeInsights} />
      <UniversalActions domain="artistry" artifactId={null} compact />

        {/* ── Backend Action Panels ── */}
        <div className="bg-white/5 border border-white/10 rounded-lg p-4">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><Zap className="w-4 h-4 text-neon-pink" /> Artistry Compute Actions</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <button onClick={() => handleArtistryAction('colorPaletteAnalysis')} disabled={isRunning !== null} className="flex flex-col items-center gap-2 p-3 bg-white/5 rounded-lg border border-white/10 hover:border-neon-pink/50 transition-colors disabled:opacity-50">
              {isRunning === 'colorPaletteAnalysis' ? <Loader2 className="w-5 h-5 text-neon-pink animate-spin" /> : <Palette className="w-5 h-5 text-neon-pink" />}
              <span className="text-xs text-gray-300">Color Palette</span>
            </button>
            <button onClick={() => handleArtistryAction('compositionScore')} disabled={isRunning !== null} className="flex flex-col items-center gap-2 p-3 bg-white/5 rounded-lg border border-white/10 hover:border-neon-cyan/50 transition-colors disabled:opacity-50">
              {isRunning === 'compositionScore' ? <Loader2 className="w-5 h-5 text-neon-cyan animate-spin" /> : <Ruler className="w-5 h-5 text-neon-cyan" />}
              <span className="text-xs text-gray-300">Composition Score</span>
            </button>
            <button onClick={() => handleArtistryAction('styleClassify')} disabled={isRunning !== null} className="flex flex-col items-center gap-2 p-3 bg-white/5 rounded-lg border border-white/10 hover:border-purple-400/50 transition-colors disabled:opacity-50">
              {isRunning === 'styleClassify' ? <Loader2 className="w-5 h-5 text-purple-400 animate-spin" /> : <Eye className="w-5 h-5 text-purple-400" />}
              <span className="text-xs text-gray-300">Style Classify</span>
            </button>
            <button onClick={() => handleArtistryAction('mediaInventory')} disabled={isRunning !== null} className="flex flex-col items-center gap-2 p-3 bg-white/5 rounded-lg border border-white/10 hover:border-yellow-400/50 transition-colors disabled:opacity-50">
              {isRunning === 'mediaInventory' ? <Loader2 className="w-5 h-5 text-yellow-400 animate-spin" /> : <Tag className="w-5 h-5 text-yellow-400" />}
              <span className="text-xs text-gray-300">Media Inventory</span>
            </button>
          </div>
          {actionResult && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-4 p-3 bg-white/5 rounded-lg border border-white/10">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold flex items-center gap-2"><BarChart3 className="w-4 h-4 text-neon-pink" /> Result</h4>
                <button onClick={() => setActionResult(null)} className="text-gray-400 hover:text-white" aria-label="Xcircle"><XCircle className="w-4 h-4" /></button>
              </div>
              {/* Color Palette Analysis */}
              {actionResult.harmonyScore !== undefined && actionResult.dominantHue !== undefined && (
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="p-2 bg-white/5 rounded text-center"><p className="text-sm font-bold text-neon-pink">{actionResult.harmonyScore as number}</p><p className="text-[10px] text-gray-400">Harmony</p></div>
                    <div className="p-2 bg-white/5 rounded text-center"><p className="text-sm font-bold text-neon-cyan capitalize">{actionResult.dominantHue as string}</p><p className="text-[10px] text-gray-400">Dominant</p></div>
                    <div className="p-2 bg-white/5 rounded text-center"><p className="text-sm font-bold text-yellow-400">{actionResult.contrastRange as number}</p><p className="text-[10px] text-gray-400">Contrast</p></div>
                  </div>
                  {(actionResult.colors as Array<{ hex: string }>)?.slice(0, 8).map((c, i) => (
                    <span key={i} className="inline-block w-6 h-6 rounded-sm border border-white/20 mr-1" style={{ backgroundColor: c.hex }} title={c.hex} />
                  ))}
                </div>
              )}
              {/* Composition Score */}
              {actionResult.overallScore !== undefined && !actionResult.dominantHue && (
                <div className="text-3xl font-bold text-neon-cyan">{actionResult.overallScore as number}<span className="text-sm text-gray-400">/100</span></div>
              )}
              {/* Style Classify */}
              {actionResult.classification !== undefined && (
                <div className="flex items-center gap-3"><span className="text-xl font-bold text-purple-400 capitalize">{actionResult.classification as string}</span>{!!actionResult.confidence && <span className="text-xs text-gray-400">{actionResult.confidence as number}%</span>}</div>
              )}
              {/* Media Inventory */}
              {actionResult.totalItems !== undefined && actionResult.categoryBreakdown !== undefined && (
                <div className="space-y-2">
                  <div className="text-lg font-bold text-yellow-400">{actionResult.totalItems as number} items</div>
                  <div className="grid grid-cols-2 gap-2">
                    {(actionResult.categoryBreakdown as Array<{ category: string; itemCount: number }>).map((entry) => (
                      <div key={entry.category} className="p-2 bg-white/5 rounded flex justify-between text-xs"><span className="text-white capitalize">{entry.category}</span><span className="text-gray-400">{entry.itemCount}</span></div>
                    ))}
                  </div>
                </div>
              )}
              {!!actionResult.message && !actionResult.harmonyScore && !actionResult.overallScore && !actionResult.classification && !actionResult.totalItems && (
                <p className="text-sm text-gray-400">{actionResult.message as string}</p>
              )}
            </motion.div>
          )}
        </div>

        {/* Stat Cards — creative palette feel */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Assets', value: (assets as unknown[]).length, icon: Layers, color: 'text-neon-pink' },
            { label: 'Artistry DTUs', value: contextDTUs.length, icon: Sparkles, color: 'text-purple-400' },
            { label: 'Styles', value: (styles as unknown[]).length, icon: Paintbrush, color: 'text-cyan-400' },
            { label: 'Marketplace', value: (marketplaceArt as unknown[]).length, icon: ShoppingBag, color: 'text-yellow-400' },
          ].map((stat, i) => (
            <motion.div key={stat.label} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.07 }} className="bg-white/5 border border-white/10 rounded-lg p-3 hover:border-neon-pink/30 transition-colors group">
              <stat.icon className={cn('w-4 h-4 mb-1 group-hover:scale-110 transition-transform', stat.color)} />
              <div className="text-xl font-bold">{stat.value}</div>
              <div className="text-[10px] text-gray-400 uppercase tracking-wider">{stat.label}</div>
            </motion.div>
          ))}
        </div>

        {/* Technique Badges — Inspiration Board */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="flex flex-wrap gap-1.5">
          {['Digital Painting', 'Vector Art', 'Photography', '3D Modeling', 'Animation', 'Typography', 'Collage', 'Mixed Media'].map((technique, i) => (
            <span key={technique} className="text-[10px] px-2 py-1 rounded-full border border-white/10 text-gray-400 hover:border-neon-pink/40 hover:text-neon-pink cursor-default transition-colors" style={{ animationDelay: `${i * 50}ms` }}>
              {technique}
            </span>
          ))}
        </motion.div>

        {/* Tabs */}
        <div className="flex gap-1 bg-white/5 p-1 rounded-lg border border-white/10">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors', tab === t.id ? 'bg-neon-pink/20 text-neon-pink' : 'text-gray-400 hover:text-white hover:bg-white/5')}>
              <t.icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          ))}
        </div>

        {isError && <ErrorState error={error?.message} onRetry={refetch} />}

        {/* Feed */}
        {tab === 'feed' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <button onClick={() => setFeedMode('chronological')} className={cn('text-xs px-3 py-1 rounded', feedMode === 'chronological' ? 'bg-neon-pink/20 text-neon-pink' : 'text-gray-400')}>Latest</button>
              <button onClick={() => setFeedMode('discovery')} className={cn('text-xs px-3 py-1 rounded', feedMode === 'discovery' ? 'bg-neon-pink/20 text-neon-pink' : 'text-gray-400')}>Discover</button>
            </div>
            {contextDTUs.length === 0 && !dtusLoading ? (
              <div className="text-center py-16 text-gray-400 text-sm">No artistry content yet. Upload your first creation.</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {contextDTUs.slice(0, 12).map(dtu => (
                  <div key={dtu.id} className="bg-white/5 border border-white/10 rounded-lg p-4 hover:border-neon-pink/30 transition-colors">
                    <h3 className="font-medium text-sm mb-1">{dtu.title || dtu.id}</h3>
                    <p className="text-xs text-gray-400 line-clamp-2">{typeof dtu.content === 'string' ? dtu.content.slice(0, 100) : ''}</p>
                    <div className="flex items-center gap-2 mt-2 text-xs text-gray-400">
                      <Eye className="w-3 h-3" />
                      <span>{dtu.tier || 'standard'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Projects — multi-image case studies */}
        {tab === 'projects' && <ProjectStudio />}

        {/* Portfolio profile page */}
        {tab === 'profile' && <PortfolioProfile />}

        {/* Follow graph + personalized feed */}
        {tab === 'network' && <CommunityNetwork />}

        {/* Collections — save-to-board */}
        {tab === 'collections' && <Collections />}

        {/* Tag / discipline search */}
        {tab === 'discover' && <DisciplineSearch />}

        {/* Job board / commission requests */}
        {tab === 'jobs' && <JobBoard />}

        {/* Behance-style curated galleries */}
        {tab === 'galleries' && <CuratedGalleries />}

        {/* Assets */}
        {tab === 'assets' && (
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input ref={searchInputRef}
              value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search assets..." className="w-full pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-neon-pink/50" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {(assets as Record<string, unknown>[]).map((asset: Record<string, unknown>) => (
                <div key={asset.id as string} className="bg-white/5 border border-white/10 rounded-lg p-4">
                  <h3 className="font-medium text-sm">{asset.title as string || 'Untitled'}</h3>
                  <div className="text-xs text-gray-400 mt-1">{asset.type as string}</div>
                  <div className="flex gap-1 mt-2">
                    {((asset.tags as string[]) || []).slice(0, 3).map((tag: string) => (
                      <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-white/5 rounded">{tag}</span>
                    ))}
                  </div>
                </div>
              ))}
              {!isLoading && (assets as Record<string, unknown>[]).length === 0 && (
                <div className="col-span-full text-center py-12 text-gray-400 text-sm">No assets found.</div>
              )}
            </div>
          </div>
        )}

        {/* Marketplace */}
        {tab === 'marketplace' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2"><ShoppingBag className="w-5 h-5" /> Asset Marketplace</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {(marketplaceArt as Record<string, unknown>[]).map((item: Record<string, unknown>) => (
                <div key={item.id as string} className="bg-white/5 border border-white/10 rounded-lg p-4 hover:border-neon-pink/30 transition-colors">
                  <h3 className="font-medium text-sm">{item.title as string}</h3>
                  <div className="text-xs text-gray-400 mt-1">{item.medium as string || item.type as string || 'Mixed Media'}</div>
                  <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center gap-1 text-xs text-gray-400">
                      <Eye className="w-3 h-3" /> {(item.views as number) || 0}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-neon-pink">
                      <DollarSign className="w-3 h-3" /> {(item.price as number) || 0}
                    </div>
                  </div>
                </div>
              ))}
              {(marketplaceArt as Record<string, unknown>[]).length === 0 && (
                <div className="col-span-full text-center py-12 text-gray-400 text-sm">No artworks listed yet. Share your creations.</div>
              )}
            </div>
          </div>
        )}

        {/* Studio — Canvas + Projects */}
        {tab === 'studio' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2"><Paintbrush className="w-5 h-5" /> Creative Canvas</h2>
            {/* Excalidraw Drawing Canvas */}
            <div className="w-full rounded-lg border border-white/10 overflow-hidden" style={{ height: '65vh' }}>
              <Excalidraw
                theme="dark"
                UIOptions={{
                  canvasActions: {
                    saveToActiveFile: false,
                    loadScene: false,
                  },
                }}
              />
            </div>
            {/* Projects list below canvas */}
            {(studioProjects as Record<string, unknown>[]).length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-gray-400">Recent Projects</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(studioProjects as Record<string, unknown>[]).map((proj: Record<string, unknown>) => (
                    <div key={proj.id as string} className="bg-white/5 border border-white/10 rounded-lg p-3 hover:border-neon-pink/30 transition-colors">
                      <h4 className="font-medium text-sm">{proj.title as string || 'Untitled Project'}</h4>
                      <div className="text-xs text-gray-400 mt-1">{proj.medium as string || proj.status as string || 'In Progress'}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Stats */}
        {tab === 'stats' && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white/5 border border-white/10 rounded-lg p-4">
              <div className="text-xs text-gray-400 mb-1">Total Assets</div>
              <div className="text-2xl font-bold">{(assets as unknown[]).length}</div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-lg p-4">
              <div className="text-xs text-gray-400 mb-1">Artistry DTUs</div>
              <div className="text-2xl font-bold">{contextDTUs.length}</div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-lg p-4">
              <div className="text-xs text-gray-400 mb-1">Styles</div>
              <div className="text-2xl font-bold">{(styles as unknown[]).length}</div>
            </div>
          </div>
        )}

        {/* Upload modal */}
        <AnimatePresence>
          {showUpload && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowUpload(false)}>
              <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} className="bg-gray-900 border border-white/10 rounded-lg p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-semibold">Upload Asset</h3>
                  <button onClick={() => setShowUpload(false)} aria-label="Close"><X className="w-4 h-4" /></button>
                </div>
                <div className="space-y-3">
                  <input value={uploadTitle} onChange={e => setUploadTitle(e.target.value)} placeholder="Title" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
                  <select value={uploadType} onChange={e => setUploadType(e.target.value)} className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm">
                    {(assetTypes as string[]).length > 0 ? (assetTypes as string[]).map((t: string) => <option key={t} value={t}>{t}</option>) : (
                      <>
                        <option value="illustration">Illustration</option>
                        <option value="painting">Painting</option>
                        <option value="photography">Photography</option>
                        <option value="digital">Digital Art</option>
                        <option value="sculpture">Sculpture</option>
                        <option value="mixed-media">Mixed Media</option>
                      </>
                    )}
                  </select>
                  <input value={uploadTags} onChange={e => setUploadTags(e.target.value)} placeholder="Tags (comma separated)" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
                  <button onClick={handleUpload} disabled={uploadMutation.isPending} className="w-full py-2 bg-neon-pink/20 rounded-lg text-sm hover:bg-neon-pink/30 disabled:opacity-50">
                    {uploadMutation.isPending ? 'Uploading...' : 'Upload'}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <WikimediaArt />
      </section>
    </div>
          <RecentMineCard domain="artistry" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="artistry" hideWhenEmpty className="mt-3" />
          <CrossLensRecentsPanel lensId="artistry" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
