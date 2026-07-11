'use client';

/**
 * RfEntryDetailModal — open a single journal entry to read it in full,
 * edit it in place, and run the two AI reflection actions the backend
 * already supports but the frontend never surfaced:
 *
 *   - `entry-detail`    — fetch the full entry (not the 48-char preview
 *                         the list view truncates to)
 *   - `entry-update`    — edit title / body / mood / tags in place
 *   - `entry-summarize` — one/two-sentence summary, deterministic-first
 *                         with an optional brain composer
 *   - `reflect-deepen`  — three grounded follow-up questions, same
 *                         deterministic-first/brain-composer contract
 *
 * Media/place/encryption editing already lives in Journal Studio's
 * Compose → entry picker → EntryEnrichPanel; this modal is the read/edit/
 * reflect surface, not a duplicate of that enrichment flow. An encrypted
 * entry is shown locked with a pointer to Studio (its plaintext body
 * literally isn't available here — `entry-detail` returns "[encrypted]").
 */

import { useCallback, useEffect, useState } from 'react';
import {
  X, Loader2, Save, Sparkles, MessageCircleQuestion, Lock, MapPin,
  CloudSun, Image as ImageIcon, Mic, AlertTriangle, Check,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface RfMedia { id: string; type: string; caption: string | null }
interface RfEntryFull {
  id: string; journalId: string | null; text: string; title: string | null;
  mood: string | null; tags: string[]; location: string | null; weather: string | null;
  photoCount: number; date: string; at: string; updatedAt: string; wordCount: number;
  media?: RfMedia[]; geo?: { lat: number; lon: number }; temperatureC?: number;
  encrypted?: boolean; kind?: string; durationSec?: number;
}

const MOODS = ['great', 'good', 'okay', 'low', 'rough'] as const;

async function rf<T>(macro: string, params: Record<string, unknown>) {
  const r = await lensRun<T>('reflection', macro, params);
  return r.data;
}

export function RfEntryDetailModal({
  entryId, onClose, onChange,
}: { entryId: string; onClose: () => void; onChange: () => void }) {
  const [entry, setEntry] = useState<RfEntryFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [mood, setMood] = useState<string>('');
  const [tagsInput, setTagsInput] = useState('');

  const [summary, setSummary] = useState<{ text: string; composer: string } | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [questions, setQuestions] = useState<{ list: string[]; composer: string } | null>(null);
  const [deepening, setDeepening] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await rf<{ entry: RfEntryFull }>('entry-detail', { id: entryId });
    if (r?.ok && r.result) {
      const e = r.result.entry;
      setEntry(e);
      setTitle(e.title || '');
      setText(e.encrypted ? '' : e.text);
      setMood(e.mood || '');
      setTagsInput(e.tags.join(', '));
      setDirty(false);
    } else {
      setError(r?.error || 'Entry not found.');
    }
    setLoading(false);
  }, [entryId]);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!entry) return;
    setSaving(true);
    const tags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean);
    const r = await rf<{ entry: RfEntryFull }>('entry-update', {
      id: entry.id, title: title.trim(), text, mood: mood || null, tags,
    });
    setSaving(false);
    if (r?.ok && r.result) {
      setEntry(r.result.entry);
      setDirty(false);
      onChange();
    } else {
      setError(r?.error || 'Save failed.');
    }
  }

  async function runSummarize() {
    if (!entry) return;
    setSummarizing(true);
    const r = await rf<{ summary: string; composer: string }>('entry-summarize', { id: entry.id });
    setSummarizing(false);
    if (r?.ok && r.result) setSummary({ text: r.result.summary, composer: r.result.composer });
    else setError(r?.error || 'Summarize failed.');
  }

  async function runDeepen() {
    if (!entry) return;
    setDeepening(true);
    const r = await rf<{ questions: string[]; composer: string }>('reflect-deepen', { id: entry.id });
    setDeepening(false);
    if (r?.ok && r.result) setQuestions({ list: r.result.questions, composer: r.result.composer });
    else setError(r?.error || 'Reflect deeper failed.');
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 pt-10"
      role="dialog" aria-modal="true" aria-label="Entry detail"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3">
          <span className="text-sm font-semibold text-zinc-100">
            {loading ? 'Loading entry…' : entry ? entry.date : 'Entry'}
          </span>
          {entry?.encrypted && <Lock className="h-3.5 w-3.5 text-rose-400" />}
          {dirty && !entry?.encrypted && (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">unsaved</span>
          )}
          <button
            type="button" onClick={onClose} aria-label="Close"
            className="ml-auto rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="max-h-[75vh] space-y-4 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : !entry ? (
            <p className="text-sm text-rose-400">{error || 'Entry not found.'}</p>
          ) : entry.encrypted ? (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-4 text-center text-[12px] text-rose-200">
              <Lock className="mx-auto mb-2 h-5 w-5" />
              This entry is encrypted at rest and can&apos;t be read or edited here.
              Decrypt it from Journal → Studio → Compose (select this entry, enter its key) first.
            </div>
          ) : (
            <>
              {error && (
                <div className="flex items-start gap-2 rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {error}
                </div>
              )}

              {/* Meta strip */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-zinc-400">
                <span>{entry.wordCount} words</span>
                {entry.location && <span className="flex items-center gap-0.5"><MapPin className="h-3 w-3" />{entry.location}</span>}
                {entry.weather && <span className="flex items-center gap-0.5"><CloudSun className="h-3 w-3" />{entry.weather}{entry.temperatureC != null ? ` ${entry.temperatureC}°C` : ''}</span>}
                {(entry.media?.length ?? entry.photoCount) > 0 && (
                  <span className="flex items-center gap-0.5"><ImageIcon className="h-3 w-3" />{entry.media?.length ?? entry.photoCount} attachment{(entry.media?.length ?? entry.photoCount) > 1 ? 's' : ''}</span>
                )}
                {entry.kind === 'voice' && <span className="flex items-center gap-0.5"><Mic className="h-3 w-3" />voice entry</span>}
                {entry.updatedAt !== entry.at && <span>edited {new Date(entry.updatedAt).toLocaleString()}</span>}
              </div>

              {/* Editable fields */}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <input
                  value={title}
                  onChange={(e) => { setTitle(e.target.value); setDirty(true); }}
                  placeholder="Title (optional)"
                  className="sm:col-span-2 rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
                />
                <select
                  value={mood}
                  onChange={(e) => { setMood(e.target.value); setDirty(true); }}
                  className="rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm text-white"
                >
                  <option value="">Mood…</option>
                  {MOODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <textarea
                value={text}
                onChange={(e) => { setText(e.target.value); setDirty(true); }}
                rows={10}
                className="w-full resize-y rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm leading-relaxed text-white focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
              />
              <input
                value={tagsInput}
                onChange={(e) => { setTagsInput(e.target.value); setDirty(true); }}
                placeholder="Tags (comma-separated)"
                className="w-full rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-[12px] text-white"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button" onClick={save} disabled={!dirty || saving || !text.trim()}
                  className="flex items-center gap-1.5 rounded bg-indigo-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save changes
                </button>
                {!dirty && !saving && entry && (
                  <span className="flex items-center gap-1 text-[11px] text-zinc-500"><Check className="h-3 w-3" /> up to date</span>
                )}
              </div>

              {/* AI reflection actions */}
              <div className="grid grid-cols-1 gap-3 border-t border-zinc-800 pt-3 sm:grid-cols-2">
                <section className="space-y-1.5 rounded-lg border border-yellow-500/20 bg-zinc-900/60 p-3">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-yellow-200">
                      <Sparkles className="h-3.5 w-3.5" /> Summarize
                    </span>
                    <button
                      type="button" onClick={runSummarize} disabled={summarizing}
                      className="rounded border border-yellow-700/40 px-2 py-1 text-[10px] text-yellow-200 hover:bg-yellow-900/30 disabled:opacity-50"
                    >
                      {summarizing ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Summarize entry'}
                    </button>
                  </div>
                  {summary && (
                    <p className="text-[11px] text-zinc-300">
                      {summary.text}
                      <span className="ml-1 text-zinc-500">({summary.composer})</span>
                    </p>
                  )}
                </section>
                <section className="space-y-1.5 rounded-lg border border-cyan-500/20 bg-zinc-900/60 p-3">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-cyan-200">
                      <MessageCircleQuestion className="h-3.5 w-3.5" /> Go deeper
                    </span>
                    <button
                      type="button" onClick={runDeepen} disabled={deepening}
                      className="rounded border border-cyan-700/40 px-2 py-1 text-[10px] text-cyan-200 hover:bg-cyan-900/30 disabled:opacity-50"
                    >
                      {deepening ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Ask follow-ups'}
                    </button>
                  </div>
                  {questions && (
                    <ul className="space-y-1 text-[11px] text-zinc-300">
                      {questions.list.map((q, i) => <li key={i}>• {q}</li>)}
                      <li className="text-zinc-500">({questions.composer})</li>
                    </ul>
                  )}
                </section>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
