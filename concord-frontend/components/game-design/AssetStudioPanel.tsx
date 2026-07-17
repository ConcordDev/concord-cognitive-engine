'use client';

/**
 * AssetStudioPanel — Increment 1 "Asset Studio" tab. Authors a parametric
 * building (archetype + dimensions + iconic feature + optional interior),
 * previews it live with the exact geometry the world will render
 * (BuildingPreview), then publishes it through the real cross-engine path:
 * `game-design.building-publish` mints a creator-attributed blueprint DTU
 * AND spawns a live `world_buildings` row in Concordia — not a mock, not a
 * local-only draft.
 *
 * Scope (locked, see docs Asset Studio build contract):
 *  - Vocabulary is archetype + width/height/depth (meters) + feature +
 *    withInterior — the exact vocabulary BuildingRenderer3D already reads.
 *  - No color/factionStyle picker — deferred to a fast-follow increment so
 *    the preview never shows a color the live world can't render yet.
 *  - Published assets are royalty-ELIGIBLE (a real citation lineage fires
 *    on remix), but there is no priced marketplace listing yet — the UI
 *    must not imply the asset earns money on sale.
 *
 * Every failure path (validation, overlap, publish error) renders the real
 * reason from the backend — never a silently-swallowed or fabricated retry.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Boxes, Home, BookOpen, Flame, ShoppingBag, Landmark, Loader2,
  CheckCircle2, AlertTriangle, Info, GitBranch, MapPin,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import type { BuildingArchetype, IconicFeature } from '@/lib/world-lens/procedural-buildings';
import { BuildingPreview } from './BuildingPreview';

const ARCHETYPES: { id: BuildingArchetype; label: string; icon: LucideIcon; blurb: string }[] = [
  { id: 'tavern', label: 'Tavern', icon: Home, blurb: 'Warm wood + thatch, hearth glow' },
  { id: 'archive', label: 'Archive', icon: BookOpen, blurb: 'Stone colonnade, tall narrow windows' },
  { id: 'forge', label: 'Forge', icon: Flame, blurb: 'Smokestack + glowing forge mouth' },
  { id: 'market', label: 'Market', icon: ShoppingBag, blurb: 'Open canopy on posts, stalls' },
  { id: 'tower', label: 'Tower', icon: Landmark, blurb: 'Tall shaft, crenellated parapet' },
];

const FEATURES: { id: IconicFeature | 'none'; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'dome', label: 'Dome' },
  { id: 'spire', label: 'Spire' },
  { id: 'colonnade', label: 'Colonnade' },
  { id: 'belfry', label: 'Belfry' },
];

interface MyBuilding {
  dtuId: string;
  buildingId: string | null;
  name: string;
  archetype: string;
  feature: string | null;
  worldId: string;
  createdAt?: string | null;
}

interface PublishResult {
  dtuId?: string;
  buildingId?: string;
  spawned?: boolean;
}

interface FormState {
  name: string;
  archetype: BuildingArchetype | '';
  feature: IconicFeature | 'none';
  width: string;
  height: string;
  depth: string;
  withInterior: boolean;
  worldId: string;
  posX: string;
  posY: string;
  posZ: string;
  rotationY: string;
  remixOfDtuId: string;
}

const DEFAULT_FORM: FormState = {
  name: '',
  archetype: '',
  feature: 'none',
  width: '8',
  height: '6',
  depth: '8',
  withInterior: false,
  worldId: 'concordia-hub',
  posX: '0',
  posY: '0',
  posZ: '0',
  rotationY: '0',
  remixOfDtuId: '',
};

const inputCls = 'bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100';

export function AssetStudioPanel({ onChange }: { gameId: string; onChange: () => void }) {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishSuccess, setPublishSuccess] = useState<PublishResult | null>(null);

  const [mine, setMine] = useState<MyBuilding[]>([]);
  const [mineLoading, setMineLoading] = useState(true);
  const [mineError, setMineError] = useState<string | null>(null);

  const refreshMine = useCallback(async () => {
    setMineLoading(true);
    const r = await lensRun('game-design', 'building-list-mine', {});
    if (r.data?.ok === false) {
      setMineError(r.data?.error || 'Failed to load your authored buildings.');
      setMineLoading(false);
      return;
    }
    const list = (r.data?.result as { buildings?: MyBuilding[] } | null)?.buildings || [];
    setMine(list);
    setMineError(null);
    setMineLoading(false);
  }, []);

  useEffect(() => { void refreshMine(); }, [refreshMine]);

  const widthNum = Number(form.width) || 0;
  const heightNum = Number(form.height) || 0;
  const depthNum = Number(form.depth) || 0;
  const dimsValid = widthNum > 0 && heightNum > 0 && depthNum > 0;
  const canPublish = !!form.archetype && form.name.trim().length > 0 && dimsValid;

  const publish = async () => {
    setPublishSuccess(null);
    if (!form.archetype) { setValidationError('Pick an archetype first.'); return; }
    if (!form.name.trim()) { setValidationError('Name your building.'); return; }
    if (!dimsValid) { setValidationError('Width, height, and depth must all be positive numbers (meters).'); return; }
    setValidationError(null);
    setPublishError(null);
    setPublishing(true);

    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      archetype: form.archetype,
      feature: form.feature === 'none' ? null : form.feature,
      withInterior: form.withInterior,
      dimensions: { width: widthNum, height: heightNum, depth: depthNum },
      worldId: form.worldId.trim() || 'concordia-hub',
      position: {
        x: Number(form.posX) || 0,
        y: Number(form.posY) || 0,
        z: Number(form.posZ) || 0,
      },
      rotationY: Number(form.rotationY) || 0,
    };
    if (form.remixOfDtuId.trim()) payload.remixOfDtuId = form.remixOfDtuId.trim();

    const r = await lensRun('game-design', 'building-publish', payload);
    setPublishing(false);
    if (r.data?.ok === false) {
      setPublishError(r.data?.error || 'Publish failed.');
      return;
    }
    const result = (r.data?.result as PublishResult | null) || null;
    setPublishSuccess(result);
    await refreshMine();
    onChange();
  };

  const selectedArchetype = ARCHETYPES.find((a) => a.id === form.archetype) || null;

  return (
    <div className="space-y-4">
      <header className="flex items-start gap-2.5">
        <div className="w-8 h-8 shrink-0 rounded-lg bg-lime-600/15 border border-lime-600/30 flex items-center justify-center">
          <Boxes className="w-4 h-4 text-lime-400" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">Asset Studio — parametric buildings</h3>
          <p className="text-[11px] text-zinc-400">
            Author a building, preview it exactly as it will render in Concordia, then publish it as a
            real creator-attributed structure.
          </p>
        </div>
      </header>

      <div className="flex items-start gap-2 text-[11px] text-sky-300/90 bg-sky-950/30 border border-sky-900/40 rounded-lg px-3 py-2">
        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <p>
          Published assets are creator-attributed and royalty-eligible — remixing another authored
          building registers a real citation lineage. Paid marketplace listing comes in a later increment;
          publishing here does not yet earn money.
        </p>
      </div>

      {validationError && (
        <div role="alert" className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">
          {validationError}
        </div>
      )}
      {publishError && (
        <div role="alert" className="flex items-start gap-2 text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>Publish failed: {publishError}</span>
        </div>
      )}
      {publishSuccess && (
        <div className="flex items-start gap-2 text-xs text-emerald-300 bg-emerald-950/30 border border-emerald-900/40 rounded-lg px-3 py-2">
          <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <div>
            <p>Published and spawned in Concordia.</p>
            <p className="text-[10px] text-emerald-400/80 font-mono mt-0.5">
              dtuId: {publishSuccess.dtuId || '—'} · buildingId: {publishSuccess.buildingId || '—'}
            </p>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-[1fr_1.1fr] gap-3">
        {/* Live preview */}
        <div className="space-y-1.5">
          <BuildingPreview
            archetype={form.archetype || null}
            feature={form.feature === 'none' ? null : form.feature}
            widthM={widthNum}
            heightM={heightNum}
            depthM={depthNum}
          />
          {selectedArchetype && (
            <p className="text-[10px] text-zinc-500 px-1">{selectedArchetype.blurb}</p>
          )}
        </div>

        {/* Form */}
        <div className="space-y-3">
          <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
            <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">Archetype</p>
            <div className="grid grid-cols-5 gap-1.5">
              {ARCHETYPES.map((a) => {
                const Icon = a.icon;
                const active = form.archetype === a.id;
                return (
                  <button
                    key={a.id}
                    type="button"
                    aria-pressed={active}
                    aria-label={`Archetype ${a.label}`}
                    title={a.blurb}
                    onClick={() => setForm((f) => ({ ...f, archetype: a.id }))}
                    className={cn(
                      'flex flex-col items-center gap-1 py-2 rounded-lg border text-[10px] font-medium transition-colors',
                      active
                        ? 'bg-lime-600/20 border-lime-500 text-lime-300'
                        : 'bg-zinc-950 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600',
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    {a.label}
                  </button>
                );
              })}
            </div>

            <label className="block">
              <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">Name</span>
              <input
                aria-label="Building name"
                placeholder="e.g. Riverside Inn"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className={cn(inputCls, 'w-full mt-1')}
              />
            </label>

            <div className="grid grid-cols-3 gap-1.5">
              <label className="block">
                <span className="text-[10px] text-zinc-400">Width (m)</span>
                <input
                  aria-label="Width (meters)"
                  inputMode="decimal"
                  value={form.width}
                  onChange={(e) => setForm((f) => ({ ...f, width: e.target.value }))}
                  className={cn(inputCls, 'w-full mt-0.5')}
                />
              </label>
              <label className="block">
                <span className="text-[10px] text-zinc-400">Height (m)</span>
                <input
                  aria-label="Height (meters)"
                  inputMode="decimal"
                  value={form.height}
                  onChange={(e) => setForm((f) => ({ ...f, height: e.target.value }))}
                  className={cn(inputCls, 'w-full mt-0.5')}
                />
              </label>
              <label className="block">
                <span className="text-[10px] text-zinc-400">Depth (m)</span>
                <input
                  aria-label="Depth (meters)"
                  inputMode="decimal"
                  value={form.depth}
                  onChange={(e) => setForm((f) => ({ ...f, depth: e.target.value }))}
                  className={cn(inputCls, 'w-full mt-0.5')}
                />
              </label>
            </div>

            <div className="flex items-center gap-3">
              <label className="flex-1 block">
                <span className="text-[10px] text-zinc-400">Iconic feature</span>
                <select
                  aria-label="Iconic feature"
                  value={form.feature}
                  onChange={(e) => setForm((f) => ({ ...f, feature: e.target.value as IconicFeature | 'none' }))}
                  className={cn(inputCls, 'w-full mt-0.5')}
                >
                  {FEATURES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-zinc-300 pt-4">
                <input
                  type="checkbox"
                  aria-label="Include interior decor"
                  checked={form.withInterior}
                  onChange={(e) => setForm((f) => ({ ...f, withInterior: e.target.checked }))}
                  className="rounded border-zinc-700 bg-zinc-950"
                />
                Interior decor
              </label>
            </div>
          </section>

          <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">
              <MapPin className="w-3 h-3" /> Placement in Concordia
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              <label className="block">
                <span className="text-[10px] text-zinc-400">World</span>
                <input
                  aria-label="World id"
                  value={form.worldId}
                  onChange={(e) => setForm((f) => ({ ...f, worldId: e.target.value }))}
                  className={cn(inputCls, 'w-full mt-0.5')}
                />
              </label>
              <label className="block">
                <span className="text-[10px] text-zinc-400">Rotation Y (deg)</span>
                <input
                  aria-label="Rotation Y"
                  inputMode="decimal"
                  value={form.rotationY}
                  onChange={(e) => setForm((f) => ({ ...f, rotationY: e.target.value }))}
                  className={cn(inputCls, 'w-full mt-0.5')}
                />
              </label>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <label className="block">
                <span className="text-[10px] text-zinc-400">X</span>
                <input aria-label="Position X" inputMode="decimal" value={form.posX}
                  onChange={(e) => setForm((f) => ({ ...f, posX: e.target.value }))}
                  className={cn(inputCls, 'w-full mt-0.5')} />
              </label>
              <label className="block">
                <span className="text-[10px] text-zinc-400">Y</span>
                <input aria-label="Position Y" inputMode="decimal" value={form.posY}
                  onChange={(e) => setForm((f) => ({ ...f, posY: e.target.value }))}
                  className={cn(inputCls, 'w-full mt-0.5')} />
              </label>
              <label className="block">
                <span className="text-[10px] text-zinc-400">Z</span>
                <input aria-label="Position Z" inputMode="decimal" value={form.posZ}
                  onChange={(e) => setForm((f) => ({ ...f, posZ: e.target.value }))}
                  className={cn(inputCls, 'w-full mt-0.5')} />
              </label>
            </div>
            <label className="block">
              <span className="text-[10px] text-zinc-400 flex items-center gap-1"><GitBranch className="w-3 h-3" /> Remix of (DTU id, optional)</span>
              <input
                aria-label="Remix of DTU id"
                placeholder="Leave blank for an original design"
                value={form.remixOfDtuId}
                onChange={(e) => setForm((f) => ({ ...f, remixOfDtuId: e.target.value }))}
                className={cn(inputCls, 'w-full mt-0.5')}
              />
            </label>
          </section>

          <button
            type="button"
            onClick={publish}
            disabled={publishing || !canPublish}
            className="flex items-center justify-center gap-1.5 w-full px-3 py-2 text-xs font-semibold bg-lime-600 hover:bg-lime-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg"
          >
            {publishing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Boxes className="w-3.5 h-3.5" />}
            {publishing ? 'Publishing…' : 'Publish to Concordia'}
          </button>
        </div>
      </div>

      {/* My authored buildings */}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
            <Boxes className="w-3.5 h-3.5 text-lime-400" /> My authored buildings
          </h4>
          {mineLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-500" />}
        </div>
        {mineError && <p className="text-[11px] text-rose-400">{mineError}</p>}
        {!mineLoading && !mineError && mine.length === 0 && (
          <p className="text-[11px] text-zinc-400 italic py-3 text-center">No buildings published yet — author one above.</p>
        )}
        {mine.length > 0 && (
          <ul className="space-y-1.5">
            {mine.map((b) => (
              <li key={b.dtuId} className="flex items-center gap-2 bg-zinc-950/60 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-[11px]">
                <span className="font-semibold text-zinc-200">{b.name || b.dtuId}</span>
                <span className="text-zinc-500 capitalize">
                  {b.archetype}{b.feature ? ` · ${b.feature}` : ''}
                </span>
                <div className="flex-1" />
                <span className="text-zinc-500 font-mono">{b.worldId}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default AssetStudioPanel;
