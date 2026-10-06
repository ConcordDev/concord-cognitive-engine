'use client';

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
import { useLensCommand } from '@/hooks/useLensCommand';
import { useCallback, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { SlidersHorizontal, Keyboard, Camera, ShieldCheck, Monitor } from 'lucide-react';

type Tab = 'preferences' | 'keybindings' | 'snapshots' | 'account' | 'system';

const TABS: { id: Tab; label: string; icon: typeof SlidersHorizontal }[] = [
  { id: 'preferences', label: 'Preferences', icon: SlidersHorizontal },
  { id: 'keybindings', label: 'Keybindings', icon: Keyboard },
  { id: 'snapshots', label: 'Snapshots', icon: Camera },
  { id: 'account', label: 'Account & Security', icon: ShieldCheck },
  { id: 'system', label: 'System & Graphics', icon: Monitor },
];

export default function SettingsPage() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [tab, setTab] = useState<Tab>('preferences');
  // Bumping this key forces the PreferencesPanel to re-fetch server truth
  // after a snapshot is restored.
  const [prefVersion, setPrefVersion] = useState(0);

  const onSnapshotApplied = useCallback(() => {
    setPrefVersion((v) => v + 1);
    setTab('preferences');
  }, []);

  // ⌘K jumps focus to the Preferences tab (search-within-settings lives there).
  useLensCommand(
    [
      {
        id: 'search', keys: 'mod+k', description: 'Search within settings', category: 'navigation',
        action: () => setTab('preferences'), global: true,
      },
      {
        id: 'snapshots', keys: 'mod+s', description: 'Open snapshots', category: 'actions',
        action: () => setTab('snapshots'), global: true,
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
        title={`Make it yours${who ? `, ${who}` : ''}`}
        subtitle="Preferences, keybindings, snapshots, security and graphics. Everything syncs to your account."
        tabs={TABS.map((t) => ({ id: t.id, label: t.label, icon: t.icon }))}
        activeTab={tab}
        onTab={(id) => setTab(id as Tab)}
        tabsLabel="Settings sections"
        cta={{ label: 'Snapshots', icon: Camera, onClick: () => setTab('snapshots'), title: 'Open snapshots (⌘S)' }}
      >
        <div className="max-w-3xl">
          {tab === 'preferences' && (
            <section aria-label="Preferences">
              <p className="text-[11px] text-gray-400 mb-4">
                Preferences are persisted on the server and sync across every device you sign in on.
              </p>
              <PreferencesPanel key={prefVersion} />
            </section>
          )}

          {tab === 'keybindings' && (
            <section aria-label="Keybindings">
              <p className="text-[11px] text-gray-400 mb-4">
                Click a binding, then press the key chord you want. Press Escape to cancel.
              </p>
              <KeybindingPanel />
            </section>
          )}

          {tab === 'snapshots' && (
            <section aria-label="Snapshots">
              <p className="text-[11px] text-gray-400 mb-4">
                Capture the current preference set so you can roll back to a known-good config.
              </p>
              <SnapshotManager onApplied={onSnapshotApplied} />
            </section>
          )}

          {tab === 'account' && (
            <section aria-label="Account and security">
              <AccountSecurityPanel />
            </section>
          )}

          {tab === 'system' && (
            <section aria-label="System and graphics" className="space-y-4">
              <QualityPresetSelector />
              <MouseSensitivitySlider />
              <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
                <SettingsHealth />
        </div>
      </section>
    )}
        </div>
      </NorthStarFrame>
    </LensShell>
  );
}
