'use client';

/**
 * NPCComposer — author a world-NPC the community-grow-the-world way.
 *
 * Authored NPCs are validated by `server/lib/content-seeder.js#validateNpc`
 * and registered via POST /api/world/npc-author. Once registered, the
 * narrative bridge wires them into oracle-brain dialogue automatically;
 * the schedule field is also forwarded to npc-schedules.js so the NPC
 * picks up time-of-day behaviour without further glue.
 *
 * Invariant surfaced in the UI: narrative_context.secret stays server-
 * side only. The narrative bridge strips secrets when building LLM
 * prompts. Authors should put hidden motivations and branch conditions
 * here — anything you'd say "the player should NEVER hear an NPC
 * accidentally reference."
 */

import { useState } from 'react';
import { api } from '@/lib/api/client';
import { ShieldAlert, Send, Loader2, CheckCircle2 } from 'lucide-react';

const ARCHETYPES = [
  'merchant', 'sage', 'guard', 'farmer', 'crafter', 'healer', 'scholar',
  'wanderer', 'priest', 'mercenary', 'noble', 'spy', 'oracle', 'engineer',
  'rogue', 'beast_handler', 'exile', 'godfather', 'intelligence_chief',
] as const;

type Archetype = typeof ARCHETYPES[number];

interface NPCAuthorPayload {
  id: string;
  name: string;
  archetype?: string;
  faction_id?: string | null;
  occupation?: string;
  body_type?: 'humanoid' | 'beast' | 'construct' | 'spirit';
  level?: number;
  is_quest_giver?: boolean;
  schedule?: Record<string, unknown>;
  narrative_context?: {
    backstory?: string;
    motivation?: string;
    quirks?: string;
    secret?: string;
  };
}

interface Props {
  onAuthored?: (npcId: string) => void;
  onClose?: () => void;
}

export default function NPCComposer({ onAuthored, onClose }: Props) {
  const [id, setId] = useState('npc_');
  const [name, setName] = useState('');
  const [archetype, setArchetype] = useState<Archetype>('wanderer');
  const [factionId, setFactionId] = useState('');
  const [occupation, setOccupation] = useState('');
  const [bodyType, setBodyType] = useState<NonNullable<NPCAuthorPayload['body_type']>>('humanoid');
  const [level, setLevel] = useState(1);
  const [isQuestGiver, setIsQuestGiver] = useState(false);

  // narrative_context — backstory + motivation + quirks are surfaced to
  // the LLM via narrative-bridge; secret is NOT.
  const [backstory, setBackstory] = useState('');
  const [motivation, setMotivation] = useState('');
  const [quirks, setQuirks] = useState('');
  const [secret, setSecret] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authored, setAuthored] = useState<string | null>(null);

  function buildPayload(): NPCAuthorPayload {
    const ctx: NPCAuthorPayload['narrative_context'] = {};
    if (backstory.trim()) ctx.backstory = backstory.trim();
    if (motivation.trim()) ctx.motivation = motivation.trim();
    if (quirks.trim()) ctx.quirks = quirks.trim();
    if (secret.trim()) ctx.secret = secret.trim();
    return {
      id: id.trim(),
      name: name.trim(),
      archetype,
      faction_id: factionId.trim() || null,
      occupation: occupation.trim() || archetype,
      body_type: bodyType,
      level,
      is_quest_giver: isQuestGiver,
      ...(Object.keys(ctx).length > 0 ? { narrative_context: ctx } : {}),
    };
  }

  async function handleAuthor() {
    setError(null);
    setAuthored(null);
    if (!id.trim() || !id.startsWith('npc_')) {
      setError('NPC id must start with "npc_" (e.g. npc_orin_smith).');
      return;
    }
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post<{ ok?: boolean; reason?: string; error?: string; npcId?: string }>(
        '/api/world/npc-author',
        buildPayload()
      );
      const body = res.data;
      if (body?.ok === false) {
        setError(body.reason || body.error || 'Authoring failed.');
      } else if (body?.npcId) {
        setAuthored(body.npcId);
        onAuthored?.(body.npcId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Authoring failed.');
    } finally {
      setSubmitting(false);
    }
  }

  function authorAnother() {
    setAuthored(null);
    setId('npc_');
    setName('');
    setBackstory('');
    setMotivation('');
    setQuirks('');
    setSecret('');
  }

  return (
    <div className="bg-black/85 border border-violet-500/30 rounded-2xl p-5 max-w-2xl w-full text-white">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold">Author World NPC</h2>
          <p className="text-[11px] text-white/50">
            Validated server-side; once authored the NPC joins dialogue + schedules immediately.
          </p>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white">close</button>
        )}
      </div>

      {/* Identity */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs text-white/70 mb-1">NPC id</label>
          <input
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="npc_orin_smith"
            className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm font-mono"
          />
        </div>
        <div>
          <label className="block text-xs text-white/70 mb-1">Display name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Orin the Smith"
            className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-3">
        <div>
          <label className="block text-xs text-white/70 mb-1">Archetype</label>
          <select
            value={archetype}
            onChange={(e) => setArchetype(e.target.value as Archetype)}
            className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm"
          >
            {ARCHETYPES.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-white/70 mb-1">Body type</label>
          <select
            value={bodyType}
            onChange={(e) => setBodyType(e.target.value as NonNullable<NPCAuthorPayload['body_type']>)}
            className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm"
          >
            <option value="humanoid">humanoid</option>
            <option value="beast">beast</option>
            <option value="construct">construct</option>
            <option value="spirit">spirit</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-white/70 mb-1">Level</label>
          <input
            type="number"
            min={1}
            max={99}
            value={level}
            onChange={(e) => setLevel(Number(e.target.value) || 1)}
            className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs text-white/70 mb-1">Faction id (optional)</label>
          <input
            value={factionId}
            onChange={(e) => setFactionId(e.target.value)}
            placeholder="e.g. scholars_guild"
            className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm font-mono"
          />
        </div>
        <div>
          <label className="block text-xs text-white/70 mb-1">Occupation (optional)</label>
          <input
            value={occupation}
            onChange={(e) => setOccupation(e.target.value)}
            placeholder={archetype}
            className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm"
          />
        </div>
      </div>

      <label className="inline-flex items-center gap-2 text-xs text-white/70 mb-4">
        <input
          type="checkbox"
          checked={isQuestGiver}
          onChange={(e) => setIsQuestGiver(e.target.checked)}
          className="accent-violet-500"
        />
        Quest giver
      </label>

      {/* Narrative context — public fields */}
      <fieldset className="rounded-md border border-white/10 bg-white/[0.02] px-3 pt-2 pb-3 mb-3">
        <legend className="px-1 text-[10px] uppercase tracking-wider text-white/50">Narrative · public</legend>
        <p className="text-[11px] text-white/50 mb-2">
          These fields enrich oracle-brain dialogue. The LLM sees them.
        </p>
        <label className="block text-xs text-white/70 mb-1">Backstory</label>
        <textarea
          value={backstory}
          onChange={(e) => setBackstory(e.target.value)}
          rows={3}
          placeholder="Where they're from, what they've lost or built…"
          className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm mb-2"
        />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-white/70 mb-1">Motivation</label>
            <input
              value={motivation}
              onChange={(e) => setMotivation(e.target.value)}
              placeholder="Reclaim a lost heirloom"
              className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-white/70 mb-1">Quirks</label>
            <input
              value={quirks}
              onChange={(e) => setQuirks(e.target.value)}
              placeholder="Speaks in proverbs"
              className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm"
            />
          </div>
        </div>
      </fieldset>

      {/* Narrative context — secret (server-only) */}
      <fieldset className="rounded-md border border-rose-500/30 bg-rose-500/5 px-3 pt-2 pb-3 mb-4">
        <legend className="px-1 text-[10px] uppercase tracking-wider text-rose-300 inline-flex items-center gap-1">
          <ShieldAlert className="w-3 h-3" /> Narrative · secret · stays server-side
        </legend>
        <p className="text-[11px] text-rose-200/80 mb-2">
          The narrative bridge omits this from every LLM prompt. Use for branch
          conditions and human-author notes — not for content the NPC should
          ever say. (No-leak invariant pinned at narrative-bridge.js:147.)
        </p>
        <textarea
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          rows={2}
          placeholder="Hidden motivation, allegiance flip, true identity…"
          className="w-full bg-black/40 border border-rose-500/20 rounded-md px-3 py-2 text-sm font-mono"
        />
      </fieldset>

      {error && <div className="text-xs text-red-400 mb-3" role="alert">{error}</div>}

      {authored && (
        <div className="mb-3 rounded-md border border-emerald-400/40 bg-emerald-500/10 p-3 text-xs text-emerald-200 inline-flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>
            <span className="font-semibold">{authored}</span> is now in the world.
            Joins dialogue + schedules at next tick.
          </span>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-3 border-t border-white/10">
        {authored ? (
          <button
            onClick={authorAnother}
            className="px-4 py-2 bg-white/10 border border-white/20 rounded-md text-sm font-medium hover:bg-white/15"
          >
            Author another NPC
          </button>
        ) : (
          <button
            onClick={handleAuthor}
            disabled={submitting}
            className="inline-flex items-center gap-2 px-4 py-2 bg-violet-500/20 border border-violet-500/40 rounded-md text-sm font-semibold disabled:opacity-50 hover:bg-violet-500/30"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Publish NPC
          </button>
        )}
      </div>
    </div>
  );
}
