'use client';

/**
 * /settings — canonical settings surface. Mounts the absorbed
 * SettingsPanel (graphics / audio / controls / notifications / privacy /
 * language) with localStorage-backed persistence. Uses the AllSettings
 * shape from the absorbed component as the source of truth.
 *
 * Phase D follow-on: replaces the showcase mount in /lenses/ux-suite
 * with a real, persistent settings page. The ux-suite mount continues
 * to render with its mock so the gallery still demonstrates the shape.
 *
 * Persistence: localStorage key 'concord:settings' — JSON-serialised
 * AllSettings. Apply-on-save (no live mutation). The Cancel button
 * reverts in-memory state from localStorage. Navigation back is via
 * router.back() so the settings page slots naturally into any flow.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Settings as SettingsIcon, Download, Upload, RotateCcw } from 'lucide-react';
import SettingsPanel from '@/components/world-lens/SettingsPanel';
import { SettingsNav } from './SettingsNav';
import { LensActionBar, type LensAction } from '@/components/lens/LensActionBar';
import { UtilityPageShell } from '@/components/shell/UtilityPageShell';
import { DomainProbeCard } from '@/components/system/DomainProbeCard';
import { probesByGroup } from '@/lib/headless-probes';
import { emit, subscribe } from '@/lib/realtime/socket';

const STORAGE_KEY = 'concord:settings';

// AllSettings is not exported from the component, so we mirror the shape
// here as a structural type. The cast through `unknown` at the boundary
// keeps the type loose enough to round-trip through localStorage without
// dragging the full interface into this file.
type SettingsPanelSettings = Parameters<typeof SettingsPanel>[0]['settings'];

const DEFAULT_SETTINGS: SettingsPanelSettings = {
  graphics: {
    qualityPreset: 'high',
    shadows: true,
    particles: true,
    weatherEffects: true,
    buildingDetail: true,
    npcDensity: true,
  },
  audio: {
    master: 0.8,
    music: 0.6,
    ambient: 0.7,
    sfx: 0.7,
    dialogue: 0.9,
    spatialAudio: true,
  },
  controls: [
    { action: 'Move Up', key: 'W' },
    { action: 'Move Down', key: 'S' },
    { action: 'Move Left', key: 'A' },
    { action: 'Move Right', key: 'D' },
    { action: 'Interact', key: 'E' },
    { action: 'Attack', key: 'Space' },
  ],
  notifications: {
    citation: true,
    royalty: true,
    event: true,
    social: true,
    system: true,
    dailyDigest: false,
    dndStart: '22:00',
    dndEnd: '07:00',
  },
  privacy: {
    profileVisibility: 'public',
    worldVisibility: true,
    activityStatus: true,
    allowDMs: true,
  },
  language: {
    language: 'en',
    measurementUnit: 'metric',
    dateFormat: 'YYYY-MM-DD',
  },
} as unknown as SettingsPanelSettings;

function loadSettings(): SettingsPanelSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return JSON.parse(raw) as SettingsPanelSettings;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(s: SettingsPanelSettings) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    window.dispatchEvent(new CustomEvent('concord:settings-saved', { detail: s }));
  } catch {
    // localStorage quota exceeded — toast handled via the global mutation
    // cache in Providers.tsx; here we silently fail since this isn't a
    // mutation, just a setter. Future commit can add a Sentry breadcrumb.
  }
}

// BD#27 world-visibility (ghost / appear-offline) round trip. The server's
// `player:visibility` socket handler (server.js) is genuinely ephemeral
// in-memory — it resets to "visible" on reconnect, same as movementMode —
// so this Save button is the one honest place to *apply* the Privacy tab's
// "World Visible to Others" toggle to the player's live presence, not just
// stash a preference nobody reads. Best-effort: if there's no live world
// socket connection right now, the toggle still saves locally (applies
// next time the player is in a world and re-opens Settings), and we say
// so rather than pretending it took effect.
const VISIBILITY_APPLY_TIMEOUT_MS = 1500;

// V1.2 Wave A — Society & Presence: a real, user-controlled activity status,
// distinct from the ghost/appear-offline toggle above. Applied immediately
// on click (not gated behind the form's Save button) — this is meant to be
// a quick, always-available status switch, the same interaction shape
// Slack/Discord use for their own presence pickers, not a settings-form
// field you commit once and forget. Server-side state is genuinely
// ephemeral in-memory (server.js's `player:presence-status` handler resets
// to "available" on reconnect, same as visibility/movementMode), so the
// localStorage copy here is a client-side memory of the LAST CHOSEN status
// only — used to re-apply it next time a world socket connects, never
// presented as if it were itself the live, authoritative state.
const PRESENCE_STATUS_STORAGE_KEY = 'concord:presenceStatus';
const PRESENCE_STATUS_APPLY_TIMEOUT_MS = 1500;

type PresenceStatus = 'available' | 'away' | 'busy' | 'dnd';
const PRESENCE_STATUS_OPTIONS: { value: PresenceStatus; label: string; dot: string }[] = [
  { value: 'available', label: 'Available', dot: 'bg-emerald-400' },
  { value: 'away', label: 'Away', dot: 'bg-amber-400' },
  { value: 'busy', label: 'Busy', dot: 'bg-orange-500' },
  { value: 'dnd', label: 'Do Not Disturb', dot: 'bg-rose-500' },
];

function loadPresenceStatus(): PresenceStatus {
  if (typeof window === 'undefined') return 'available';
  try {
    const raw = localStorage.getItem(PRESENCE_STATUS_STORAGE_KEY);
    return (PRESENCE_STATUS_OPTIONS.some((o) => o.value === raw) ? raw : 'available') as PresenceStatus;
  } catch {
    return 'available';
  }
}

function applyLivePresenceStatus(status: PresenceStatus): Promise<{ applied: boolean; note: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: { applied: boolean; note: string }) => {
      if (settled) return;
      settled = true;
      offAck();
      offNack();
      clearTimeout(timer);
      resolve(result);
    };
    const offAck = subscribe<{ status: string }>('player:presence-status:ack', () => {
      finish({ applied: true, note: `Status set to ${status}.` });
    });
    const offNack = subscribe<{ reason: string }>('player:presence-status:nack', (data) => {
      finish({ applied: false, note: `Could not apply status live (${data?.reason || 'unknown'}). Saved for next time.` });
    });
    const timer = setTimeout(() => {
      finish({ applied: false, note: 'Not connected to a world right now — status saved for next time you play.' });
    }, PRESENCE_STATUS_APPLY_TIMEOUT_MS);
    emit('player:presence-status', { status });
  });
}

function applyLiveVisibility(hidden: boolean): Promise<{ applied: boolean; note: string }> {
  return new Promise((resolve) => {
    const mode = hidden ? 'hidden' : 'visible';
    let settled = false;
    const finish = (result: { applied: boolean; note: string }) => {
      if (settled) return;
      settled = true;
      offAck();
      offNack();
      clearTimeout(timer);
      resolve(result);
    };
    const offAck = subscribe<{ mode: string }>('player:visibility:ack', () => {
      finish({ applied: true, note: hidden ? 'You are now hidden from other players.' : 'You are now visible to other players.' });
    });
    const offNack = subscribe<{ reason: string }>('player:visibility:nack', (data) => {
      finish({ applied: false, note: `Could not apply live visibility (${data?.reason || 'unknown'}). Preference saved for next time.` });
    });
    const timer = setTimeout(() => {
      finish({ applied: false, note: 'Not connected to a world right now — preference saved for next time you play.' });
    }, VISIBILITY_APPLY_TIMEOUT_MS);
    emit('player:visibility', { mode });
  });
}

export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<SettingsPanelSettings>(DEFAULT_SETTINGS);
  const [hydrated, setHydrated] = useState(false);
  const [visibilityNote, setVisibilityNote] = useState<string | null>(null);
  const savingVisibilityRef = useRef(false);
  const [presenceStatus, setPresenceStatus] = useState<PresenceStatus>('available');
  const [presenceNote, setPresenceNote] = useState<string | null>(null);
  const applyingPresenceRef = useRef(false);

  useEffect(() => {
    setSettings(loadSettings());
    setPresenceStatus(loadPresenceStatus());
    setHydrated(true);
  }, []);

  const handlePresenceStatusChange = useCallback((next: PresenceStatus) => {
    if (applyingPresenceRef.current || next === presenceStatus) return;
    applyingPresenceRef.current = true;
    setPresenceStatus(next);
    try { localStorage.setItem(PRESENCE_STATUS_STORAGE_KEY, next); } catch { /* best-effort */ }
    setPresenceNote('Applying status…');
    applyLivePresenceStatus(next).then(({ note }) => {
      applyingPresenceRef.current = false;
      setPresenceNote(note);
    });
  }, [presenceStatus]);

  const handleSave = useCallback((next: SettingsPanelSettings) => {
    saveSettings(next);
    const prevHidden = settings?.privacy?.worldVisibility === false;
    const nextHidden = next?.privacy?.worldVisibility === false;
    setSettings(next);

    if (nextHidden !== prevHidden && !savingVisibilityRef.current) {
      savingVisibilityRef.current = true;
      setVisibilityNote('Applying visibility change…');
      applyLiveVisibility(nextHidden).then(({ note }) => {
        savingVisibilityRef.current = false;
        setVisibilityNote(note);
        // Give the user a beat to read the honest result before leaving.
        setTimeout(() => router.back(), 900);
      });
      return;
    }

    router.back();
  }, [router, settings]);

  const handleCancel = useCallback(() => {
    setSettings(loadSettings());
    router.back();
  }, [router]);

  const handleExport = useCallback(() => {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `concord-settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [settings]);

  const handleImport = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const next = JSON.parse(String(reader.result)) as SettingsPanelSettings;
          handleSave(next);
        } catch {
          // Malformed JSON — surface a toast in a follow-on; silent for now.
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [handleSave]);

  const handleReset = useCallback(() => {
    handleSave(DEFAULT_SETTINGS);
  }, [handleSave]);

  const lensActions: LensAction[] = [
    { id: 'export', label: 'Export', icon: <Download className="h-3.5 w-3.5" />, onClick: handleExport },
    { id: 'import', label: 'Import', icon: <Upload className="h-3.5 w-3.5" />, onClick: handleImport },
    { id: 'reset', label: 'Reset to defaults', icon: <RotateCcw className="h-3.5 w-3.5" />, onClick: handleReset },
  ];

  if (!hydrated) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-lattice-void via-lattice-deep to-cyan-950/10 text-slate-100">
        <div className="flex min-h-screen items-center justify-center">
          <SettingsIcon className="h-6 w-6 animate-pulse text-neon-cyan" aria-hidden="true" />
        </div>
      </main>
    );
  }

  return (
    <UtilityPageShell
      icon={SettingsIcon}
      title="Settings"
      subtitle="Graphics · Audio · Controls · Notifications · Privacy · Language"
      belowHeader={
        <>
          <SettingsNav active="general" />
          <div className="mt-2">
            <LensActionBar actions={lensActions} />
          </div>
        </>
      }
    >
      <SettingsPanel settings={settings} onSave={handleSave} onCancel={handleCancel} />
      {visibilityNote && (
        <div
          role="status"
          className="mt-3 rounded-md border border-cyan-700/40 bg-cyan-950/30 px-3 py-2 text-xs text-cyan-200"
        >
          {visibilityNote}
        </div>
      )}
      <section
        className="mt-6 rounded-lg border border-slate-700/40 bg-slate-900/30 p-4"
        aria-labelledby="presence-status-heading"
      >
        <header className="mb-3">
          <h2 id="presence-status-heading" className="text-base font-semibold text-slate-100">
            Presence Status
          </h2>
          <p className="text-xs text-slate-400">
            Shown to players near you and to your party, distinct from the
            &quot;World Visible to Others&quot; ghost toggle above — visibility
            gates whether you can be seen at all; this is what shows once you
            are.
          </p>
        </header>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Presence status">
          {PRESENCE_STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              aria-pressed={presenceStatus === opt.value}
              onClick={() => handlePresenceStatusChange(opt.value)}
              className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                presenceStatus === opt.value
                  ? 'border-cyan-500/60 bg-cyan-950/50 text-cyan-200'
                  : 'border-slate-700/50 bg-slate-900/40 text-slate-300 hover:border-slate-600'
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${opt.dot}`} aria-hidden="true" />
              {opt.label}
            </button>
          ))}
        </div>
        {presenceNote && (
          <div role="status" className="mt-3 rounded-md border border-cyan-700/40 bg-cyan-950/30 px-3 py-2 text-xs text-cyan-200">
            {presenceNote}
          </div>
        )}
      </section>
      <section
        className="mt-8 rounded-lg border border-slate-700/40 bg-slate-900/30 p-4"
        aria-labelledby="integrations-heading"
      >
        <header className="mb-3">
          <h2 id="integrations-heading" className="text-base font-semibold text-slate-100">
            Integrations
          </h2>
          <p className="text-xs text-slate-400">
            External services + companion clients. Each card probes its
            integration adapter and reports whether the bridge is reachable.
          </p>
        </header>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {probesByGroup('integration').map((p) => (
            <DomainProbeCard key={`${p.domain}.${p.macro}`} probe={p} />
          ))}
        </div>
      </section>
    </UtilityPageShell>
  );
}
