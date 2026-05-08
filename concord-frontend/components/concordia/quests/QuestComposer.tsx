'use client';

/**
 * QuestComposer — author a multi-step quest the community can play.
 *
 * Wraps server/emergent/quest-engine.js#createQuest via POST
 * /api/world/quest-author. Authored quests are immediately playable
 * (no restart). They participate in the royalty cascade when other
 * DTUs cite them: a player's clear-summary DTU that references the
 * quest pays the author back through the lineage.
 *
 * Step types match quest-engine.STEP_TYPES:
 *   learn       — teach a concept; check via comprehension
 *   challenge   — apply skill; check via outcome
 *   discover    — find / explore; check via attended event
 *   synthesize  — combine prior steps into a new artifact / DTU
 */

import { useState } from 'react';
import { Plus, Trash2, Send, Loader2, CheckCircle2, GripVertical } from 'lucide-react';
import { api } from '@/lib/api/client';

const STEP_TYPES = ['learn', 'challenge', 'discover', 'synthesize'] as const;
const DIFFICULTIES = ['beginner', 'intermediate', 'advanced', 'master'] as const;

type StepType = typeof STEP_TYPES[number];
type Difficulty = typeof DIFFICULTIES[number];

interface AuthoredStep {
  id: string;
  type: StepType;
  prompt: string;
  hint?: string;
}

interface Props {
  onAuthored?: (questId: string) => void;
  onClose?: () => void;
}

function uid() {
  return `step_${Math.random().toString(36).slice(2, 8)}`;
}

const TYPE_HINT: Record<StepType, string> = {
  learn: 'Teach a concept. Player completes by reading + acknowledging.',
  challenge: 'Apply a skill. Player completes by hitting an outcome (kill / harvest / build / cast).',
  discover: 'Explore. Player completes by attending a named event or visiting a location.',
  synthesize: 'Combine prior steps. Player completes by creating a DTU that cites the prior steps.',
};

const TYPE_TINT: Record<StepType, string> = {
  learn: 'border-cyan-500/30 bg-cyan-500/5',
  challenge: 'border-rose-500/30 bg-rose-500/5',
  discover: 'border-emerald-500/30 bg-emerald-500/5',
  synthesize: 'border-amber-500/30 bg-amber-500/5',
};

export default function QuestComposer({ onAuthored, onClose }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [domain, setDomain] = useState('general');
  const [difficulty, setDifficulty] = useState<Difficulty>('intermediate');
  const [estimatedTime, setEstimatedTime] = useState('30m');
  const [tagsInput, setTagsInput] = useState('');
  const [prereqsInput, setPrereqsInput] = useState('');
  const [openToCommunity, setOpenToCommunity] = useState(true);
  const [steps, setSteps] = useState<AuthoredStep[]>([
    { id: uid(), type: 'learn', prompt: '' },
  ]);

  // Reward block — quest-engine reads quest.rewards and grants via
  // lib/quest-rewards#grantQuestRewards on completion.
  const [rewardCC, setRewardCC] = useState(50);
  const [rewardXP, setRewardXP] = useState(100);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authored, setAuthored] = useState<string | null>(null);

  function addStep() {
    setSteps((prev) => [...prev, { id: uid(), type: 'challenge', prompt: '' }]);
  }
  function removeStep(id: string) {
    setSteps((prev) => prev.filter((s) => s.id !== id));
  }
  function updateStep(id: string, patch: Partial<AuthoredStep>) {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }
  function moveStep(id: string, dir: -1 | 1) {
    setSteps((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      if (idx < 0) return prev;
      const next = idx + dir;
      if (next < 0 || next >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[next]] = [copy[next], copy[idx]];
      return copy;
    });
  }

  async function handleAuthor() {
    setError(null);
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }
    if (steps.length === 0) {
      setError('Add at least one step.');
      return;
    }
    for (const s of steps) {
      if (!s.prompt.trim()) {
        setError(`Step "${s.type}" needs a prompt.`);
        return;
      }
    }
    setSubmitting(true);
    try {
      const tags = tagsInput
        .split(',').map((t) => t.trim()).filter(Boolean);
      if (openToCommunity && !tags.includes('community-remixable')) tags.push('community-remixable');
      const prerequisites = prereqsInput
        .split(',').map((t) => t.trim()).filter(Boolean);
      const payload = {
        title: title.trim(),
        description: description.trim(),
        domain: domain.trim() || 'general',
        difficulty,
        estimatedTime: estimatedTime.trim() || null,
        tags,
        prerequisites,
        steps: steps.map((s) => ({
          type: s.type,
          prompt: s.prompt.trim(),
          hint: s.hint?.trim() || undefined,
        })),
        rewards: {
          cc: rewardCC,
          xp: rewardXP,
        },
      };
      const res = await api.post<{ ok?: boolean; error?: string; questId?: string }>(
        '/api/world/quest-author',
        payload
      );
      const body = res.data;
      if (body?.ok === false) {
        setError(body.error || 'Authoring failed.');
      } else if (body?.questId) {
        setAuthored(body.questId);
        onAuthored?.(body.questId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Authoring failed.');
    } finally {
      setSubmitting(false);
    }
  }

  function authorAnother() {
    setAuthored(null);
    setTitle('');
    setDescription('');
    setSteps([{ id: uid(), type: 'learn', prompt: '' }]);
  }

  return (
    <div className="bg-black/85 border border-amber-500/30 rounded-2xl p-5 max-w-3xl w-full text-white">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold">Author Quest</h2>
          <p className="text-[11px] text-white/50">
            Multi-step community quest. Playable immediately; cascades royalties when cited.
          </p>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white">close</button>
        )}
      </div>

      {/* Quest header */}
      <div className="grid grid-cols-1 gap-3 mb-3">
        <div>
          <label className="block text-xs text-white/70 mb-1">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. The Smith's Lost Hammer"
            className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-white/70 mb-1">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="One-liner the quest-giver says when offering."
            className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-3">
        <div>
          <label className="block text-xs text-white/70 mb-1">Domain</label>
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="general / combat / lore / craft"
            className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-white/70 mb-1">Difficulty</label>
          <select
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as Difficulty)}
            className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm"
          >
            {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-white/70 mb-1">Est. time</label>
          <input
            value={estimatedTime}
            onChange={(e) => setEstimatedTime(e.target.value)}
            placeholder="30m / 2h"
            className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs text-white/70 mb-1">Tags (comma)</label>
          <input
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="tutorial, lore, faction:scholars_guild"
            className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-white/70 mb-1">Prerequisite quest ids (comma)</label>
          <input
            value={prereqsInput}
            onChange={(e) => setPrereqsInput(e.target.value)}
            placeholder="quest_abc123, quest_def456"
            className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm font-mono"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs text-white/70 mb-1">Reward (CC)</label>
          <input
            type="number"
            min={0}
            value={rewardCC}
            onChange={(e) => setRewardCC(Number(e.target.value) || 0)}
            className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-white/70 mb-1">Reward (XP)</label>
          <input
            type="number"
            min={0}
            value={rewardXP}
            onChange={(e) => setRewardXP(Number(e.target.value) || 0)}
            className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm"
          />
        </div>
      </div>

      <label className="inline-flex items-center gap-2 text-xs text-white/70 mb-4">
        <input
          type="checkbox"
          checked={openToCommunity}
          onChange={(e) => setOpenToCommunity(e.target.checked)}
          className="accent-amber-500"
        />
        Open to community remix (derivative quests cite this one + cascade royalties)
      </label>

      {/* Steps */}
      <div className="space-y-2 mb-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-amber-300">Steps</h3>
          <button
            type="button"
            onClick={addStep}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-amber-500/15 border border-amber-500/30 rounded hover:bg-amber-500/25"
          >
            <Plus className="w-3 h-3" /> Add step
          </button>
        </div>
        {steps.map((step, i) => (
          <div key={step.id} className={`rounded-md border ${TYPE_TINT[step.type]} p-3`}>
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
                value={step.type}
                onChange={(e) => updateStep(step.id, { type: e.target.value as StepType })}
                className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-xs"
              >
                {STEP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <span className="text-[10px] text-white/40 italic">{TYPE_HINT[step.type]}</span>
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
              placeholder="Step prompt — what the player must do."
              className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-1.5 text-sm mb-2"
            />
            <input
              value={step.hint || ''}
              onChange={(e) => updateStep(step.id, { hint: e.target.value })}
              placeholder="Optional hint surfaced if the player asks."
              className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-1.5 text-xs text-white/70"
            />
          </div>
        ))}
      </div>

      {error && <div className="text-xs text-red-400 mb-3" role="alert">{error}</div>}

      {authored && (
        <div className="mb-3 rounded-md border border-emerald-400/40 bg-emerald-500/10 p-3 text-xs text-emerald-200 inline-flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>
            Quest <span className="font-mono">{authored}</span> is live. Anyone in the
            world can accept it now.
          </span>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-3 border-t border-white/10">
        {authored ? (
          <button
            onClick={authorAnother}
            className="px-4 py-2 bg-white/10 border border-white/20 rounded-md text-sm font-medium hover:bg-white/15"
          >
            Author another quest
          </button>
        ) : (
          <button
            onClick={handleAuthor}
            disabled={submitting}
            className="inline-flex items-center gap-2 px-4 py-2 bg-amber-500/20 border border-amber-500/40 rounded-md text-sm font-semibold disabled:opacity-50 hover:bg-amber-500/30"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Publish quest
          </button>
        )}
      </div>
    </div>
  );
}
