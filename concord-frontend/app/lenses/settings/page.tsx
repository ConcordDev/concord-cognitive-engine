'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { SettingsHealth } from '@/components/settings/SettingsHealth';
import { QualityPresetSelector } from '@/components/settings/QualityPresetSelector';
import { MouseSensitivitySlider } from '@/components/settings/MouseSensitivitySlider';
import { PreferencesPanel } from '@/components/settings/PreferencesPanel';
import { KeybindingPanel } from '@/components/settings/KeybindingPanel';
import { SnapshotManager } from '@/components/settings/SnapshotManager';
import { AccountSecurityPanel } from '@/components/settings/AccountSecurityPanel';
import { PresenceStatusControl } from '@/components/settings/PresenceStatusControl';
import { WorldVisibilityControl } from '@/components/settings/WorldVisibilityControl';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useAuth } from '@/hooks/useAuth';
import { lensRun } from '@/lib/api/client';
import { loadPreferenceExport } from '@/lib/settings/export-preferences';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { ShieldCheck, Monitor } from 'lucide-react';

type Tab = 'account' | 'world';

const TABS: { id: Tab; label: string; icon: typeof ShieldCheck }[] = [
  { id: 'account', label: 'Account & Security', icon: ShieldCheck },
  { id: 'world', label: 'World & graphics', icon: Monitor },
];

export default function SettingsPage() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [tab, setTab] = useState<Tab>('account');
  const [prefVersion, setPrefVersion] = useState(0);
  const [exportNote, setExportNote] = useState<string | null>(null);

  const onSnapshotApplied = useCallback(() => {
    setPrefVersion((v) => v + 1);
    setTab('world');
  }, []);

  const onExport = useCallback(async () => {
    setExportNote(null);
    const packed = await loadPreferenceExport(lensRun);
    if (!packed.ok) {
      setExportNote(packed.reason);
      return;
    }
    const blob = new Blob([packed.body], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = packed.filename;
    a.click();
    URL.revokeObjectURL(url);
    setExportNote('Exported the saved preference set.');
  }, []);

  useLensCommand(
    [
      {
        id: 'search', keys: 'mod+k', description: 'Search within settings', category: 'navigation',
        action: () => setTab('world'), global: true,
      },
      {
        id: 'snapshots', keys: 'mod+s', description: 'Open snapshots', category: 'actions',
        action: () => setTab('world'), global: true,
      },
    ],
    { lensId: 'settings' },
  );

  return (
    <LensShell lensId="settings" asMain={false}>
      <FirstRunTour lensId="settings" />
      <DepthBadge lensId="settings" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="settings"
        crumb="Settings"
        title={`Your settings${who ? `, ${who}` : ''}`}
        subtitle="Account and security first. World graphics, bindings, and snapshots sit one tab over."
        tabs={TABS.map((t) => ({ id: t.id, label: t.label, icon: t.icon }))}
        activeTab={tab}
        onTab={(id) => setTab(id as Tab)}
        tabsLabel="Settings sections"
        cta={{ label: 'Review', onClick: () => setTab('account'), title: 'Review account and security' }}
      >
        <div className="max-w-3xl">
          {tab === 'account' && (
            <section aria-label="Account and security" className="space-y-6">
              <AccountSecurityPanel />
              <PresenceStatusControl />
              <p className="text-sm text-zinc-400">
                Data controls — download, sharing, and deletion — live in{' '}
                <Link href="/lenses/privacy" className="text-teal-300 underline-offset-2 hover:underline">
                  Privacy
                </Link>
                .
              </p>
            </section>
          )}

          {tab === 'world' && (
            <section aria-label="World and graphics" className="space-y-6">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] text-zinc-400">
                  These values are the ones saved on your account.
                </p>
                <button
                  type="button"
                  onClick={() => { void onExport(); }}
                  className="text-xs text-teal-300 underline-offset-2 hover:underline"
                >
                  Export saved preferences
                </button>
              </div>
              {exportNote && (
                <p role="status" className="text-xs text-zinc-300">{exportNote}</p>
              )}
              <PreferencesPanel key={prefVersion} />
              <QualityPresetSelector />
              <MouseSensitivitySlider />
              <KeybindingPanel />
              <SnapshotManager onApplied={onSnapshotApplied} />
              <WorldVisibilityControl />
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
                <SettingsHealth />
              </div>
            </section>
          )}
        </div>
      </NorthStarFrame>
    </LensShell>
  );
}
