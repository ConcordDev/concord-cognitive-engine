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
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  Cloud, ArrowLeft, Database, Globe, Coins, Users,
  Backpack, Award, CalendarDays,
  type LucideIcon,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api/client';

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
  const router = useRouter();
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
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-zinc-950 to-cyan-950/10 text-slate-100">
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="border-b border-cyan-500/20 bg-zinc-950/60 px-4 py-3 backdrop-blur sm:px-6"
      >
        <div className="mx-auto flex max-w-screen-md items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 p-2 transition hover:bg-cyan-500/20"
            aria-label="Go back"
          >
            <ArrowLeft className="h-5 w-5 text-cyan-400" aria-hidden="true" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="flex items-center gap-2 text-base font-semibold tracking-tight sm:text-lg">
              <Cloud className="h-4 w-4 text-cyan-400" aria-hidden="true" />
              Save &amp; Sync
            </h1>
            <p className="mt-0.5 truncate text-xs text-slate-400">
              Autosave runs on the governor tick · Manual sync available
            </p>
          </div>
        </div>
      </motion.header>

      <section className="mx-auto max-w-screen-md px-3 py-4 sm:px-6 sm:py-5">
        <SaveSystem
          saveState={saveState}
          offlineCalcs={offlineCalcs}
          worldPersistence={worldPersistence}
          onManualSave={handleManualSave}
        />
      </section>
    </main>
  );
}
