'use client';

/**
 * CreatureStudioPanel — "Creature Studio" tab. Authors a creature by real
 * params (species name → slugified speciesId, topology, coat colour,
 * optional variant), previews it live with the EXACT mesh the world's
 * CreatureSystem renders (CreaturePreview → createCreatureMesh), then
 * publishes it through the real cross-engine path:
 * `creatures.creature-publish` mints a creator-attributed
 * `creature_blueprint` DTU whose geometry comes from the real
 * generateCreature engine — not a mock, not a local-only draft.
 *
 * Scope (locked, mirrors the Asset Studio building contract):
 *  - Vocabulary is speciesId + topology + coatColor + optional variant —
 *    exactly the fields createCreatureMesh + creature-publish read.
 *  - worldId / position are deliberately omitted here, so publish is
 *    DTU-only (spawned:false) — an honest "authored, not yet placed"
 *    result rather than a fabricated in-world spawn.
 *  - Published blueprints are royalty-ELIGIBLE (a real citation lineage
 *    fires on remix/breed), but publishing itself earns no money.
 *
 * Every failure path renders the real backend `error` string — never a
 * silently-swallowed or fabricated success.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PawPrint, Loader2, CheckCircle2, AlertTriangle, Info, Palette, Sparkles,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import type { CreatureTopology } from '@/lib/world-lens/creature-mesh-builder';
import { CreaturePreview } from './CreaturePreview';

/** The 11 real topologies the mesh builder + backend recognise, with
 * human-readable labels. Kept in sync with the exported CreatureTopology
 * union in lib/world-lens/creature-mesh-builder.ts. */
const TOPOLOGIES: { id: CreatureTopology; label: string; blurb: string }[] = [
  { id: 'quadruped', label: 'Quadruped', blurb: 'Four-legged body, walking gait' },
  { id: 'winged_quadruped', label: 'Winged quadruped', blurb: 'Four legs + a wing pair' },
  { id: 'winged_biped', label: 'Winged biped', blurb: 'Upright bird-like, flapping wings' },
  { id: 'serpentine', label: 'Serpentine', blurb: 'Segmented snake-like body' },
  { id: 'eel', label: 'Eel', blurb: 'Slender aquatic serpentine' },
  { id: 'fish', label: 'Fish', blurb: 'Finned body, swaying tail' },
  { id: 'shark', label: 'Shark', blurb: 'Large finned body + dorsal fin' },
  { id: 'cephalopod', label: 'Cephalopod', blurb: 'Bulb head, undulating tentacles' },
  { id: 'polyped', label: 'Polyped', blurb: 'Low body on six splayed legs' },
  { id: 'amorphous', label: 'Amorphous', blurb: 'Formless pulsing blob' },
  { id: 'humanoid', label: 'Humanoid', blurb: 'Upright bipedal frame' },
];

/** species name → speciesId. Lowercase, non-alphanumerics collapse to a
 * single underscore, edges trimmed. Deterministic — the same name always
 * yields the same id, so the preview + publish agree. */
function slugifySpecies(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

interface MyCreature {
  dtuId: string;
  name: string;
  species_id: string | null;
  topology: string | null;
  massKg: number | null;
  variant: string | null;
  visibility: string;
  createdAt?: string | null;
  spawnCount: number;
}

interface PublishResult {
  dtuId?: string;
  creatureId?: string | null;
  spawned?: boolean;
  species_id?: string;
}

const inputCls = 'bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100';

export function CreatureStudioPanel({ onChange }: { gameId: string; onChange: () => void }) {
  const [name, setName] = useState('');
  const [topology, setTopology] = useState<CreatureTopology>('quadruped');
  const [coatColor, setCoatColor] = useState('#8b5e3c');
  const [variant, setVariant] = useState('');

  const [validationError, setValidationError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishSuccess, setPublishSuccess] = useState<PublishResult | null>(null);

  const [mine, setMine] = useState<MyCreature[]>([]);
  const [mineLoading, setMineLoading] = useState(true);
  const [mineError, setMineError] = useState<string | null>(null);

  const speciesId = useMemo(() => slugifySpecies(name), [name]);
  const canPublish = speciesId.length > 0 && !publishing;

  const refreshMine = useCallback(async () => {
    setMineLoading(true);
    const r = await lensRun('creatures', 'creature-list-mine', {});
    if (r.data?.ok === false) {
      setMineError(r.data?.error || 'Failed to load your authored creatures.');
      setMineLoading(false);
      return;
    }
    const list = (r.data?.result as { creatures?: MyCreature[] } | null)?.creatures || [];
    setMine(list);
    setMineError(null);
    setMineLoading(false);
  }, []);

  useEffect(() => { void refreshMine(); }, [refreshMine]);

  const publish = useCallback(async () => {
    setPublishSuccess(null);
    if (!name.trim()) { setValidationError('Name your species first.'); return; }
    if (!speciesId) { setValidationError('Species name must contain at least one letter or number.'); return; }
    setValidationError(null);
    setPublishError(null);
    setPublishing(true);

    const payload: Record<string, unknown> = {
      speciesId,
      name: name.trim(),
      topology,
      coatColor,
    };
    if (variant.trim()) payload.variant = variant.trim();

    const r = await lensRun('creatures', 'creature-publish', payload);
    setPublishing(false);
    if (r.data?.ok === false) {
      setPublishError(r.data?.error || 'Publish failed.');
      return;
    }
    const result = (r.data?.result as PublishResult | null) || null;
    setPublishSuccess(result);
    await refreshMine();
    onChange();
  }, [name, speciesId, topology, coatColor, variant, refreshMine, onChange]);

  // Cmd/Ctrl+Enter publishes — a discoverable keyboard shortcut (chip
  // rendered next to the Publish button) without pulling in the lens-command
  // registry the sibling AssetStudioPanel doesn't use either.
  const panelRef = useRef<HTMLDivElement | null>(null);
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canPublish) {
      e.preventDefault();
      void publish();
    }
  }, [canPublish, publish]);

  const selectedTopology = TOPOLOGIES.find((t) => t.id === topology) || null;

  return (
    <div ref={panelRef} onKeyDown={onKeyDown} className="space-y-4">
      <header className="flex items-start gap-2.5">
        <div className="w-8 h-8 shrink-0 rounded-lg bg-lime-600/15 border border-lime-600/30 flex items-center justify-center">
          <PawPrint className="w-4 h-4 text-lime-400" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">Creature Studio — parametric creatures</h3>
          <p className="text-[11px] text-zinc-400">
            Author a creature by body plan + coat, preview it exactly as Concordia will render it, then
            publish it as a real creator-attributed blueprint.
          </p>
        </div>
      </header>

      <div className="flex items-start gap-2 text-[11px] text-sky-300/90 bg-sky-950/30 border border-sky-900/40 rounded-lg px-3 py-2">
        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <p>
          Publishing mints a creator-attributed <span className="font-mono">creature_blueprint</span> DTU
          whose geometry comes from the real procedural generator. It is not placed in a world yet
          (blueprint-only) — breeding or remixing another authored creature registers a real citation
          lineage, and a later sale pays royalties to ancestors. Publishing itself does not earn money.
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
            <p>
              {publishSuccess.spawned
                ? 'Published and spawned in Concordia.'
                : 'Published as a blueprint (not placed in a world yet).'}
            </p>
            <p className="text-[10px] text-emerald-400/80 font-mono mt-0.5">
              dtuId: {publishSuccess.dtuId || '—'} · species: {publishSuccess.species_id || '—'} · spawned: {String(publishSuccess.spawned ?? false)}
            </p>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-[1fr_1.1fr] gap-3">
        {/* Live preview */}
        <div className="space-y-1.5">
          <CreaturePreview topology={topology} coatColor={coatColor} variant={variant.trim() || null} />
          {selectedTopology && (
            <p className="text-[10px] text-zinc-500 px-1">{selectedTopology.blurb}</p>
          )}
        </div>

        {/* Form */}
        <div className="space-y-3">
          <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
            <label className="block">
              <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">Species name</span>
              <input
                aria-label="Species name"
                placeholder="e.g. Ember Stalker"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={cn(inputCls, 'w-full mt-1')}
              />
              <span className="block text-[10px] text-zinc-500 mt-1">
                Species id: <span className="font-mono text-zinc-400">{speciesId || '—'}</span>
              </span>
            </label>

            <div>
              <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-1.5">Body plan (topology)</p>
              <div className="grid grid-cols-3 gap-1.5">
                {TOPOLOGIES.map((t) => {
                  const active = topology === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      aria-pressed={active}
                      aria-label={`Topology ${t.label}`}
                      title={t.blurb}
                      onClick={() => setTopology(t.id)}
                      className={cn(
                        'py-1.5 px-1 rounded-lg border text-[10px] font-medium transition-colors text-center',
                        active
                          ? 'bg-lime-600/20 border-lime-500 text-lime-300'
                          : 'bg-zinc-950 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600',
                      )}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-end gap-3">
              <label className="block">
                <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide flex items-center gap-1">
                  <Palette className="w-3 h-3" /> Coat colour
                </span>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="color"
                    aria-label="Coat colour"
                    value={coatColor}
                    onChange={(e) => setCoatColor(e.target.value)}
                    className="h-8 w-12 rounded-lg border border-zinc-700 bg-zinc-950 cursor-pointer"
                  />
                  <span className="text-[10px] font-mono text-zinc-400">{coatColor}</span>
                </div>
              </label>
              <label className="flex-1 block">
                <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> Variant (optional)
                </span>
                <input
                  aria-label="Variant label"
                  placeholder="e.g. magma, storm"
                  value={variant}
                  onChange={(e) => setVariant(e.target.value)}
                  className={cn(inputCls, 'w-full mt-1')}
                />
              </label>
            </div>
          </section>

          <button
            type="button"
            onClick={publish}
            disabled={!canPublish}
            className="flex items-center justify-center gap-1.5 w-full px-3 py-2 text-xs font-semibold bg-lime-600 hover:bg-lime-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg"
          >
            {publishing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PawPrint className="w-3.5 h-3.5" />}
            {publishing ? 'Publishing…' : 'Publish blueprint'}
            <kbd className="ml-1 px-1.5 py-0.5 text-[9px] font-mono bg-black/30 border border-white/20 rounded">⌘↵</kbd>
          </button>
        </div>
      </div>

      {/* My authored creatures */}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
            <PawPrint className="w-3.5 h-3.5 text-lime-400" /> My authored creatures
          </h4>
          {mineLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-500" />}
        </div>
        {mineError && <p className="text-[11px] text-rose-400">{mineError}</p>}
        {!mineLoading && !mineError && mine.length === 0 && (
          <p className="text-[11px] text-zinc-400 italic py-3 text-center">No creatures published yet — author one above.</p>
        )}
        {mine.length > 0 && (
          <ul className="space-y-1.5">
            {mine.map((c) => (
              <li key={c.dtuId} className="flex items-center gap-2 bg-zinc-950/60 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-[11px]">
                <span className="font-semibold text-zinc-200">{c.name || c.dtuId}</span>
                <span className="text-zinc-500 font-mono">{c.species_id || '—'}</span>
                {c.topology && <span className="text-zinc-500 capitalize">{c.topology.replace(/_/g, ' ')}</span>}
                {c.variant && <span className="text-amber-400/80">{c.variant}</span>}
                <div className="flex-1" />
                <span className="text-zinc-500">
                  {c.spawnCount > 0 ? `${c.spawnCount} live` : 'blueprint only'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default CreatureStudioPanel;
