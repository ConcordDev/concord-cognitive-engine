'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { Activity, X } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import ShieldCard from '@/components/chat/ShieldCard';
import MeshStatusCard from '@/components/chat/MeshStatusCard';
import IntelligenceCard from '@/components/chat/IntelligenceCard';
import AtlasPrivacyMonitor from '@/components/chat/AtlasPrivacyMonitor';
import { InitiativeChip, type Initiative } from '@/components/chat/InitiativeChip';

type SystemsTab = 'shield' | 'mesh' | 'intel' | 'privacy' | 'initiatives';

export function ChatSystemsDrawer({
  open,
  onClose,
  initiativesData,
}: {
  open: boolean;
  onClose: () => void;
  initiativesData?: Initiative[] | null;
}) {
  const [systemsTab, setSystemsTab] = useState<SystemsTab>('shield');

  const { data: shieldData } = useQuery({
    queryKey: ['chat-shield-status'],
    queryFn: () =>
      api
        .get<{ ok: boolean; securityScore?: Record<string, unknown> }>('/api/shield/status')
        .then((r) => (r.data?.securityScore || r.data || {}) as Record<string, unknown>),
    enabled: open && systemsTab === 'shield',
    refetchInterval: open && systemsTab === 'shield' ? 10_000 : false,
  });
  const { data: meshData } = useQuery({
    queryKey: ['chat-mesh-status'],
    queryFn: () => api.get<Record<string, unknown>>('/api/mesh/status').then((r) => r.data || {}),
    enabled: open && systemsTab === 'mesh',
    refetchInterval: open && systemsTab === 'mesh' ? 10_000 : false,
  });
  const { data: intelData } = useQuery({
    queryKey: ['chat-intel-status'],
    queryFn: () => api.get<Record<string, unknown>>('/api/intel/status').then((r) => r.data || {}),
    enabled: open && systemsTab === 'intel',
    refetchInterval: open && systemsTab === 'intel' ? 15_000 : false,
  });
  const { data: privacyData } = useQuery({
    queryKey: ['chat-atlas-privacy'],
    queryFn: () =>
      api
        .get<Record<string, unknown>>('/api/atlas/privacy_zones?view=stats')
        .then((r) => r.data || null),
    enabled: open && systemsTab === 'privacy',
    refetchInterval: open && systemsTab === 'privacy' ? 20_000 : false,
  });

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ x: 420, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 420, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className="fixed top-20 right-4 bottom-4 w-[28rem] z-50 flex flex-col bg-[var(--nb-sheet,rgb(var(--lattice-surface-rgb)))] border border-[color:var(--nb-rule,rgb(var(--lattice-border-rgb)))] rounded-lg shadow-2xl overflow-hidden"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-[color:var(--nb-rule,rgb(var(--lattice-border-rgb)))]">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-[color:var(--nb-red,#a855f7)]" />
              <span className="text-sm font-semibold text-[color:var(--nb-ink,#ffffff)]">Systems</span>
            </div>
            <button
              onClick={onClose}
              className="text-[color:var(--nb-muted,#9ca3af)] hover:text-[color:var(--nb-ink,#ffffff)] transition-colors"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex gap-1 px-3 py-2 border-b border-[color:var(--nb-rule,rgb(var(--lattice-border-rgb)))] overflow-x-auto">
            {(
              [
                { key: 'shield', label: 'Shield' },
                { key: 'mesh', label: 'Mesh' },
                { key: 'intel', label: 'Intel' },
                { key: 'privacy', label: 'Privacy' },
                { key: 'initiatives', label: 'Initiatives' },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                onClick={() => setSystemsTab(t.key)}
                className={cn(
                  'px-3 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap',
                  systemsTab === t.key
                    ? 'bg-[var(--nb-red-soft,rgba(168,85,247,0.2))] text-[color:var(--nb-red,#a855f7)] border border-[color:var(--nb-red,rgba(168,85,247,0.3))]'
                    : 'text-[color:var(--nb-muted,#9ca3af)] hover:text-[color:var(--nb-ink,#ffffff)] hover:bg-[var(--nb-paper,rgb(var(--lattice-bg-rgb)))]'
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {systemsTab === 'shield' && (
              <ShieldCard type="score" securityScore={shieldData as never} />
            )}
            {systemsTab === 'mesh' && (
              <MeshStatusCard type="status" metrics={meshData as never} />
            )}
            {systemsTab === 'intel' && (
              <IntelligenceCard type="overview" metrics={intelData as never} />
            )}
            {systemsTab === 'privacy' && (
              <AtlasPrivacyMonitor data={privacyData as never} loading={!privacyData} />
            )}
            {systemsTab === 'initiatives' && (
              <div className="space-y-2">
                {Array.isArray(initiativesData) && initiativesData.length > 0 ? (
                  initiativesData.slice(0, 8).map((init: Initiative) => (
                    <InitiativeChip
                      key={init.id}
                      initiative={init}
                      onDismiss={(id: string) => {
                        try {
                          api.post(`/api/initiative/${encodeURIComponent(id)}/dismiss`, {});
                        } catch {
                          /* non-fatal */
                        }
                      }}
                      onAction={(id: string, action: string) => {
                        try {
                          api.post(`/api/initiative/${encodeURIComponent(id)}/respond`, {
                            response: action || 'acted',
                          });
                        } catch {
                          /* non-fatal */
                        }
                      }}
                      onRespond={(id: string) => {
                        try {
                          api.post(`/api/initiative/${encodeURIComponent(id)}/respond`, {
                            response: 'engaged',
                          });
                        } catch {
                          /* non-fatal */
                        }
                      }}
                    />
                  ))
                ) : (
                  <p className="text-xs text-[color:var(--nb-muted,#9ca3af)] text-center py-8">
                    No proactive initiatives right now. Claude will surface them here when
                    opportunities arise.
                  </p>
                )}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
