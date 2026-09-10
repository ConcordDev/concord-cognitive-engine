'use client';

import { DTUDetailView } from '@/components/dtu/DTUDetailView';

export function BridgeDtuModal({ dtuId, onClose, onNavigate }: {
  dtuId: string | null;
  onClose: () => void;
  onNavigate: (id: string) => void;
}) {
  if (!dtuId) return null;
  return <DTUDetailView dtuId={dtuId} onClose={onClose} onNavigate={onNavigate} />;
}
