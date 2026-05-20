'use client';

import { useEffect, useMemo, useState } from 'react';
import { Package, Plus, Trash2, Loader2, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface PantryItem {
  id: string;
  itemName: string;
  qty: number;
  unit: string;
  purchaseDate?: string;
  expirationDate?: string;
  location?: 'fridge' | 'freezer' | 'pantry' | 'counter';
}

const LOCATIONS: PantryItem['location'][] = ['fridge', 'freezer', 'pantry', 'counter'];

export function PantryTracker() {
  const [items, setItems] = useState<PantryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [filterLoc, setFilterLoc] = useState<PantryItem['location'] | 'all'>('all');
  const [newName, setNewName] = useState('');
  const [newQty, setNewQty] = useState('1');
  const [newUnit, setNewUnit] = useState('item');
  const [newExp, setNewExp] = useState('');
  const [newLoc, setNewLoc] = useState<PantryItem['location']>('pantry');

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'food', action: 'pantry-list', input: {} });
      setItems((res.data?.result?.items || []) as PantryItem[]);
    } catch (e) { console.error('[Pantry] list failed', e); }
    finally { setLoading(false); }
  }

  async function add() {
    if (!newName.trim()) return;
    try {
      await lensRun({
        domain: 'food', action: 'pantry-add',
        input: {
          itemName: newName.trim(),
          qty: Number(newQty) || 1,
          unit: newUnit,
          expirationDate: newExp || null,
          location: newLoc,
        },
      });
      setNewName(''); setNewQty('1'); setNewExp(''); setCreating(false);
      await refresh();
    } catch (e) { console.error('[Pantry] add failed', e); }
  }

  async function remove(id: string) {
    try {
      await lensRun({ domain: 'food', action: 'pantry-delete', input: { id } });
      setItems(prev => prev.filter(i => i.id !== id));
    } catch (e) { console.error('[Pantry] delete failed', e); }
  }

  const filtered = useMemo(() => filterLoc === 'all' ? items : items.filter(i => i.location === filterLoc), [items, filterLoc]);

  const expSoon = useMemo(() => {
    const now = Date.now();
    return items.filter(i => i.expirationDate && (new Date(i.expirationDate).getTime() - now) / 86400000 < 7).length;
  }, [items]);

  function expiryAge(d?: string): 'green' | 'yellow' | 'red' | 'gray' {
    if (!d) return 'gray';
    const days = (new Date(d).getTime() - Date.now()) / 86400000;
    if (days < 2) return 'red';
    if (days < 7) return 'yellow';
    return 'green';
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Package className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Pantry</span>
        <span className="ml-auto text-[10px] text-gray-500">{items.length} items{expSoon > 0 ? ` · ${expSoon} expiring soon` : ''}</span>
        <button onClick={() => setCreating(v => !v)} className="p-1 text-gray-400 hover:text-white" title="Add item">
          <Plus className="w-4 h-4" />
        </button>
      </header>

      {creating && (
        <div className="p-3 border-b border-white/10 grid grid-cols-2 gap-2 text-xs">
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Item (e.g. tomatoes)" className="col-span-2 px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="number" value={newQty} onChange={e => setNewQty(e.target.value)} placeholder="Qty" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={newUnit} onChange={e => setNewUnit(e.target.value)} placeholder="Unit" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="date" value={newExp} onChange={e => setNewExp(e.target.value)} className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
          <select value={newLoc} onChange={e => setNewLoc(e.target.value as PantryItem['location'])} className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white">
            {LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
          <button onClick={add} className="col-span-2 py-1.5 rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">Add to pantry</button>
        </div>
      )}

      <div className="px-3 py-1.5 border-b border-white/5 flex items-center gap-1 text-[10px]">
        {(['all', ...LOCATIONS] as const).map(l => (
          <button
            key={l}
            onClick={() => setFilterLoc(l as PantryItem['location'] | 'all')}
            className={cn('px-2 py-0.5 rounded uppercase tracking-wider',
              filterLoc === l ? 'bg-cyan-500/20 text-cyan-300' : 'text-gray-500 hover:text-white'
            )}
          >{l}</button>
        ))}
      </div>

      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500"><Package className="w-6 h-6 mx-auto mb-2 opacity-30" /> {items.length === 0 ? 'Empty pantry. Hit + to add.' : 'No items match.'}</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {filtered.map(item => {
              const age = expiryAge(item.expirationDate);
              return (
                <li key={item.id} className="px-3 py-2 hover:bg-white/[0.03] group flex items-center gap-2">
                  <div className={cn('w-1.5 h-8 rounded',
                    age === 'red' ? 'bg-red-500' : age === 'yellow' ? 'bg-yellow-500' : age === 'green' ? 'bg-green-500' : 'bg-gray-600'
                  )} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white truncate">{item.itemName}</div>
                    <div className="text-[10px] text-gray-500">
                      {item.qty} {item.unit} · {item.location || 'pantry'}
                      {item.expirationDate && ` · exp ${new Date(item.expirationDate).toLocaleDateString()}`}
                    </div>
                  </div>
                  {age === 'red' && <AlertTriangle className="w-3.5 h-3.5 text-red-400" />}
                  <button onClick={() => remove(item.id)} className="opacity-0 group-hover:opacity-100 p-1 text-gray-500 hover:text-red-400" title="Remove">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default PantryTracker;
