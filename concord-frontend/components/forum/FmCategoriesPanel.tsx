'use client';

/**
 * FmCategoriesPanel — forum categories with topic counts.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, FolderTree } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Category { id: string; name: string; description: string | null; topicCount: number }

export function FmCategoriesPanel({ onChange }: { onChange: () => void }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', description: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('forum', 'category-list', {});
    setCategories(r.data?.result?.categories || []);
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addCategory = async () => {
    if (!form.name.trim()) { setError('Category name is required.'); return; }
    const r = await lensRun('forum', 'category-create', { name: form.name.trim(), description: form.description.trim() });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ name: '', description: '' });
    setError(null);
    await refresh();
  };

  const del = async (id: string) => {
    await lensRun('forum', 'category-delete', { id });
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <section className="grid grid-cols-2 sm:grid-cols-3 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <input placeholder="Category name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <input placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <button type="button" onClick={addCategory}
          className="flex items-center justify-center gap-1 bg-orange-600 hover:bg-orange-500 text-white text-xs font-medium rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Category
        </button>
      </section>

      {categories.length === 0 ? (
        <p className="text-[11px] text-zinc-400 italic py-6 text-center">No categories yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center gap-3 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
              <FolderTree className="w-4 h-4 text-orange-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-zinc-100">{c.name}</p>
                {c.description && <p className="text-[10px] text-zinc-400">{c.description}</p>}
              </div>
              <span className="text-[11px] text-zinc-400">{c.topicCount} topics</span>
              <button aria-label="Delete" type="button" onClick={() => del(c.id)} className="text-zinc-600 hover:text-rose-400">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
