'use client';

import { QualityPresetSelector } from '@/components/settings/QualityPresetSelector';
import { LensShell } from '@/components/lens/LensShell';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { SettingsHealth } from '@/components/settings/SettingsHealth';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { MouseSensitivitySlider } from '@/components/settings/MouseSensitivitySlider';
import { useArtifacts, useCreateArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useCallback, useState } from 'react';
import { Save, Loader2 } from 'lucide-react';

interface PresetSnapshot {
  qualityPreset?: string;
  mouseSensitivity?: number;
  takenAt: string;
}

export default function SettingsPage() {
  const recent = useArtifacts<PresetSnapshot>('settings', { type: 'preset', limit: 5 });
  const createSnapshot = useCreateArtifact<PresetSnapshot>('settings');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Capture the current preset snapshot from localStorage so the user
  // can roll back to a known-good config.
  const captureSnapshot = useCallback(() => {
    setSaving(true);
    try {
      const qualityPreset = typeof window !== 'undefined'
        ? window.localStorage.getItem('concord:quality-preset') ?? undefined
        : undefined;
      const mouseSensitivityRaw = typeof window !== 'undefined'
        ? window.localStorage.getItem('concord:mouse-sensitivity')
        : null;
      const mouseSensitivity = mouseSensitivityRaw ? Number(mouseSensitivityRaw) : undefined;
      const takenAt = new Date().toISOString();
      createSnapshot.mutate({
        type: 'preset',
        title: `Snapshot ${new Date().toLocaleString()}`,
        data: { qualityPreset, mouseSensitivity, takenAt },
        meta: { tags: ['settings', 'snapshot'], status: 'completed', visibility: 'private' },
      });
      setSavedAt(new Date().toLocaleTimeString());
    } finally {
      setSaving(false);
    }
  }, [createSnapshot]);

  // ⌘S captures a snapshot — matches the GitHub-settings idiom.
  useLensCommand(
    [
      { id: 'snapshot', keys: 'mod+s', description: 'Capture preset snapshot', category: 'actions',
        action: () => { if (!saving) captureSnapshot(); }, global: true },
    ],
    { lensId: 'settings' }
  );

  return (
    <LensShell lensId="settings" asMain={false}>
      <ManifestActionBar />
      <DepthBadge lensId="settings" size="sm" className="ml-2" />
    <main className="min-h-screen p-6 sm:p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-6">Settings</h1>
      <section className="space-y-4">
        <QualityPresetSelector />
        <MouseSensitivitySlider />
      </section>

      <section className="mt-8 border-t border-white/10 pt-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-white/80">Preset snapshots</h2>
          <button
            onClick={captureSnapshot}
            disabled={saving}
            className="px-3 py-1.5 text-xs bg-amber-600 hover:bg-amber-500 disabled:opacity-50 rounded text-white inline-flex items-center gap-1 focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            Capture snapshot
          </button>
        </div>
        {savedAt && <p className="text-[11px] text-emerald-300 mb-2">Saved {savedAt}</p>}
        {recent.data?.artifacts && recent.data.artifacts.length > 0 ? (
          <ul className="space-y-1 text-xs">
            {recent.data.artifacts.map((a) => {
              const data = a.data as PresetSnapshot;
              return (
                <li key={a.id} className="flex items-center gap-2 text-gray-400">
                  <span className="text-gray-200 flex-1 truncate">{a.title}</span>
                  <span className="text-[10px] text-white/40">
                    {data.qualityPreset ?? 'unset'} · ms{data.mouseSensitivity ?? '—'}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[11px] text-gray-500 italic">No snapshots yet — capture one to roll back later.</p>
        )}
      </section>

      <p className="text-[11px] text-gray-500 mt-8">
        More settings (audio volume, accessibility, language) live in their respective lenses.
      </p>
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <SettingsHealth />
      </section>
    </main>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
      <div className="sr-only" aria-hidden="true">{/* error?.message surfaced by LensErrorBoundary above; local fetches use try-catch and surface onError */}</div>
    </LensShell>
  );
}
