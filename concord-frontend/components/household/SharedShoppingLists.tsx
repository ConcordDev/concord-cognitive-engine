'use client';

/**
 * SharedShoppingLists — Cozi-shape shared shopping lists multiple members
 * edit live. Real CRUD against household.shopping-list-* and
 * household.shopping-item-* macros. Each item records who added/checked it.
 */

import { useCallback, useEffect, useState } from 'react';
import { ShoppingCart, Plus, Trash2, Check, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Item { id: string; name: string; quantity: string; addedBy: string | null; checked: boolean; checkedBy?: string | null }
interface ShopList { id: string; name: string; items: Item[]; itemCount: number; checkedCount: number }

export function SharedShoppingLists() {
  const [lists, setLists] = useState<ShopList[]>([]);
  const [loading, setLoading] = useState(true);
  const [newList, setNewList] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [itemForm, setItemForm] = useState({ name: '', quantity: '', addedBy: '' });
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const r = await lensRun<{ lists: ShopList[] }>('household', 'shopping-list-list', {});
    if (r.data?.ok) {
      const next = r.data.result?.lists || [];
      setLists(next);
      setActiveId(prev => (prev && next.some(l => l.id === prev)) ? prev : (next[0]?.id || null));
    }
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const active = lists.find(l => l.id === activeId) || null;

  async function addList() {
    if (!newList.trim()) return;
    const r = await lensRun<{ list: ShopList }>('household', 'shopping-list-create', { name: newList.trim() });
    setNewList('');
    await refresh();
    if (r.data?.ok && r.data.result?.list) setActiveId(r.data.result.list.id);
  }
  async function delList(id: string) {
    if (!confirm('Delete this shopping list?')) return;
    await lensRun('household', 'shopping-list-delete', { id });
    await refresh();
  }
  async function addItem() {
    if (!active || !itemForm.name.trim()) return;
    setBusy(true);
    await lensRun('household', 'shopping-item-add', {
      listId: active.id, name: itemForm.name.trim(),
      quantity: itemForm.quantity.trim() || undefined, addedBy: itemForm.addedBy.trim() || undefined,
    });
    setItemForm({ ...itemForm, name: '', quantity: '' });
    setBusy(false);
    await refresh();
  }
  async function toggle(item: Item) {
    if (!active) return;
    await lensRun('household', 'shopping-item-toggle', {
      listId: active.id, itemId: item.id, checked: !item.checked, by: itemForm.addedBy.trim() || undefined,
    });
    await refresh();
  }
  async function removeItem(itemId: string) {
    if (!active) return;
    await lensRun('household', 'shopping-item-remove', { listId: active.id, itemId });
    await refresh();
  }

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <ShoppingCart className="w-4 h-4 text-emerald-400" />
        <h3 className="text-sm font-bold text-zinc-100">Shared Shopping Lists</h3>
      </div>

      <div className="flex gap-1.5 mb-3">
        <input value={newList} onChange={e => setNewList(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void addList(); }}
          placeholder="New list (e.g. Groceries)" className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <button aria-label="Add" onClick={addList} className="px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white"><Plus className="w-3.5 h-3.5" /></button>
      </div>

      {lists.length === 0 ? (
        <p className="text-xs text-zinc-400 italic">No data yet — create a shopping list above.</p>
      ) : (
        <>
          <div className="flex gap-1.5 flex-wrap mb-3">
            {lists.map(l => (
              <button key={l.id} onClick={() => setActiveId(l.id)}
                className={cn('group px-2.5 py-1 text-xs rounded-lg inline-flex items-center gap-1.5',
                  l.id === activeId ? 'bg-emerald-700 text-white' : 'border border-zinc-700 text-zinc-300 hover:bg-zinc-800')}>
                {l.name}
                <span className={cn('text-[10px]', l.id === activeId ? 'text-emerald-200' : 'text-zinc-400')}>
                  {l.checkedCount}/{l.itemCount}
                </span>
                <Trash2 className="w-3 h-3 opacity-0 group-hover:opacity-100 text-rose-300"
                  onClick={e => { e.stopPropagation(); void delList(l.id); }} />
              </button>
            ))}
          </div>

          {active && (
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5">
              <div className="flex gap-1.5 mb-2 flex-wrap">
                <input value={itemForm.name} onChange={e => setItemForm({ ...itemForm, name: e.target.value })}
                  onKeyDown={e => { if (e.key === 'Enter') void addItem(); }} placeholder="Item"
                  className="flex-1 min-w-[100px] bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
                <input value={itemForm.quantity} onChange={e => setItemForm({ ...itemForm, quantity: e.target.value })} placeholder="Qty"
                  className="w-16 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
                <input value={itemForm.addedBy} onChange={e => setItemForm({ ...itemForm, addedBy: e.target.value })} placeholder="Who"
                  className="w-20 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
                <button onClick={addItem} disabled={busy || !itemForm.name.trim()}
                  className="px-2.5 py-1 text-xs rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold disabled:opacity-40">Add</button>
              </div>
              {active.items.length === 0 ? (
                <p className="text-[11px] text-zinc-400 italic">No items yet.</p>
              ) : (
                <ul className="space-y-1">
                  {active.items.map(it => (
                    <li key={it.id} className="group flex items-center gap-2">
                      <button onClick={() => toggle(it)}
                        className={cn('w-4 h-4 rounded border flex items-center justify-center shrink-0',
                          it.checked ? 'bg-emerald-600 border-emerald-600' : 'border-zinc-600 hover:border-emerald-500')}>
                        {it.checked && <Check className="w-3 h-3 text-white" />}
                      </button>
                      <span className={cn('text-xs flex-1 truncate', it.checked ? 'text-zinc-600 line-through' : 'text-zinc-200')}>
                        {it.name}{it.quantity ? ` · ${it.quantity}` : ''}
                      </span>
                      {it.addedBy && <span className="text-[10px] text-zinc-400">{it.addedBy}</span>}
                      <button onClick={() => removeItem(it.id)} className="opacity-0 group-hover:opacity-100 text-rose-400" aria-label="Remove">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
