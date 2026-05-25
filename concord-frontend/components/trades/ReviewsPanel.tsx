'use client';

import { useEffect, useState } from 'react';
import { Star, Plus, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Review { id: string; jobId: string; rating: number; nps: number | null; text: string; customerName: string; submittedAt: string }

export function ReviewsPanel() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [avgRating, setAvgRating] = useState(0);
  const [nps, setNps] = useState(0);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ jobId: '', rating: '5', nps: '9', customerName: '', text: '' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'trades', action: 'reviews-list', input: {} });
      setReviews((res.data?.result?.reviews || []) as Review[]);
      setAvgRating(res.data?.result?.avgRating || 0);
      setNps(res.data?.result?.nps || 0);
    } catch (e) { console.error('[Reviews] failed', e); }
    finally { setLoading(false); }
  }

  async function submit() {
    if (!form.jobId.trim()) return;
    try {
      await lensRun({
        domain: 'trades', action: 'reviews-submit',
        input: { jobId: form.jobId, rating: Number(form.rating), nps: Number(form.nps), customerName: form.customerName, text: form.text },
      });
      setForm({ jobId: '', rating: '5', nps: '9', customerName: '', text: '' });
      await refresh();
    } catch (e) { console.error('[Reviews] submit', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-amber-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Reviews & NPS</span>
        <span className="ml-auto inline-flex items-center gap-3 text-[10px] text-gray-400">
          <span><span className="text-amber-300 font-bold">{avgRating.toFixed(1)}</span>/5 avg</span>
          <span>NPS <span className={cn('font-bold', nps >= 50 ? 'text-emerald-300' : nps >= 0 ? 'text-amber-300' : 'text-rose-300')}>{nps > 0 ? '+' : ''}{nps}</span></span>
        </span>
      </header>

      <div className="p-3 border-b border-white/10 grid grid-cols-5 gap-2">
        <input value={form.jobId} onChange={e => setForm({ ...form, jobId: e.target.value })} placeholder="Job ID" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
        <input value={form.customerName} onChange={e => setForm({ ...form, customerName: e.target.value })} placeholder="Customer name" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <select value={form.rating} onChange={e => setForm({ ...form, rating: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          {[1, 2, 3, 4, 5].map(r => <option key={r} value={r}>{r}★</option>)}
        </select>
        <input type="number" min="0" max="10" value={form.nps} onChange={e => setForm({ ...form, nps: e.target.value })} placeholder="NPS 0-10" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input value={form.text} onChange={e => setForm({ ...form, text: e.target.value })} placeholder="Feedback (optional)" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={submit} className="px-3 py-1.5 text-xs rounded bg-amber-500 text-black font-bold hover:bg-amber-400 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Submit</button>
      </div>

      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : reviews.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Star className="w-6 h-6 mx-auto mb-2 opacity-30" />No reviews yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {reviews.map(r => (
              <li key={r.id} className="px-3 py-2 hover:bg-white/[0.03]">
                <div className="flex items-center gap-2 mb-1">
                  <div className="flex">
                    {[1, 2, 3, 4, 5].map(n => <Star key={n} className={cn('w-3 h-3', n <= r.rating ? 'text-amber-400 fill-amber-400' : 'text-gray-600')} />)}
                  </div>
                  <span className="text-xs text-white">{r.customerName}</span>
                  {r.nps != null && <span className={cn('text-[10px] font-mono', r.nps >= 9 ? 'text-emerald-300' : r.nps >= 7 ? 'text-amber-300' : 'text-rose-300')}>NPS {r.nps}</span>}
                  <span className="ml-auto text-[10px] text-gray-400">{new Date(r.submittedAt).toLocaleDateString()}</span>
                </div>
                {r.text && <p className="text-[11px] text-gray-300 ml-1">{r.text}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default ReviewsPanel;
