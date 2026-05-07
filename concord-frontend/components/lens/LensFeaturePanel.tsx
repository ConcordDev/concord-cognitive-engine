'use client';

/**
 * LensFeaturePanel — Displays the complete feature specification for any lens.
 *
 * Shows all features from the 112-lens spec including Concord Coin integration,
 * DTU economics, merit credit, compression, preview system, remix/citation
 * economy, crew attribution, USB integration, bot/emergent access, and
 * cross-lens economics.
 *
 * Can be embedded in any lens page as a tab or panel.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import {
  Coins,
  Bot,
  Users,
  Shield,
  Zap,
  Brain,
  Lightbulb,
  Search,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Clock,
  Sparkles,
  Globe,
  Layers,
  Target,
  BarChart3,
  Cpu,
} from 'lucide-react';

interface LensFeature {
  id: string;
  lensId: string;
  featureId: string;
  name: string;
  description: string;
  category: string;
  integrations: string[];
  status: string;
}

interface LensFeatureSummary {
  lensId: string;
  lensNumber: number;
  category: string;
  featureCount: number;
  economicIntegrations: string[];
  emergentAccess: boolean;
  botAccess: boolean;
  usbIntegration: boolean;
}

interface LensFeaturePanelProps {
  lensId: string;
  className?: string;
  compact?: boolean;
}

const CATEGORY_CONFIG: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  economy: { icon: Coins, color: 'text-neon-green', label: 'Economy' },
  marketplace: { icon: Target, color: 'text-neon-purple', label: 'Marketplace' },
  creation: { icon: Sparkles, color: 'text-neon-cyan', label: 'Creation' },
  governance: { icon: Shield, color: 'text-blue-400', label: 'Governance' },
  analysis: { icon: BarChart3, color: 'text-yellow-400', label: 'Analysis' },
  collaboration: { icon: Users, color: 'text-pink-400', label: 'Collaboration' },
  infrastructure: { icon: Cpu, color: 'text-gray-400', label: 'Infrastructure' },
  research: { icon: Lightbulb, color: 'text-orange-400', label: 'Research' },
  safety: { icon: Shield, color: 'text-red-400', label: 'Safety' },
  intelligence: { icon: Brain, color: 'text-violet-400', label: 'Intelligence' },
};

const STATUS_CONFIG: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  active: { icon: CheckCircle2, color: 'bg-neon-green/20 text-neon-green', label: 'Active' },
  beta: { icon: Zap, color: 'bg-yellow-500/20 text-yellow-400', label: 'Beta' },
  planned: { icon: Clock, color: 'bg-blue-500/20 text-blue-400', label: 'Planned' },
  deprecated: { icon: Clock, color: 'bg-red-500/20 text-red-400', label: 'Deprecated' },
};

function LensFeaturePanel({ lensId, className, compact = false }: LensFeaturePanelProps) {
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedFeature, setExpandedFeature] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['lens-features', lensId],
    queryFn: () => api.get(`/api/lens-features/${lensId}`).then((r) => r.data),
    staleTime: 60000,
  });

  const features: LensFeature[] = useMemo(() => data?.features || [], [data]);
  const summary: LensFeatureSummary | null = data?.summary || null;

  const categories = useMemo(() => {
    const cats = new Set(features.map((f) => f.category));
    return Array.from(cats).sort();
  }, [features]);

  const filteredFeatures = useMemo(() => {
    let result = features;
    if (filterCategory !== 'all') {
      result = result.filter((f) => f.category === filterCategory);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (f) => f.name.toLowerCase().includes(q) || f.description.toLowerCase().includes(q)
      );
    }
    return result;
  }, [features, filterCategory, searchQuery]);

  if (isLoading) {
    return (
      <div className={cn('p-6 text-center text-gray-500', className)}>
        <Layers className="w-8 h-8 mx-auto mb-2 animate-pulse" />
        Loading features...
      </div>
    );
  }

  if (features.length === 0) {
    return (
      <div className={cn('p-8 text-center', className)}>
        <Layers className="w-10 h-10 mx-auto mb-3 text-gray-600" />
        <p className="text-gray-400 text-sm">No features defined for this lens yet.</p>
      </div>
    );
  }

  if (compact) {
    return (
      <div className={cn('space-y-2', className)}>
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Layers className="w-4 h-4 text-neon-cyan" />
          <span className="font-medium">{features.length} Features</span>
          {summary?.emergentAccess && <Bot className="w-3.5 h-3.5 text-neon-purple" />}
          {summary?.botAccess && <Cpu className="w-3.5 h-3.5 text-neon-green" />}
          {summary?.usbIntegration && <Globe className="w-3.5 h-3.5 text-neon-cyan" />}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {features.slice(0, 6).map((f) => {
            const cat = CATEGORY_CONFIG[f.category] || CATEGORY_CONFIG.infrastructure;
            const CatIcon = cat.icon;
            return (
              <span
                key={f.featureId}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-white/5 text-gray-300"
                title={f.description}
              >
                <CatIcon className={cn('w-3 h-3', cat.color)} />
                {f.name}
              </span>
            );
          })}
          {features.length > 6 && (
            <span className="px-2 py-0.5 rounded text-[10px] bg-white/5 text-gray-500">
              +{features.length - 6} more
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
          <Layers className="w-4 h-4 text-neon-cyan" />
          Lens Features
          <span className="text-xs text-gray-500">({features.length})</span>
        </h3>
        <div className="flex items-center gap-2">
          {summary?.emergentAccess && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-neon-purple/10 text-neon-purple">
              <Bot className="w-3 h-3" /> Emergent
            </span>
          )}
          {summary?.botAccess && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-neon-green/10 text-neon-green">
              <Cpu className="w-3 h-3" /> Bot
            </span>
          )}
          {summary?.usbIntegration && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-neon-cyan/10 text-neon-cyan">
              <Globe className="w-3 h-3" /> USB
            </span>
          )}
        </div>
      </div>

      {/* Economic Integrations */}
      {summary?.economicIntegrations && summary.economicIntegrations.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {summary.economicIntegrations.map((integration) => (
            <span
              key={integration}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-neon-green/5 text-neon-green/80 border border-neon-green/10"
            >
              <Coins className="w-3 h-3" />
              {integration.replace(/_/g, ' ')}
            </span>
          ))}
        </div>
      )}

      {/* Search + Filter */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search features..."
            className="w-full pl-8 pr-3 py-1.5 bg-white/5 border border-white/10 rounded text-xs focus:outline-none focus:border-neon-cyan/30"
          />
        </div>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="px-2 py-1.5 bg-white/5 border border-white/10 rounded text-xs focus:outline-none"
        >
          <option value="all">All Categories</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {CATEGORY_CONFIG[cat]?.label || cat}
            </option>
          ))}
        </select>
      </div>

      {/* Feature List */}
      <div className="space-y-1.5">
        {filteredFeatures.map((feature) => {
          const cat = CATEGORY_CONFIG[feature.category] || CATEGORY_CONFIG.infrastructure;
          const CatIcon = cat.icon;
          const statusCfg = STATUS_CONFIG[feature.status] || STATUS_CONFIG.active;
          const StatusIcon = statusCfg.icon;
          const isExpanded = expandedFeature === feature.featureId;

          return (
            <div
              key={feature.featureId}
              className={cn(
                'rounded-lg border border-white/5 bg-white/[0.02] transition-colors',
                isExpanded && 'border-white/10 bg-white/[0.04]'
              )}
            >
              <button
                onClick={() => setExpandedFeature(isExpanded ? null : feature.featureId)}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
              >
                <CatIcon className={cn('w-4 h-4 flex-shrink-0', cat.color)} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{feature.name}</p>
                  {!isExpanded && (
                    <p className="text-[11px] text-gray-500 truncate">{feature.description}</p>
                  )}
                </div>
                <span
                  className={cn(
                    'px-1.5 py-0.5 rounded text-[9px] font-medium flex-shrink-0 inline-flex items-center gap-0.5',
                    statusCfg.color
                  )}
                >
                  <StatusIcon className="w-2.5 h-2.5" />
                  {statusCfg.label}
                </span>
                {isExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                )}
              </button>

              {isExpanded && (
                <div className="px-3 pb-3 space-y-2 border-t border-white/5 pt-2">
                  <p className="text-xs text-gray-400">{feature.description}</p>
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className={cn('px-1.5 py-0.5 rounded', cat.color, 'bg-white/5')}>
                      {cat.label}
                    </span>
                    {feature.integrations.map((int) => (
                      <span key={int} className="px-1.5 py-0.5 rounded bg-white/5 text-gray-400">
                        {int.replace(/_/g, ' ')}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {filteredFeatures.length === 0 && (
        <p className="text-center text-gray-500 text-xs py-4">No features match your filters.</p>
      )}
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedLensFeaturePanel = withErrorBoundary(LensFeaturePanel);
export { _WrappedLensFeaturePanel as LensFeaturePanel };
