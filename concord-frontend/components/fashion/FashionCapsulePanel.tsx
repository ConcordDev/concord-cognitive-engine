'use client';

/**
 * FashionCapsulePanel — capsule-wardrobe planner + #30wears challenge
 * tracking. Backed by fashion.capsule-* and challenge-* macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Package, Target, Trash2, ChevronRight } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Item { id: string; name: string; category: string }
interface Capsule {
  id: string; name: string; season: string; targetSize: number;
  itemIds: string[]; itemNames: string[]; filled: number; pctFilled: number;
}
interface Challenge {
  id: string; itemId: string; itemName: string; category: string | null;
  target: number; wears: number; progress: number; pct: number; complete: boolean;
}

const SEASONS = ['all', 'spring', 'summer', 'fall', 'winter'];

export function FashionCapsulePanel() {
  const [capsules, setCapsules] = useState<Capsule[]>([]);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [completed, setCompleted] = useState(0);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [capForm, setCapForm] = useState({ name: '', season: 'all', targetSize: '33' });
  const [openCap, setOpenCap] = useState<string | null>(null);
  const [enrollItem, setEnrollItem] = useState('');
  const [enrollTarget, setEnrollTarget] = useState('30');

  const refresh = useCallback(async () => {
    setLoading(true);
    const [c, ch, i] = await Promise.all([
      lensRun('fashion', 'capsule-list', {}),
      lensRun('fashion', 'challenge-list', {}),
      lensRun('fashion', 'item-list', {}),
    ]);
    setCapsules((c.data?.result?.capsules as Capsule[]) || []);
    setChallenges((ch.data?.result?.challenges as Challenge[]) || []);
    setCompleted((ch.data?.result?.completed as number) || 0);
    setItems((i.data?.result?.items as Item[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const createCapsule = async () => {
    if (!capForm.name.trim()) { setError('Capsule name is required.'); return; }
    const r = await lensRun('fashion', 'capsule-create', {
      name: capForm.name.trim(), season: capForm.season,
      targetSize: Number(capForm.targetSize) || 33,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setCapForm({ name: '', season: 'all', targetSize: '33' });
    setError(null);
    await refresh();
  };
  const toggleCapItem = async (capsuleId: string, itemId: string) => {
    const r = await lensRun('fashion', 'capsule-toggle-item', { capsuleId, itemId });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setError(null);
    await refresh();
  };
  const delCapsule = async (id: string) => { await lensRun('fashion', 'capsule-delete', { id }); await refresh(); };

  const enroll = async () => {
    if (!enrollItem) { setError('Choose an item to enroll.'); return; }
    const r = await lensRun('fashion', 'challenge-enroll', {
      itemId: enrollItem, target: Number(enrollTarget) || 30,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setEnrollItem(''); setError(null);
    await refresh();
  };
  const unenroll = async (id: string) => { await lensRun('fashion', 'challenge-unenroll', { id }); await refresh(); };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const enrolledIds = new Set(challenges.map((c) => c.itemId));

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Capsule planner */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Package className="w-3.5 h-3.5 text-fuchsia-400" /> Capsule wardrobes
        </h3>
        <div className="grid grid-cols-4 gap-2 mb-2">
          <input value={capForm.name} onChange={(e) => setCapForm({ ...capForm, name: e.target.value })}
            placeholder="Capsule name" className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={capForm.season} onChange={(e) => setCapForm({ ...capForm, season: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 capitalize">
            {SEASONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input inputMode="numeric" value={capForm.targetSize}
            onChange={(e) => setCapForm({ ...capForm, targetSize: e.target.value })}
            placeholder="Size" className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        </div>
        <button type="button" onClick={createCapsule}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-fuchsia-600 hover:bg-fuchsia-500 text-white rounded-lg mb-2">
          <Plus className="w-3.5 h-3.5" /> Create capsule
        </button>
        {capsules.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No capsule wardrobes yet.</p>
        ) : (
          <ul className="space-y-2">
            {capsules.map((c) => (
              <li key={c.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl overflow-hidden">
                <div className="flex items-center px-3 py-2.5">
                  <button type="button" onClick={() => setOpenCap(openCap === c.id ? null : c.id)}
                    className="flex-1 flex items-center gap-2 text-left">
                    <ChevronRight className={cn('w-4 h-4 text-zinc-600 transition-transform', openCap === c.id && 'rotate-90')} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-zinc-100">{c.name}</p>
                      <p className="text-[10px] text-zinc-400 capitalize">{c.season} · {c.filled}/{c.targetSize} items</p>
                    </div>
                  </button>
                  <span className="text-[11px] text-fuchsia-300 mr-2">{c.pctFilled}%</span>
                  <button aria-label="Delete" type="button" onClick={() => delCapsule(c.id)} className="text-zinc-600 hover:text-rose-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="h-1 bg-zinc-800">
                  <div className="h-full bg-fuchsia-500" style={{ width: `${Math.min(100, c.pctFilled)}%` }} />
                </div>
                {openCap === c.id && (
                  <div className="border-t border-zinc-800 p-3 bg-zinc-950/50">
                    {items.length === 0 ? (
                      <p className="text-[11px] text-zinc-400 italic">Add closet items first.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {items.map((i) => {
                          const inCap = c.itemIds.includes(i.id);
                          return (
                            <button key={i.id} type="button" onClick={() => toggleCapItem(c.id, i.id)}
                              className={cn('text-[11px] px-2 py-0.5 rounded-full border',
                                inCap ? 'border-fuchsia-700/50 bg-fuchsia-950/40 text-fuchsia-300' : 'border-zinc-700 text-zinc-400')}>
                              {i.name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* #30wears challenge */}
      <section>
        <h3 className="flex items-center justify-between text-xs font-semibold text-zinc-300 mb-2">
          <span className="flex items-center gap-1"><Target className="w-3.5 h-3.5 text-fuchsia-400" /> #30wears challenge</span>
          {challenges.length > 0 && <span className="text-[11px] text-emerald-400">{completed}/{challenges.length} complete</span>}
        </h3>
        <div className="flex gap-2 mb-2">
          <select value={enrollItem} onChange={(e) => setEnrollItem(e.target.value)}
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            <option value="">— choose item —</option>
            {items.filter((i) => !enrolledIds.has(i.id)).map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
          <input inputMode="numeric" value={enrollTarget} onChange={(e) => setEnrollTarget(e.target.value)}
            placeholder="Target" className="w-16 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={enroll}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-fuchsia-600 hover:bg-fuchsia-500 text-white rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Enroll
          </button>
        </div>
        {challenges.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No items enrolled. Pledge to wear pieces 30 times.</p>
        ) : (
          <ul className="space-y-2">
            {challenges.map((ch) => (
              <li key={ch.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-zinc-100">{ch.itemName}</p>
                  <div className="flex items-center gap-2">
                    <span className={cn('text-[11px]', ch.complete ? 'text-emerald-400' : 'text-zinc-400')}>
                      {ch.progress}/{ch.target}{ch.complete ? ' — done' : ''}
                    </span>
                    <button aria-label="Delete" type="button" onClick={() => unenroll(ch.id)} className="text-zinc-600 hover:text-rose-400">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="h-1.5 bg-zinc-800 rounded-full mt-2 overflow-hidden">
                  <div className={cn('h-full rounded-full', ch.complete ? 'bg-emerald-500' : 'bg-fuchsia-500')}
                    style={{ width: `${Math.min(100, ch.pct)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
