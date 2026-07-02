'use client';

/**
 * /lenses/world/save — save status + manual sync trigger.
 *
 * Backend persistence runs on the autosave heartbeat (governorTick).
 * This page is the user-visible save status surface — what subsystems
 * have been saved, when the last cloud sync ran, what offline
 * calculations completed during away-time. The manual "Save now"
 * button forces a snapshot via /api/save/manual.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Cloud, Database, Globe, Coins, Users,
  Backpack, Award, CalendarDays,
  type LucideIcon,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api/client';
import { UtilityPageShell } from '@/components/shell/UtilityPageShell';
import { LensShell } from '@/components/lens/LensShell';

// Mirror the SaveSystem prop shape locally — extracting via
// Parameters<typeof X> on a dynamic-imported component is blocked by
// next/dynamic's ComponentType wrapper. Mirror is structurally
// equivalent, type-checked at the JSX boundary.
type SubsystemStatus = 'saved' | 'saving' | 'pending' | 'error';
interface SaveState {
  autoSaving: boolean;
  lastSaveTime: string;
  subsystems: { name: string; status: SubsystemStatus; lastSaved: string }[];
}
interface OfflineCalc {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  change?: string;
}
interface WorldPersistence {
  entries: { label: string; lastUpdated: string; icon: React.ComponentType<{ className?: string }> }[];
}

const SaveSystem = dynamic(
  () => import('@/components/world-lens/SaveSystem'),
  { ssr: false },
);

// Resolve backend iconName strings to lucide ComponentTypes. Unknown
// names fall back to Database — the panel tile will still render.
const ICON_BY_NAME: Record<string, LucideIcon> = {
  Database, Globe, Coins, Users, Backpack, Award, CalendarDays,
};
function resolveIcon(name?: string): LucideIcon {
  return (name && ICON_BY_NAME[name]) || Database;
}

// Honest pre-fetch seed: every subsystem starts PENDING with no timestamp —
// the page must never claim "saved just now" before /api/save/status (a real
// endpoint — server/routes/save.js reads genuine MAX(timestamp) freshness)
// has actually reported. The prior seed fabricated status:'saved' +
// lastSaved:now, which rendered as live state before anything was known.
const PENDING_SAVE_STATE: SaveState = {
  autoSaving: false,
  lastSaveTime: '',
  subsystems: [
    { name: 'Player inventory', status: 'pending', lastSaved: '—' },
    { name: 'World buildings', status: 'pending', lastSaved: '—' },
    { name: 'Skill progression', status: 'pending', lastSaved: '—' },
    { name: 'Wallet ledger', status: 'pending', lastSaved: '—' },
  ],
};

// Same honesty rule for the persistence panel: no invented lastUpdated.
const PENDING_PERSISTENCE: WorldPersistence = {
  entries: [
    { label: 'World snapshot', lastUpdated: '—', icon: Globe },
    { label: 'NPC state', lastUpdated: '—', icon: Users },
    { label: 'Wallet', lastUpdated: '—', icon: Coins },
    { label: 'DTU substrate', lastUpdated: '—', icon: Database },
  ],
};

// Fetch failed: statuses are UNKNOWN, shown as an explicit error — never as
// a green "saved".
const ERROR_SAVE_STATE: SaveState = {
  autoSaving: false,
  lastSaveTime: '',
  subsystems: PENDING_SAVE_STATE.subsystems.map((s) => ({ ...s, status: 'error' as SubsystemStatus })),
};

export default function SaveSystemPage() {
  const [saveState, setSaveState] = useState<SaveState>(PENDING_SAVE_STATE);
  const [offlineCalcs, setOfflineCalcs] = useState<OfflineCalc[] | null>(null);
  const [worldPersistence, setWorldPersistence] = useState<WorldPersistence>(PENDING_PERSISTENCE);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/api/save/status')
      .then((r) => {
        if (cancelled) return;
        const d = r.data as {
          saveState?: SaveState;
          offlineCalcs?: OfflineCalc[];
          worldPersistence?: { entries: { label: string; lastUpdated: string; iconName?: string }[] };
        };
        if (d.saveState) setSaveState(d.saveState);
        if (d.offlineCalcs) setOfflineCalcs(d.offlineCalcs);
        if (d.worldPersistence) {
          // Backend sends iconName strings; resolve to lucide component refs here.
          setWorldPersistence({
            entries: d.worldPersistence.entries.map((e) => ({
              label: e.label,
              lastUpdated: e.lastUpdated,
              icon: resolveIcon(e.iconName),
            })),
          });
        }
      })
      .catch(() => {
        // The endpoint IS live (server/routes/save.js) — a failure here means
        // the status is genuinely unknown. Show an honest error, never a
        // fabricated green "saved".
        if (!cancelled) setSaveState(ERROR_SAVE_STATE);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleManualSave = useCallback(async () => {
    setSaveState((prev) => ({ ...prev, autoSaving: true }));
    try {
      await api.post('/api/save/manual');
      // The manual snapshot genuinely succeeded — marking subsystems saved
      // NOW is honest (unlike the old pre-fetch seed, this follows a real
      // 2xx from /api/save/manual).
      const now = new Date().toISOString();
      setSaveState((prev) => ({
        autoSaving: false,
        lastSaveTime: now,
        subsystems: prev.subsystems.map((s) => ({ ...s, status: 'saved' as SubsystemStatus, lastSaved: now })),
      }));
    } catch {
      setSaveState((prev) => ({ ...prev, autoSaving: false }));
    }
  }, []);

  return (
    <LensShell lensId="world" asMain={false}>
      <UtilityPageShell
        icon={Cloud}
        title="Save & Sync"
        subtitle="Autosave runs on the governor tick · Manual sync available"
        showBackButton
      >
        <SaveSystem
          saveState={saveState}
          offlineCalcs={offlineCalcs}
          worldPersistence={worldPersistence}
          onManualSave={handleManualSave}
        />
      </UtilityPageShell>
    </LensShell>
  );
}
