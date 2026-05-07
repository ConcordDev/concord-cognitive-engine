'use client';

import { useState, useCallback } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { useLensDTUs } from '@/hooks/useLensDTUs';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Palette, Search, Upload,
  Eye, ShoppingBag, DollarSign, Sparkles,
  Music, X,
  BarChart3, Globe, Layers,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

type ArtistryTab = 'feed' | 'assets' | 'marketplace' | 'studio' | 'stats';
type FeedMode = 'chronological' | 'discovery';

export default function ArtistryLensPage() {
  useLensNav('artistry');
  const queryClient = useQueryClient();
  const { latestData: realtimeData, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('artistry');
  const { contextDTUs, isLoading: dtusLoading } = useLensDTUs({ lens: 'artistry' });

  const [tab, setTab] = useState<ArtistryTab>('feed');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFeatures, setShowFeatures] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [feedMode, setFeedMode] = useState<FeedMode>('chronological');

  // Upload form
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadType, setUploadType] = useState('track');
  const [uploadTags, setUploadTags] = useState('');

  // Assets from API
  const { data: assets, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['artistry', 'assets', searchQuery],
    queryFn: () => apiHelpers.artistry.assets.list({ search: searchQuery || undefined }).then(r => r.data?.assets || []).catch(() => []),
    initialData: [],
  });

  // Genres
  const { data: genres } = useQuery({
    queryKey: ['artistry', 'genres'],
    queryFn: () => apiHelpers.artistry.genres().then(r => r.data?.genres || []).catch(() => []),
    initialData: [],
  });

  // Asset types
  const { data: assetTypes } = useQuery({
    queryKey: ['artistry', 'asset-types'],
    queryFn: () => apiHelpers.artistry.assetTypes().then(r => r.data?.types || []).catch(() => []),
    initialData: [],
  });

  // Marketplace beats
  const { data: marketplaceBeats } = useQuery({
    queryKey: ['artistry', 'marketplace', 'beats'],
    queryFn: () => apiHelpers.artistry.marketplace.beats.list().then(r => r.data?.beats || []).catch(() => []),
    initialData: [],
    enabled: tab === 'marketplace',
  });

  // Studio projects
  const { data: studioProjects } = useQuery({
    queryKey: ['artistry', 'studio', 'projects'],
    queryFn: () => apiHelpers.artistry.studio.projects.list().then(r => r.data?.projects || []).catch(() => []),
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
    { id: 'assets', label: 'Assets', icon: Layers },
    { id: 'marketplace', label: 'Marketplace', icon: ShoppingBag },
    { id: 'studio', label: 'Studio', icon: Music },
    { id: 'stats', label: 'Stats', icon: BarChart3 },
  ];

  return (
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

        {/* Stat Cards — creative palette feel */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Assets', value: (assets as unknown[]).length, icon: Layers, color: 'text-neon-pink' },
            { label: 'Artistry DTUs', value: contextDTUs.length, icon: Sparkles, color: 'text-purple-400' },
            { label: 'Genres', value: (genres as unknown[]).length, icon: Music, color: 'text-cyan-400' },
            { label: 'Marketplace', value: (marketplaceBeats as unknown[]).length, icon: ShoppingBag, color: 'text-yellow-400' },
          ].map((stat, i) => (
            <motion.div key={stat.label} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.07 }} className="bg-white/5 border border-white/10 rounded-lg p-3 hover:border-neon-pink/30 transition-colors group">
              <stat.icon className={cn('w-4 h-4 mb-1 group-hover:scale-110 transition-transform', stat.color)} />
              <div className="text-xl font-bold">{stat.value}</div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider">{stat.label}</div>
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
              <div className="text-center py-16 text-gray-500 text-sm">No artistry content yet. Upload your first creation.</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {contextDTUs.slice(0, 12).map(dtu => (
                  <div key={dtu.id} className="bg-white/5 border border-white/10 rounded-lg p-4 hover:border-neon-pink/30 transition-colors">
                    <h3 className="font-medium text-sm mb-1">{dtu.title || dtu.id}</h3>
                    <p className="text-xs text-gray-500 line-clamp-2">{typeof dtu.content === 'string' ? dtu.content.slice(0, 100) : ''}</p>
                    <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
                      <Eye className="w-3 h-3" />
                      <span>{dtu.tier || 'standard'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Assets */}
        {tab === 'assets' && (
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search assets..." className="w-full pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-neon-pink/50" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {(assets as Record<string, unknown>[]).map((asset: Record<string, unknown>) => (
                <div key={asset.id as string} className="bg-white/5 border border-white/10 rounded-lg p-4">
                  <h3 className="font-medium text-sm">{asset.title as string || 'Untitled'}</h3>
                  <div className="text-xs text-gray-500 mt-1">{asset.type as string}</div>
                  <div className="flex gap-1 mt-2">
                    {((asset.tags as string[]) || []).slice(0, 3).map((tag: string) => (
                      <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-white/5 rounded">{tag}</span>
                    ))}
                  </div>
                </div>
              ))}
              {!isLoading && (assets as Record<string, unknown>[]).length === 0 && (
                <div className="col-span-full text-center py-12 text-gray-500 text-sm">No assets found.</div>
              )}
            </div>
          </div>
        )}

        {/* Marketplace */}
        {tab === 'marketplace' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2"><ShoppingBag className="w-5 h-5" /> Beat Marketplace</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {(marketplaceBeats as Record<string, unknown>[]).map((beat: Record<string, unknown>) => (
                <div key={beat.id as string} className="bg-white/5 border border-white/10 rounded-lg p-4">
                  <h3 className="font-medium text-sm">{beat.title as string}</h3>
                  <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
                    <DollarSign className="w-3 h-3" /> {beat.price as number || 0}
                    <Music className="w-3 h-3 ml-2" /> {beat.bpm as number || 120} BPM
                  </div>
                </div>
              ))}
              {(marketplaceBeats as Record<string, unknown>[]).length === 0 && (
                <div className="col-span-full text-center py-12 text-gray-500 text-sm">No beats listed yet.</div>
              )}
            </div>
          </div>
        )}

        {/* Studio */}
        {tab === 'studio' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2"><Music className="w-5 h-5" /> Studio Projects</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {(studioProjects as Record<string, unknown>[]).map((proj: Record<string, unknown>) => (
                <div key={proj.id as string} className="bg-white/5 border border-white/10 rounded-lg p-4">
                  <h3 className="font-medium text-sm">{proj.title as string}</h3>
                  <div className="text-xs text-gray-500 mt-1">{proj.bpm as number || 120} BPM - {proj.key as string || 'C'}</div>
                </div>
              ))}
              {(studioProjects as Record<string, unknown>[]).length === 0 && (
                <div className="col-span-full text-center py-12 text-gray-500 text-sm">No studio projects. Create one in the Studio lens.</div>
              )}
            </div>
          </div>
        )}

        {/* Stats */}
        {tab === 'stats' && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white/5 border border-white/10 rounded-lg p-4">
              <div className="text-xs text-gray-500 mb-1">Total Assets</div>
              <div className="text-2xl font-bold">{(assets as unknown[]).length}</div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-lg p-4">
              <div className="text-xs text-gray-500 mb-1">Artistry DTUs</div>
              <div className="text-2xl font-bold">{contextDTUs.length}</div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-lg p-4">
              <div className="text-xs text-gray-500 mb-1">Genres</div>
              <div className="text-2xl font-bold">{(genres as unknown[]).length}</div>
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
                  <button onClick={() => setShowUpload(false)}><X className="w-4 h-4" /></button>
                </div>
                <div className="space-y-3">
                  <input value={uploadTitle} onChange={e => setUploadTitle(e.target.value)} placeholder="Title" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
                  <select value={uploadType} onChange={e => setUploadType(e.target.value)} className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm">
                    {(assetTypes as string[]).length > 0 ? (assetTypes as string[]).map((t: string) => <option key={t} value={t}>{t}</option>) : (
                      <>
                        <option value="track">Track</option>
                        <option value="beat">Beat</option>
                        <option value="artwork">Artwork</option>
                        <option value="video">Video</option>
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
    </div>
  );
}
