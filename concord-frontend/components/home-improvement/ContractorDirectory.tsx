'use client';

import { useState, useEffect, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { Wrench, Plus, Trash2, Loader2, Star, Phone, Mail, BadgeCheck, FileText } from 'lucide-react';

interface Quote {
  id: string;
  project: string;
  amount: number;
  scope: string;
  validUntil: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: string;
}
interface Review {
  id: string;
  rating: number;
  text: string;
  project: string;
  createdAt: string;
}
interface Pro {
  id: string;
  name: string;
  trade: string;
  phone: string;
  email: string;
  license: string;
  notes: string;
  quotes: Quote[];
  reviews: Review[];
  quoteCount: number;
  reviewCount: number;
  avgRating: number;
  lowestQuote: number;
  createdAt: string;
}

const DOMAIN = 'home-improvement';

function Stars({ value }: { value: number }) {
  return (
    <span className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={`w-3.5 h-3.5 ${n <= Math.round(value) ? 'text-amber-400 fill-amber-400' : 'text-gray-600'}`} />
      ))}
    </span>
  );
}

export function ContractorDirectory() {
  const [pros, setPros] = useState<Pro[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', trade: 'general', phone: '', email: '', license: '', notes: '' });
  const [openPro, setOpenPro] = useState<string | null>(null);
  const [quoteForm, setQuoteForm] = useState({ project: '', amount: '', scope: '', validUntil: '' });
  const [reviewForm, setReviewForm] = useState({ rating: '5', text: '', project: '' });

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await lensRun<{ pros: Pro[] }>(DOMAIN, 'pro-list', {});
    if (data.ok && data.result) setPros(data.result.pros || []);
    else setError(data.error || 'Failed to load contractors');
    setLoading(false);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const addPro = async () => {
    if (!form.name.trim()) return;
    setBusy(true); setError(null);
    const { data } = await lensRun(DOMAIN, 'pro-add', { ...form });
    if (data.ok) { setForm({ name: '', trade: 'general', phone: '', email: '', license: '', notes: '' }); setShowForm(false); await load(); }
    else setError(data.error || 'Failed to add contractor');
    setBusy(false);
  };

  const removePro = async (id: string) => {
    setBusy(true);
    const { data } = await lensRun(DOMAIN, 'pro-delete', { id });
    if (data.ok) await load();
    setBusy(false);
  };

  const addQuote = async (proId: string) => {
    if (!quoteForm.amount) return;
    setBusy(true); setError(null);
    const { data } = await lensRun(DOMAIN, 'pro-quote-add', {
      proId, project: quoteForm.project, amount: Number(quoteForm.amount), scope: quoteForm.scope, validUntil: quoteForm.validUntil,
    });
    if (data.ok) { setQuoteForm({ project: '', amount: '', scope: '', validUntil: '' }); await load(); }
    else setError(data.error || 'Failed to add quote');
    setBusy(false);
  };

  const addReview = async (proId: string) => {
    setBusy(true); setError(null);
    const { data } = await lensRun(DOMAIN, 'pro-review-add', {
      proId, rating: Number(reviewForm.rating), text: reviewForm.text, project: reviewForm.project,
    });
    if (data.ok) { setReviewForm({ rating: '5', text: '', project: '' }); await load(); }
    else setError(data.error || 'Failed to add review');
    setBusy(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2 text-sm">
          <Wrench className="w-4 h-4 text-neon-cyan" /> Pro Directory
          <span className="text-xs text-gray-400">({pros.length})</span>
        </h3>
        <button onClick={() => setShowForm((v) => !v)} className="text-xs flex items-center gap-1 text-neon-cyan hover:text-cyan-300">
          <Plus className="w-3.5 h-3.5" /> Add contractor
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {showForm && (
        <div className="panel p-3 space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Contractor / company name" className="input-lattice" />
            <input value={form.trade} onChange={(e) => setForm((f) => ({ ...f, trade: e.target.value }))} placeholder="Trade (plumbing, electrical...)" className="input-lattice" />
            <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="Phone" className="input-lattice" />
            <input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="Email" className="input-lattice" />
            <input value={form.license} onChange={(e) => setForm((f) => ({ ...f, license: e.target.value }))} placeholder="License #" className="input-lattice" />
            <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Notes" className="input-lattice" />
          </div>
          <button onClick={addPro} disabled={busy || !form.name.trim()} className="btn-neon green w-full text-sm disabled:opacity-50">
            {busy ? 'Saving...' : 'Add Contractor'}
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-gray-400"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading contractors...</div>
      ) : pros.length === 0 ? (
        <p className="text-xs text-gray-400">No contractors yet. Add pros to compare quotes and track reviews.</p>
      ) : (
        <div className="space-y-3">
          {pros.map((p) => (
            <div key={p.id} className="panel p-3 space-y-2">
              <div className="flex items-start justify-between">
                <button onClick={() => setOpenPro((o) => (o === p.id ? null : p.id))} className="min-w-0 text-left flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-white truncate">{p.name}</p>
                    <span className="text-[10px] px-1.5 py-0.5 bg-neon-cyan/10 text-neon-cyan rounded uppercase">{p.trade}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-400 mt-1">
                    {p.reviewCount > 0 ? <Stars value={p.avgRating} /> : <span className="text-gray-600">No reviews</span>}
                    {p.reviewCount > 0 && <span>{p.avgRating} ({p.reviewCount})</span>}
                    {p.quoteCount > 0 && <span className="text-neon-green">Lowest quote: ${p.lowestQuote.toLocaleString()}</span>}
                  </div>
                </button>
                <button aria-label="Delete" onClick={() => removePro(p.id)} disabled={busy} className="text-gray-400 hover:text-red-400 p-1"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>

              {openPro === p.id && (
                <div className="space-y-3 border-t border-lattice-border pt-2">
                  <div className="flex flex-wrap gap-3 text-xs text-gray-400">
                    {p.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{p.phone}</span>}
                    {p.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{p.email}</span>}
                    {p.license && <span className="flex items-center gap-1"><BadgeCheck className="w-3 h-3 text-neon-green" />{p.license}</span>}
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-gray-300 mb-1 flex items-center gap-1"><FileText className="w-3 h-3" /> Quotes</p>
                    {p.quotes.map((q) => (
                      <div key={q.id} className="flex items-center justify-between text-xs py-1 border-b border-lattice-border/50">
                        <span className="text-gray-200">{q.project}</span>
                        <span className="flex items-center gap-2">
                          <span className="text-neon-green font-semibold">${q.amount.toLocaleString()}</span>
                          <span className={`px-1.5 py-0.5 rounded ${q.status === 'accepted' ? 'bg-neon-green/20 text-neon-green' : q.status === 'declined' ? 'bg-red-400/20 text-red-400' : 'bg-yellow-400/20 text-yellow-400'}`}>{q.status}</span>
                        </span>
                      </div>
                    ))}
                    <div className="grid grid-cols-2 gap-1.5 mt-1.5">
                      <input value={quoteForm.project} onChange={(e) => setQuoteForm((f) => ({ ...f, project: e.target.value }))} placeholder="Project" className="input-lattice text-xs" />
                      <input value={quoteForm.amount} onChange={(e) => setQuoteForm((f) => ({ ...f, amount: e.target.value }))} type="number" placeholder="Amount $" className="input-lattice text-xs" />
                    </div>
                    <button onClick={() => addQuote(p.id)} disabled={busy || !quoteForm.amount} className="btn-neon w-full text-xs mt-1 disabled:opacity-50">Add Quote</button>
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-gray-300 mb-1 flex items-center gap-1"><Star className="w-3 h-3" /> Reviews</p>
                    {p.reviews.map((r) => (
                      <div key={r.id} className="text-xs py-1 border-b border-lattice-border/50">
                        <div className="flex items-center gap-2"><Stars value={r.rating} />{r.project && <span className="text-gray-400">{r.project}</span>}</div>
                        {r.text && <p className="text-gray-300 mt-0.5">{r.text}</p>}
                      </div>
                    ))}
                    <div className="grid grid-cols-2 gap-1.5 mt-1.5">
                      <select value={reviewForm.rating} onChange={(e) => setReviewForm((f) => ({ ...f, rating: e.target.value }))} className="input-lattice text-xs">
                        {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} star{n !== 1 ? 's' : ''}</option>)}
                      </select>
                      <input value={reviewForm.project} onChange={(e) => setReviewForm((f) => ({ ...f, project: e.target.value }))} placeholder="Project" className="input-lattice text-xs" />
                    </div>
                    <input value={reviewForm.text} onChange={(e) => setReviewForm((f) => ({ ...f, text: e.target.value }))} placeholder="Review text" className="input-lattice text-xs w-full mt-1" />
                    <button onClick={() => addReview(p.id)} disabled={busy} className="btn-neon w-full text-xs mt-1 disabled:opacity-50">Add Review</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
