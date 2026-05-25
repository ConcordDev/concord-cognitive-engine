'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PersonaEditor — visual from-scratch authoring surface for an AI persona.
 * Wires personas.create / personas.update / personas.revise / personas.publish /
 * personas.regenerate_portrait. Every field is real user input persisted by a macro.
 */

import { useState } from 'react';
import { lensRun } from '@/lib/api/client';

export interface PersonaDetail {
  id: string;
  name: string;
  tagline: string;
  personality: string;
  voice: string;
  greeting: string;
  category: string;
  tags: string[];
  portrait: string;
  version: number;
  published: boolean;
  installCount: number;
  chatCount: number;
  rating: number;
  ratingCount: number;
  exampleDialogue: Array<{ prompt: string; response: string }>;
  contentHash: string;
  isAuthor: boolean;
}

const VOICES = ['warm', 'formal', 'playful', 'terse', 'wise', 'mysterious'];

interface DraftDialogue { prompt: string; response: string }

export function PersonaEditor({
  existing,
  onSaved,
  onCancel,
}: {
  existing?: PersonaDetail | null;
  onSaved: (personaId: string) => void;
  onCancel: () => void;
}) {
  const editing = !!existing;
  const [name, setName] = useState(existing?.name || '');
  const [tagline, setTagline] = useState(existing?.tagline || '');
  const [personality, setPersonality] = useState(existing?.personality || '');
  const [voice, setVoice] = useState(existing?.voice || 'warm');
  const [greeting, setGreeting] = useState(existing?.greeting || '');
  const [category, setCategory] = useState(existing?.category || 'original');
  const [tags, setTags] = useState((existing?.tags || []).join(', '));
  const [dialogue, setDialogue] = useState<DraftDialogue[]>(
    existing?.exampleDialogue?.length ? existing.exampleDialogue : [],
  );
  const [changelog, setChangelog] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const addDialogue = () => setDialogue((d) => [...d, { prompt: '', response: '' }]);
  const setDialogueAt = (i: number, k: keyof DraftDialogue, v: string) =>
    setDialogue((d) => d.map((row, idx) => (idx === i ? { ...row, [k]: v } : row)));
  const removeDialogue = (i: number) =>
    setDialogue((d) => d.filter((_, idx) => idx !== i));

  const save = async () => {
    if (!name.trim()) { setErr('Name is required.'); return; }
    setBusy(true);
    setErr(null);
    const exampleDialogue = dialogue.filter((d) => d.prompt.trim() && d.response.trim());
    const payload: Record<string, unknown> = {
      name: name.trim(), tagline, personality, voice, greeting, category,
      tags, exampleDialogue,
    };
    let r;
    if (editing && existing) {
      payload.personaId = existing.id;
      if (existing.published && changelog.trim()) {
        payload.changelog = changelog.trim();
        r = await lensRun('personas', 'revise', payload);
      } else {
        r = await lensRun('personas', 'update', payload);
      }
    } else {
      r = await lensRun('personas', 'create', payload);
    }
    setBusy(false);
    if (r.data?.ok) {
      const res = r.data.result as any;
      onSaved(res?.persona?.id || existing?.id || res?.personaId);
    } else {
      setErr(r.data?.error || 'save_failed');
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-[11px] uppercase tracking-wider text-zinc-400">Name *</span>
          <input
            type="text" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Persona name"
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] uppercase tracking-wider text-zinc-400">Tagline</span>
          <input
            type="text" value={tagline} onChange={(e) => setTagline(e.target.value)}
            placeholder="One-line hook"
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100"
          />
        </label>
      </div>

      <label className="block space-y-1">
        <span className="text-[11px] uppercase tracking-wider text-zinc-400">Personality</span>
        <textarea
          value={personality} onChange={(e) => setPersonality(e.target.value)}
          rows={3} placeholder="Describe who this character is, how they think, what they value."
          className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100"
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-[11px] uppercase tracking-wider text-zinc-400">Voice</span>
          <select
            value={voice} onChange={(e) => setVoice(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100"
          >
            {VOICES.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[11px] uppercase tracking-wider text-zinc-400">Category</span>
          <input
            type="text" value={category} onChange={(e) => setCategory(e.target.value)}
            placeholder="original, helper, mentor…"
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100"
          />
        </label>
      </div>

      <label className="block space-y-1">
        <span className="text-[11px] uppercase tracking-wider text-zinc-400">Greeting</span>
        <textarea
          value={greeting} onChange={(e) => setGreeting(e.target.value)}
          rows={2} placeholder="The first thing this persona says when a chat opens."
          className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-[11px] uppercase tracking-wider text-zinc-400">Tags (comma separated)</span>
        <input
          type="text" value={tags} onChange={(e) => setTags(e.target.value)}
          placeholder="strategist, witty, sci-fi"
          className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100"
        />
      </label>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-wider text-zinc-400">Example dialogue</span>
          <button
            type="button" onClick={addDialogue}
            className="text-[11px] text-purple-300 hover:text-purple-200"
          >+ Add example</button>
        </div>
        {dialogue.length === 0 && (
          <p className="text-[11px] text-zinc-400 italic">
            Example exchanges teach the persona how to reply. The chat preview surfaces an exact authored response when the user echoes a prompt.
          </p>
        )}
        {dialogue.map((d, i) => (
          <div key={i} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2 space-y-1.5">
            <input
              type="text" value={d.prompt}
              onChange={(e) => setDialogueAt(i, 'prompt', e.target.value)}
              placeholder="User says…"
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-100"
            />
            <textarea
              value={d.response} rows={2}
              onChange={(e) => setDialogueAt(i, 'response', e.target.value)}
              placeholder="Persona replies…"
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-100"
            />
            <button
              type="button" onClick={() => removeDialogue(i)}
              className="text-[10px] text-red-400 hover:text-red-300"
            >Remove</button>
          </div>
        ))}
      </div>

      {editing && existing?.published && (
        <label className="block space-y-1">
          <span className="text-[11px] uppercase tracking-wider text-amber-400">
            Changelog (publishing a revision notifies installers)
          </span>
          <input
            type="text" value={changelog} onChange={(e) => setChangelog(e.target.value)}
            placeholder="What changed in this version?"
            className="w-full bg-zinc-950 border border-amber-800/50 rounded-lg px-3 py-2 text-sm text-zinc-100"
          />
        </label>
      )}

      {err && (
        <div className="bg-red-950/50 border border-red-700/50 text-red-200 px-3 py-2 rounded-lg text-xs">
          {err}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button" onClick={save} disabled={busy || !name.trim()}
          className="flex-1 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white text-sm py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
        >
          {busy ? 'Saving…' : editing
            ? (existing?.published && changelog.trim() ? 'Publish revision' : 'Save changes')
            : 'Create persona'}
        </button>
        <button
          type="button" onClick={onCancel}
          className="px-4 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm py-2 rounded-lg"
        >Cancel</button>
      </div>
    </div>
  );
}
