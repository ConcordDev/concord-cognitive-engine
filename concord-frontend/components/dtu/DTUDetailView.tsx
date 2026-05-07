'use client';

/**
 * DTUDetailView — Full detail view for a single DTU, fetched from /api/dtus/:id.
 *
 * Shows: title, full content, type/tier, created date, creator, tags,
 *        lineage (parent DTUs), citation count, integrity badge.
 *
 * Wired to:
 *   - GET /api/dtus/:id       (via apiHelpers.dtus.get)
 *   - GET /api/dtus/:id/lineage (via apiHelpers.dtus.lineage)
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import type { DTU } from '@/lib/api/generated-types';
import { DTUIntegrityBadge } from './DTUIntegrityBadge';
import { ProvenanceBadge } from './ProvenanceBadge';
import {
  X, Clock, GitBranch, Tag, FileText, Zap, Crown, Ghost,
  Copy, ChevronRight, Download, DollarSign, Share2,
  Music, Image as ImageIcon, Video, Code, FileType, ArrowUpCircle,
} from 'lucide-react';
import { ArtifactRenderer } from '@/components/artifact/ArtifactRenderer';
import { TierBadge, TierBadgeDetail, TierPromotionTimeline } from './TierBadge';
import { ScopeBadge } from '@/components/platform/ScopeControls';
import { PromoteDialog } from '@/components/scope/PromoteDialog';

interface DTUDetailViewProps {
  dtuId: string;
  onClose: () => void;
  onNavigate?: (id: string) => void;
}

const tierConfig: Record<string, { icon: typeof Zap; color: string; label: string; bg: string }> = {
  regular: { icon: Zap, color: 'text-neon-blue', label: 'Regular DTU', bg: 'bg-neon-blue/10' },
  mega: { icon: Crown, color: 'text-neon-purple', label: 'Mega DTU', bg: 'bg-neon-purple/10' },
  hyper: { icon: Zap, color: 'text-neon-pink', label: 'Hyper DTU', bg: 'bg-neon-pink/10' },
  shadow: { icon: Ghost, color: 'text-gray-400', label: 'Shadow DTU', bg: 'bg-gray-500/10' },
  archive: { icon: FileType, color: 'text-gray-500', label: 'Archived DTU', bg: 'bg-gray-600/10' },
};

// ── DTU Creation Path Labels (Feature 11: All 15 DTU Creation Paths) ────────
const DTU_SOURCE_LABELS: Record<string, string> = {
  user: '1. User Create',
  sovereign: '1. User Create',
  media: '2. Artifact Upload',
  'autogen.pipeline': '3. Autogen Pipeline',
  autogen: '3. Autogen Pipeline',
  dream: '4. Dream Capture',
  teaching: '5. Teaching Session',
  entity_autonomy: '6. Entity Autonomy',
  emergent: '6. Entity Autonomy',
  evolution: '7. Evolution Synth',
  hlr: '8. HLR Reasoning',
  hypothesis: '9. Hypothesis Engine',
  creative: '10. Creative Generation',
  'research-jobs': '11. Research Jobs',
  feedback: '12. Feedback Submission',
  evolution_proposal: '13. Evolution Proposal',
  death_memorial: '14. Death Memorial',
  repair_cortex: '15. Repair Cortex Log',
  event_bridge: 'Event Bridge',
  sleep_consolidation: 'Sleep Consolidation',
  breakthrough_cluster: 'Breakthrough Cluster',
  federation: 'Federation',
  seed: 'Seed Data',
  invoice: 'Invoice Generation',
  tax_summary: 'Tax Summary',
  forge: 'Inline Forge',
};

const DTU_SOURCE_STYLES: Record<string, { bg: string }> = {
  user: { bg: 'bg-neon-cyan/10 text-neon-cyan' },
  sovereign: { bg: 'bg-neon-cyan/10 text-neon-cyan' },
  media: { bg: 'bg-blue-500/10 text-blue-400' },
  'autogen.pipeline': { bg: 'bg-green-500/10 text-green-400' },
  autogen: { bg: 'bg-green-500/10 text-green-400' },
  dream: { bg: 'bg-purple-500/10 text-purple-400' },
  teaching: { bg: 'bg-yellow-500/10 text-yellow-400' },
  entity_autonomy: { bg: 'bg-neon-purple/10 text-neon-purple' },
  emergent: { bg: 'bg-neon-purple/10 text-neon-purple' },
  evolution: { bg: 'bg-pink-500/10 text-pink-400' },
  hlr: { bg: 'bg-orange-500/10 text-orange-400' },
  hypothesis: { bg: 'bg-amber-500/10 text-amber-400' },
  creative: { bg: 'bg-rose-500/10 text-rose-400' },
  'research-jobs': { bg: 'bg-indigo-500/10 text-indigo-400' },
  feedback: { bg: 'bg-teal-500/10 text-teal-400' },
  evolution_proposal: { bg: 'bg-fuchsia-500/10 text-fuchsia-400' },
  death_memorial: { bg: 'bg-gray-500/10 text-gray-400' },
  repair_cortex: { bg: 'bg-red-500/10 text-red-400' },
  event_bridge: { bg: 'bg-sky-500/10 text-sky-400' },
  sleep_consolidation: { bg: 'bg-violet-500/10 text-violet-400' },
  breakthrough_cluster: { bg: 'bg-lime-500/10 text-lime-400' },
  invoice: { bg: 'bg-emerald-500/10 text-emerald-400' },
  tax_summary: { bg: 'bg-emerald-500/10 text-emerald-400' },
  forge: { bg: 'bg-neon-pink/10 text-neon-pink' },
  seed: { bg: 'bg-gray-500/10 text-gray-500' },
  federation: { bg: 'bg-cyan-500/10 text-cyan-400' },
};

export function DTUDetailView({ dtuId, onClose, onNavigate }: DTUDetailViewProps) {
  const [activeTab, setActiveTab] = useState<'content' | 'lineage' | 'metadata'>('content');
  const [showPromote, setShowPromote] = useState(false);

  // Fetch DTU details
  const { data: dtuData, isLoading, isError } = useQuery({
    queryKey: ['dtu-detail', dtuId],
    queryFn: async () => {
      const res = await apiHelpers.dtus.get(dtuId);
      return (res.data?.dtu || res.data) as DTU;
    },
    enabled: Boolean(dtuId),
    staleTime: 30_000,
  });

  // Fetch lineage (enhanced: includes forks, citations, citedBy, royaltyCascade)
  const { data: lineageData } = useQuery({
    queryKey: ['dtu-lineage', dtuId],
    queryFn: async () => {
      const res = await apiHelpers.dtus.lineage(dtuId);
      return res.data as {
        ok: boolean;
        current?: { id: string; title?: string; tier?: string; type?: string; ownerId?: string; domain?: string };
        parents?: Array<{ id: string; title?: string; summary?: string; tier?: string; ownerId?: string }>;
        children?: Array<{ id: string; title?: string; summary?: string; tier?: string; ownerId?: string }>;
        forks?: Array<{ id: string; title?: string; summary?: string; tier?: string; ownerId?: string }>;
        citations?: Array<{ id: string; title?: string; summary?: string; tier?: string }>;
        citedBy?: Array<{ id: string; title?: string; summary?: string; tier?: string; ownerId?: string }>;
        relatedIds?: string[];
        royaltyCascade?: Array<{ id: string; title?: string; ownerId?: string; generation: number; royaltyRate: number; royaltyPercent: string }>;
        // Backward compat
        ancestors?: Array<{ id: string; title?: string; summary?: string; tier?: string }>;
        descendants?: Array<{ id: string; title?: string; summary?: string; tier?: string }>;
      };
    },
    enabled: Boolean(dtuId) && activeTab === 'lineage',
    staleTime: 60_000,
  });

  const dtu = dtuData;
  const config = tierConfig[dtu?.tier || 'regular'];
  const TierIcon = config.icon;

  const parentDtus = lineageData?.parents || lineageData?.ancestors || [];
  const childDtus = lineageData?.children || lineageData?.descendants || [];
  const forkDtus = lineageData?.forks || [];
  const citationDtus = lineageData?.citations || [];
  const citedByDtus = lineageData?.citedBy || [];
  const royaltyCascade = lineageData?.royaltyCascade || [];

  // Fetch royalty cascade earnings for this DTU
  const { data: cascadeData } = useQuery({
    queryKey: ['dtu-royalty-cascade', dtuId],
    queryFn: async () => {
      const res = await apiHelpers.economy.royaltyCascade(dtuId);
      return res.data as {
        ok: boolean;
        totalEarned: number;
        totalTransactions: number;
        ancestors: Array<{
          creatorId: string;
          contentId: string;
          generation: number;
          rate: number;
          ratePercent: string;
          totalEarned: number;
        }>;
        descendantCount: number;
      };
    },
    enabled: Boolean(dtuId),
    retry: false,
    staleTime: 60_000,
  });

  const handleCopyId = () => {
    navigator.clipboard.writeText(dtuId);
  };

  const [sharecopied, setShareCopied] = useState(false);
  const handleShareUrl = () => {
    const publicUrl = `${window.location.origin}/dtu/${dtuId}`;
    navigator.clipboard.writeText(publicUrl);
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2000);
  };

  const [downloading, setDownloading] = useState(false);

  const handleDownloadDtu = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(`/api/dtus/${dtuId}/export.dtu`);
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const tier = dtu?.tier || 'regular';
      const ext = tier === 'hyper' ? '.hyper.dtu' : tier === 'mega' ? '.mega.dtu' : '.dtu';
      const name = (dtu?.title || dtuId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name}${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('DTU download failed:', e);
    } finally {
      setDownloading(false);
    }
  };

  // Determine primaryType for artifact rendering
  const primaryType = (dtu?.meta?.primaryType || (dtu as unknown as Record<string, unknown>)?.primaryType) as string | undefined;
  const artifactRef = (dtu?.artifact || dtu?.meta?.artifactId) as string | undefined;

  const primaryTypeIcon: Record<string, typeof Music> = {
    play_audio: Music,
    display_image: ImageIcon,
    play_video: Video,
    render_code: Code,
    render_document: FileType,
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-2xl max-h-[85vh] bg-lattice-surface border border-lattice-border rounded-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-lattice-border">
          {isLoading ? (
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 rounded bg-lattice-deep animate-pulse" />
              <div className="h-5 w-32 bg-lattice-deep rounded animate-pulse" />
            </div>
          ) : (
            <div className="flex items-center gap-3 min-w-0">
              <div className={`p-1.5 rounded ${config.bg}`}>
                <TierIcon className={`w-5 h-5 ${config.color}`} />
              </div>
              <div className="min-w-0">
                <h2 className="font-semibold truncate flex items-center gap-2">
                  {dtu?.title || dtu?.summary || config.label}
                  {dtu && <ProvenanceBadge source={dtu.source} model={dtu.meta?.model as string} authority={dtu.meta?.authority as string} />}
                </h2>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span className="font-mono truncate">{dtuId.slice(0, 20)}...</span>
                  <button onClick={handleCopyId} className="hover:text-white" title="Copy ID">
                    <Copy className="w-3 h-3" />
                  </button>
                  <TierBadge tier={dtu?.tier || 'regular'} showRegular size="sm" />
                  <ScopeBadge scope={(dtu?.meta?.scope as string) || 'local'} />
                  {dtu?.domain && (
                    <span className="text-gray-600">{dtu.domain}</span>
                  )}
                </div>
              </div>
            </div>
          )}
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={handleShareUrl}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-neon-purple/10 text-neon-purple hover:bg-neon-purple/20 transition-colors"
              title="Copy public share URL"
            >
              <Share2 className="w-3.5 h-3.5" />
              {sharecopied ? 'Copied!' : 'Share'}
            </button>
            <button
              onClick={handleDownloadDtu}
              disabled={downloading || isLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-neon-cyan/10 text-neon-cyan hover:bg-neon-cyan/20 transition-colors disabled:opacity-40"
              title="Download as .dtu file"
            >
              <Download className="w-3.5 h-3.5" />
              {downloading ? 'Exporting...' : `.${dtu?.tier === 'mega' ? 'mega.' : dtu?.tier === 'hyper' ? 'hyper.' : ''}dtu`}
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-lattice-elevated transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-lattice-border">
          {(['content', 'lineage', 'metadata'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? 'text-neon-cyan border-b-2 border-neon-cyan'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {isLoading ? (
            <div className="space-y-4">
              <div className="h-4 w-24 bg-lattice-deep rounded animate-pulse" />
              <div className="h-20 bg-lattice-deep rounded animate-pulse" />
              <div className="h-4 w-48 bg-lattice-deep rounded animate-pulse" />
            </div>
          ) : isError || !dtu ? (
            <div className="text-center py-8">
              <p className="text-red-400 text-sm">Failed to load DTU details</p>
              <p className="text-xs text-gray-500 mt-1">The DTU may have been deleted or you may not have access.</p>
            </div>
          ) : (
            <>
              {activeTab === 'content' && (
                <div className="space-y-4">
                  {/* Title */}
                  {dtu.title && dtu.title !== dtu.summary && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-400 mb-1">Title</h3>
                      <p className="text-white text-lg font-medium">{dtu.title}</p>
                    </div>
                  )}

                  {/* Summary */}
                  {dtu.summary && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-400 mb-1">Summary</h3>
                      <p className="text-gray-200">{dtu.summary}</p>
                    </div>
                  )}

                  {/* Full content */}
                  <div>
                    <h3 className="text-sm font-medium text-gray-400 mb-2">Full Content</h3>
                    <div className="bg-lattice-deep p-4 rounded-lg">
                      <p className="text-gray-200 whitespace-pre-wrap text-sm">
                        {dtu.content || '(No content)'}
                      </p>
                    </div>
                  </div>

                  {/* Artifact preview — based on primaryType */}
                  {primaryType && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-400 mb-2 flex items-center gap-2">
                        {primaryTypeIcon[primaryType] ? (() => {
                          const Icon = primaryTypeIcon[primaryType];
                          return <Icon className="w-4 h-4" />;
                        })() : <FileType className="w-4 h-4" />}
                        Artifact Preview
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-neon-purple/10 text-neon-purple uppercase">
                          {primaryType.replace(/_/g, ' ')}
                        </span>
                      </h3>
                      {artifactRef ? (
                        <ArtifactRenderer
                          dtuId={artifactRef}
                          artifact={{
                            type: primaryType === 'play_audio' ? 'audio/mpeg'
                              : primaryType === 'display_image' ? 'image/png'
                              : primaryType === 'play_video' ? 'video/mp4'
                              : primaryType === 'render_code' ? 'text/plain'
                              : primaryType === 'render_document' ? 'text/markdown'
                              : 'application/octet-stream',
                            filename: dtu.title || dtu.id,
                            sizeBytes: (dtu.meta?.artifactSize as number) || 0,
                            multipart: false,
                          }}
                          mode="inline"
                        />
                      ) : (
                        <div className="bg-lattice-deep p-4 rounded-lg text-center">
                          <p className="text-gray-500 text-sm">
                            This DTU has type "{primaryType.replace(/_/g, ' ')}" but no artifact is attached.
                          </p>
                        </div>
                      )}
                      {artifactRef && (
                        <a
                          href={`/api/media/${artifactRef}/download`}
                          download
                          className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 rounded-md text-xs font-medium bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-colors"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Download artifact
                        </a>
                      )}
                    </div>
                  )}

                  {/* Tags */}
                  {dtu.tags && dtu.tags.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-400 mb-2 flex items-center gap-2">
                        <Tag className="w-4 h-4" />
                        Tags
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {dtu.tags.map((tag) => (
                          <span
                            key={tag}
                            className="px-3 py-1 bg-lattice-elevated rounded-full text-sm text-gray-300"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Created via: source path badge */}
                  {dtu.source && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">Created via:</span>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${DTU_SOURCE_STYLES[dtu.source]?.bg || 'bg-gray-500/10 text-gray-400'}`}>
                        {DTU_SOURCE_LABELS[dtu.source] || dtu.source}
                      </span>
                    </div>
                  )}

                  {/* Metrics row */}
                  <div className="flex items-center gap-4 text-sm text-gray-400 flex-wrap">
                    <span className="flex items-center gap-1">
                      <Clock className="w-4 h-4" />
                      {new Date(dtu.timestamp).toLocaleString()}
                    </span>
                    {dtu.ownerId && (
                      <span className="text-gray-500">Creator: {dtu.ownerId}</span>
                    )}
                    {dtu.resonance !== undefined && (
                      <span>Resonance: {(dtu.resonance * 100).toFixed(1)}%</span>
                    )}
                    {dtu.coherence !== undefined && (
                      <span>Coherence: {(dtu.coherence * 100).toFixed(1)}%</span>
                    )}
                  </div>

                  {/* Citation count (children = citations) */}
                  {(dtu.children?.length || 0) > 0 && (
                    <div className="flex items-center gap-2 text-sm text-gray-400">
                      <GitBranch className="w-4 h-4" />
                      <span>{dtu.children.length} citation{dtu.children.length !== 1 ? 's' : ''} (child DTUs)</span>
                    </div>
                  )}

                  {/* Scope promotion — Push to Marketplace for local DTUs */}
                  {(!(dtu.meta?.scope) || dtu.meta?.scope === 'local') && !showPromote && (
                    <button
                      onClick={() => setShowPromote(true)}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-neon-purple/10 text-neon-purple border border-neon-purple/30 hover:bg-neon-purple/20 transition-colors"
                    >
                      <ArrowUpCircle className="w-4 h-4" />
                      Push to Marketplace
                    </button>
                  )}
                  {showPromote && (
                    <PromoteDialog
                      dtuId={dtu.id}
                      onComplete={() => setShowPromote(false)}
                      onCancel={() => setShowPromote(false)}
                    />
                  )}

                  {/* Integrity badge */}
                  <DTUIntegrityBadge
                    dtuId={dtu.id}
                    status={dtu.meta?.integrityStatus as 'verified' | 'unverified' | 'tampered' || 'unverified'}
                    contentHash={dtu.meta?.contentHash as string}
                  />

                  {/* Royalty Earnings Summary */}
                  {cascadeData?.ok && (cascadeData.totalEarned > 0 || cascadeData.totalTransactions > 0) && (
                    <div className="p-3 rounded-lg bg-neon-green/5 border border-neon-green/20">
                      <h3 className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                        <DollarSign className="w-4 h-4 text-neon-green" />
                        Royalties
                      </h3>
                      <div className="flex items-center gap-4 text-sm">
                        <span className="text-gray-400">
                          This DTU has earned{' '}
                          <span className="text-neon-green font-mono font-bold">
                            {cascadeData.totalEarned.toFixed(2)} CC
                          </span>
                          {' '}in royalties across{' '}
                          <span className="text-white font-medium">{cascadeData.totalTransactions}</span>
                          {' '}transaction{cascadeData.totalTransactions !== 1 ? 's' : ''}
                        </span>
                      </div>
                      {cascadeData.ancestors.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {cascadeData.ancestors.slice(0, 5).map((a, i) => (
                            <div key={i} className="flex items-center justify-between text-xs">
                              <span className="text-gray-400 truncate max-w-[160px]">
                                Gen {a.generation}: {a.creatorId}
                              </span>
                              <div className="flex items-center gap-2">
                                <span className="text-neon-pink font-mono">{a.ratePercent}</span>
                                {a.totalEarned > 0 && (
                                  <span className="text-neon-green font-mono">{a.totalEarned.toFixed(2)} CC</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Tier consolidation details */}
                  {(dtu.tier === 'mega' || dtu.tier === 'hyper' || !!dtu.meta?.consolidated) && (
                    <div className="pt-2 border-t border-lattice-border">
                      <TierBadgeDetail
                        tier={dtu.tier}
                        showRegular
                        sourceCount={dtu.meta?.sourceCount as number | undefined}
                        sourceDtus={(dtu.meta?.sourceDtus as Array<{ id: string; title?: string }>) || (dtu.parents || []).map((id: string) => ({ id }))}
                        megaCount={dtu.meta?.megaCount as number | undefined}
                        totalDtuCount={dtu.meta?.totalDtuCount as number | undefined}
                        consolidatedInto={
                          dtu.meta?.consolidatedInto
                            ? { id: dtu.meta.consolidatedInto as string, title: dtu.meta.consolidatedIntoTitle as string | undefined }
                            : null
                        }
                        onNavigateToParent={onNavigate}
                      />
                    </div>
                  )}

                  {/* Tier promotion timeline */}
                  {Array.isArray(dtu.meta?.tierHistory) && (dtu.meta.tierHistory as Array<{ tier: string; at: string }>).length > 0 && (
                    <TierPromotionTimeline
                      history={dtu.meta.tierHistory as Array<{ tier: 'regular' | 'mega' | 'hyper' | 'shadow'; at: string; reason?: string }>}
                    />
                  )}
                </div>
              )}

              {activeTab === 'lineage' && (
                <div className="space-y-5">
                  {/* ── Lineage Tree Layout ── */}

                  {/* Parents (ancestors above) */}
                  <LineageSection
                    title="Parents"
                    icon={<GitBranch className="w-4 h-4 text-neon-blue" />}
                    items={parentDtus.length > 0 ? parentDtus : (dtu.parents || []).map((id: string) => ({ id }))}
                    emptyText="No parent DTUs (this is a root thought)"
                    onNavigate={onNavigate}
                    color="border-neon-blue/30"
                  />

                  {/* Current DTU indicator */}
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-neon-cyan/5 border border-neon-cyan/30">
                    <div className={`p-1.5 rounded ${config.bg}`}>
                      <TierIcon className={`w-4 h-4 ${config.color}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-medium text-white truncate block">
                        {dtu.title || dtu.summary || 'Current DTU'}
                      </span>
                      <span className="text-[10px] text-neon-cyan uppercase">Current</span>
                    </div>
                  </div>

                  {/* Children (below current) */}
                  <LineageSection
                    title="Children"
                    icon={<GitBranch className="w-4 h-4 text-neon-green rotate-180" />}
                    items={childDtus.length > 0 ? childDtus : (dtu.children || []).map((id: string) => ({ id }))}
                    emptyText="No children DTUs yet"
                    onNavigate={onNavigate}
                    color="border-neon-green/30"
                  />

                  {/* Fork Tree (derivatives) */}
                  {forkDtus.length > 0 && (
                    <LineageSection
                      title="Forks / Derivatives"
                      icon={<GitBranch className="w-4 h-4 text-neon-purple" />}
                      items={forkDtus}
                      emptyText=""
                      onNavigate={onNavigate}
                      color="border-neon-purple/30"
                    />
                  )}

                  {/* Citations (DTUs this one cites) */}
                  {citationDtus.length > 0 && (
                    <LineageSection
                      title="Cites"
                      icon={<FileText className="w-4 h-4 text-amber-400" />}
                      items={citationDtus}
                      emptyText=""
                      onNavigate={onNavigate}
                      color="border-amber-400/30"
                    />
                  )}

                  {/* Cited By (DTUs that cite this one) */}
                  {citedByDtus.length > 0 && (
                    <LineageSection
                      title="Cited By"
                      icon={<FileText className="w-4 h-4 text-amber-300" />}
                      items={citedByDtus}
                      emptyText=""
                      onNavigate={onNavigate}
                      color="border-amber-300/30"
                    />
                  )}

                  {/* Royalty Cascade */}
                  {royaltyCascade.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-400 mb-2 flex items-center gap-2">
                        <Zap className="w-4 h-4 text-neon-pink" />
                        Royalty Cascade
                      </h3>
                      <div className="space-y-1">
                        {royaltyCascade.map((entry) => (
                          <div
                            key={entry.id}
                            className="flex items-center justify-between p-2 rounded-lg border border-neon-pink/20 bg-neon-pink/5 text-xs"
                          >
                            <button
                              onClick={() => onNavigate?.(entry.id)}
                              className="text-gray-200 hover:text-neon-cyan truncate max-w-[180px]"
                            >
                              {entry.title || entry.id.slice(0, 20)}
                            </button>
                            <div className="flex items-center gap-2 text-gray-400 flex-shrink-0">
                              <span>Gen {entry.generation}</span>
                              <span className="text-neon-pink font-mono font-medium">{entry.royaltyPercent}</span>
                              {entry.ownerId && (
                                <span className="text-gray-500 truncate max-w-[80px]">{entry.ownerId}</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Related IDs */}
                  {((lineageData?.relatedIds || dtu.relatedIds || []) as string[]).length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-400 mb-2">
                        Related ({(lineageData?.relatedIds || dtu.relatedIds || []).length})
                      </h3>
                      <div className="space-y-1">
                        {((lineageData?.relatedIds || dtu.relatedIds || []) as string[]).slice(0, 10).map((relId: string) => (
                          <button
                            key={relId}
                            onClick={() => onNavigate?.(relId)}
                            className="text-xs text-neon-cyan hover:underline font-mono block"
                          >
                            {relId.slice(0, 24)}...
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'metadata' && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-medium text-gray-400 mb-2 flex items-center gap-2">
                      <FileText className="w-4 h-4" />
                      Properties
                    </h3>
                    <div className="space-y-1 text-xs">
                      {[
                        ['ID', dtu.id],
                        ['Tier', dtu.tier],
                        ['Source', dtu.source],
                        ['Created Via', dtu.source ? (DTU_SOURCE_LABELS[dtu.source] || dtu.source) : undefined],
                        ['Primary Type', primaryType],
                        ['Artifact', artifactRef],
                        ['Domain', dtu.domain],
                        ['Owner', dtu.ownerId],
                        ['Global', dtu.isGlobal ? 'Yes' : 'No'],
                        ['Created', dtu.timestamp],
                        ['Updated', dtu.updatedAt],
                        ['Resonance', dtu.resonance?.toFixed(3)],
                        ['Coherence', dtu.coherence?.toFixed(3)],
                        ['Stability', dtu.stability?.toFixed(3)],
                        ['Parents', dtu.parents?.length || 0],
                        ['Children', dtu.children?.length || 0],
                      ].filter(([, v]) => v !== undefined && v !== null && v !== '').map(([key, val]) => (
                        <div key={key} className="flex items-start justify-between">
                          <span className="text-gray-500">{key}:</span>
                          <span className="text-gray-300 text-right font-mono max-w-[250px] truncate">{String(val)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-medium text-gray-400 mb-2">Raw Metadata</h3>
                    <pre className="bg-lattice-deep p-4 rounded-lg text-xs font-mono overflow-auto max-h-60">
                      {JSON.stringify(dtu.meta || {}, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Lineage Section sub-component ────────────────────────────────────────────

interface LineageNode {
  id: string;
  title?: string;
  summary?: string;
  tier?: string;
  ownerId?: string;
}

function LineageSection({
  title,
  icon,
  items,
  emptyText,
  onNavigate,
  color,
}: {
  title: string;
  icon: React.ReactNode;
  items: Array<LineageNode | string>;
  emptyText: string;
  onNavigate?: (id: string) => void;
  color: string;
}) {
  const resolved = items.map((item) =>
    typeof item === 'string' ? { id: item } as LineageNode : item
  );

  return (
    <div>
      <h3 className="text-sm font-medium text-gray-400 mb-2 flex items-center gap-2">
        {icon}
        {title} ({resolved.length})
      </h3>
      {resolved.length > 0 ? (
        <div className="space-y-1.5">
          {resolved.map((node) => (
            <button
              key={node.id}
              onClick={() => onNavigate?.(node.id)}
              className={`w-full text-left p-2.5 rounded-lg border ${color} hover:border-neon-cyan/50 bg-lattice-deep/30 transition-colors flex items-center gap-2`}
            >
              <div className="min-w-0 flex-1">
                <span className="text-sm text-gray-200 truncate block">
                  {node.title || node.summary || node.id.slice(0, 24)}
                </span>
                <div className="flex items-center gap-2 mt-0.5">
                  {node.tier && (
                    <span className="text-[10px] text-gray-500 uppercase">{node.tier}</span>
                  )}
                  {node.ownerId && (
                    <span className="text-[10px] text-gray-600 truncate max-w-[120px]">{node.ownerId}</span>
                  )}
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-600 flex-shrink-0" />
            </button>
          ))}
        </div>
      ) : emptyText ? (
        <p className="text-gray-500 text-sm">{emptyText}</p>
      ) : null}
    </div>
  );
}
