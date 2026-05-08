'use client';

/**
 * GoddessArcComposer — author a phase-tied dialogue arc for a deity,
 * patron, or antagonist NPC.
 *
 * Each phase declares conditions over world metrics (ecosystem_score,
 * concord_alignment, concordia_alignment, refusal_debt,
 * refusal_field_strength) and a pool of dialogue lines + optional
 * cinematic cues. The world-narrative dialogue endpoint reads the arc
 * via patron_npc_id and selects the first matching phase.
 *
 * Authoring convention surfaced in the UI: list most-specific phases
 * first (wrathful / compound-refusal overrides) so the warm/cold
 * default phases sit at the bottom and only catch when nothing else
 * matches.
 *
 * Posts to /api/world/arc-author. Fetches metric/tone/comparator
 * vocabularies from /api/world/arcs/options so the composer stays in
 * sync with the server validator.
 */

import { useEffect, useState } from 'react';
import {
  Plus, Trash2, Send, Loader2, CheckCircle2, Crown, Film, GripVertical,
} from 'lucide-react';
import { api } from '@/lib/api/client';

interface Condition {
  id: string;
  metric: string;
  comparator: string;
  value: number;
}

interface Phase {
  id: string;
  phaseId: string;
  tone: string;
  conditions: Condition[];
  dialogue: string;          // newline-separated lines
  camera: string;
  soundscape: string;
  domeEffect: string;
}

interface OptionsResponse {
  ok?: boolean;
  metrics: string[];
  tones: string[];
  comparators: string[];
}

interface Props {
  onAuthored?: (arcId: string) => void;
  onClose?: () => void;
}

function uid() {
  return Math.random().toString(36).slice(2, 8);
}

const FALLBACK_OPTS: OptionsResponse = {
  metrics: ['ecosystem_score', 'concord_alignment', 'concordia_alignment', 'refusal_debt', 'refusal_field_strength'],
  tones: ['gentle', 'warm', 'neutral', 'distant', 'cold', 'stern', 'wrathful', 'mournful', 'exalted', 'broken'],
  comparators: ['gte', 'lte', 'gt', 'lt', 'eq'],
};

const CMP_LABEL: Record<string, string> = {
  gte: '≥',
  lte: '≤',
  gt: '>',
  lt: '<',
  eq: '=',
};

function blankPhase(phaseId = 'warm', tone = 'warm'): Phase {
  return {
    id: uid(),
    phaseId,
    tone,
    conditions: [],
    dialogue: '',
    camera: '',
    soundscape: '',
    domeEffect: '',
  };
}

export default function GoddessArcComposer({ onAuthored, onClose }: Props) {
  const [opts, setOpts] = useState<OptionsResponse>(FALLBACK_OPTS);

  const [id, setId] = useState('arc_');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [patronNpcId, setPatronNpcId] = useState('');
  const [publishToFederation, setPublishToFederation] = useState(false);

  const [phases, setPhases] = useState<Phase[]>([
    {
      ...blankPhase('wrathful', 'wrathful'),
      conditions: [{ id: uid(), metric: 'refusal_field_strength', comparator: 'gte', value: 6 }],
      dialogue: 'The dome buckles under your refusals.\nYou bend reality and yet you ask me to speak softly?',
    },
    {
      ...blankPhase('cold', 'cold'),
      conditions: [{ id: uid(), metric: 'ecosystem_score', comparator: 'lt', value: 0 }],
      dialogue: 'You bring rot.\nWalk softer in this place.',
    },
    {
      ...blankPhase('warm', 'warm'),
      conditions: [{ id: uid(), metric: 'ecosystem_score', comparator: 'gte', value: 0 }],
      dialogue: 'You return.\nWhat do you carry?',
    },
  ]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authored, setAuthored] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<OptionsResponse>('/api/world/arcs/options')
      .then((r) => {
        if (r.data?.ok !== false) setOpts(r.data);
      })
      .catch(() => { /* keep FALLBACK_OPTS */ });
  }, []);

  function addPhase() {
    setPhases((prev) => [...prev, blankPhase(`phase_${prev.length + 1}`, 'neutral')]);
  }
  function removePhase(phaseId: string) {
    setPhases((prev) => prev.filter((p) => p.id !== phaseId));
  }
  function updatePhase(phaseId: string, patch: Partial<Phase>) {
    setPhases((prev) => prev.map((p) => (p.id === phaseId ? { ...p, ...patch } : p)));
  }
  function movePhase(phaseId: string, dir: -1 | 1) {
    setPhases((prev) => {
      const idx = prev.findIndex((p) => p.id === phaseId);
      if (idx < 0) return prev;
      const next = idx + dir;
      if (next < 0 || next >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[next]] = [copy[next], copy[idx]];
      return copy;
    });
  }

  function addCondition(phaseId: string) {
    updatePhase(phaseId, {
      conditions: [
        ...(phases.find((p) => p.id === phaseId)?.conditions ?? []),
        { id: uid(), metric: opts.metrics[0], comparator: 'gte', value: 0 },
      ],
    });
  }
  function updateCondition(phaseId: string, condId: string, patch: Partial<Condition>) {
    const phase = phases.find((p) => p.id === phaseId);
    if (!phase) return;
    updatePhase(phaseId, {
      conditions: phase.conditions.map((c) => (c.id === condId ? { ...c, ...patch } : c)),
    });
  }
  function removeCondition(phaseId: string, condId: string) {
    const phase = phases.find((p) => p.id === phaseId);
    if (!phase) return;
    updatePhase(phaseId, {
      conditions: phase.conditions.filter((c) => c.id !== condId),
    });
  }

  function buildPhasePayload(p: Phase) {
    const conditionsObj: Record<string, Record<string, number>> = {};
    for (const c of p.conditions) {
      if (!conditionsObj[c.metric]) conditionsObj[c.metric] = {};
      conditionsObj[c.metric][c.comparator] = c.value;
    }
    const dialogue = p.dialogue
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const cinematic: Record<string, string> = {};
    if (p.camera.trim()) cinematic.camera = p.camera.trim();
    if (p.soundscape.trim()) cinematic.soundscape = p.soundscape.trim();
    if (p.domeEffect.trim()) cinematic.dome_effect = p.domeEffect.trim();
    return {
      id: p.phaseId.trim(),
      tone: p.tone,
      ...(Object.keys(conditionsObj).length > 0 ? { conditions: conditionsObj } : {}),
      dialogue,
      ...(Object.keys(cinematic).length > 0 ? { cinematic } : {}),
    };
  }

  async function handleAuthor() {
    setError(null);
    if (!id.trim() || !id.startsWith('arc_')) {
      setError('Arc id must start with "arc_".');
      return;
    }
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    if (!patronNpcId.trim()) {
      setError('Patron NPC id is required (e.g. npc_concordia_warm).');
      return;
    }
    if (phases.length === 0) {
      setError('Add at least one phase.');
      return;
    }
    for (const p of phases) {
      if (!p.phaseId.trim()) {
        setError('Each phase needs an id.');
        return;
      }
      const lines = p.dialogue.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (lines.length === 0) {
        setError(`Phase "${p.phaseId}" needs at least one dialogue line.`);
        return;
      }
    }
    setSubmitting(true);
    try {
      const payload = {
        id: id.trim(),
        name: name.trim(),
        description: description.trim(),
        patron_npc_id: patronNpcId.trim(),
        publish_to_federation: publishToFederation,
        phases: phases.map(buildPhasePayload),
      };
      const res = await api.post<{ ok?: boolean; reason?: string; error?: string; arcId?: string }>(
        '/api/world/arc-author',
        payload
      );
      const body = res.data;
      if (body?.ok === false) {
        setError(body.reason || body.error || 'Authoring failed.');
      } else if (body?.arcId) {
        setAuthored(body.arcId);
        onAuthored?.(body.arcId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Authoring failed.');
    } finally {
      setSubmitting(false);
    }
  }

  function authorAnother() {
    setAuthored(null);
    setId('arc_');
    setName('');
    setDescription('');
    setPatronNpcId('');
    setPhases([blankPhase('warm', 'warm')]);
  }

  return (
    <div className="bg-black/85 border border-purple-500/30 rounded-2xl p-5 max-w-3xl w-full text-white">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-start gap-2">
          <Crown className="w-5 h-5 mt-0.5 text-purple-300" aria-hidden="true" />
          <div>
            <h2 className="text-lg font-bold">Author Goddess Arc</h2>
            <p className="text-[11px] text-white/50">
              Phase-tied dialogue keyed off ecosystem score, alignments, refusal-field strength.
              Most specific phase first wins.
            </p>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white">close</button>
        )}
      </div>

      {/* Header fields */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs text-white/70 mb-1">Arc id</label>
          <input
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="arc_concordia_twin_faces"
            className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm font-mono"
          />
        </div>
        <div>
          <label className="block text-xs text-white/70 mb-1">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Concordia&rsquo;s Twin Faces"
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
          placeholder="What this arc covers — when it&rsquo;s warm, when it&rsquo;s cold, when it bends."
          className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label className="block text-xs text-white/70 mb-1">Patron NPC id</label>
          <input
            value={patronNpcId}
            onChange={(e) => setPatronNpcId(e.target.value)}
            placeholder="npc_concordia_warm"
            className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm font-mono"
          />
          <p className="text-[10px] text-white/40 mt-1">
            The NPC whose dialogue this arc drives. Author it first via the NPC composer
            if you haven&rsquo;t already.
          </p>
        </div>
        <label className="inline-flex items-start gap-2 mt-6 text-xs text-white/70">
          <input
            type="checkbox"
            checked={publishToFederation}
            onChange={(e) => setPublishToFederation(e.target.checked)}
            className="accent-purple-500 mt-0.5"
          />
          <span>
            Publish to federation — other Concord instances can import this arc
            (full text + cinematic cues) and pay royalties when their players
            cite it.
          </span>
        </label>
      </div>

      {/* Phase list */}
      <div className="space-y-3 mb-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-purple-300">Phases (ordered — most specific first)</h3>
          <button
            type="button"
            onClick={addPhase}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-purple-500/15 border border-purple-500/30 rounded hover:bg-purple-500/25"
          >
            <Plus className="w-3 h-3" /> Add phase
          </button>
        </div>

        {phases.map((phase, i) => (
          <div key={phase.id} className="rounded-md border border-purple-500/20 bg-purple-500/5 p-3">
            <div className="flex items-center gap-2 mb-2">
              <div className="flex flex-col -ml-1">
                <button
                  type="button"
                  onClick={() => movePhase(phase.id, -1)}
                  disabled={i === 0}
                  className="text-white/30 hover:text-white/70 disabled:opacity-20"
                  aria-label="Move up"
                >▲</button>
                <button
                  type="button"
                  onClick={() => movePhase(phase.id, 1)}
                  disabled={i === phases.length - 1}
                  className="text-white/30 hover:text-white/70 disabled:opacity-20"
                  aria-label="Move down"
                >▼</button>
              </div>
              <GripVertical className="w-3 h-3 text-white/40" />
              <input
                value={phase.phaseId}
                onChange={(e) => updatePhase(phase.id, { phaseId: e.target.value })}
                placeholder="phase id"
                className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-xs font-mono w-32"
              />
              <select
                value={phase.tone}
                onChange={(e) => updatePhase(phase.id, { tone: e.target.value })}
                className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-xs"
              >
                {opts.tones.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <button
                type="button"
                onClick={() => removePhase(phase.id)}
                disabled={phases.length === 1}
                className="ml-auto text-white/40 hover:text-rose-400 disabled:opacity-20"
                aria-label="Remove phase"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Conditions */}
            <div className="mb-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] uppercase tracking-wider text-white/50">Conditions (all must match)</span>
                <button
                  type="button"
                  onClick={() => addCondition(phase.id)}
                  className="text-[10px] text-purple-300 hover:text-purple-200"
                >
                  + condition
                </button>
              </div>
              {phase.conditions.length === 0 ? (
                <p className="text-[11px] text-white/40 italic">
                  No conditions — this phase always matches (catch-all default).
                </p>
              ) : (
                <div className="space-y-1.5">
                  {phase.conditions.map((c) => (
                    <div key={c.id} className="flex items-center gap-2 text-xs">
                      <select
                        value={c.metric}
                        onChange={(e) => updateCondition(phase.id, c.id, { metric: e.target.value })}
                        className="flex-1 bg-white/5 border border-white/10 rounded-md px-2 py-1 text-xs"
                      >
                        {opts.metrics.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                      <select
                        value={c.comparator}
                        onChange={(e) => updateCondition(phase.id, c.id, { comparator: e.target.value })}
                        className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-xs"
                      >
                        {opts.comparators.map((cmp) => <option key={cmp} value={cmp}>{CMP_LABEL[cmp] ?? cmp}</option>)}
                      </select>
                      <input
                        type="number"
                        step={0.1}
                        value={c.value}
                        onChange={(e) => updateCondition(phase.id, c.id, { value: Number(e.target.value) || 0 })}
                        className="w-20 bg-white/5 border border-white/10 rounded-md px-2 py-1 text-xs text-center"
                      />
                      <button
                        type="button"
                        onClick={() => removeCondition(phase.id, c.id)}
                        className="text-white/40 hover:text-rose-400"
                        aria-label="Remove condition"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Dialogue */}
            <div className="mb-2">
              <label className="block text-[10px] uppercase tracking-wider text-white/50 mb-1">
                Dialogue lines (one per line)
              </label>
              <textarea
                value={phase.dialogue}
                onChange={(e) => updatePhase(phase.id, { dialogue: e.target.value })}
                rows={3}
                placeholder="Each line is a candidate response in this phase."
                className="w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm font-mono"
              />
            </div>

            {/* Cinematic */}
            <fieldset className="rounded-md border border-white/10 bg-white/[0.02] px-3 pt-2 pb-3">
              <legend className="px-1 text-[10px] uppercase tracking-wider text-white/50 inline-flex items-center gap-1">
                <Film className="w-3 h-3" /> Cinematic cues (optional)
              </legend>
              <div className="grid grid-cols-3 gap-2">
                <input
                  value={phase.camera}
                  onChange={(e) => updatePhase(phase.id, { camera: e.target.value })}
                  placeholder="camera (e.g. low_angle_warm)"
                  className="w-full bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-xs"
                />
                <input
                  value={phase.soundscape}
                  onChange={(e) => updatePhase(phase.id, { soundscape: e.target.value })}
                  placeholder="soundscape tag"
                  className="w-full bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-xs"
                />
                <input
                  value={phase.domeEffect}
                  onChange={(e) => updatePhase(phase.id, { domeEffect: e.target.value })}
                  placeholder="dome_effect (shrink|flash|none)"
                  className="w-full bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-xs"
                />
              </div>
            </fieldset>
          </div>
        ))}
      </div>

      {error && <div className="text-xs text-red-400 mb-3" role="alert">{error}</div>}

      {authored && (
        <div className="mb-3 rounded-md border border-emerald-400/40 bg-emerald-500/10 p-3 text-xs text-emerald-200 inline-flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>
            Arc <span className="font-mono">{authored}</span> registered. Bound to <span className="font-mono">{patronNpcId}</span>;
            world-narrative selects phases on next dialogue request.
          </span>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-3 border-t border-white/10">
        {authored ? (
          <button
            onClick={authorAnother}
            className="px-4 py-2 bg-white/10 border border-white/20 rounded-md text-sm font-medium hover:bg-white/15"
          >
            Author another arc
          </button>
        ) : (
          <button
            onClick={handleAuthor}
            disabled={submitting}
            className="inline-flex items-center gap-2 px-4 py-2 bg-purple-500/20 border border-purple-500/40 rounded-md text-sm font-semibold disabled:opacity-50 hover:bg-purple-500/30"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Publish arc
          </button>
        )}
      </div>
    </div>
  );
}
