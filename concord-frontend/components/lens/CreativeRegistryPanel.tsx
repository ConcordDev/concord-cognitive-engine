'use client';

/**
 * CreativeRegistryPanel — Shows Creative Global content available
 * for a given domain. Displays in every creative lens.
 */

import { useEffect } from 'react';
import { useCreativeRegistry } from '@/hooks/useCreativeRegistry';
import { Globe, RefreshCw, Music, Image as ImageIcon, Code, FileText, Layers } from 'lucide-react';

interface CreativeRegistryPanelProps {
  domain: string;
  contentType?: string;
  onUse?: (dtuId: string) => void;
  onRemix?: (dtuId: string) => void;
}

function ContentIcon({ type }: { type: string }) {
  if (type?.startsWith('audio/')) return <Music className="w-4 h-4 text-neon-cyan" />;
  if (type?.startsWith('image/')) return <ImageIcon className="w-4 h-4 text-purple-400" />;
  if (type?.startsWith('text/')) return <FileText className="w-4 h-4 text-yellow-400" />;
  if (type === 'code') return <Code className="w-4 h-4 text-neon-green" />;
  return <Layers className="w-4 h-4 text-gray-400" />;
}

export function CreativeRegistryPanel({
  domain,
  contentType,
  onUse,
  onRemix,
}: CreativeRegistryPanelProps) {
  const { entries, total, isLoading, on, off, handleRegistryUpdate } = useCreativeRegistry(domain, contentType);

  // Subscribe to real-time updates
  useEffect(() => {
    on('creative_registry:update', handleRegistryUpdate);
    return () => {
      off('creative_registry:update', handleRegistryUpdate);
    };
  }, [on, off, handleRegistryUpdate]);

  if (isLoading) {
    return (
      <div className="lens-card animate-pulse">
        <div className="h-4 bg-gray-700 rounded w-1/3 mb-3" />
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-gray-800 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="lens-card">
        <div className="flex items-center gap-2 mb-2">
          <Globe className="w-4 h-4 text-neon-green" />
          <h3 className="text-sm font-semibold text-white">Creative Global</h3>
          <span className="text-xs text-gray-500">{domain}</span>
        </div>
        <p className="text-xs text-gray-500">No creative content available yet.</p>
      </div>
    );
  }

  return (
    <div className="lens-card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-neon-green" />
          <h3 className="text-sm font-semibold text-white">Creative Global</h3>
          <span className="text-xs text-gray-500">{domain}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleRegistryUpdate({})}
            className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
            title="Refresh registry"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs text-gray-500">{total} items</span>
        </div>
      </div>

      <div className="space-y-2 max-h-80 overflow-y-auto">
        {entries.map((entry) => (
          <div
            key={entry.dtuId}
            className="flex items-center gap-3 p-2 rounded bg-gray-800/50 hover:bg-gray-800 transition-colors"
          >
            <ContentIcon type={entry.contentType} />

            <div className="flex-1 min-w-0">
              <h4 className="text-sm text-white truncate">
                {entry.title || 'Untitled'}
              </h4>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span>by {entry.creator || 'unknown'}</span>
                <span className="px-1 py-0.5 bg-gray-700 rounded text-gray-400">
                  {entry.tier}
                </span>
                {entry.crossDomain && (
                  <span className="text-neon-cyan/60">from {entry.primaryDomain}</span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {onUse && (
                <button
                  onClick={() => onUse(entry.dtuId)}
                  className="px-2 py-1 text-xs text-gray-300 border border-gray-600 rounded hover:bg-gray-700 transition-colors"
                >
                  Use
                </button>
              )}
              {onRemix && (
                <button
                  onClick={() => onRemix(entry.dtuId)}
                  className="px-2 py-1 text-xs text-neon-green border border-neon-green/30 rounded hover:bg-neon-green/10 transition-colors"
                >
                  Remix
                </button>
              )}
              {entry.dtu?.marketplace && (
                <span className="text-xs text-neon-cyan font-medium">
                  ${entry.dtu.marketplace.price}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
