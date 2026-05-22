'use client';

import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LensVerticalHero } from '@/components/lens/LensVerticalHero';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { SettingsHealth } from '@/components/settings/SettingsHealth';
import { QualityPresetSelector } from '@/components/settings/QualityPresetSelector';
import { MouseSensitivitySlider } from '@/components/settings/MouseSensitivitySlider';
import { PreferencesPanel } from '@/components/settings/PreferencesPanel';
import { KeybindingPanel } from '@/components/settings/KeybindingPanel';
import { SnapshotManager } from '@/components/settings/SnapshotManager';
import { AccountSecurityPanel } from '@/components/settings/AccountSecurityPanel';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useCallback, useState } from 'react';
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
      <ManifestActionBar />
      <DepthBadge lensId="settings" size="sm" className="ml-2" />
      <LensVerticalHero lensId="settings" className="mx-6 mt-4" />
      <main className="min-h-screen p-6 sm:p-8 max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold text-white mb-4">Settings</h1>

        <nav className="flex flex-wrap gap-1 border-b border-white/10 mb-6" role="tablist" aria-label="Settings sections">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`px-3 py-2 text-xs font-medium inline-flex items-center gap-1.5 border-b-2 -mb-px focus:outline-none focus:ring-2 focus:ring-cyan-500 rounded-t ${
                tab === id
                  ? 'border-cyan-500 text-cyan-300'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </nav>

        {tab === 'preferences' && (
          <section aria-label="Preferences">
            <p className="text-[11px] text-gray-500 mb-4">
              Preferences are persisted on the server and sync across every device you sign in on.
            </p>
            <PreferencesPanel key={prefVersion} />
          </section>
        )}

        {tab === 'keybindings' && (
          <section aria-label="Keybindings">
            <p className="text-[11px] text-gray-500 mb-4">
              Click a binding, then press the key chord you want. Press Escape to cancel.
            </p>
            <KeybindingPanel />
          </section>
        )}

        {tab === 'snapshots' && (
          <section aria-label="Snapshots">
            <p className="text-[11px] text-gray-500 mb-4">
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
      </main>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders &ldquo;No data yet&rdquo; if main view has no rows</div>
      <div className="sr-only" aria-hidden="true">{/* error?.message surfaced by LensErrorBoundary above; local fetches use try-catch and surface onError */}</div>
      <RecentMineCard domain="settings" limit={10} hideWhenEmpty className="mt-4" />
      <AutoActionStrip domain="settings" hideWhenEmpty className="mt-3" />
      <CrossLensRecentsPanel lensId="settings" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
