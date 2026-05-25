'use client';

/**
 * LensShell — Shared execution shell for all lens pages
 *
 * Eliminates cross-lens duplication by providing:
 * - Automatic useLensNav registration
 * - Standard loading/error/empty states
 * - Tab bar rendering (when tabs provided)
 * - Search + filter bar (when searchable)
 * - Consistent layout via ds.pageContainer
 *
 * Usage:
 *   <LensShell
 *     domain="education"
 *     title="Education"
 *     icon={<GraduationCap />}
 *     tabs={tabs}
 *     activeTab={activeTab}
 *     onTabChange={setActiveTab}
 *     isLoading={isLoading}
 *     isError={isError}
 *     error={error}
 *   >
 *     {children}
 *   </LensShell>
 */

import { ReactNode, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLensNav } from '@/hooks/useLensNav';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { Loading } from '@/components/common/Loading';
import { ErrorState } from '@/components/common/EmptyState';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { PersistentChatRail } from '@/components/chat/PersistentChatRail';
import { ConnectiveTissueBar } from '@/components/lens/ConnectiveTissueBar';
import { Search, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface LensTab {
  id: string;
  icon: LucideIcon;
  label?: string;
}

interface LensShellProps {
  /** Domain slug for useLensNav (e.g. 'education') */
  domain: string;
  /** Page title displayed in header */
  title: string;
  /** Icon displayed next to title */
  icon?: ReactNode;
  /** Header actions (e.g. create button) */
  actions?: ReactNode;

  /** Tab configuration */
  tabs?: LensTab[];
  activeTab?: string;
  onTabChange?: (tabId: string) => void;

  /** Search bar */
  searchable?: boolean;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  searchPlaceholder?: string;

  /** Filter controls slot */
  filters?: ReactNode;

  /** Universal AI actions — pass selected artifact ID to enable analyze/generate/suggest */
  aiActions?: boolean;
  selectedArtifactId?: string | null;

  /** Persistent chat rail — enable the cross-lens conversation panel */
  enableChatRail?: boolean;

  /** ConnectiveTissueBar — show DTU economy bar (tip, publish, bounty, fork, search) */
  enableConnectiveTissue?: boolean;

  /** Data loading states */
  isLoading?: boolean;
  isError?: boolean;
  error?: { message?: string } | null;
  onRetry?: () => void;

  /** Main content */
  children: ReactNode;
  className?: string;
}

export function LensShell({
  domain,
  title,
  icon,
  actions,
  tabs,
  activeTab,
  onTabChange,
  searchable,
  searchQuery,
  onSearchChange,
  searchPlaceholder = 'Search...',
  filters,
  aiActions,
  selectedArtifactId,
  enableChatRail = true,
  enableConnectiveTissue = true,
  isLoading,
  isError,
  error,
  onRetry,
  children,
  className,
}: LensShellProps) {
  useLensNav(domain);
  const router = useRouter();
  const [chatOpen, setChatOpen] = useState(false);

  const handleLensNavigate = (lensDomain: string) => {
    router.push(`/lenses/${lensDomain}`);
  };

  return (
    <div className={cn(ds.pageContainer, chatOpen && 'mr-[380px]', className)}>
      {/* Header */}
      <div className={ds.sectionHeader}>
        <div className="flex items-center gap-3">
          {icon && <div className="text-neon-cyan">{icon}</div>}
          <h1 className={ds.heading1}>{title}</h1>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>

      {/* Tab Bar */}
      {tabs && tabs.length > 0 && (
        <div className="flex gap-1 border-b border-lattice-border pb-px overflow-x-auto">
          {tabs.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange?.(tab.id)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap',
                  isActive
                    ? 'text-neon-cyan border-b-2 border-neon-cyan bg-lattice-surface'
                    : 'text-gray-400 hover:text-white hover:bg-lattice-surface/50'
                )}
              >
                <Icon className="w-4 h-4" />
                {tab.label || tab.id}
              </button>
            );
          })}
        </div>
      )}

      {/* Search + Filters Row */}
      {(searchable || filters) && (
        <div className="flex items-center gap-3 flex-wrap">
          {searchable && (
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchQuery || ''}
                onChange={e => onSearchChange?.(e.target.value)}
                placeholder={searchPlaceholder}
                className={cn(ds.input, 'pl-10 pr-8')}
              />
              {searchQuery && (
                <button
                  onClick={() => onSearchChange?.('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                aria-label="Close">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
          {filters}
        </div>
      )}

      {/* Universal AI Actions */}
      {aiActions && (
        <UniversalActions domain={domain} artifactId={selectedArtifactId} compact />
      )}

      {/* Connective Tissue — cross-lens DTU economy bar */}
      {enableConnectiveTissue && (
        <ConnectiveTissueBar lensId={domain} />
      )}

      {/* Content area with standard loading/error states */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loading text={`Loading ${title.toLowerCase()}...`} />
        </div>
      ) : isError ? (
        <ErrorState error={error?.message} onRetry={onRetry} />
      ) : (
        children
      )}

      {/* Persistent Chat Rail — follows user across all lenses */}
      {enableChatRail && (
        <PersistentChatRail
          currentLens={domain}
          collapsed={!chatOpen}
          onToggle={() => setChatOpen(!chatOpen)}
          onLensNavigate={handleLensNavigate}
        />
      )}
    </div>
  );
}

/**
 * StatusBadge — Shared status badge with color mapping
 */
export function StatusBadge({
  status,
  colorMap,
}: {
  status: string;
  colorMap?: Record<string, string>;
}) {
  const defaultColors: Record<string, string> = {
    active: 'neon-green',
    draft: 'gray-400',
    completed: 'neon-cyan',
    archived: 'gray-500',
    pending: 'amber-400',
    approved: 'neon-green',
    rejected: 'red-400',
    enrolled: 'neon-blue',
    withdrawn: 'red-400',
    graduated: 'amber-400',
  };
  const colors = colorMap || defaultColors;
  const color = colors[status] || 'gray-400';

  return (
    <span className={ds.badge(color)}>
      {status}
    </span>
  );
}

/**
 * ItemList — Shared list rendering with empty state
 */
export function ItemList<T>({
  items,
  renderItem,
  emptyTitle = 'No items found',
  emptyDescription,
  onCreateNew,
  grid,
}: {
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
  onCreateNew?: () => void;
  grid?: '2' | '3' | '4';
}) {
  if (items.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-400 mb-2">{emptyTitle}</p>
        {emptyDescription && <p className="text-sm text-gray-400">{emptyDescription}</p>}
        {onCreateNew && (
          <button onClick={onCreateNew} className={cn(ds.btnPrimary, 'mt-4')}>
            Create New
          </button>
        )}
      </div>
    );
  }

  const gridClass = grid === '4' ? ds.grid4 : grid === '3' ? ds.grid3 : grid === '2' ? ds.grid2 : 'space-y-3';

  return (
    <div className={gridClass}>
      {items.map((item, i) => renderItem(item, i))}
    </div>
  );
}
