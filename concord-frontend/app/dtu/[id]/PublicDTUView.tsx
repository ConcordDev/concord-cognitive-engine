'use client';

/**
 * PublicDTUView — Read-only public view of a DTU.
 *
 * Displays: content, tier badge, provenance badge, simplified lineage tree,
 * creator profile link, and a "Fork to my universe" CTA.
 * No authentication required.
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import Link from 'next/link';
import {
  Zap,
  Crown,
  Ghost,
  GitBranch,
  User,
  ExternalLink,
  Clock,
  Tag,
  Copy,
  ChevronRight,
  Shield,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface DTU {
  id?: string;
  _id?: string;
  title?: string;
  name?: string;
  content?: string;
  summary?: string;
  description?: string;
  tier?: string;
  type?: string;
  tags?: string[];
  domain?: string;
  createdAt?: string;
  updatedAt?: string;
  creator?: string;
  creatorId?: string;
  provenance?: {
    source?: string;
    verified?: boolean;
    integrity?: string;
  };
  integrity?: {
    status?: string;
    contentHash?: string;
  };
  parentId?: string;
}

interface LineageNode {
  id: string;
  title?: string;
  tier?: string;
  children?: LineageNode[];
}

interface PublicDTUViewProps {
  dtu: DTU | null;
  dtuId: string;
}

const tierConfig: Record<string, { icon: typeof Zap; color: string; label: string; bg: string }> = {
  regular: { icon: Zap, color: 'text-neon-blue', label: 'Regular DTU', bg: 'bg-neon-blue/10' },
  mega: { icon: Crown, color: 'text-neon-purple', label: 'Mega DTU', bg: 'bg-neon-purple/10' },
  hyper: { icon: Zap, color: 'text-neon-pink', label: 'Hyper DTU', bg: 'bg-neon-pink/10' },
  shadow: { icon: Ghost, color: 'text-gray-400', label: 'Shadow DTU', bg: 'bg-gray-500/10' },
};

function SimplifiedLineageTree({ nodes }: { nodes: LineageNode[] }) {
  if (!nodes || nodes.length === 0) return null;

  return (
    <div className="space-y-1">
      {nodes.slice(0, 10).map((node) => (
        <div key={node.id} className="flex items-center gap-2 text-sm">
          <GitBranch className="w-3.5 h-3.5 text-gray-500 shrink-0" />
          <Link
            href={`/dtu/${node.id}`}
            className="text-gray-300 hover:text-neon-cyan transition-colors truncate"
          >
            {node.title || node.id}
          </Link>
          {node.tier && (
            <span
              className={cn(
                'text-[10px] px-1.5 py-0.5 rounded-full',
                tierConfig[node.tier]?.bg || 'bg-gray-500/10',
                tierConfig[node.tier]?.color || 'text-gray-400'
              )}
            >
              {node.tier}
            </span>
          )}
          {node.children && node.children.length > 0 && (
            <span className="text-xs text-gray-500">
              +{node.children.length} branch{node.children.length > 1 ? 'es' : ''}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export function PublicDTUView({ dtu, dtuId }: PublicDTUViewProps) {
  // Fetch lineage client-side (optional enhancement)
  const {
    data: lineageData,
    isLoading: lineageLoading,
    isError: lineageError,
  } = useQuery({
    queryKey: ['dtu-lineage-public', dtuId],
    queryFn: async () => {
      const res = await api.get(`/api/dtus/${dtuId}/lineage`);
      return res.data;
    },
    enabled: Boolean(dtu),
    staleTime: 60_000,
    retry: false,
  });

  if (!dtu) {
    return (
      <div className="min-h-screen bg-lattice-void flex items-center justify-center">
        <div className="text-center space-y-4 max-w-md px-6">
          <Ghost className="w-16 h-16 text-gray-600 mx-auto" />
          <h1 className="text-2xl font-bold text-white">DTU Not Found</h1>
          <p className="text-gray-400">
            This thought unit doesn&apos;t exist or may have been archived.
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-4 py-2 bg-neon-cyan/20 text-neon-cyan rounded-lg hover:bg-neon-cyan/30 transition-colors"
          >
            Go to Concord OS
            <ExternalLink className="w-4 h-4" />
          </Link>
        </div>
      </div>
    );
  }

  if (lineageLoading) {
    return (
      <div className="min-h-screen bg-lattice-void">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6 animate-pulse">
          <div className="h-8 bg-lattice-surface rounded-lg w-1/3" />
          <div className="h-12 bg-lattice-surface rounded-lg w-2/3" />
          <div className="h-48 bg-lattice-surface rounded-xl" />
          <div className="h-24 bg-lattice-surface rounded-xl" />
        </div>
      </div>
    );
  }

  if (lineageError) {
    return (
      <div className="min-h-screen bg-lattice-void flex items-center justify-center">
        <div className="text-center space-y-4 max-w-md px-6">
          <Ghost className="w-16 h-16 text-red-500 mx-auto" />
          <h1 className="text-2xl font-bold text-white">Failed to Load Lineage</h1>
          <p className="text-gray-400">
            Could not fetch lineage data for this DTU. Please try again later.
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-4 py-2 bg-neon-cyan/20 text-neon-cyan rounded-lg hover:bg-neon-cyan/30 transition-colors"
          >
            Go to Concord OS
            <ExternalLink className="w-4 h-4" />
          </Link>
        </div>
      </div>
    );
  }

  const id = dtu.id || dtu._id || dtuId;
  const title = dtu.title || dtu.name || 'Untitled DTU';
  const content = dtu.content || dtu.summary || dtu.description || '';
  const tier = dtu.tier || 'regular';
  const tierCfg = tierConfig[tier] || tierConfig.regular;
  const TierIcon = tierCfg.icon;
  const tags = dtu.tags || [];
  const creator = dtu.creator || dtu.creatorId;
  const createdAt = dtu.createdAt
    ? new Date(dtu.createdAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

  const lineageNodes: LineageNode[] =
    lineageData?.lineage?.ancestors ||
    lineageData?.lineage?.children ||
    lineageData?.ancestors ||
    lineageData?.children ||
    [];

  const provenanceVerified = dtu.provenance?.verified || dtu.integrity?.status === 'verified';

  return (
    <div className="min-h-screen bg-lattice-void">
      {/* Top navigation bar */}
      <header className="sticky top-0 z-30 bg-lattice-surface/80 backdrop-blur-sm border-b border-lattice-border">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 text-white hover:text-neon-cyan transition-colors"
          >
            <Sparkles className="w-5 h-5" />
            <span className="font-semibold text-sm">Concord OS</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href={`/login?from=/dtu/${id}`}
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/register"
              className="text-sm px-3 py-1.5 bg-neon-cyan/20 text-neon-cyan rounded-lg hover:bg-neon-cyan/30 transition-colors"
            >
              Join Concord
            </Link>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Title + Tier Badge */}
        <div className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
                tierCfg.bg,
                tierCfg.color
              )}
            >
              <TierIcon className="w-3.5 h-3.5" />
              {tierCfg.label}
            </span>
            {provenanceVerified && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-neon-green/10 text-neon-green">
                <Shield className="w-3.5 h-3.5" />
                Provenance Verified
              </span>
            )}
            {dtu.domain && (
              <span className="text-xs text-gray-500 px-2 py-1 bg-lattice-elevated rounded-full">
                {dtu.domain}
              </span>
            )}
          </div>

          <h1 className="text-3xl font-bold text-white leading-tight">{title}</h1>

          {/* Meta row */}
          <div className="flex items-center gap-4 text-sm text-gray-400 flex-wrap">
            {creator && (
              <Link
                href={`/profile/${creator}`}
                className="inline-flex items-center gap-1.5 hover:text-neon-cyan transition-colors"
              >
                <User className="w-3.5 h-3.5" />
                {creator}
              </Link>
            )}
            {createdAt && (
              <span className="inline-flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                {createdAt}
              </span>
            )}
            {dtu.type && (
              <span className="text-xs bg-lattice-elevated px-2 py-0.5 rounded">{dtu.type}</span>
            )}
          </div>
        </div>

        {/* Content */}
        <article className="bg-lattice-surface border border-lattice-border rounded-xl p-6">
          <div className="text-gray-200 whitespace-pre-wrap leading-relaxed prose prose-invert prose-sm max-w-none">
            {content}
          </div>
        </article>

        {/* Tags */}
        {tags.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <Tag className="w-4 h-4 text-gray-500" />
            {tags.map((tag) => (
              <span
                key={tag}
                className="text-xs px-2 py-1 bg-lattice-elevated text-gray-300 rounded-full"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}

        {/* Lineage Tree (simplified) */}
        {lineageNodes.length > 0 && (
          <div className="bg-lattice-surface border border-lattice-border rounded-xl p-5 space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <GitBranch className="w-4 h-4 text-neon-cyan" />
              Lineage
            </h2>
            <SimplifiedLineageTree nodes={lineageNodes} />
          </div>
        )}

        {/* Fork CTA */}
        <div className="bg-gradient-to-r from-neon-cyan/5 to-neon-purple/5 border border-lattice-border rounded-xl p-6 text-center space-y-3">
          <Copy className="w-8 h-8 text-neon-cyan mx-auto" />
          <h3 className="text-lg font-semibold text-white">Fork to your universe</h3>
          <p className="text-sm text-gray-400 max-w-md mx-auto">
            Create your own branch of this thought unit. Evolve it, extend it, make it yours.
          </p>
          <Link
            href={`/login?from=/lenses/chat?fork=${id}`}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-neon-cyan text-black font-medium rounded-lg hover:bg-neon-cyan/90 transition-colors"
          >
            Fork this DTU
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>

        {/* Footer */}
        <footer className="pt-6 border-t border-lattice-border text-center">
          <p className="text-xs text-gray-500">
            Shared from{' '}
            <Link href="/" className="text-neon-cyan hover:underline">
              Concord OS
            </Link>{' '}
            &mdash; Sovereign Cognitive Engine
          </p>
        </footer>
      </main>
    </div>
  );
}
