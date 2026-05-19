'use client';

import { useEffect, useState } from 'react';
import { FolderTree, Plus, Trash2, Loader2 } from 'lucide-react';
import { api } from '@/lib/api/client';

interface Collection { id: string; name: string; description: string; productSkus: string[]; kind: string }

export function CollectionsPanel() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', description: '' });
  const [skuInput, setSkuInput] = useState<Record<string, string>>({});

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await api.post('/api/lens/run', { domain: 'retail', action: 'collections-list', input: {} });
      setCollections((res.data?.result?.collections || []) as Collection[]);
    } catch (e) { console.error('[Collections] list failed', e); }
    finally { setLoading(false); }
  }

  async function create() {
    if (!form.name.trim()) return;
    try {
      await api.post('/api/lens/run', { domain: 'retail', action: 'collections-create', input: form });
      setForm({ name: '', description: '' });
      await refresh();
    } catch (e) { console.error('[Collections] create failed', e); }
  }

  async function addSku(collectionId: string) {
    const sku = (skuInput[collectionId] || '').trim().toUpperCase();
    if (!sku) return;
    try {
      await api.post('/api/lens/run', { domain: 'retail', action: 'collections-add-product', input: { id: collectionId, sku } });
      setSkuInput({ ...skuInput, [collectionId]: '' });
      await refresh();
    } catch (e) { console.error('[Collections] add-product failed', e); }
  }

  async function remove(id: string) {
    try {
      await api.post('/api/lens/run', { domain: 'retail', action: 'collections-delete', input: { id } });
      setCollections(prev => prev.filter(c => c.id !== id));
    } catch (e) { console.error('[Collections] delete failed', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-emerald-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <FolderTree className="w-4 h-4 text-emerald-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Collections</span>
        <span className="ml-auto text-[10px] text-gray-500">{collections.length}</span>
      </header>

      <div className="p-3 border-b border-white/10 grid grid-cols-4 gap-2">
        <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Collection name" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Description" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={create} className="px-3 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Create</button>
      </div>

      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : collections.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500"><FolderTree className="w-6 h-6 mx-auto mb-2 opacity-30" />No collections yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {collections.map(c => (
              <li key={c.id} className="px-3 py-2 hover:bg-white/[0.03] group">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm text-white font-medium flex-1 truncate">{c.name}</span>
                  <span className="text-[10px] text-gray-500">{c.productSkus.length} products</span>
                  <button onClick={() => remove(c.id)} className="opacity-0 group-hover:opacity-100 p-1 text-gray-500 hover:text-rose-400"><Trash2 className="w-3 h-3" /></button>
                </div>
                {c.description && <p className="text-[11px] text-gray-500 mb-1">{c.description}</p>}
                <div className="flex flex-wrap items-center gap-1">
                  {c.productSkus.map(sku => (
                    <span key={sku} className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-cyan-500/15 text-cyan-300">{sku}</span>
                  ))}
                  <input
                    value={skuInput[c.id] || ''}
                    onChange={e => setSkuInput({ ...skuInput, [c.id]: e.target.value })}
                    onKeyDown={e => { if (e.key === 'Enter') addSku(c.id); }}
                    placeholder="+ SKU"
                    className="w-20 px-1.5 py-0.5 text-[10px] bg-lattice-deep border border-lattice-border rounded text-white font-mono"
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default CollectionsPanel;
