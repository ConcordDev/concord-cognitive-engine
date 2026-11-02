'use client';

/** /settings/memory — what Concord remembers about you. See components/settings/MemoryPanel.tsx. */

import { Brain } from 'lucide-react';
import MemoryPanel from '@/components/settings/MemoryPanel';
import { SettingsNav } from '../SettingsNav';
import { UtilityPageShell } from '@/components/shell/UtilityPageShell';

export default function MemorySettingsPage() {
  return (
    <UtilityPageShell
      icon={Brain}
      title="Memory"
      subtitle="What I remember about you · Edit · Forget · Export"
      showBackButton
      belowHeader={<SettingsNav active="memory" />}
    >
      <MemoryPanel />
    </UtilityPageShell>
  );
}
