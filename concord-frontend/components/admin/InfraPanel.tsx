'use client';

import { ds } from '@/lib/design-system';
import { BackupHealth } from '@/components/admin/BackupHealth';
import { CDNStatus } from '@/components/admin/CDNStatus';
import { CodeEngineStatus } from '@/components/admin/CodeEngineStatus';
import { RepairDashboard } from '@/components/admin/RepairDashboard';

export function InfraPanel() {
  return (
    <div className="space-y-4">
      <p className={ds.textMuted}>
        Backup, CDN, code-engine, and repair — each panel owns its own live endpoint.
      </p>
      <section className={ds.panelBare}>
        <BackupHealth />
      </section>
      <section className={ds.panelBare}>
        <CDNStatus />
      </section>
      <section className={ds.panelBare}>
        <CodeEngineStatus />
      </section>
      <section className={ds.panelBare}>
        <RepairDashboard />
      </section>
    </div>
  );
}
