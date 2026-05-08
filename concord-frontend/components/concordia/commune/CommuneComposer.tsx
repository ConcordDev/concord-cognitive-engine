'use client';

/**
 * CommuneComposer — author a commune template (the "soft spot" verb in
 * cook → eat → fight → commune now has a substrate).
 *
 * A commune template defines what gathering means in the community's
 * world: trigger, location, participant range, ritual steps, faction
 * effects. Once authored, NPC initiators + quest engine + faction
 * strategy can instantiate it.
 *
 * Posts to /api/world/commune-author. Validation is server-side via
 * server/lib/commune-templates.js#validateCommuneTemplate.
 */

import { useEffect, useState } from 'react';
import { Plus, Trash2, Send, Loader2, CheckCircle2, Users, MapPin, GripVertical } from 'lucide-react';
import { api } from '@/lib/api/client';

interface RitualStep {
  id: string;
  kind: string;
  prompt: string;
}

interface FactionEffect {
  id: string;
  factionId: string;
  delta: number;
}

interface OptionsResponse {
  ok?: boolean;
  triggers: string[];
  locationTypes: string[];
  ritualStepKinds: string[];
}

interface Props {
  onAuthored?: (templateId: string) => void;
  onClose?: () => void;
}

function uid() {
  return `step_${Math.random().toString(36).slice(2, 8)}`;
}

const STEP_KIND_HINT: Record<string, string> = {
  speak:   'Each participant says a phrase.',
  offer:   'Each contributes an item or DTU into the commune pool.',
  vote:    'Collective decision; result drives faction effects.',
  share:   'Share a memory / DTU into the commune pool (royalty cascades on cite).',
  sing:    'Synchronized cue — chant / rhythm / song.',
  vow:     'Each makes a binding promise tracked by the world.',
  bless:   'A leader confers a status effect on the gathered.',
  witness: 'Observe a world event together; everyone gains the witness tag.',
};

export default function CommuneComposer({ onAuthored, onClose }: Props) {
  const [opts, setOpts] = useState<OptionsResponse | null>(null);

  const [id, setId] = useState('commune_');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [trigger, setTrigger] = useState('ritual');
  const [locationType, setLocationType] = useState('faction-hall');
  const [participantsMin, setParticipantsMin] = useState(3);
  const [participantsMax, setParticipantsMax] = useState(12);
  const [steps, setSteps] = useState<RitualStep[]>([
    { id: uid(), kind: 'speak', prompt: 'Each speaker names what brought them here.' },
  ]);
  const [factionEffects, setFactionEffects] = useState<FactionEffect[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authored, setAuthored] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<OptionsResponse>('/api/world/commune-templates/options')
      .then((r) => {
        if (r.data?.ok !== false) setOpts(r.data);
      })
      .catch(() => {
        // Fallback to a minimal default if the endpoint is unreachable.
        setOpts({
          triggers: ['ritual', 'summon', 'spontaneous', 'scheduled', 'milestone'],
          locationTypes: ['faction-hall', 'wilderness', 'sanctuary', 'open', 'underground', 'celestial'],
          ritualStepKinds: ['speak', 'offer', 'vote', 'share', 'sing', 'vow', 'bless', 'witness'],
        });
      });
  }, []);

  function addStep() {
    setSteps((prev) => [...prev, { id: uid(), kind: 'speak', prompt: '' }]);
  }
  function removeStep(stepId: string) {
    setSteps((prev) => prev.filter((s) => s.id !== stepId));
  }
  function updateStep(stepId: string, patch: Partial<RitualStep>) {
    setSteps((prev) => prev.map((s) => (s.id === stepId ? { ...s, ...patch } : s)));
  }
  function moveStep(stepId: string, dir: -1 | 1) {
    setSteps((prev) => {
      const idx = prev.findIndex((s) => s.id === stepId);
      if (idx < 0) return prev;
      const next = idx + dir;
      if (next < 0 || next >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[next]] = [copy[next], copy[idx]];
      return copy;
    });
  }

  function addEffect() {
    setFactionEffects((prev) => [...prev, { id: uid(), factionId: '', delta: 0.05 }]);
  }
  function updateEffect(effectId: string, patch: Partial<FactionEffect>) {
    setFactionEffects((prev) => prev.map((e) => (e.id === effectId ? { ...e, ...patch } : e)));
  }
  function removeEffect(effectId: string) {
    setFactionEffects((prev) => prev.filter((e) => e.id !== effectId));
  }

  async function handleAuthor() {
    setError(null);
    if (!id.trim() || !id.startsWith('commune_')) {
      setError('Template id must start with "commune_".');
      return;
    }
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    if (participantsMin < 1 || participantsMax < participantsMin) {
      setError('Participants_max must be ≥ participants_min ≥ 1.');
      return;
    }
    if (steps.length === 0) {
      setError('Add at least one ritual step.');
      return;
    }
    for (const s of steps) {
      if (!s.prompt.trim()) {
        setError(`Step "${s.kind}" needs a prompt.`);
        return;
      }
    }
    const fxObj: Record<string, number> = {};
    for (const e of factionEffects) {
      if (!e.factionId.trim()) continue;
      if (e.delta < -1 || e.delta > 1) {
        setError(`Faction effect "${e.factionId}" must be between -1 and 1.`);
        return;
      }
      fxObj[e.factionId.trim()] = e.delta;
    }

    setSubmitting(true);
    try {
      const payload = {
        id: id.trim(),
        name: name.trim(),
        description: description.trim(),
        trigger,
        location_type: locationType,
        participants_min: participantsMin,
        participants_max: participantsMax,
        ritual_steps: steps.map((s) => ({ kind: s.kind, prompt: s.prompt.trim() })),
        ...(Object.keys(fxObj).length > 0 ? { faction_effects: fxObj } : {}),
      };
      const res = await api.post<{ ok?: boolean; reason?: string; error?: string; templateId?: string }>(
        '/api/world/commune-author',
        payload
      );
      const body = res.data;
      if (body?.ok === false) {
        setError(body.reason || body.error || 'Authoring failed.');
      } else if (body?.templateId) {
        setAuthored(body.templateId);
        onAuthored?.(body.templateId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Authoring failed.');
    } finally {
      setSubmitting(false);
    }
  }

  function authorAnother() {
    setAuthored(null);
    setId('commune_');
    setName('');
    setDescription('');
    setSteps([{ id: uid(), kind: 'speak', prompt: '' }]);
    setFactionEffects([]);
  }

  return (
    <div className="bg-black/85 border border-cyan-500/30 rounded-2xl p-5 max-w-3xl w-full text-white">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold">Author Commune Template</h2>
          <p className="text-[11px] text-white/50">
            Defines a gathering shape — trigger, place, participants, ritual, faction effect.
          </p>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white">close</button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs text-white/70 mb-1">Template id</label>
          <input
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="commune_evening_council"
            className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm font-mono"
          />
        </div>
        <div>
          <label className="block text-xs text-white/70 mb-1">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Evening Council"
            className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="mb-3">
        <label className="block text-xs text-white/70 mb-1">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="One-liner — what this gathering accomplishes."
          className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs text-white/70 mb-1">Trigger</label>
          <select
            value={trigger}
            onChange={(e) => setTrigger(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm"
          >
            {(opts?.triggers ?? []).map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-white/70 mb-1">Location type</label>
          <select
            value={locationType}
            onChange={(e) => setLocationType(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm"
          >
            {(opts?.locationTypes ?? []).map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label className="block text-xs text-white/70 mb-1 inline-flex items-center gap-1">
            <Users className="w-3 h-3" /> Min participants
          </label>
          <input
            type="number"
            min={1}
            value={participantsMin}
            onChange={(e) => setParticipantsMin(Number(e.target.value) || 1)}
            className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-white/70 mb-1 inline-flex items-center gap-1">
            <Users className="w-3 h-3" /> Max participants
          </label>
          <input
            type="number"
            min={participantsMin}
            value={participantsMax}
            onChange={(e) => setParticipantsMax(Number(e.target.value) || 1)}
            className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm"
          />
        </div>
      </div>

      {/* Ritual steps */}
      <div className="space-y-2 mb-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-cyan-300">Ritual steps</h3>
          <button
            type="button"
            onClick={addStep}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-cyan-500/15 border border-cyan-500/30 rounded hover:bg-cyan-500/25"
          >
            <Plus className="w-3 h-3" /> Add step
          </button>
        </div>
        {steps.map((step, i) => (
          <div key={step.id} className="rounded-md border border-cyan-500/20 bg-cyan-500/5 p-3">
            <div className="flex items-center gap-2 mb-2">
              <div className="flex flex-col -ml-1">
                <button
                  type="button"
                  onClick={() => moveStep(step.id, -1)}
                  disabled={i === 0}
                  className="text-white/30 hover:text-white/70 disabled:opacity-20"
                  aria-label="Move up"
                >▲</button>
                <button
                  type="button"
                  onClick={() => moveStep(step.id, 1)}
                  disabled={i === steps.length - 1}
                  className="text-white/30 hover:text-white/70 disabled:opacity-20"
                  aria-label="Move down"
                >▼</button>
              </div>
              <GripVertical className="w-3 h-3 text-white/40" />
              <span className="text-xs text-white/60 font-mono">step {i + 1}</span>
              <select
                value={step.kind}
                onChange={(e) => updateStep(step.id, { kind: e.target.value })}
                className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-xs"
              >
                {(opts?.ritualStepKinds ?? []).map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <span className="text-[10px] text-white/40 italic">
                {STEP_KIND_HINT[step.kind] || ''}
              </span>
              <button
                type="button"
                onClick={() => removeStep(step.id)}
                disabled={steps.length === 1}
                className="ml-auto text-white/40 hover:text-rose-400 disabled:opacity-20"
                aria-label="Remove step"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <input
              value={step.prompt}
              onChange={(e) => updateStep(step.id, { prompt: e.target.value })}
              placeholder="Step prompt — what each participant does."
              className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-1.5 text-sm"
            />
          </div>
        ))}
      </div>

      {/* Faction effects */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-cyan-300 inline-flex items-center gap-1">
            <MapPin className="w-3 h-3" /> Faction effects
            <span className="text-[10px] text-white/40 font-normal ml-2 italic">delta -1.0 to +1.0</span>
          </h3>
          <button
            type="button"
            onClick={addEffect}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-cyan-500/15 border border-cyan-500/30 rounded hover:bg-cyan-500/25"
          >
            <Plus className="w-3 h-3" /> Add effect
          </button>
        </div>
        {factionEffects.length === 0 ? (
          <p className="text-[11px] text-white/40 italic">
            Optional. When the commune completes, these deltas are applied to faction relations.
          </p>
        ) : (
          <div className="space-y-2">
            {factionEffects.map((eff) => (
              <div key={eff.id} className="flex items-center gap-2">
                <input
                  value={eff.factionId}
                  onChange={(e) => updateEffect(eff.id, { factionId: e.target.value })}
                  placeholder="faction_id"
                  className="flex-1 bg-white/5 border border-white/10 rounded-md px-3 py-1.5 text-sm font-mono"
                />
                <input
                  type="number"
                  min={-1}
                  max={1}
                  step={0.05}
                  value={eff.delta}
                  onChange={(e) => updateEffect(eff.id, { delta: Number(e.target.value) || 0 })}
                  className="w-24 bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-sm text-center"
                />
                <button
                  type="button"
                  onClick={() => removeEffect(eff.id)}
                  className="text-white/40 hover:text-rose-400"
                  aria-label="Remove effect"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && <div className="text-xs text-red-400 mb-3" role="alert">{error}</div>}

      {authored && (
        <div className="mb-3 rounded-md border border-emerald-400/40 bg-emerald-500/10 p-3 text-xs text-emerald-200 inline-flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>
            Template <span className="font-mono">{authored}</span> registered. NPC initiators
            and quest-engine can instantiate it now.
          </span>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-3 border-t border-white/10">
        {authored ? (
          <button
            onClick={authorAnother}
            className="px-4 py-2 bg-white/10 border border-white/20 rounded-md text-sm font-medium hover:bg-white/15"
          >
            Author another template
          </button>
        ) : (
          <button
            onClick={handleAuthor}
            disabled={submitting}
            className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-500/20 border border-cyan-500/40 rounded-md text-sm font-semibold disabled:opacity-50 hover:bg-cyan-500/30"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Publish template
          </button>
        )}
      </div>
    </div>
  );
}
