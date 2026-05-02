'use client';

import { useState } from 'react';
import { useLensDTUs } from '@/hooks/useLensDTUs';
import { useAuth } from '@/hooks/useAuth';
import { TierBadge } from './TierBadge';
import { Library, ExternalLink, ChevronDown, ChevronUp, RefreshCw, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DTU } from '@/lib/api/generated-types';

interface DTULibraryPanelProps {
  lens?: string;
  className?: string;
  onInsert?: (dtu: DTU) => void;
  startOpen?: boolean;
}

function DTULibraryPanel({
  lens = 'studio',
  className,
  onInsert,
  startOpen = true,
}: DTULibraryPanelProps) {
  const [open, setOpen] = useState(startOpen);
  const { user } = useAuth();
  const { contextDTUs, isLoading, refetch } = useLensDTUs({ lens });

  const myDTUs = (contextDTUs || []).filter(
    (d) => d.ownerId === user?.id || d.meta?.createdBy === user?.id
  );

  return (
    <div
      className={cn('rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden', className)}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-white/5 transition-colors"
      >
        <span className="flex items-center gap-2">
          <Library className="w-4 h-4 text-neon-cyan" />
          My Creations
          {myDTUs.length > 0 && (
            <span className="text-[10px] bg-neon-cyan/20 text-neon-cyan px-1.5 py-0.5 rounded-full">
              {myDTUs.length}
            </span>
          )}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              refetch();
            }}
            className="p-1 rounded text-gray-500 hover:text-white transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
          {open ? (
            <ChevronUp className="w-4 h-4 text-gray-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-400" />
          )}
        </div>
      </button>

      {open && (
        <div className="border-t border-white/10">
          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-4 h-4 text-neon-cyan animate-spin" />
            </div>
          ) : myDTUs.length === 0 ? (
            <div className="px-4 py-5 text-center">
              <p className="text-xs text-gray-500">No creations yet.</p>
              <p className="text-[10px] text-gray-600 mt-1">
                Save a project to create a DTU artifact.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-white/5 max-h-64 overflow-y-auto">
              {myDTUs.map((dtu) => (
                <li
                  key={dtu.id}
                  className="flex items-center gap-2 px-4 py-2.5 hover:bg-white/5 group"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{dtu.title}</p>
                    <p className="text-[10px] text-gray-500 mt-0.5">
                      {dtu.timestamp
                        ? new Date(dtu.timestamp).toLocaleDateString()
                        : 'Unknown date'}
                    </p>
                  </div>
                  <TierBadge tier={dtu.tier} size="sm" />
                  <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    {onInsert && (
                      <button
                        onClick={() => onInsert(dtu)}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-neon-cyan/15 text-neon-cyan hover:bg-neon-cyan/25 transition-colors"
                      >
                        Insert
                      </button>
                    )}
                    <a
                      href={`/dtu/${dtu.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-500 hover:text-white transition-colors"
                      title="Open"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}


import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _DTULibraryPanel = withErrorBoundary(DTULibraryPanel);
export { _DTULibraryPanel as DTULibraryPanel };
