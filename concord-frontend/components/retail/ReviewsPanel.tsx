'use client';

import { useCallback, useEffect, useState } from 'react';
import { Star, Loader2, Plus, EyeOff, Eye, Trash2, BadgeCheck } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Review {
  id: string; sku: string; productName: string; rating: number;
  title: string; body: string; authorName: string; verified: boolean;
  status: string; createdAt: string;
}
interface ReviewSummary {
  totalReviews: number; avgRating: number; verifiedCount: number;
  distribution: Record<string, number>;
  topRated: Array<{ sku: string; productName: string; reviewCount: number; avgRating: number }>;
}
interface AdminProduct { sku: string; name: string }

function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} className={cn('w-3 h-3', i <= n ? 'text-amber-400 fill-amber-400' : 'text-gray-600')} />
      ))}
    </span>
  );
}

/**
 * ReviewsPanel — product reviews + ratings on the storefront. Buyers
 * submit star ratings (verified-purchase flagged when the email matches
 * a real order), merchants moderate (publish/hide/delete), and a summary
 * shows the rating distribution and top-rated products.
 */
export function ReviewsPanel() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ sku: '', rating: '5', authorName: '', title: '', body: '', buyerEmail: '' });
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [rRes, sRes, pRes] = await Promise.all([
        lensRun('retail', 'reviews-list', {}),
        lensRun('retail', 'reviews-summary', {}),
        lensRun('retail', 'product-list', {}),
      ]);
      setReviews((rRes.data?.result?.reviews || []) as Review[]);
      setSummary((sRes.data?.result || null) as ReviewSummary | null);
      setProducts((pRes.data?.result?.products || []) as AdminProduct[]);
    } catch (e) { console.error('[Reviews] refresh failed', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function submit() {
    if (!form.sku || !form.authorName.trim()) { setNotice('Pick a product and enter your name'); return; }
    setBusy(true); setNotice(null);
    try {
      const r = await lensRun('retail', 'reviews-submit', {
        sku: form.sku, rating: Number(form.rating), authorName: form.authorName,
        title: form.title, body: form.body, buyerEmail: form.buyerEmail || undefined,
      });
      if (r.data?.ok === false) setNotice(r.data.error || 'Submit failed');
      else { setForm({ sku: '', rating: '5', authorName: '', title: '', body: '', buyerEmail: '' }); await refresh(); }
    } catch (e) { console.error('[Reviews] submit failed', e); }
    finally { setBusy(false); }
  }

  async function moderate(id: string, status: string) {
    setBusy(true);
    try {
      await lensRun('retail', 'reviews-moderate', { id, status });
      await refresh();
    } catch (e) { console.error('[Reviews] moderate failed', e); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await lensRun('retail', 'reviews-delete', { id });
      await refresh();
    } catch (e) { console.error('[Reviews] delete failed', e); }
    finally { setBusy(false); }
  }

  return (
    <div className="bg-[#0d1117] border border-emerald-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Star className="w-4 h-4 text-amber-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Product reviews</span>
        {summary && summary.totalReviews > 0 && (
          <span className="ml-auto text-[10px] text-amber-300">★ {summary.avgRating} · {summary.totalReviews} reviews</span>
        )}
      </header>

      {/* Summary distribution */}
      {summary && summary.totalReviews > 0 && (
        <div className="p-3 border-b border-white/10">
          <div className="space-y-1">
            {[5, 4, 3, 2, 1].map(star => {
              const count = summary.distribution[String(star)] || 0;
              const pct = summary.totalReviews > 0 ? (count / summary.totalReviews) * 100 : 0;
              return (
                <div key={star} className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500 w-6">{star}★</span>
                  <div className="flex-1 h-1.5 bg-lattice-deep rounded-full overflow-hidden">
                    <div className="h-full bg-amber-400" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[10px] text-gray-500 w-6 text-right">{count}</span>
                </div>
              );
            })}
          </div>
          {summary.topRated.length > 0 && (
            <p className="text-[10px] text-gray-500 mt-2">
              Top rated: {summary.topRated.slice(0, 3).map(t => `${t.productName} (★${t.avgRating})`).join(' · ')}
            </p>
          )}
        </div>
      )}

      {/* Submit a review */}
      <div className="p-3 border-b border-white/10 space-y-2">
        <div className="grid grid-cols-3 gap-2">
          <select value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="">Product…</option>
            {products.map(p => <option key={p.sku} value={p.sku}>{p.name}</option>)}
          </select>
          <select value={form.rating} onChange={e => setForm({ ...form, rating: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            {[5, 4, 3, 2, 1].map(n => <option key={n} value={n}>{n} star{n > 1 ? 's' : ''}</option>)}
          </select>
          <input value={form.authorName} onChange={e => setForm({ ...form, authorName: e.target.value })} placeholder="Your name" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Review title" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={form.buyerEmail} onChange={e => setForm({ ...form, buyerEmail: e.target.value })} placeholder="Buyer email (verifies purchase)" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        </div>
        <textarea value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} placeholder="What did you think?" rows={2} className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={submit} disabled={busy || !form.sku} className="px-3 py-1.5 text-xs rounded bg-amber-500 text-black font-bold hover:bg-amber-400 disabled:opacity-40 inline-flex items-center gap-1">
          <Plus className="w-3 h-3" /> Submit review
        </button>
        {notice && <p className="text-[11px] text-amber-300">{notice}</p>}
      </div>

      <div className="max-h-72 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : reviews.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500"><Star className="w-6 h-6 mx-auto mb-2 opacity-30" />No reviews yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {reviews.map(r => (
              <li key={r.id} className={cn('px-3 py-2 hover:bg-white/[0.03]', r.status === 'hidden' && 'opacity-50')}>
                <div className="flex items-center gap-2">
                  <Stars n={r.rating} />
                  <span className="text-xs text-white font-medium truncate">{r.title || r.productName}</span>
                  {r.verified && <span className="inline-flex items-center gap-0.5 text-[9px] text-emerald-300"><BadgeCheck className="w-3 h-3" />verified</span>}
                  <span className="ml-auto text-[10px] text-gray-500">{r.authorName}</span>
                  <button onClick={() => moderate(r.id, r.status === 'published' ? 'hidden' : 'published')} disabled={busy} className="p-1 text-gray-500 hover:text-amber-300">
                    {r.status === 'published' ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  </button>
                  <button onClick={() => remove(r.id)} disabled={busy} className="p-1 text-gray-500 hover:text-rose-400"><Trash2 className="w-3 h-3" /></button>
                </div>
                {r.body && <p className="text-[11px] text-gray-400 mt-0.5">{r.body}</p>}
                <p className="text-[10px] text-gray-600">{r.productName} · {new Date(r.createdAt).toLocaleDateString()}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default ReviewsPanel;
