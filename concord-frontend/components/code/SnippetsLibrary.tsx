'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Sparkles, Trash2, Search, Loader2, Copy, ChevronDown, ChevronRight } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface Snippet {
  id: string;
  title: string;
  language: string;
  code: string;
  tags?: string[];
  createdAt?: string;
}

interface SnippetsLibraryProps {
  onInsert: (code: string) => void;
  onClose?: () => void;
  currentLanguage?: string;
  currentSelection?: string;
}

export function SnippetsLibrary({ onInsert, currentLanguage, currentSelection }: SnippetsLibraryProps) {
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newLanguage, setNewLanguage] = useState(currentLanguage || 'javascript');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (currentSelection) setNewCode(currentSelection);
  }, [currentSelection]);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({
        domain: 'code',
        action: 'snippets-list',
        input: { language: undefined, limit: 100 },
      });
      const items = (res.data?.result?.snippets || []) as Snippet[];
      setSnippets(items);
    } catch (e) {
      console.error('[Snippets] list failed', e);
    } finally {
      setLoading(false);
    }
  }

  async function saveSnippet() {
    if (!newTitle.trim() || !newCode.trim()) return;
    setSaving(true);
    try {
      await lensRun({
        domain: 'code',
        action: 'snippets-save',
        input: {
          title: newTitle.trim(),
          code: newCode,
          language: newLanguage,
        },
      });
      setNewTitle('');
      setNewCode('');
      setCreating(false);
      await refresh();
    } catch (e) {
      console.error('[Snippets] save failed', e);
    } finally {
      setSaving(false);
    }
  }

  async function deleteSnippet(id: string) {
    if (!confirm('Delete snippet?')) return;
    try {
      await lensRun({
        domain: 'code',
        action: 'snippets-delete',
        input: { id },
      });
      setSnippets(prev => prev.filter(s => s.id !== id));
    } catch (e) {
      console.error('[Snippets] delete failed', e);
    }
  }

  const filtered = useMemo(() => {
    if (!query.trim()) return snippets;
    const q = query.toLowerCase();
    return snippets.filter(s =>
      s.title.toLowerCase().includes(q) ||
      s.language.toLowerCase().includes(q) ||
      s.code.toLowerCase().includes(q)
    );
  }, [snippets, query]);

  function toggle(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col h-full bg-[#0d1117]">
      <header className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Snippets</span>
        <span className="ml-auto text-[10px] text-gray-500">{snippets.length}</span>
        <button
          onClick={() => { setCreating(v => !v); if (currentSelection) setNewCode(currentSelection); }}
          title="New snippet"
          className="p-1 rounded text-gray-400 hover:text-white hover:bg-white/10"
        >
          <Plus className="w-4 h-4" />
        </button>
      </header>

      {creating && (
        <div className="p-3 border-b border-white/10 space-y-2 bg-white/[0.02]">
          <input
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            placeholder="Snippet title…"
            className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
          />
          <div className="flex items-center gap-2">
            <select
              value={newLanguage}
              onChange={e => setNewLanguage(e.target.value)}
              className="px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
            >
              {['javascript', 'typescript', 'python', 'rust', 'go', 'ruby', 'shell', 'sql', 'html', 'css', 'json', 'yaml', 'markdown'].map(l => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
            <span className="text-[10px] text-gray-500">{newCode.split('\n').length} lines</span>
          </div>
          <textarea
            value={newCode}
            onChange={e => setNewCode(e.target.value)}
            placeholder="// Paste or type code…"
            rows={5}
            className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono resize-y"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={saveSnippet}
              disabled={saving || !newTitle.trim() || !newCode.trim()}
              className="px-3 py-1 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save snippet'}
            </button>
            <button
              onClick={() => { setCreating(false); setNewTitle(''); setNewCode(''); }}
              className="px-3 py-1 text-xs rounded border border-white/10 text-gray-400 hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="px-2 py-2 border-b border-white/5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Filter snippets…"
            className="w-full pl-7 pr-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-xs text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500">
            {snippets.length === 0 ? (
              <>
                <p>No snippets yet.</p>
                <p className="mt-1 text-gray-600">Select code → Save as Snippet.</p>
              </>
            ) : (
              'No matches.'
            )}
          </div>
        ) : (
          <ul className="py-1">
            {filtered.map(s => {
              const isOpen = expanded.has(s.id);
              return (
                <li key={s.id} className="border-b border-white/5">
                  <div className="px-3 py-2 hover:bg-white/[0.03] group">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggle(s.id)}
                        className="text-gray-500 hover:text-white"
                        aria-label={isOpen ? 'Collapse' : 'Expand'}
                      >
                        {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                      </button>
                      <button
                        onClick={() => onInsert(s.code)}
                        className="flex-1 text-left text-xs text-white truncate hover:text-cyan-300"
                        title="Insert at cursor"
                      >
                        {s.title}
                      </button>
                      <span className="text-[9px] text-gray-500 font-mono uppercase">{s.language}</span>
                      <button
                        onClick={() => navigator.clipboard?.writeText(s.code)}
                        title="Copy"
                        className="opacity-0 group-hover:opacity-100 p-1 text-gray-500 hover:text-white"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => deleteSnippet(s.id)}
                        title="Delete"
                        className="opacity-0 group-hover:opacity-100 p-1 text-gray-500 hover:text-red-400"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                    {isOpen && (
                      <pre className="mt-2 ml-5 text-[11px] text-gray-300 font-mono bg-lattice-deep border border-lattice-border rounded p-2 max-h-40 overflow-auto whitespace-pre">
                        {s.code}
                      </pre>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default SnippetsLibrary;

export interface SnippetItem extends Snippet {
  // exposed for outer command palette integration
  _kind: 'snippet';
}

export function snippetCommandLabel(s: Snippet): string {
  return cn('Insert:', s.title, '·', s.language);
}
