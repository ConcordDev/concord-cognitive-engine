'use client';

import { useEffect, useState } from 'react';
import { FileSearch, Loader2, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api/client';

interface SmartPhrase { id: string; name: string; text: string; createdAt: string }

export function SmartPhrasesPanel() {
  const [list, setList] = useState<SmartPhrase[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: '', text: '' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const r = await api.post('/api/lens/run', { domain: 'healthcare', action: 'smartphrases-list', input: {} });
      setList((r.data?.result?.smartPhrases || []) as SmartPhrase[]);
    } catch (e) { console.error('[SmartPhrases] failed', e); }
    finally { setLoading(false); }
  }

  async function create() {
    if (!draft.name.trim() || !draft.text.trim()) return;
    try {
      await api.post('/api/lens/run', { domain: 'healthcare', action: 'smartphrases-create', input: draft });
      setDraft({ name: '', text: '' });
      setCreating(false);
      await refresh();
    } catch (e) { console.error('[SmartPhrases] create', e); }
  }

  async function remove(id: string) {
    if (!confirm('Delete this SmartPhrase?')) return;
    try {
      await api.post('/api/lens/run', { domain: 'healthcare', action: 'smartphrases-delete', input: { id } });
      await refresh();
    } catch (e) { console.error('[SmartPhrases] remove', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <FileSearch className="w-4 h-4 text-cyan-400" />
        <span className="text-sm font-semibold text-gray-200">SmartPhrases</span>
        <span className="text-[10px] text-gray-500">{list.length}</span>
        <button onClick={() => setCreating(v => !v)} className="ml-auto px-2.5 py-1 text-xs rounded bg-cyan-500 text-black font-semibold hover:bg-cyan-400 inline-flex items-center gap-1">
          <Plus className="w-3 h-3" />New
        </button>
      </header>

      {creating && (
        <div className="p-3 grid grid-cols-12 gap-2 border-b border-white/10">
          <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Trigger name (e.g. .pneumonia) *" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <textarea value={draft.text} onChange={e => setDraft({ ...draft, text: e.target.value })} placeholder="Expanded text" rows={3} className="col-span-9 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <button onClick={create} className="col-span-12 px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">Save SmartPhrase</button>
        </div>
      )}

      <div className="max-h-[32rem] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : list.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500"><FileSearch className="w-6 h-6 mx-auto mb-2 opacity-30" />No SmartPhrases.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {list.map(sp => (
              <li key={sp.id} className="px-4 py-2.5 hover:bg-white/[0.02] group">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono text-cyan-300 font-semibold">{sp.name}</span>
                  <button onClick={() => remove(sp.id)} className="ml-auto opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-rose-500/20 text-rose-300" title="Delete">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
                <pre className="mt-1 px-2 py-1.5 bg-black/30 border border-white/10 rounded text-[11px] text-gray-300 font-mono whitespace-pre-wrap">{sp.text}</pre>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default SmartPhrasesPanel;
