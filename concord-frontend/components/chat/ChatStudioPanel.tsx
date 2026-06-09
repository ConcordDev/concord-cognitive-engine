'use client';

// ChatStudioPanel — the ChatGPT-parity surface for the chat lens.
// One slide-over with seven tabs, each backed by a real server macro
// in server/domains/chat.js. No seed/demo data — every value here is
// either typed by the user or computed from real input/platform state.
//
//   Voice    → voice-get / voice-update          (speech-in + TTS-out prefs)
//   GPTs     → assistant-* CRUD                   (custom configurable assistants)
//   Canvas   → canvas-* CRUD + revert            (side-by-side doc/code editing)
//   Memory   → memory-* CRUD                      (persistent cross-chat facts)
//   Run      → code-run / code-history           (sandboxed JS execution)
//   Share    → share-create / list / revoke      (public read-only links)
//   Image    → image-generate / history / delete (in-thread image generation)

import { useCallback, useEffect, useState } from 'react';
import {
  X, Loader2, Plus, Trash2, Save, RotateCcw, Play, Mic, Bot, FileCode,
  Brain, Terminal, Share2, ImageIcon, Volume2, Copy, Check, Eye, History,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

// ── Shared types ─────────────────────────────────────────────────────

type StudioTab = 'voice' | 'gpts' | 'canvas' | 'memory' | 'code' | 'share' | 'image';

interface VoicePrefs {
  enabled: boolean;
  ttsVoice: string;
  ttsRate: number;
  ttsPitch: number;
  autoplayReplies: boolean;
  sttLang: string;
  updatedAt: string | null;
}

interface Assistant {
  id: string;
  name: string;
  instructions: string;
  description: string;
  starters: string[];
  knowledgeDtuIds: string[];
  model: string;
  icon: string;
  createdAt: string;
  updatedAt: string;
}

interface CanvasDocSummary {
  id: string;
  title: string;
  kind: 'document' | 'code';
  language: string | null;
  threadId: string | null;
  revisionCount: number;
  charCount: number;
  createdAt: string;
  updatedAt: string;
}

interface CanvasRevision {
  content: string;
  editedBy: 'user' | 'ai';
  savedAt: string;
}

interface CanvasDoc extends Omit<CanvasDocSummary, 'revisionCount' | 'charCount'> {
  content: string;
  revisions: CanvasRevision[];
}

interface MemoryFact {
  id: string;
  fact: string;
  category: 'preference' | 'fact' | 'context' | 'instruction';
  source: 'user' | 'ai';
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

interface CodeRun {
  id: string;
  language: string;
  code: string;
  logs: string[];
  returnValue: string | null;
  error: string | null;
  durationMs: number;
  timedOut: boolean;
  ranAt: string;
}

interface ShareLink {
  token: string;
  threadId: string;
  title: string;
  messageCount: number;
  revoked: boolean;
  viewCount: number;
  createdAt: string;
  url: string;
}

interface GenImage {
  id: string;
  prompt: string;
  url: string;
  width: number;
  height: number;
  seed: number;
  reachable: boolean;
  createdAt: string;
}

export interface StudioMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  initialTab?: StudioTab;
  /** Active conversation id — used to seed Share + Canvas with the live thread. */
  threadId?: string | null;
  /** Live conversation snapshot — used by the Share tab. */
  messages?: StudioMessage[];
  /** Push generated content (image markdown, canvas link) into the chat input. */
  onInsert?: (text: string) => void;
  /** Activate a custom GPT — the page applies its instructions to the system prompt. */
  onActivateAssistant?: (a: Assistant) => void;
}

const TABS: Array<{ id: StudioTab; label: string; icon: typeof Mic }> = [
  { id: 'voice', label: 'Voice', icon: Mic },
  { id: 'gpts', label: 'GPTs', icon: Bot },
  { id: 'canvas', label: 'Canvas', icon: FileCode },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'code', label: 'Run', icon: Terminal },
  { id: 'share', label: 'Share', icon: Share2 },
  { id: 'image', label: 'Image', icon: ImageIcon },
];

const MODELS = ['overview', 'deep', 'creative', 'code', 'research', 'creti'];

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// ── Voice tab ────────────────────────────────────────────────────────

function VoiceTab() {
  const [prefs, setPrefs] = useState<VoicePrefs | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voices, setVoices] = useState<string[]>([]);
  const [testText, setTestText] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await lensRun<{ prefs: VoicePrefs }>('chat', 'voice-get', {});
      if (!cancelled && r.data?.ok && r.data.result) setPrefs(r.data.result.prefs);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const load = () => {
      const list = window.speechSynthesis.getVoices().map((v) => v.name);
      if (list.length) setVoices(['default', ...list]);
    };
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, []);

  const patch = useCallback(async (delta: Partial<VoicePrefs>) => {
    if (!prefs) return;
    const optimistic = { ...prefs, ...delta };
    setPrefs(optimistic);
    setSaving(true);
    setError(null);
    const r = await lensRun<{ prefs: VoicePrefs }>('chat', 'voice-update', delta as Record<string, unknown>);
    if (r.data?.ok && r.data.result) setPrefs(r.data.result.prefs);
    else setError(r.data?.error || 'Save failed');
    setSaving(false);
  }, [prefs]);

  const speakTest = useCallback(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis || !prefs) return;
    const text = testText.trim() || 'This is your Concord voice. Voice mode reads replies aloud.';
    const u = new SpeechSynthesisUtterance(text);
    u.rate = prefs.ttsRate;
    u.pitch = prefs.ttsPitch;
    if (prefs.ttsVoice !== 'default') {
      const v = window.speechSynthesis.getVoices().find((x) => x.name === prefs.ttsVoice);
      if (v) u.voice = v;
    }
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }, [prefs, testText]);

  const sttSupported = typeof window !== 'undefined'
    && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  if (loading) return <TabLoading />;
  if (!prefs) return <TabEmpty icon={Mic} text="Voice preferences unavailable" />;

  return (
    <div className="space-y-4">
      <ToggleRow
        label="Enable voice mode"
        sub="Show the mic button in the composer and the speaker on replies."
        checked={prefs.enabled}
        onChange={(v) => patch({ enabled: v })}
      />
      <ToggleRow
        label="Autoplay replies"
        sub="Speak each assistant reply aloud as it finishes streaming."
        checked={prefs.autoplayReplies}
        onChange={(v) => patch({ autoplayReplies: v })}
      />
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-gray-400">TTS voice</span>
          <select
            value={prefs.ttsVoice}
            onChange={(e) => patch({ ttsVoice: e.target.value })}
            className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 focus:border-cyan-500/50 focus:outline-none"
          >
            {(voices.length ? voices : [prefs.ttsVoice]).map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-gray-400">Speech-in language</span>
          <input
            type="text"
            value={prefs.sttLang}
            onChange={(e) => setPrefs({ ...prefs, sttLang: e.target.value })}
            onBlur={(e) => patch({ sttLang: e.target.value })}
            placeholder="en-US"
            className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 focus:border-cyan-500/50 focus:outline-none"
          />
        </label>
      </div>
      <RangeRow
        label="Rate"
        value={prefs.ttsRate}
        min={0.5}
        max={2}
        step={0.05}
        onCommit={(v) => patch({ ttsRate: v })}
      />
      <RangeRow
        label="Pitch"
        value={prefs.ttsPitch}
        min={0}
        max={2}
        step={0.05}
        onCommit={(v) => patch({ ttsPitch: v })}
      />
      <div className="rounded-md border border-white/10 bg-black/20 p-3 space-y-2">
        <span className="text-[10px] uppercase tracking-wider text-gray-400">Test the voice</span>
        <textarea
          value={testText}
          onChange={(e) => setTestText(e.target.value)}
          placeholder="Type text to hear it spoken with these settings"
          rows={2}
          className="w-full px-2 py-1.5 text-sm bg-black/40 border border-white/10 rounded text-gray-100 placeholder-gray-500 focus:border-cyan-500/50 focus:outline-none resize-none"
        />
        <button
          type="button"
          onClick={speakTest}
          disabled={!ttsSupported}
          className="inline-flex items-center gap-1 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-200 hover:brightness-110 disabled:opacity-40"
        >
          <Volume2 className="w-3 h-3" /> Speak
        </button>
      </div>
      <div className="text-[10px] text-gray-400 space-y-0.5">
        <p>Speech-in {sttSupported ? 'supported' : 'not supported'} in this browser.</p>
        <p>Text-to-speech {ttsSupported ? 'supported' : 'not supported'} in this browser.</p>
        {prefs.updatedAt && <p>Last saved {fmtTime(prefs.updatedAt)}.</p>}
      </div>
      {saving && <p className="text-[11px] text-gray-400">Saving…</p>}
      {error && <p className="text-[11px] text-rose-300">{error}</p>}
    </div>
  );
}

// ── Custom GPTs tab ──────────────────────────────────────────────────

function GptsTab({ onActivate }: { onActivate?: (a: Assistant) => void }) {
  const [list, setList] = useState<Assistant[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Assistant | null>(null);
  const [draft, setDraft] = useState<{ name: string; description: string; instructions: string; model: string; starters: string }>(
    { name: '', description: '', instructions: '', model: 'overview', starters: '' },
  );
  const [composing, setComposing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<{ assistants: Assistant[] }>('chat', 'assistants-list', {});
    if (r.data?.ok && r.data.result) setList(r.data.result.assistants);
    setLoading(false);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const startNew = () => {
    setEditing(null);
    setDraft({ name: '', description: '', instructions: '', model: 'overview', starters: '' });
    setComposing(true);
    setError(null);
  };
  const startEdit = (a: Assistant) => {
    setEditing(a);
    setDraft({
      name: a.name, description: a.description, instructions: a.instructions,
      model: a.model, starters: a.starters.join('\n'),
    });
    setComposing(true);
    setError(null);
  };

  const save = async () => {
    if (!draft.name.trim() || !draft.instructions.trim()) {
      setError('Name and instructions are required');
      return;
    }
    setSaving(true);
    setError(null);
    const starters = draft.starters.split('\n').map((s) => s.trim()).filter(Boolean);
    const input: Record<string, unknown> = {
      name: draft.name, description: draft.description,
      instructions: draft.instructions, model: draft.model, starters,
    };
    const r = editing
      ? await lensRun('chat', 'assistant-update', { id: editing.id, ...input })
      : await lensRun('chat', 'assistant-create', input);
    if (r.data?.ok) {
      setComposing(false);
      await refresh();
    } else {
      setError(r.data?.error || 'Save failed');
    }
    setSaving(false);
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this custom GPT?')) return;
    await lensRun('chat', 'assistant-delete', { id });
    await refresh();
  };

  if (loading) return <TabLoading />;

  return (
    <div className="space-y-3">
      {!composing && (
        <button
          type="button"
          onClick={startNew}
          className="w-full inline-flex items-center justify-center gap-1 rounded-md border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs text-violet-200 hover:brightness-110"
        >
          <Plus className="w-3 h-3" /> New custom GPT
        </button>
      )}
      {composing && (
        <div className="rounded-md border border-violet-500/30 bg-violet-500/5 p-3 space-y-2">
          <input
            type="text"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Name (e.g. SQL Tutor)"
            maxLength={60}
            className="w-full px-2 py-1.5 text-sm bg-black/40 border border-white/10 rounded text-gray-100 placeholder-gray-500 focus:border-violet-500/50 focus:outline-none"
          />
          <input
            type="text"
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            placeholder="Short description"
            maxLength={300}
            className="w-full px-2 py-1.5 text-sm bg-black/40 border border-white/10 rounded text-gray-100 placeholder-gray-500 focus:border-violet-500/50 focus:outline-none"
          />
          <textarea
            value={draft.instructions}
            onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
            placeholder="System instructions — how this GPT should behave"
            rows={5}
            maxLength={8000}
            className="w-full px-2 py-1.5 text-sm bg-black/40 border border-white/10 rounded text-gray-100 placeholder-gray-500 focus:border-violet-500/50 focus:outline-none resize-none"
          />
          <textarea
            value={draft.starters}
            onChange={(e) => setDraft({ ...draft, starters: e.target.value })}
            placeholder="Conversation starters — one per line"
            rows={3}
            className="w-full px-2 py-1.5 text-sm bg-black/40 border border-white/10 rounded text-gray-100 placeholder-gray-500 focus:border-violet-500/50 focus:outline-none resize-none"
          />
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-gray-400">Default mode</span>
            <select
              value={draft.model}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}
              className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 focus:border-violet-500/50 focus:outline-none"
            >
              {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          {error && <p className="text-[11px] text-rose-300">{error}</p>}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-1 rounded-md border border-violet-500/40 bg-violet-500/15 px-3 py-1 text-xs text-violet-100 hover:brightness-110 disabled:opacity-40"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              {editing ? 'Update' : 'Create'}
            </button>
            <button
              type="button"
              onClick={() => setComposing(false)}
              className="px-3 py-1 text-xs text-gray-400 hover:text-gray-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {list.length === 0 && !composing ? (
        <TabEmpty icon={Bot} text="No custom GPTs yet" sub="Build a reusable assistant with its own instructions." />
      ) : (
        list.map((a) => (
          <div key={a.id} className="rounded-md border border-violet-500/20 bg-black/20 p-3 group">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-100 truncate">{a.name}</p>
                {a.description && <p className="text-[11px] text-gray-400 mt-0.5 line-clamp-2">{a.description}</p>}
                <span className="text-[9px] uppercase tracking-wider text-violet-300/70 mt-1 inline-block">{a.model}</span>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                <button type="button" onClick={() => startEdit(a)} className="p-1 text-gray-400 hover:text-violet-300" aria-label="Edit GPT">
                  <Save className="w-3 h-3" />
                </button>
                <button type="button" onClick={() => remove(a.id)} className="p-1 text-gray-400 hover:text-rose-300" aria-label="Delete GPT">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
            {onActivate && (
              <button
                type="button"
                onClick={() => onActivate(a)}
                className="mt-2 inline-flex items-center gap-1 rounded border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[11px] text-violet-200 hover:brightness-110"
              >
                <Play className="w-3 h-3" /> Use this GPT
              </button>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// ── Canvas tab ───────────────────────────────────────────────────────

function CanvasTab({ threadId, onInsert }: { threadId?: string | null; onInsert?: (t: string) => void }) {
  const [docs, setDocs] = useState<CanvasDocSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<CanvasDoc | null>(null);
  const [draftContent, setDraftContent] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newKind, setNewKind] = useState<'document' | 'code'>('document');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<{ docs: CanvasDocSummary[] }>('chat', 'canvas-list', {});
    if (r.data?.ok && r.data.result) setDocs(r.data.result.docs);
    setLoading(false);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const openDoc = async (id: string) => {
    const r = await lensRun<{ doc: CanvasDoc }>('chat', 'canvas-get', { id });
    if (r.data?.ok && r.data.result) {
      setActive(r.data.result.doc);
      setDraftContent(r.data.result.doc.content);
    }
  };

  const createDoc = async () => {
    if (!newTitle.trim()) { setError('Title is required'); return; }
    setSaving(true);
    setError(null);
    const r = await lensRun<{ doc: CanvasDoc }>('chat', 'canvas-create', {
      title: newTitle, kind: newKind, threadId: threadId || undefined,
      language: newKind === 'code' ? 'javascript' : undefined,
    });
    if (r.data?.ok && r.data.result) {
      setNewTitle('');
      setActive(r.data.result.doc);
      setDraftContent(r.data.result.doc.content);
      await refresh();
    } else {
      setError(r.data?.error || 'Create failed');
    }
    setSaving(false);
  };

  const saveDoc = async () => {
    if (!active) return;
    setSaving(true);
    setError(null);
    const r = await lensRun<{ doc: CanvasDoc }>('chat', 'canvas-update', {
      id: active.id, content: draftContent, editedBy: 'user',
    });
    if (r.data?.ok && r.data.result) {
      setActive(r.data.result.doc);
      await refresh();
    } else {
      setError(r.data?.error || 'Save failed');
    }
    setSaving(false);
  };

  const revert = async (revisionIndex: number) => {
    if (!active) return;
    const r = await lensRun<{ doc: CanvasDoc }>('chat', 'canvas-revert', { id: active.id, revisionIndex });
    if (r.data?.ok && r.data.result) {
      setActive(r.data.result.doc);
      setDraftContent(r.data.result.doc.content);
      await refresh();
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this canvas document?')) return;
    await lensRun('chat', 'canvas-delete', { id });
    if (active?.id === id) setActive(null);
    await refresh();
  };

  if (loading) return <TabLoading />;

  if (active) {
    const dirty = draftContent !== active.content;
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={() => setActive(null)} className="text-[11px] text-gray-400 hover:text-gray-200">
            ‹ All documents
          </button>
          <span className="text-[10px] text-gray-400">{draftContent.length} chars</span>
        </div>
        <p className="text-sm font-medium text-gray-100">{active.title}</p>
        <textarea
          value={draftContent}
          onChange={(e) => setDraftContent(e.target.value)}
          rows={14}
          className={cn(
            'w-full px-2 py-1.5 text-sm bg-black/40 border rounded text-gray-100 placeholder-gray-500 focus:outline-none resize-none',
            active.kind === 'code' ? 'font-mono text-[12px] border-emerald-500/30 focus:border-emerald-500/50' : 'border-cyan-500/20 focus:border-cyan-500/50',
          )}
          placeholder={active.kind === 'code' ? '// edit code here' : 'Write your document…'}
        />
        {error && <p className="text-[11px] text-rose-300">{error}</p>}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={saveDoc}
            disabled={saving || !dirty}
            className="inline-flex items-center gap-1 rounded-md border border-cyan-500/40 bg-cyan-500/15 px-3 py-1 text-xs text-cyan-100 hover:brightness-110 disabled:opacity-40"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            Save revision
          </button>
          {onInsert && (
            <button
              type="button"
              onClick={() => onInsert(`[Canvas: ${active.title}]\n\n${draftContent.slice(0, 4000)}`)}
              className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-black/30 px-3 py-1 text-xs text-gray-300 hover:text-gray-100"
            >
              <Copy className="w-3 h-3" /> Send to chat
            </button>
          )}
          <button
            type="button"
            onClick={() => remove(active.id)}
            className="inline-flex items-center gap-1 rounded-md border border-rose-500/20 px-3 py-1 text-xs text-rose-300 hover:bg-rose-500/10"
          >
            <Trash2 className="w-3 h-3" /> Delete
          </button>
        </div>
        {active.revisions.length > 0 && (
          <details className="mt-2">
            <summary className="text-[10px] uppercase tracking-wider text-gray-400 cursor-pointer hover:text-gray-400">
              {active.revisions.length} revision{active.revisions.length === 1 ? '' : 's'}
            </summary>
            <div className="mt-1.5 space-y-1">
              {active.revisions.map((rev, i) => (
                <div key={`${rev.savedAt}-${i}`} className="flex items-center justify-between gap-2 rounded border border-white/5 bg-black/10 px-2 py-1">
                  <span className="text-[10px] text-gray-400">
                    {rev.editedBy === 'ai' ? 'AI' : 'You'} · {fmtTime(rev.savedAt)} · {rev.content.length} chars
                  </span>
                  <button
                    type="button"
                    onClick={() => revert(i)}
                    className="inline-flex items-center gap-1 text-[10px] text-amber-300 hover:brightness-110"
                  >
                    <RotateCcw className="w-2.5 h-2.5" /> Restore
                  </button>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-cyan-500/20 bg-black/20 p-3 space-y-2">
        <input
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="New canvas title"
          maxLength={120}
          className="w-full px-2 py-1.5 text-sm bg-black/40 border border-white/10 rounded text-gray-100 placeholder-gray-500 focus:border-cyan-500/50 focus:outline-none"
        />
        <div className="flex items-center gap-2">
          <select
            value={newKind}
            onChange={(e) => setNewKind(e.target.value as 'document' | 'code')}
            className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 focus:border-cyan-500/50 focus:outline-none"
          >
            <option value="document">Document</option>
            <option value="code">Code</option>
          </select>
          <button
            type="button"
            onClick={createDoc}
            disabled={saving || !newTitle.trim()}
            className="inline-flex items-center gap-1 rounded-md border border-cyan-500/40 bg-cyan-500/15 px-3 py-1 text-xs text-cyan-100 hover:brightness-110 disabled:opacity-40"
          >
            <Plus className="w-3 h-3" /> Create
          </button>
        </div>
        {error && <p className="text-[11px] text-rose-300">{error}</p>}
      </div>
      {docs.length === 0 ? (
        <TabEmpty icon={FileCode} text="No canvas documents yet" sub="Co-edit a doc or code file side-by-side with the AI." />
      ) : (
        docs.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => openDoc(d.id)}
            className="w-full text-left rounded-md border border-cyan-500/15 bg-black/20 p-3 hover:bg-white/5 transition"
          >
            <div className="flex items-center gap-2">
              {d.kind === 'code' ? <FileCode className="w-3.5 h-3.5 text-emerald-400" /> : <FileCode className="w-3.5 h-3.5 text-cyan-400" />}
              <span className="text-sm text-gray-100 truncate">{d.title}</span>
            </div>
            <div className="mt-1 text-[10px] text-gray-400 flex items-center gap-2">
              <span>{d.kind}{d.language ? ` · ${d.language}` : ''}</span>
              <span>·</span>
              <span>{d.charCount} chars</span>
              <span>·</span>
              <span>{d.revisionCount} rev</span>
              <span>·</span>
              <span>{fmtTime(d.updatedAt)}</span>
            </div>
          </button>
        ))
      )}
    </div>
  );
}

// ── Memory tab ───────────────────────────────────────────────────────

function MemoryTab() {
  const [items, setItems] = useState<MemoryFact[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [category, setCategory] = useState<MemoryFact['category']>('fact');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<{ memories: MemoryFact[] }>('chat', 'memory-list', {});
    if (r.data?.ok && r.data.result) setItems(r.data.result.memories);
    setLoading(false);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const add = async () => {
    if (!draft.trim()) return;
    setSaving(true);
    setError(null);
    const r = await lensRun('chat', 'memory-add', { fact: draft, category });
    if (r.data?.ok) {
      setDraft('');
      await refresh();
    } else {
      setError(r.data?.error || 'Add failed');
    }
    setSaving(false);
  };

  const toggle = async (m: MemoryFact) => {
    await lensRun('chat', 'memory-update', { id: m.id, active: !m.active });
    await refresh();
  };
  const remove = async (id: string) => {
    await lensRun('chat', 'memory-delete', { id });
    await refresh();
  };
  const clearAll = async () => {
    if (!window.confirm('Forget every saved memory? This cannot be undone.')) return;
    await lensRun('chat', 'memory-delete', { id: '*' });
    await refresh();
  };

  if (loading) return <TabLoading />;

  const active = items.filter((m) => m.active).length;

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-amber-500/20 bg-black/20 p-3 space-y-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="A fact the AI should remember across every conversation"
          rows={2}
          maxLength={500}
          className="w-full px-2 py-1.5 text-sm bg-black/40 border border-white/10 rounded text-gray-100 placeholder-gray-500 focus:border-amber-500/50 focus:outline-none resize-none"
        />
        <div className="flex items-center gap-2">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as MemoryFact['category'])}
            className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 focus:border-amber-500/50 focus:outline-none"
          >
            <option value="fact">Fact</option>
            <option value="preference">Preference</option>
            <option value="context">Context</option>
            <option value="instruction">Instruction</option>
          </select>
          <button
            type="button"
            onClick={add}
            disabled={saving || !draft.trim()}
            className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/15 px-3 py-1 text-xs text-amber-100 hover:brightness-110 disabled:opacity-40"
          >
            <Plus className="w-3 h-3" /> Remember
          </button>
        </div>
        {error && <p className="text-[11px] text-rose-300">{error}</p>}
      </div>
      {items.length === 0 ? (
        <TabEmpty icon={Brain} text="No memories yet" sub="Saved facts are injected into every chat's system prompt." />
      ) : (
        <>
          <div className="flex items-center justify-between text-[10px] text-gray-400">
            <span>{active} of {items.length} active</span>
            <button type="button" onClick={clearAll} className="text-rose-400 hover:brightness-110">Forget all</button>
          </div>
          {items.map((m) => (
            <div key={m.id} className="rounded-md border border-amber-500/15 bg-black/20 p-2.5 group flex items-start gap-2">
              <input
                type="checkbox"
                checked={m.active}
                onChange={() => toggle(m)}
                className="mt-0.5 accent-amber-500"
                aria-label="Toggle memory active"
              />
              <div className="flex-1 min-w-0">
                <p className={cn('text-sm', m.active ? 'text-gray-100' : 'text-gray-400 line-through')}>{m.fact}</p>
                <div className="mt-1 flex items-center gap-2 text-[9px] text-gray-400">
                  <span className="uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300">{m.category}</span>
                  <span>{m.source === 'ai' ? 'AI-extracted' : 'You'}</span>
                  <span>·</span>
                  <span>{fmtTime(m.updatedAt)}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => remove(m.id)}
                className="p-1 text-gray-400 hover:text-rose-300 opacity-0 group-hover:opacity-100 transition"
                aria-label="Delete memory"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ── Code interpreter tab ─────────────────────────────────────────────

function CodeTab() {
  const [code, setCode] = useState('');
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState<CodeRun | null>(null);
  const [history, setHistory] = useState<CodeRun[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    const r = await lensRun<{ runs: CodeRun[] }>('chat', 'code-history', { limit: 20 });
    if (r.data?.ok && r.data.result) setHistory(r.data.result.runs);
  }, []);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  const run = async () => {
    if (!code.trim()) return;
    setRunning(true);
    setError(null);
    const r = await lensRun<{ run: CodeRun }>('chat', 'code-run', { code, language: 'javascript' });
    if (r.data?.ok && r.data.result) {
      setCurrent(r.data.result.run);
      await loadHistory();
    } else {
      setError(r.data?.error || 'Run failed');
    }
    setRunning(false);
  };

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-emerald-500/20 bg-black/20 p-3 space-y-2">
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="// JavaScript — sandboxed: no require/import/process/fetch&#10;// Use console.log() to print output.&#10;console.log(2 + 2);"
          rows={6}
          maxLength={20000}
          spellCheck={false}
          className="w-full px-2 py-1.5 font-mono text-[12px] bg-black/40 border border-white/10 rounded text-gray-100 placeholder-gray-500 focus:border-emerald-500/50 focus:outline-none resize-none"
        />
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={run}
            disabled={running || !code.trim()}
            className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-3 py-1 text-xs text-emerald-100 hover:brightness-110 disabled:opacity-40"
          >
            {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            Run
          </button>
          <span className="text-[10px] text-gray-400">1.5s wall budget · CPU only</span>
        </div>
        {error && <p className="text-[11px] text-rose-300">{error}</p>}
      </div>
      {current && <RunResult run={current} />}
      {history.length > 0 && (
        <details>
          <summary className="text-[10px] uppercase tracking-wider text-gray-400 cursor-pointer hover:text-gray-400 flex items-center gap-1">
            <History className="w-3 h-3" /> Run history ({history.length})
          </summary>
          <div className="mt-2 space-y-1.5">
            {history.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => { setCode(r.code); setCurrent(r); }}
                className="w-full text-left rounded border border-white/5 bg-black/10 px-2 py-1.5 hover:bg-white/5"
              >
                <p className="font-mono text-[11px] text-gray-400 truncate">{r.code.split('\n')[0]}</p>
                <span className={cn('text-[9px]', r.error ? 'text-rose-400' : 'text-emerald-400')}>
                  {r.error ? 'error' : 'ok'} · {r.durationMs}ms · {fmtTime(r.ranAt)}
                </span>
              </button>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function RunResult({ run }: { run: CodeRun }) {
  return (
    <div className={cn(
      'rounded-md border p-3 space-y-1.5',
      run.error ? 'border-rose-500/30 bg-rose-500/5' : 'border-emerald-500/20 bg-black/20',
    )}>
      <div className="flex items-center justify-between text-[10px] text-gray-400">
        <span>{run.error ? 'Errored' : 'Completed'} in {run.durationMs}ms{run.timedOut ? ' (timed out)' : ''}</span>
        <span>{fmtTime(run.ranAt)}</span>
      </div>
      {run.logs.length > 0 && (
        <pre className="font-mono text-[11px] text-gray-200 bg-black/40 rounded p-2 overflow-x-auto whitespace-pre-wrap">
          {run.logs.join('\n')}
        </pre>
      )}
      {run.returnValue !== null && (
        <div className="text-[11px]">
          <span className="text-gray-400">returns </span>
          <span className="font-mono text-cyan-300">{run.returnValue}</span>
        </div>
      )}
      {run.error && <p className="font-mono text-[11px] text-rose-300">{run.error}</p>}
      {run.logs.length === 0 && run.returnValue === null && !run.error && (
        <p className="text-[11px] text-gray-400">No output. Use console.log() to print.</p>
      )}
    </div>
  );
}

// ── Share links tab ──────────────────────────────────────────────────

function ShareTab({ threadId, messages }: { threadId?: string | null; messages?: StudioMessage[] }) {
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<{ links: ShareLink[] }>('chat', 'share-list', {});
    if (r.data?.ok && r.data.result) setLinks(r.data.result.links);
    setLoading(false);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const canShare = !!threadId && !!messages && messages.length > 0;

  const createLink = async () => {
    if (!canShare) return;
    setCreating(true);
    setError(null);
    const title = messages!.find((m) => m.role === 'user')?.content.slice(0, 80) || 'Shared conversation';
    const r = await lensRun('chat', 'share-create', {
      threadId,
      title,
      messages: messages!.map((m) => ({ role: m.role, content: m.content, timestamp: m.timestamp })),
    });
    if (r.data?.ok) await refresh();
    else setError(r.data?.error || 'Share failed');
    setCreating(false);
  };

  const revoke = async (token: string) => {
    if (!window.confirm('Revoke this share link? Anyone with the URL loses access.')) return;
    await lensRun('chat', 'share-revoke', { token });
    await refresh();
  };

  const copy = async (url: string) => {
    try {
      const full = typeof window !== 'undefined' ? `${window.location.origin}${url}` : url;
      await navigator.clipboard.writeText(full);
      setCopied(url);
      setTimeout(() => setCopied(null), 1500);
    } catch { /* clipboard unavailable */ }
  };

  if (loading) return <TabLoading />;

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={createLink}
        disabled={!canShare || creating}
        className="w-full inline-flex items-center justify-center gap-1 rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs text-sky-200 hover:brightness-110 disabled:opacity-40"
      >
        {creating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Share2 className="w-3 h-3" />}
        Share current conversation
      </button>
      {!canShare && (
        <p className="text-[10px] text-gray-400">
          Open a conversation with at least one message to create a public read-only link.
        </p>
      )}
      {error && <p className="text-[11px] text-rose-300">{error}</p>}
      {links.length === 0 ? (
        <TabEmpty icon={Share2} text="No share links yet" sub="Create a read-only snapshot anyone can open." />
      ) : (
        links.map((l) => (
          <div key={l.token} className={cn('rounded-md border bg-black/20 p-3 group', l.revoked ? 'border-white/5 opacity-60' : 'border-sky-500/20')}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm text-gray-100 truncate">{l.title}</p>
                <p className="text-[10px] text-gray-400 mt-0.5 truncate">{l.url}</p>
                <div className="mt-1 flex items-center gap-2 text-[9px] text-gray-400">
                  <span>{l.messageCount} msgs</span>
                  <span>·</span>
                  <span className="inline-flex items-center gap-0.5"><Eye className="w-2.5 h-2.5" /> {l.viewCount}</span>
                  <span>·</span>
                  <span>{fmtTime(l.createdAt)}</span>
                  {l.revoked && <span className="text-rose-400">· revoked</span>}
                </div>
              </div>
              <div className="flex items-center gap-1">
                {!l.revoked && (
                  <>
                    <button type="button" onClick={() => copy(l.url)} className="p-1 text-gray-400 hover:text-sky-300" aria-label="Copy share URL">
                      {copied === l.url ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    </button>
                    <button type="button" onClick={() => revoke(l.token)} className="p-1 text-gray-400 hover:text-rose-300" aria-label="Revoke share link">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ── Image generation tab ─────────────────────────────────────────────

function ImageTab({ onInsert }: { onInsert?: (t: string) => void }) {
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState<512 | 768 | 1024>(768);
  const [generating, setGenerating] = useState(false);
  const [images, setImages] = useState<GenImage[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await lensRun<{ images: GenImage[] }>('chat', 'image-history', { limit: 30 });
    if (r.data?.ok && r.data.result) setImages(r.data.result.images);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const generate = async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    setError(null);
    const r = await lensRun('chat', 'image-generate', { prompt, width: size, height: size });
    if (r.data?.ok) {
      setPrompt('');
      await refresh();
    } else {
      setError(r.data?.error || 'Generation failed');
    }
    setGenerating(false);
  };

  const remove = async (id: string) => {
    await lensRun('chat', 'image-delete', { id });
    await refresh();
  };

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-fuchsia-500/20 bg-black/20 p-3 space-y-2">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the image to generate"
          rows={2}
          maxLength={800}
          className="w-full px-2 py-1.5 text-sm bg-black/40 border border-white/10 rounded text-gray-100 placeholder-gray-500 focus:border-fuchsia-500/50 focus:outline-none resize-none"
        />
        <div className="flex items-center gap-2">
          <select
            value={size}
            onChange={(e) => setSize(Number(e.target.value) as 512 | 768 | 1024)}
            className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 focus:border-fuchsia-500/50 focus:outline-none"
          >
            <option value={512}>512 × 512</option>
            <option value={768}>768 × 768</option>
            <option value={1024}>1024 × 1024</option>
          </select>
          <button
            type="button"
            onClick={generate}
            disabled={generating || !prompt.trim()}
            className="inline-flex items-center gap-1 rounded-md border border-fuchsia-500/40 bg-fuchsia-500/15 px-3 py-1 text-xs text-fuchsia-100 hover:brightness-110 disabled:opacity-40"
          >
            {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <ImageIcon className="w-3 h-3" />}
            Generate
          </button>
        </div>
        {error && <p className="text-[11px] text-rose-300">{error}</p>}
      </div>
      {images.length === 0 ? (
        <TabEmpty icon={ImageIcon} text="No images yet" sub="Generate an image from a text prompt." />
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {images.map((img) => (
            <div key={img.id} className="rounded-md border border-fuchsia-500/15 bg-black/20 overflow-hidden group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.url}
                alt={img.prompt}
                loading="lazy"
                className="w-full aspect-square object-cover bg-black/40"
              />
              <div className="p-2">
                <p className="text-[10px] text-gray-300 line-clamp-2">{img.prompt}</p>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-[9px] text-gray-400">{img.width}×{img.height}</span>
                  <div className="flex items-center gap-1">
                    {onInsert && (
                      <button
                        type="button"
                        onClick={() => onInsert(`![${img.prompt}](${img.url})`)}
                        className="text-[9px] text-fuchsia-300 hover:brightness-110"
                      >
                        Insert
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => remove(img.id)}
                      className="text-gray-400 hover:text-rose-300"
                      aria-label="Delete image"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────

function TabLoading() {
  return (
    <div className="flex items-center justify-center py-10 text-xs text-gray-400">
      <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
    </div>
  );
}

function TabEmpty({ icon: Icon, text, sub }: { icon: typeof Mic; text: string; sub?: string }) {
  return (
    <div className="text-center py-10 px-4">
      <Icon className="w-8 h-8 mx-auto text-gray-600 mb-2" />
      <p className="text-xs text-gray-400">{text}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

function ToggleRow({ label, sub, checked, onChange }: { label: string; sub: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start justify-between gap-3 cursor-pointer">
      <div>
        <p className="text-sm text-gray-100">{label}</p>
        <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>
      </div>
      <button aria-label="Toggle"
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'mt-0.5 w-9 h-5 rounded-full transition-colors relative shrink-0',
          checked ? 'bg-cyan-500/70' : 'bg-white/10',
        )}
      >
        <span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all', checked ? 'left-4' : 'left-0.5')} />
      </button>
    </label>
  );
}

function RangeRow({ label, value, min, max, step, onCommit }: {
  label: string; value: number; min: number; max: number; step: number; onCommit: (v: number) => void;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-gray-400 flex justify-between">
        <span>{label}</span>
        <span className="text-cyan-300">{local.toFixed(2)}×</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={local}
        onChange={(e) => setLocal(Number(e.target.value))}
        onMouseUp={() => onCommit(local)}
        onTouchEnd={() => onCommit(local)}
        className="accent-cyan-500"
      />
    </label>
  );
}

// ── Main panel ───────────────────────────────────────────────────────

export function ChatStudioPanel({ open, onClose, initialTab, threadId, messages, onInsert, onActivateAssistant }: Props) {
  const [tab, setTab] = useState<StudioTab>(initialTab || 'voice');
  useEffect(() => { if (open && initialTab) setTab(initialTab); }, [open, initialTab]);

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-[460px] max-w-[100vw] z-40 bg-[#0d1117] border-l border-cyan-500/20 shadow-2xl overflow-hidden flex flex-col">
      <header className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-violet-950/40 to-transparent">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-violet-400" />
          <span className="text-sm font-semibold text-gray-200">Chat Studio</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-md hover:bg-white/5 text-gray-400"
          aria-label="Close chat studio"
        >
          <X className="w-4 h-4" />
        </button>
      </header>

      <nav className="flex items-center gap-0.5 px-2 py-1.5 border-b border-white/10 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] whitespace-nowrap transition-colors',
                tab === t.id
                  ? 'bg-violet-500/15 text-violet-200 border border-violet-500/30'
                  : 'text-gray-400 hover:text-gray-200 border border-transparent',
              )}
            >
              <Icon className="w-3 h-3" /> {t.label}
            </button>
          );
        })}
      </nav>

      <div className="flex-1 overflow-y-auto p-3">
        {tab === 'voice' && <VoiceTab />}
        {tab === 'gpts' && <GptsTab onActivate={onActivateAssistant} />}
        {tab === 'canvas' && <CanvasTab threadId={threadId} onInsert={onInsert} />}
        {tab === 'memory' && <MemoryTab />}
        {tab === 'code' && <CodeTab />}
        {tab === 'share' && <ShareTab threadId={threadId} messages={messages} />}
        {tab === 'image' && <ImageTab onInsert={onInsert} />}
      </div>
    </div>
  );
}

export default ChatStudioPanel;
