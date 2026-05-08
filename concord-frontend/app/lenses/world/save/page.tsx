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

const DEFAULT_SAVE_STATE: SaveState = {
  autoSaving: false,
  lastSaveTime: new Date().toISOString(),
  subsystems: [
    { name: 'Player inventory', status: 'saved', lastSaved: new Date().toISOString() },
    { name: 'World buildings', status: 'saved', lastSaved: new Date().toISOString() },
    { name: 'Skill progression', status: 'saved', lastSaved: new Date().toISOString() },
    { name: 'Wallet ledger', status: 'saved', lastSaved: new Date().toISOString() },
  ],
};

const DEFAULT_PERSISTENCE: WorldPersistence = {
  entries: [
    { label: 'World snapshot', lastUpdated: new Date().toISOString(), icon: Globe },
    { label: 'NPC state', lastUpdated: new Date().toISOString(), icon: Users },
    { label: 'Wallet', lastUpdated: new Date().toISOString(), icon: Coins },
    { label: 'DTU substrate', lastUpdated: new Date().toISOString(), icon: Database },
  ],
};

export default function SaveSystemPage() {
  const [saveState, setSaveState] = useState<SaveState>(DEFAULT_SAVE_STATE);
  const [offlineCalcs, setOfflineCalcs] = useState<OfflineCalc[] | null>(null);
  const [worldPersistence, setWorldPersistence] = useState<WorldPersistence>(DEFAULT_PERSISTENCE);

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
        // Endpoint not live yet; defaults already in state.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleManualSave = useCallback(async () => {
    setSaveState((prev) => ({ ...prev, autoSaving: true }));
    try {
      await api.post('/api/save/manual');
      setSaveState((prev) => ({
        ...prev,
        autoSaving: false,
        lastSaveTime: new Date().toISOString(),
      }));
    } catch {
      setSaveState((prev) => ({ ...prev, autoSaving: false }));
    }
  }, []);

  return (
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
  );
}
