'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { History, Clock, RotateCcw, ChevronDown, ChevronRight, User, Diff } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Version {
  version: number;
  snapshot: {
    title: string;
    content?: string;
    tags: string[];
    tier: string;
  };
  changedAt: string;
  changedBy: string;
}

interface VersionHistoryProps {
  dtuId: string;
  versions: Version[];
  currentVersion?: number;
  onRestore?: (version: number) => void;
  onCompare?: (v1: number, v2: number) => void;
  className?: string;
}

export function VersionHistory({
  dtuId,
  versions,
  currentVersion,
  onRestore,
  onCompare,
  className,
}: VersionHistoryProps) {
  const [expandedVersion, setExpandedVersion] = useState<number | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [selectedVersions, setSelectedVersions] = useState<number[]>([]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  };

  const toggleVersion = (version: number) => {
    if (compareMode) {
      setSelectedVersions((prev) => {
        if (prev.includes(version)) {
          return prev.filter((v) => v !== version);
        }
        if (prev.length >= 2) {
          return [prev[1], version];
        }
        return [...prev, version];
      });
    } else {
      setExpandedVersion(expandedVersion === version ? null : version);
    }
  };

  const handleCompare = () => {
    if (selectedVersions.length === 2 && onCompare) {
      onCompare(selectedVersions[0], selectedVersions[1]);
    }
  };

  if (versions.length === 0) {
    return (
      <div className={cn('flex flex-col items-center justify-center py-8 text-center', className)}>
        <History className="w-10 h-10 text-gray-600 mb-3" />
        <p className="text-gray-400">No version history yet</p>
        <p className="text-xs text-gray-600 mt-1">Changes will be tracked automatically</p>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-lattice-border">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-neon-cyan" />
          <span className="font-medium text-white">Version History</span>
          <span className="text-xs text-gray-500">({versions.length})</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setCompareMode(!compareMode);
              setSelectedVersions([]);
            }}
            className={cn(
              'px-3 py-1 text-xs rounded transition-colors',
              compareMode ? 'bg-neon-purple/20 text-neon-purple' : 'text-gray-400 hover:text-white'
            )}
          >
            <Diff className="w-3 h-3 inline mr-1" />
            Compare
          </button>
        </div>
      </div>

      {/* Compare action */}
      {compareMode && selectedVersions.length === 2 && (
        <div className="px-4 py-2 bg-neon-purple/10 border-b border-lattice-border">
          <button
            onClick={handleCompare}
            className="w-full py-2 bg-neon-purple text-white text-sm rounded hover:bg-neon-purple/90 transition-colors"
          >
            Compare v{selectedVersions[0]} with v{selectedVersions[1]}
          </button>
        </div>
      )}

      {/* Version list */}
      <div className="flex-1 overflow-y-auto">
        {versions.map((v, _index) => {
          const isExpanded = expandedVersion === v.version;
          const isSelected = selectedVersions.includes(v.version);
          const isCurrent = v.version === currentVersion;

          return (
            <div
              key={v.version}
              className={cn('border-b border-lattice-border', isSelected && 'bg-neon-purple/10')}
            >
              <button
                onClick={() => toggleVersion(v.version)}
                className="w-full px-4 py-3 flex items-start gap-3 hover:bg-lattice-surface/50 transition-colors"
              >
                {/* Version indicator */}
                <div
                  className={cn(
                    'w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0',
                    isCurrent
                      ? 'bg-neon-cyan/20 text-neon-cyan'
                      : 'bg-lattice-surface text-gray-400'
                  )}
                >
                  v{v.version}
                </div>

                {/* Version info */}
                <div className="flex-1 min-w-0 text-left">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-white truncate">{v.snapshot.title}</span>
                    {isCurrent && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-neon-cyan/20 text-neon-cyan">
                        Current
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDate(v.changedAt)}
                    </span>
                    <span className="flex items-center gap-1">
                      <User className="w-3 h-3" />
                      {v.changedBy}
                    </span>
                  </div>
                </div>

                {/* Expand/select indicator */}
                {compareMode ? (
                  <div
                    className={cn(
                      'w-5 h-5 rounded border flex items-center justify-center',
                      isSelected
                        ? 'border-neon-purple bg-neon-purple text-white'
                        : 'border-gray-600'
                    )}
                  >
                    {isSelected && (
                      <span className="text-xs">{selectedVersions.indexOf(v.version) + 1}</span>
                    )}
                  </div>
                ) : isExpanded ? (
                  <ChevronDown className="w-4 h-4 text-gray-400" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                )}
              </button>

              {/* Expanded content */}
              <AnimatePresence>
                {isExpanded && !compareMode && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-4 pl-15">
                      {/* Tags */}
                      {v.snapshot.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-3">
                          {v.snapshot.tags.map((tag) => (
                            <span
                              key={tag}
                              className="px-2 py-0.5 text-xs bg-lattice-surface rounded text-gray-400"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Content preview */}
                      {v.snapshot.content && (
                        <p className="text-sm text-gray-400 line-clamp-3 mb-3">
                          {v.snapshot.content}
                        </p>
                      )}

                      {/* Restore button */}
                      {!isCurrent && onRestore && (
                        <button
                          onClick={() => onRestore(v.version)}
                          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-lattice-surface border border-lattice-border rounded hover:border-neon-cyan hover:text-neon-cyan transition-colors"
                          data-dtu-id={dtuId}
                        >
                          <RotateCcw className="w-3 h-3" />
                          Restore this version
                        </button>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}
