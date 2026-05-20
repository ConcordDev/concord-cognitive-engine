'use client';

/**
 * ParentingSection — Huckleberry 2026-shape baby-care tracker. Owns the
 * child roster + active-child state; panels hydrate via lensRun().
 * Not medical advice.
 */

import { useCallback, useEffect, useState } from 'react';
import { Baby, Plus, ListChecks, Moon, TrendingUp, Sparkles, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { PgTodayPanel } from './PgTodayPanel';
import { PgSleepPanel } from './PgSleepPanel';
import { PgGrowthPanel } from './PgGrowthPanel';
import { PgMilestonesPanel } from './PgMilestonesPanel';

interface Child { id: string; name: string; birthDate: string; sex: string; ageDisplay: string; ageMonths: number }
type TabId = 'today' | 'sleep' | 'growth' | 'milestones';
const TABS: { id: TabId; label: string; icon: typeof Baby }[] = [
  { id: 'today', label: 'Today', icon: ListChecks },
  { id: 'sleep', label: 'Sleep', icon: Moon },
  { id: 'growth', label: 'Growth', icon: TrendingUp },
  { id: 'milestones', label: 'Milestones', icon: Sparkles },
];

export function ParentingSection() {
  const [children, setChildren] = useState<Child[]>([]);
  const [activeChild, setActiveChild] = useState<string>('');
  const [tab, setTab] = useState<TabId>('today');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', birthDate: '', sex: 'boy' });

  const refreshChildren = useCallback(async () => {
    const r = await lensRun('parenting', 'child-list', {});
    const list: Child[] = r.data?.result?.children || [];
    setChildren(list);
    setActiveChild((prev) => (list.some((c) => c.id === prev) ? prev : list[0]?.id || ''));
    setLoading(false);
  }, []);

  useEffect(() => { void refreshChildren(); }, [refreshChildren]);

  const addChild = async () => {
    if (!form.name.trim()) { setError('Child name is required.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.birthDate)) { setError('Pick a birth date.'); return; }
    const r = await lensRun('parenting', 'child-add', {
      name: form.name.trim(), birthDate: form.birthDate, sex: form.sex,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ name: '', birthDate: '', sex: 'boy' });
    setError(null);
    await refreshChildren();
  };

  const delChild = async (id: string) => {
    await lensRun('parenting', 'child-delete', { id });
    await refreshChildren();
  };

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-rose-600/15 to-transparent">
        <Baby className="w-5 h-5 text-rose-400" />
        <h2 className="text-sm font-bold text-zinc-100">Baby Care</h2>
        <span className="text-[11px] text-zinc-500">Huckleberry shape · not medical advice</span>
      </header>

      {error && <div className="mx-4 mt-3 text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-6 text-zinc-500"><Loader2 className="w-4 h-4 animate-spin" /></div>
      ) : (
        <>
          {/* Child roster */}
          <div className="px-4 py-3 border-b border-zinc-800 space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {children.map((c) => (
                <span key={c.id} className={cn('flex items-center gap-1.5 text-[11px] pl-2.5 pr-1.5 py-1 rounded-lg',
                  activeChild === c.id ? 'bg-rose-600 text-white' : 'bg-zinc-800 text-zinc-300')}>
                  <button type="button" onClick={() => setActiveChild(c.id)}>{c.name} · {c.ageDisplay}</button>
                  <button type="button" onClick={() => delChild(c.id)} className="text-zinc-300/70 hover:text-rose-200">×</button>
                </span>
              ))}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <input placeholder="Child name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <input type="date" value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <select value={form.sex} onChange={(e) => setForm({ ...form, sex: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
                <option value="boy">Boy</option>
                <option value="girl">Girl</option>
              </select>
              <button type="button" onClick={addChild}
                className="flex items-center justify-center gap-1 bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium rounded-lg">
                <Plus className="w-3.5 h-3.5" /> Add child
              </button>
            </div>
          </div>

          {!activeChild ? (
            <p className="text-[11px] text-zinc-500 italic px-4 py-8 text-center">Add a child to start tracking.</p>
          ) : (
            <>
              <nav className="flex gap-1 px-2 pt-2 border-b border-zinc-800 overflow-x-auto">
                {TABS.map((t) => {
                  const Icon = t.icon;
                  const active = tab === t.id;
                  return (
                    <button key={t.id} type="button" onClick={() => setTab(t.id)}
                      className={cn('flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-rose-500',
                        active ? 'bg-zinc-900 text-rose-300 border-x border-t border-zinc-800' : 'text-zinc-400 hover:text-zinc-200')}>
                      <Icon className="w-3.5 h-3.5" /> {t.label}
                    </button>
                  );
                })}
              </nav>
              <div className="p-4">
                {tab === 'today' && <PgTodayPanel childId={activeChild} />}
                {tab === 'sleep' && <PgSleepPanel childId={activeChild} />}
                {tab === 'growth' && <PgGrowthPanel childId={activeChild} />}
                {tab === 'milestones' && <PgMilestonesPanel childId={activeChild} />}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
