// concord-frontend/components/concordia/mounts/MountDesigner.tsx
//
// Concordia Procedural Mount System Phase B3 — UI scaffold.
//
// Three-pane layout per the plan:
//   - Left:   owned mountable companions (mounts.list_mountable)
//   - Center: 3D preview placeholder (full preview lands in B4 polish)
//   - Right:  equipped gear slots (saddle/bridle/barding) with author /
//             equip / unequip actions, plus computed stats.
//
// All read+mutate calls flow through the lens-run macro endpoint:
//   POST /api/lens/run { domain: 'mounts', name, input }
//
// This is a deliberately compact scaffold. Full visual polish (3D preview
// + animation hooks for the saddle silhouette + drag-to-equip) lands
// alongside the quadruped-gait integration in B4.

"use client";

import { useCallback, useEffect, useState, Suspense } from "react";
import dynamic from "next/dynamic";
import type { MountSpecies, MountGaitProfile } from "@/lib/concordia/mounts/mount-types";

// Three.js/R3F is heavy; lazy-load so the rest of the lens stays light.
const MountPreviewCanvas = dynamic(
  () => import("./MountPreviewCanvas").then((m) => m.default),
  { ssr: false, loading: () => <span className="text-zinc-400">Loading 3D preview…</span> },
);

type Slot = "saddle" | "bridle" | "barding";

interface CompanionRow {
  id: string;
  name: string;
  creature_id: string;
  level: number;
  world_id: string;
  mount_state?: string | null;
}

interface MountStats {
  ok: boolean;
  speciesId?: string;
  base?: { speedMps: number; baseStamina: number; carryCapacityKg: number };
  modifiers?: { speed: number; stamina: number; carry: number; comfort: number };
  effective?: { speedMps: number; baseStamina: number; carryCapacityKg: number; comfort: number };
  equipped?: Array<{ slot: Slot; dtuId: string; weight_kg: number }>;
}

interface EquippedGear {
  saddle: GearSlot | null;
  bridle: GearSlot | null;
  barding: GearSlot | null;
}

interface GearSlot {
  dtuId: string;
  slot?: Slot;
  weight_kg: number;
  stat_mods: Partial<{ speed: number; stamina: number; carry: number; comfort: number }>;
  style_tags: string[];
  missing?: boolean;
}

async function runMacro<T = unknown>(
  domain: string,
  name: string,
  input: Record<string, unknown> = {},
): Promise<T> {
  const r = await fetch("/api/lens/run", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ domain, name, input }),
  });
  if (!r.ok) throw new Error(`macro ${domain}.${name} failed: ${r.status}`);
  return r.json() as Promise<T>;
}

function fmtMul(x: number | undefined): string {
  if (x === undefined || x === 0) return "—";
  const sign = x > 0 ? "+" : "";
  return `${sign}${(x * 100).toFixed(0)}%`;
}

export function MountDesigner() {
  const [companions, setCompanions] = useState<CompanionRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stats, setStats] = useState<MountStats | null>(null);
  const [gear, setGear] = useState<EquippedGear | null>(null);
  const [species, setSpecies] = useState<MountSpecies | null>(null);
  const [gaitProfile, setGaitProfile] = useState<MountGaitProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const list = await runMacro<{ ok: boolean; companions: CompanionRow[] }>("mounts", "list_mountable");
      setCompanions(list.companions || []);
      if (!selectedId && list.companions?.length) setSelectedId(list.companions[0].id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!selectedId) return;
    void (async () => {
      try {
        const [s, g] = await Promise.all([
          runMacro<MountStats>("mounts", "compute_stats", { mountId: selectedId }),
          runMacro<{ ok: boolean; gear: EquippedGear }>("mounts", "get_equipped_gear", { mountId: selectedId }),
        ]);
        setStats(s);
        setGear(g.gear);
        // Pull species + gait for the 3D preview pane.
        if (s?.speciesId) {
          try {
            const [sp, gp] = await Promise.all([
              runMacro<{ ok: boolean; species: MountSpecies }>("mounts", "get_species", { speciesId: s.speciesId }),
              runMacro<{ ok: boolean; gait: MountGaitProfile }>("mounts", "get_gait", { speciesId: s.speciesId }),
            ]);
            if (sp?.species) setSpecies(sp.species);
            if (gp?.gait) setGaitProfile(gp.gait);
          } catch { /* preview is best-effort; render falls back to placeholder */ }
        }
      } catch (e) {
        setErr((e as Error).message);
      }
    })();
  }, [selectedId]);

  const onUnequip = useCallback(async (slot: Slot) => {
    if (!selectedId) return;
    await runMacro("mounts", "unequip_gear", { mountId: selectedId, slot });
    await refresh();
  }, [selectedId, refresh]);

  return (
    <div className="grid grid-cols-12 gap-4 p-4 text-sm">
      {/* Left pane: companions */}
      <aside className="col-span-3 border-r border-zinc-800 pr-3">
        <h2 className="text-base font-semibold mb-2">Mounts</h2>
        {loading && <p className="text-zinc-400">Loading…</p>}
        {err && <p className="text-red-400">Error: {err}</p>}
        <ul className="space-y-1">
          {companions.map(c => (
            <li key={c.id}>
              <button
                onClick={() => setSelectedId(c.id)}
                className={`w-full text-left px-2 py-1 rounded ${selectedId === c.id ? "bg-zinc-800" : "hover:bg-zinc-900"}`}
              >
                <span className="font-medium">{c.name}</span>{" "}
                <span className="text-zinc-400">lvl {c.level}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* Center pane: 3D preview */}
      <section className="col-span-5 border-r border-zinc-800 pr-3">
        <h2 className="text-base font-semibold mb-2">Preview</h2>
        <div className="aspect-video rounded bg-zinc-950 border border-zinc-800 overflow-hidden">
          {selectedId && species && gaitProfile ? (
            <Suspense fallback={<div className="grid place-items-center h-full text-zinc-400">Loading 3D…</div>}>
              <MountPreviewCanvas species={species} gait={gaitProfile} />
            </Suspense>
          ) : (
            <div className="grid place-items-center h-full text-zinc-400">
              {selectedId ? "Loading mount…" : "Select a mount"}
            </div>
          )}
        </div>

        {stats?.ok && stats.base && stats.effective && (
          <div className="mt-4 grid grid-cols-3 gap-3">
            <StatCard label="Speed" base={stats.base.speedMps} effective={stats.effective.speedMps} unit=" m/s" />
            <StatCard label="Stamina" base={stats.base.baseStamina} effective={stats.effective.baseStamina} />
            <StatCard label="Carry" base={stats.base.carryCapacityKg} effective={stats.effective.carryCapacityKg} unit=" kg" />
          </div>
        )}
      </section>

      {/* Right pane: gear */}
      <aside className="col-span-4">
        <h2 className="text-base font-semibold mb-2">Gear</h2>
        {selectedId && gear && (
          <div className="space-y-2">
            {(["saddle", "bridle", "barding"] as Slot[]).map(slot => (
              <GearRow
                key={slot}
                slot={slot}
                slotData={gear[slot]}
                onUnequip={() => onUnequip(slot)}
              />
            ))}
          </div>
        )}

        {stats?.ok && stats.modifiers && (
          <div className="mt-4 text-xs text-zinc-400 border-t border-zinc-800 pt-3 space-y-1">
            <div>Speed mod:    {fmtMul(stats.modifiers.speed)}</div>
            <div>Stamina mod:  {fmtMul(stats.modifiers.stamina)}</div>
            <div>Carry mod:    {fmtMul(stats.modifiers.carry)}</div>
            <div>Comfort:      {stats.modifiers.comfort ?? 0}</div>
          </div>
        )}

        <p className="mt-4 text-xs text-zinc-400">
          Author new gear via the Crafting lens (recipe kind <code>mount_gear</code>).
          B3 ships the validation + equip flow; the in-context author panel lands in B4 polish.
        </p>
      </aside>
    </div>
  );
}

function StatCard({ label, base, effective, unit = "" }: { label: string; base: number; effective: number; unit?: string }) {
  const delta = effective - base;
  const dPct = base > 0 ? (delta / base) * 100 : 0;
  const sign = dPct >= 0 ? "+" : "";
  return (
    <div className="rounded border border-zinc-800 p-2">
      <div className="text-xs text-zinc-400">{label}</div>
      <div className="text-lg font-medium">{effective.toFixed(2)}{unit}</div>
      <div className="text-xs text-zinc-400">base {base.toFixed(2)}{unit} ({sign}{dPct.toFixed(0)}%)</div>
    </div>
  );
}

function GearRow({ slot, slotData, onUnequip }: { slot: Slot; slotData: GearSlot | null; onUnequip: () => void }) {
  return (
    <div className="rounded border border-zinc-800 p-2">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-zinc-400">{slot}</div>
        {slotData && (
          <button onClick={onUnequip} className="text-xs text-zinc-400 hover:text-red-400">
            Unequip
          </button>
        )}
      </div>
      {slotData ? (
        <div className="mt-1">
          <div className="text-sm font-medium">{slotData.dtuId.slice(0, 14)}…</div>
          <div className="text-xs text-zinc-400">
            {slotData.weight_kg} kg
            {slotData.stat_mods?.speed != null && ` · ${fmtMul(slotData.stat_mods.speed)} speed`}
            {slotData.stat_mods?.comfort != null && ` · +${slotData.stat_mods.comfort} comfort`}
          </div>
        </div>
      ) : (
        <div className="mt-1 text-xs text-zinc-400">Empty</div>
      )}
    </div>
  );
}

export default MountDesigner;
