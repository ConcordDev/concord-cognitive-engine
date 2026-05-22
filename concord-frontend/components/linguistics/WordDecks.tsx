'use client';

/**
 * WordDecks — themed vocabulary packs (SAT, GRE, domain glossaries).
 * Create a deck, bulk-import a list of real words (definitions are
 * auto-fetched from the Free Dictionary API), and track per-deck
 * mastery. Wires the linguistics.deck-* macros. No seeded packs — the
 * user supplies every word.
 */

import { useCallback, useEffect, useState } from 'react';
import { Library, Plus, Trash2, Upload, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Deck {
  id: string;
  name: string;
  description: string;
  theme: string;
  wordCount: number;
  mastered: number;
}

export function WordDecks({ onImported }: { onImported?: () => void }) {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', theme: 'general' });
  const [importDeck, setImportDeck] = useState<string | null>(null);
  const [importText, setImportText] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await lensRun<{ decks: Deck[] }>('linguistics', 'deck-list', {});
    setDecks((r.data?.result?.decks) || []);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const createDeck = useCallback(async () => {
    if (!form.name.trim()) return;
    const r = await lensRun('linguistics', 'deck-create', {
      name: form.name.trim(),
      description: form.description.trim(),
      theme: form.theme.trim() || 'general',
    });
    if (r.data?.ok) {
      setForm({ name: '', description: '', theme: 'general' });
      setCreating(false);
      await refresh();
    }
  }, [form, refresh]);

  const deleteDeck = useCallback(async (id: string) => {
    await lensRun('linguistics', 'deck-delete', { id });
    await refresh();
  }, [refresh]);

  const runImport = useCallback(async () => {
    if (!importDeck) return;
    const words = importText
      .split(/[\n,]+/)
      .map((w) => w.trim())
      .filter(Boolean);
    if (words.length === 0) { setImportMsg('Enter at least one word.'); return; }
    setImportBusy(true);
    setImportMsg(null);
    const r = await lensRun<{ addedCount: number; skippedCount: number }>(
      'linguistics',
      'deck-import',
      { deckId: importDeck, words },
    );
    setImportBusy(false);
    if (r.data?.ok && r.data.result) {
      setImportMsg(`Added ${r.data.result.addedCount} word(s), ${r.data.result.skippedCount} skipped (already saved).`);
      setImportText('');
      await refresh();
      onImported?.();
    } else {
      setImportMsg(r.data?.error || 'Import failed.');
    }
  }, [importDeck, importText, refresh, onImported]);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Library className="w-4 h-4 text-cyan-400" />
        <h3 className="text-sm font-bold text-zinc-100">Word Decks</h3>
        <button
          onClick={() => setCreating(!creating)}
          className="ml-auto px-2.5 py-1 text-xs rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white inline-flex items-center gap-1"
        >
          <Plus className="w-3 h-3" />New deck
        </button>
      </div>

      {creating && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 mb-3 space-y-1.5">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Deck name (e.g. GRE High-Frequency)"
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200"
          />
          <div className="flex gap-1.5">
            <input
              value={form.theme}
              onChange={(e) => setForm({ ...form, theme: e.target.value })}
              placeholder="theme"
              className="w-28 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200"
            />
            <input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Description (optional)"
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200"
            />
            <button
              onClick={createDeck}
              disabled={!form.name.trim()}
              className="px-2.5 py-1 text-xs rounded bg-cyan-600 hover:bg-cyan-500 text-white font-semibold disabled:opacity-40"
            >
              Create
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-4 text-zinc-500">
          <Loader2 className="w-4 h-4 animate-spin" />
        </div>
      ) : decks.length === 0 ? (
        <p className="text-xs text-zinc-500 italic">No decks yet — create one to organise themed vocabulary.</p>
      ) : (
        <ul className="space-y-1.5">
          {decks.map((d) => (
            <li key={d.id} className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-zinc-100 truncate">{d.name}</p>
                  {d.description && <p className="text-[10px] text-zinc-500 truncate">{d.description}</p>}
                </div>
                <span className="text-[10px] text-cyan-300 bg-cyan-900/30 border border-cyan-800/40 rounded px-1.5 py-0.5 shrink-0">
                  {d.theme}
                </span>
                <span className="text-[10px] text-zinc-400 shrink-0">
                  {d.mastered}/{d.wordCount} mastered
                </span>
                <button
                  onClick={() => { setImportDeck(importDeck === d.id ? null : d.id); setImportMsg(null); }}
                  className="text-cyan-400 hover:text-cyan-300 shrink-0"
                  title="Import words"
                >
                  <Upload className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => deleteDeck(d.id)}
                  className="text-rose-400 hover:text-rose-300 shrink-0"
                  title="Delete deck"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              {d.wordCount > 0 && (
                <div className="mt-1.5 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-cyan-500 rounded-full"
                    style={{ width: `${Math.round((d.mastered / d.wordCount) * 100)}%` }}
                  />
                </div>
              )}
              {importDeck === d.id && (
                <div className="mt-2 pt-2 border-t border-zinc-800 space-y-1.5">
                  <textarea
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    placeholder="Paste words, one per line or comma-separated. Definitions are fetched automatically."
                    className="w-full h-20 resize-none bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={runImport}
                      disabled={importBusy || !importText.trim()}
                      className={cn(
                        'px-2.5 py-1 text-xs rounded bg-cyan-600 hover:bg-cyan-500 text-white font-semibold disabled:opacity-40 inline-flex items-center gap-1',
                      )}
                    >
                      {importBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                      Import to deck
                    </button>
                    {importMsg && <span className="text-[10px] text-zinc-400">{importMsg}</span>}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
