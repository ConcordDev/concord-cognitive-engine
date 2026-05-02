'use client';

/**
 * InspectorDrawer — Object Inspector for any entity (DTU, artifact, listing, project, job).
 *
 * Shows metadata, versions, links, recent events, and available actions.
 * Opens as a right-side drawer/panel.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import {
  X,
  FileText,
  Package,
  Store,
  Music,
  Cog,
  History,
  Link2,
  ChevronDown,
  ChevronRight,
  Copy,
} from 'lucide-react';
import { useUIStore } from '@/store/ui';

interface InspectorProps {
  entityType: string;
  entityId: string;
  onClose: () => void;
}

interface InspectorData {
  ok: boolean;
  entityType: string;
  entity: Record<string, unknown>;
  versions: Array<{ id: string; version: number; created_at: string }>;
  links: Array<{
    id: string;
    from_kind: string;
    from_id: string;
    to_artifact_id: string;
    rel: string;
  }>;
  recentEvents: Array<{
    id: string;
    type: string;
    summary: string;
    createdAt: string;
    undoToken: string | null;
  }>;
  actions: string[];
}

const ENTITY_ICONS: Record<string, typeof FileText> = {
  dtu: FileText,
  artifact: Package,
  listing: Store,
  project: Music,
  job: Cog,
};

function InspectorDrawer({ entityType, entityId, onClose }: InspectorProps) {
  const addToast = useUIStore((s) => s.addToast);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['details', 'actions'])
  );

  const { data, isLoading, isError } = useQuery<InspectorData>({
    queryKey: ['inspector', entityType, entityId],
    queryFn: async () => (await api.get(`/api/inspect/${entityType}/${entityId}`)).data,
  });

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  const copyId = () => {
    navigator.clipboard.writeText(entityId);
    addToast({ type: 'success', message: 'ID copied' });
  };

  const Icon = ENTITY_ICONS[entityType] || FileText;

  return (
    <div className="fixed top-0 right-0 z-50 w-96 h-full bg-lattice-surface border-l border-lattice-border shadow-2xl overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-lattice-border sticky top-0 bg-lattice-surface z-10">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-neon-blue" />
          <span className="text-sm font-medium text-white capitalize">{entityType} Inspector</span>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </div>

      {isLoading ? (
        <div className="p-4 text-gray-500 text-sm">Loading...</div>
      ) : isError || !data ? (
        <div className="p-4 text-red-400 text-sm">Failed to load entity</div>
      ) : (
        <div className="divide-y divide-lattice-border/50">
          {/* ID bar */}
          <div className="px-4 py-2 flex items-center justify-between text-xs">
            <span className="font-mono text-gray-500 truncate">{entityId}</span>
            <button onClick={copyId} className="text-gray-500 hover:text-white">
              <Copy className="w-3 h-3" />
            </button>
          </div>

          {/* Details */}
          <CollapsibleSection
            title="Details"
            section="details"
            expanded={expandedSections.has('details')}
            onToggle={toggleSection}
          >
            <div className="space-y-1">
              {Object.entries(data.entity)
                .filter(
                  ([k]) =>
                    !k.startsWith('_') &&
                    ![
                      'body_json',
                      'tags_json',
                      'metadata_json',
                      'input_json',
                      'output_json',
                      'error_json',
                    ].includes(k)
                )
                .map(([key, val]) => (
                  <div key={key} className="flex items-start justify-between text-xs">
                    <span className="text-gray-500 flex-shrink-0">{key}:</span>
                    <span className="text-gray-300 text-right truncate ml-2 max-w-[200px]">
                      {typeof val === 'object' ? JSON.stringify(val) : String(val ?? '—')}
                    </span>
                  </div>
                ))}
            </div>
          </CollapsibleSection>

          {/* Actions */}
          {data.actions.length > 0 && (
            <CollapsibleSection
              title={`Actions (${data.actions.length})`}
              section="actions"
              expanded={expandedSections.has('actions')}
              onToggle={toggleSection}
            >
              <div className="flex flex-wrap gap-1">
                {data.actions.map((action) => (
                  <span
                    key={action}
                    className="px-2 py-0.5 text-xs rounded bg-neon-blue/10 text-neon-blue border border-neon-blue/20 cursor-pointer hover:bg-neon-blue/20"
                  >
                    {action.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            </CollapsibleSection>
          )}

          {/* Versions */}
          {data.versions.length > 0 && (
            <CollapsibleSection
              title={`Versions (${data.versions.length})`}
              section="versions"
              expanded={expandedSections.has('versions')}
              onToggle={toggleSection}
            >
              <div className="space-y-1">
                {data.versions.map((v) => (
                  <div key={v.id} className="flex items-center justify-between text-xs">
                    <span className="text-gray-300 flex items-center gap-1">
                      <History className="w-3 h-3 text-gray-600" />v{v.version}
                    </span>
                    <span className="text-gray-600 font-mono">{v.created_at?.slice(0, 16)}</span>
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          )}

          {/* Links */}
          {data.links.length > 0 && (
            <CollapsibleSection
              title={`Links (${data.links.length})`}
              section="links"
              expanded={expandedSections.has('links')}
              onToggle={toggleSection}
            >
              <div className="space-y-1">
                {data.links.map((link) => (
                  <div key={link.id} className="flex items-center gap-1 text-xs text-gray-400">
                    <Link2 className="w-3 h-3 text-gray-600" />
                    <span>{link.rel || 'linked'}</span>
                    <span className="font-mono text-gray-600 truncate">
                      {link.to_artifact_id?.slice(0, 12)}
                    </span>
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          )}

          {/* Recent events */}
          {data.recentEvents.length > 0 && (
            <CollapsibleSection
              title={`History (${data.recentEvents.length})`}
              section="history"
              expanded={expandedSections.has('history')}
              onToggle={toggleSection}
            >
              <div className="space-y-1">
                {data.recentEvents.map((evt) => (
                  <div key={evt.id} className="text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400">{evt.summary}</span>
                      {evt.undoToken && <span className="text-neon-blue text-[10px]">undo</span>}
                    </div>
                    <span className="text-gray-600 font-mono">{evt.createdAt?.slice(0, 16)}</span>
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          )}
        </div>
      )}
    </div>
  );
}

function CollapsibleSection({
  title,
  section,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  section: string;
  expanded: boolean;
  onToggle: (section: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        onClick={() => onToggle(section)}
        className="flex items-center gap-1 w-full px-4 py-2 text-xs font-medium text-gray-400 hover:text-white"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {title}
      </button>
      {expanded && <div className="px-4 pb-2">{children}</div>}
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedInspectorDrawer = withErrorBoundary(InspectorDrawer);
export { _WrappedInspectorDrawer as InspectorDrawer };
