'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * ReflectionPrompts — structured after-action review. Pulls the prompt set
 * from `reflectionPrompts`, lets the user answer each, saves via
 * `reflectionSave`, and lists past reflections via `reflectionList`.
 * Every value rendered comes from a metacognition macro.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Lightbulb, Save, Loader2, ChevronDown, ChevronUp, MessageSquareText, Flame,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { activateOnEnterOrSpace } from '@/lib/a11y/editable-target';

interface Prompt { id: string; question: string }
interface SavedAnswer { question: string; answer: string }
interface Reflection {
  id: string;
  decisionId: string | null;
  title: string;
  answers: SavedAnswer[];
  note: string;
  createdAt: string;
}
interface Streak { current: number; longest: number; totalDays: number }

function fmtDate(ts: string): string {
  const d = new Date(ts);
  return isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function ReflectionPrompts({ decisionId }: { decisionId?: string }) {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [reflections, setReflections] = useState<Reflection[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streak, setStreak] = useState<Streak | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  // FIX-metacognition-001: reflections were permanent — no edit or delete
  // control anywhere. Edit loads a saved reflection into the form and
  // saves it back in place (reflectionSave with its id); Delete is a
  // two-step confirm calling reflectionDelete.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [pRes, lRes] = await Promise.all([
      lensRun('metacognition', 'reflectionPrompts', decisionId ? { decisionId } : {}),
      lensRun('metacognition', 'reflectionList', {}),
    ]);
    if (pRes.data.ok && pRes.data.result) {
      setPrompts(((pRes.data.result as any).prompts as Prompt[]) || []);
    } else {
      setError(pRes.data.error || 'Failed to load prompts');
    }
    if (lRes.data.ok && lRes.data.result) {
      setReflections(((lRes.data.result as any).reflections as Reflection[]) || []);
    }
    setLoading(false);
  }, [decisionId]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    const answerList = prompts
      .map((p) => ({ question: p.question, answer: (answers[p.id] || '').trim() }))
      .filter((a) => a.answer);
    if (answerList.length === 0 && !note.trim()) {
      setError('Answer at least one prompt or add a note.');
      return;
    }
    setSaving(true);
    setError(null);
    const res = await lensRun('metacognition', 'reflectionSave', {
      decisionId, title: title.trim() || undefined, answers: answerList, note: note.trim() || undefined,
      ...(editingId ? { id: editingId } : {}),
    });
    setSaving(false);
    if (res.data.ok) {
      const r = res.data.result as any;
      if (r?.streak) setStreak(r.streak as Streak);
      setAnswers({}); setNote(''); setTitle(''); setEditingId(null);
      load();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('metacognition:record-changed'));
      }
    } else {
      setError(res.data.error || 'Failed to save reflection');
    }
  };

  const startEdit = (r: Reflection) => {
    const byQuestion = new Map(r.answers.map((a) => [a.question, a.answer]));
    const next: Record<string, string> = {};
    for (const p of prompts) {
      const saved = byQuestion.get(p.question);
      if (saved) next[p.id] = saved;
    }
    setAnswers(next);
    setNote(r.note || '');
    setTitle(r.title || '');
    setEditingId(r.id);
    setExpanded(null);
    setError(null);
  };

  const remove = async (id: string) => {
    const res = await lensRun('metacognition', 'reflectionDelete', { id });
    setConfirmingDelete(null);
    if (res.data.ok) {
      if (editingId === id) { setEditingId(null); setAnswers({}); setNote(''); setTitle(''); }
      load();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('metacognition:record-changed'));
      }
    } else {
      setError(res.data.error || 'Failed to delete reflection');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-400 gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading reflection prompts...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3">{error}</div>
      )}

      <div className="panel p-4 space-y-3">
        <h3 className="font-semibold flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-neon-yellow" /> After-Action Review
        </h3>
        <p className="text-xs text-gray-400">
          Answer the structured prompts to turn a decision into a lesson. Saving counts toward your reflection streak.
        </p>
        <input
          aria-label="Reflection title"
          className="input-lattice w-full"
          placeholder="Reflection title (optional)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="space-y-3">
          {prompts.map((p) => (
            <div key={p.id}>
              <label className="text-sm text-gray-300 block mb-1">{p.question}</label>
              <textarea
                aria-label={p.question}
                className="input-lattice w-full"
                rows={2}
                placeholder="Your answer..."
                value={answers[p.id] || ''}
                onChange={(e) => setAnswers((a) => ({ ...a, [p.id]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        <div>
          <label className="text-sm text-gray-300 block mb-1">Free-form note</label>
          <textarea
            aria-label="Free-form note"
            className="input-lattice w-full"
            rows={2}
            placeholder="Anything else worth recording..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="btn-neon purple w-full flex items-center justify-center gap-2"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Save Reflection'}
        </button>
        {editingId && (
          <button
            onClick={() => { setEditingId(null); setAnswers({}); setNote(''); setTitle(''); }}
            className="w-full text-xs text-gray-400 hover:text-gray-200 py-1"
          >
            Cancel edit — write a new reflection instead
          </button>
        )}
        {streak && (
          <div className="flex items-center gap-2 text-xs text-neon-yellow">
            <Flame className="w-3.5 h-3.5" />
            Streak updated — {streak.current}-day current, {streak.longest}-day longest
          </div>
        )}
      </div>

      <div className="panel p-4">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <MessageSquareText className="w-4 h-4 text-neon-cyan" /> Past Reflections
          {reflections.length > 0 && (
            <span className="ml-auto text-xs bg-neon-cyan/10 text-neon-cyan px-2 py-0.5 rounded-full">
              {reflections.length}
            </span>
          )}
        </h3>
        {reflections.length === 0 ? (
          <p className="text-center py-8 text-gray-400 text-sm">
            No reflections saved yet. Answer the prompts above to record your first one.
          </p>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {reflections.map((r) => {
              const isExp = expanded === r.id;
              return (
                <div key={r.id} className="lens-card">
                  <div
                    className="flex items-center gap-2 cursor-pointer"
                    onClick={() => setExpanded(isExp ? null : r.id)} role="button" tabIndex={0} onKeyDown={activateOnEnterOrSpace}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{r.title}</p>
                      <p className="text-xs text-gray-400">
                        {r.answers.length} answer{r.answers.length !== 1 ? 's' : ''} · {fmtDate(r.createdAt)}
                      </p>
                    </div>
                    {isExp ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                  </div>
                  {isExp && (
                    <div className="mt-3 pt-3 border-t border-gray-700/30 space-y-2 text-xs">
                      {r.answers.map((a, i) => (
                        <div key={i}>
                          <p className="text-gray-400">{a.question}</p>
                          <p className="text-gray-300">{a.answer}</p>
                        </div>
                      ))}
                      {r.note && (
                        <p className="text-gray-400"><span className="text-gray-400">Note:</span> {r.note}</p>
                      )}
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          onClick={() => startEdit(r)}
                          className="px-2 py-1 rounded bg-zinc-700/40 text-zinc-200 hover:bg-zinc-700/70"
                          aria-label={`Edit reflection ${r.title}`}
                        >
                          Edit
                        </button>
                        {confirmingDelete === r.id ? (
                          <>
                            <button
                              onClick={() => void remove(r.id)}
                              className="px-2 py-1 rounded bg-rose-600/30 text-rose-200 hover:bg-rose-600/50"
                              aria-label={`Confirm delete reflection ${r.title}`}
                            >
                              Delete?
                            </button>
                            <button
                              onClick={() => setConfirmingDelete(null)}
                              className="px-2 py-1 rounded bg-zinc-700/40 text-zinc-300"
                              aria-label={`Keep reflection ${r.title}`}
                            >
                              Keep
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setConfirmingDelete(r.id)}
                            className="px-2 py-1 rounded text-rose-300 hover:bg-rose-600/20"
                            aria-label={`Delete reflection ${r.title}`}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
