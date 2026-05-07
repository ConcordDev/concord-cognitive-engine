'use client';

/**
 * LensPageShell — Complete lens page wrapper that eliminates per-page boilerplate.
 *
 * Composes LensShell with:
 *  - Real-time data via useRealtimeLens (LiveIndicator, RealtimeDataPanel)
 *  - DTU export button
 *  - Collapsible LensFeaturePanel
 *  - Standard header with icon + title + description + live status
 *
 * Reduces ~200-400 lines of boilerplate per lens page to a single wrapper.
 *
 * Usage:
 *   <LensPageShell
 *     domain="ethics"
 *     title="Ethics Lens"
 *     description="Invariant simulator for moral philosophy queues"
 *     headerIcon={<Scale className="w-6 h-6" />}
 *   >
 *     {(realtimeProps) => (
 *       <YourDomainContent {...realtimeProps} />
 *     )}
 *   </LensPageShell>
 *
 * Or with static children:
 *   <LensPageShell domain="ethics" title="Ethics" description="...">
 *     <YourDomainContent />
 *   </LensPageShell>
 */

import { ReactNode, useState } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { Loading } from '@/components/common/Loading';
import { ErrorState } from '@/components/common/EmptyState';
import { ChevronDown, Layers } from 'lucide-react';

export interface RealtimeProps {
  realtimeData: Record<string, unknown> | null;
  isLive: boolean;
  lastUpdated: string | null;
  insights: Array<{ domain: string; insight: string; confidence: number; timestamp: string }>;
  alerts: Array<{ id: string; message: string; severity: string; timestamp: string }>;
}

interface LensPageShellProps {
  /** Domain slug — used for useLensNav, useRealtimeLens, DTUExport, and features */
  domain: string;
  /** Page title */
  title: string;
  /** Short description shown under the title */
  description?: string;
  /** Icon element rendered in the header */
  headerIcon?: ReactNode;

  /** Data loading states */
  isLoading?: boolean;
  isError?: boolean;
  error?: { message?: string } | null;
  onRetry?: () => void;

  /** Optional header actions (buttons, etc.) rendered to the right of the title */
  actions?: ReactNode;

  /** If true, show DTU export button */
  showExport?: boolean;
  /** If true, show realtime data panel */
  showRealtimePanel?: boolean;
  /** If true, show the collapsible feature panel at the bottom */
  showFeatures?: boolean;

  /** Extra data to include in DTU export */
  exportData?: unknown;

  /**
   * Children can be:
   *  - ReactNode (static children)
   *  - Render function receiving realtime props for dynamic children
   */
  children: ReactNode | ((props: RealtimeProps) => ReactNode);

  className?: string;
}

export function LensPageShell({
  domain,
  title,
  description,
  headerIcon,
  isLoading = false,
  isError = false,
  error,
  onRetry,
  actions,
  showExport = true,
  showRealtimePanel = true,
  showFeatures = true,
  exportData,
  children,
  className,
}: LensPageShellProps) {
  useLensNav(domain);
  const [showFeaturesPanel, setShowFeaturesPanel] = useState(false);
  const {
    latestData: realtimeData,
    isLive,
    lastUpdated,
    insights,
    alerts,
  } = useRealtimeLens(domain);

  const realtimeProps: RealtimeProps = {
    realtimeData: realtimeData as Record<string, unknown> | null,
    isLive,
    lastUpdated,
    insights: insights ?? [],
    alerts: (alerts ?? []) as RealtimeProps['alerts'],
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Loading text={`Loading ${title.toLowerCase()}...`} />
      </div>
    );
  }

  // Error state
  if (isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message} onRetry={onRetry} />
      </div>
    );
  }

  return (
    <div
      data-testid="lens-shell"
      data-lens-theme={domain}
      className={`px-3 py-4 sm:p-6 space-y-4 sm:space-y-6 ${className ?? ''}`}
    >
      {/* Header */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {headerIcon && <div className="text-neon-cyan">{headerIcon}</div>}
          <div>
            <h1 className="text-xl font-bold">{title}</h1>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
            {description && <p className="text-sm text-gray-400">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </header>

      {/* Realtime toolbar */}
      {showRealtimePanel && (
        <RealtimeDataPanel
          domain={domain}
          data={realtimeData as Record<string, unknown> | null}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={insights}
          compact
        />
      )}

      {/* DTU Export */}
      {showExport && <DTUExportButton domain={domain} data={exportData ?? {}} compact />}

      {/* Domain-specific content */}
      {typeof children === 'function' ? children(realtimeProps) : children}

      {/* Collapsible Lens Features */}
      {showFeatures && (
        <div className="border-t border-white/10">
          <button
            onClick={() => setShowFeaturesPanel(!showFeaturesPanel)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-400 hover:text-white transition-colors"
          >
            <span className="flex items-center gap-2">
              <Layers className="w-4 h-4" />
              Lens Features & Capabilities
            </span>
            <ChevronDown
              className={`w-4 h-4 transition-transform ${showFeaturesPanel ? 'rotate-180' : ''}`}
            />
          </button>
          {showFeaturesPanel && (
            <div className="px-4 pb-4">
              <LensFeaturePanel lensId={domain} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
