'use client';

import { useState } from 'react';
import { X, Clock, GitBranch, Tag, FileText, Zap, Crown, Ghost } from 'lucide-react';
import { ProvenanceBadge } from './ProvenanceBadge';
import { TierBadge, TierBadgeDetail } from './TierBadge';

interface DTU {
  id: string;
  tier: 'regular' | 'mega' | 'hyper' | 'shadow';
  summary: string;
  content: string;
  timestamp: string;
  resonance?: number;
  parentId?: string;
  children?: string[];
  tags?: string[];
  metadata?: Record<string, unknown>;
  source?: string;
  meta?: Record<string, unknown>;
}

interface DTUDetailModalProps {
  dtu: DTU | null;
  isOpen: boolean;
  onClose: () => void;
  onNavigate?: (id: string) => void;
}

const tierConfig = {
  regular: { icon: Zap, color: 'text-neon-blue', label: 'Regular DTU' },
  mega: { icon: Crown, color: 'text-neon-purple', label: 'Mega DTU' },
  hyper: { icon: Zap, color: 'text-neon-pink', label: 'Hyper DTU' },
  shadow: { icon: Ghost, color: 'text-gray-400', label: 'Shadow DTU' },
};

export function DTUDetailModal({ dtu, isOpen, onClose, onNavigate }: DTUDetailModalProps) {
  const [activeTab, setActiveTab] = useState<'content' | 'lineage' | 'metadata'>('content');

  if (!isOpen || !dtu) return null;

  const config = tierConfig[dtu.tier];
  const TierIcon = config.icon;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }} />

      {/* Modal */}
      <div className="relative w-full max-w-2xl max-h-[80vh] bg-lattice-surface border border-lattice-border rounded-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-lattice-border">
          <div className="flex items-center gap-3">
            <TierIcon className={`w-5 h-5 ${config.color}`} />
            <div>
              <h2 className="font-semibold flex items-center gap-2">
                {config.label}
                <TierBadge tier={dtu.tier} size="sm" />
                <ProvenanceBadge source={dtu.source} model={dtu.meta?.model as string} authority={dtu.meta?.authority as string} />
              </h2>
              <p className="text-xs text-gray-500 font-mono">{dtu.id}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-lattice-elevated transition-colors"
          aria-label="Close">
            <X className="w-5 h-5" />
          </button>
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
          {activeTab === 'content' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-gray-400 mb-2">Summary</h3>
                <p className="text-white">{dtu.summary}</p>
              </div>

              <div>
                <h3 className="text-sm font-medium text-gray-400 mb-2">Full Content</h3>
                <div className="bg-lattice-deep p-4 rounded-lg">
                  <p className="text-gray-200 whitespace-pre-wrap">{dtu.content}</p>
                </div>
              </div>

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
                        className="px-3 py-1 bg-lattice-elevated rounded-full text-sm"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-4 text-sm text-gray-400">
                <span className="flex items-center gap-1">
                  <Clock className="w-4 h-4" />
                  {new Date(dtu.timestamp).toLocaleString()}
                </span>
                {dtu.resonance !== undefined && (
                  <span>Resonance: {(dtu.resonance * 100).toFixed(1)}%</span>
                )}
              </div>

              {/* Tier consolidation details */}
              {(dtu.tier === 'mega' || dtu.tier === 'hyper' || !!dtu.metadata?.consolidated) && (
                <div className="pt-2 border-t border-lattice-border">
                  <TierBadgeDetail
                    tier={dtu.tier}
                    showRegular
                    sourceCount={dtu.metadata?.sourceCount as number | undefined}
                    sourceDtus={(dtu.children || []).map((id: string) => ({ id }))}
                    megaCount={dtu.metadata?.megaCount as number | undefined}
                    totalDtuCount={dtu.metadata?.totalDtuCount as number | undefined}
                    consolidatedInto={
                      dtu.metadata?.consolidatedInto
                        ? { id: dtu.metadata.consolidatedInto as string, title: dtu.metadata.consolidatedIntoTitle as string | undefined }
                        : null
                    }
                    onNavigateToParent={onNavigate}
                  />
                </div>
              )}
            </div>
          )}

          {activeTab === 'lineage' && (
            <div className="space-y-4">
              {dtu.parentId && (
                <div>
                  <h3 className="text-sm font-medium text-gray-400 mb-2">Parent DTU</h3>
                  <button
                    onClick={() => onNavigate?.(dtu.parentId!)}
                    className="lens-card w-full text-left hover:border-neon-cyan transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <GitBranch className="w-4 h-4 text-gray-400" />
                      <span className="font-mono text-sm">{dtu.parentId}</span>
                    </div>
                  </button>
                </div>
              )}

              <div>
                <h3 className="text-sm font-medium text-gray-400 mb-2">
                  Children ({dtu.children?.length || 0})
                </h3>
                {dtu.children && dtu.children.length > 0 ? (
                  <div className="space-y-2">
                    {dtu.children.map((childId) => (
                      <button
                        key={childId}
                        onClick={() => onNavigate?.(childId)}
                        className="lens-card w-full text-left hover:border-neon-cyan transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <GitBranch className="w-4 h-4 text-gray-400 rotate-180" />
                          <span className="font-mono text-sm">{childId}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-sm">No children DTUs</p>
                )}
              </div>
            </div>
          )}

          {activeTab === 'metadata' && (
            <div>
              <h3 className="text-sm font-medium text-gray-400 mb-2 flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Raw Metadata
              </h3>
              <pre className="bg-lattice-deep p-4 rounded-lg text-sm font-mono overflow-auto">
                {JSON.stringify(dtu.metadata || {}, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
