'use client';

/**
 * ClientPortal — share deliverables with clients via a share token and
 * record their approval decision. Wires consulting.portal-share /
 * portal-list / portal-respond / portal-delete.
 */

import { useCallback, useEffect, useState } from 'react';
import { Share2, Loader2, Trash2, Plus, Check, X, Link2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Share {
  id: string; title: string; engagementId: string | null; engagementName: string;
  client: string; summary: string; link: string; shareToken: string;
  approvalStatus: string; approvalNote: string; approvedBy: string; approvedAt: string | null;
}
interface EngagementOption { id: string; name: string }

const STATUS_COLOR: Record<string, string> = {
  awaiting: 'text-amber-400 bg-amber-500/10',
  approved: 'text-emerald-400 bg-emerald-500/10',
  rejected: 'text-rose-400 bg-rose-500/10',
  'changes-requested': 'text-sky-400 bg-sky-500/10',
};

export function ClientPortal({ engagements }: { engagements: EngagementOption[] }) {
  const [shares, setShares] = useState<Share[]>([]);
  const [counts, setCounts] = useState({ awaiting: 0, approved: 0 });
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', engagementId: '', client: '', summary: '', link: '' });
  const [error, setError] = useState('');
  const [respondFor, setRespondFor] = useState<Share | null>(null);
  const [respForm, setRespForm] = useState({ decision: 'approved', respondedBy: '', note: '' });

  const refresh = useCallback(async () => {
    const r = await lensRun('consulting', 'portal-list', {});
    const res = r.data?.result as { shares?: Share[]; awaiting?: number; approved?: number } | null;
    setShares(res?.shares || []);
    setCounts({ awaiting: res?.awaiting || 0, approved: res?.approved || 0 });
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function share() {
    setError('');
    if (!form.title.trim()) { setError('Title required'); return; }
    const r = await lensRun('consulting', 'portal-share', {
      title: form.title.trim(), engagementId: form.engagementId || undefined,
      client: form.client.trim(), summary: form.summary.trim(), link: form.link.trim(),
    });
    if (!r.data?.ok) { setError(r.data?.error || 'Failed'); return; }
    setForm({ title: '', engagementId: '', client: '', summary: '', link: '' });
    setOpen(false);
    await refresh();
  }
  async function respond() {
    if (!respondFor) return;
    await lensRun('consulting', 'portal-respond', {
      id: respondFor.id, decision: respForm.decision,
      respondedBy: respForm.respondedBy.trim(), note: respForm.note.trim(),
    });
    setRespondFor(null);
    setRespForm({ decision: 'approved', respondedBy: '', note: '' });
    await refresh();
  }
  async function del(id: string) {
    await lensRun('consulting', 'portal-delete', { id });
    await refresh();
  }

  if (loading) return <div className="flex justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-1.5 text-center">
            <p className="text-base font-bold text-amber-400">{counts.awaiting}</p>
            <p className="text-[9px] text-zinc-400 uppercase">Awaiting</p>
          </div>
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-1.5 text-center">
            <p className="text-base font-bold text-emerald-400">{counts.approved}</p>
            <p className="text-[9px] text-zinc-400 uppercase">Approved</p>
          </div>
        </div>
        <button onClick={() => { setOpen(true); setError(''); }}
          className="px-3 py-1.5 text-xs rounded bg-indigo-600 hover:bg-indigo-500 text-white font-semibold inline-flex items-center gap-1">
          <Plus className="w-3 h-3" />Share Deliverable
        </button>
      </div>

      <ul className="space-y-1.5">
        {shares.length === 0 && <li className="text-xs text-zinc-400 italic py-3 text-center">No deliverables shared yet.</li>}
        {shares.map(sh => (
          <li key={sh.id} className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2">
            <div className="group flex items-center gap-2">
              <Share2 className="w-4 h-4 text-indigo-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-zinc-100 truncate">{sh.title}</p>
                <p className="text-[10px] text-zinc-400">{sh.client}{sh.engagementName ? ` · ${sh.engagementName}` : ''}</p>
              </div>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold uppercase ${STATUS_COLOR[sh.approvalStatus] || 'text-zinc-400 bg-zinc-800'}`}>{sh.approvalStatus}</span>
              {sh.approvalStatus === 'awaiting' && (
                <button onClick={() => { setRespondFor(sh); setRespForm({ decision: 'approved', respondedBy: '', note: '' }); }}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300">Record reply</button>
              )}
              <button onClick={() => del(sh.id)} aria-label="Delete" className="opacity-0 group-hover:opacity-100 text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
            {sh.summary && <p className="text-[10px] text-zinc-400 mt-1">{sh.summary}</p>}
            <div className="flex items-center gap-3 mt-1">
              <span className="text-[10px] text-zinc-400 inline-flex items-center gap-1"><Link2 className="w-2.5 h-2.5" />token: {sh.shareToken}</span>
              {sh.link && <a href={sh.link} target="_blank" rel="noreferrer" className="text-[10px] text-indigo-400 hover:underline truncate">{sh.link}</a>}
            </div>
            {sh.approvedAt && (
              <p className="text-[10px] text-zinc-400 mt-1">
                {sh.approvalStatus} by {sh.approvedBy} on {new Date(sh.approvedAt).toLocaleDateString()}
                {sh.approvalNote ? ` — ${sh.approvalNote}` : ''}
              </p>
            )}
          </li>
        ))}
      </ul>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          <div className="w-full max-w-sm bg-zinc-950 border border-zinc-800 rounded-xl p-4" onClick={e => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
            <h4 className="text-sm font-bold text-zinc-100 mb-3">Share Deliverable</h4>
            <div className="space-y-2">
              <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Deliverable title"
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
              <select value={form.engagementId} onChange={e => setForm({ ...form, engagementId: e.target.value })}
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200">
                <option value="">No engagement</option>
                {engagements.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
              <input value={form.client} onChange={e => setForm({ ...form, client: e.target.value })} placeholder="Client"
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
              <textarea value={form.summary} onChange={e => setForm({ ...form, summary: e.target.value })} placeholder="Summary" rows={2}
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200 resize-none" />
              <input value={form.link} onChange={e => setForm({ ...form, link: e.target.value })} placeholder="Link to file (optional)"
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
            </div>
            {error && <p className="text-[11px] text-rose-400 mt-2">{error}</p>}
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setOpen(false)} className="px-3 py-1.5 text-xs rounded bg-zinc-800 text-zinc-300">Cancel</button>
              <button onClick={share} className="px-3 py-1.5 text-xs rounded bg-indigo-600 hover:bg-indigo-500 text-white font-semibold">Share</button>
            </div>
          </div>
        </div>
      )}

      {respondFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setRespondFor(null)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          <div className="w-full max-w-xs bg-zinc-950 border border-zinc-800 rounded-xl p-4" onClick={e => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
            <h4 className="text-sm font-bold text-zinc-100 mb-1">Client reply — {respondFor.title}</h4>
            <p className="text-[10px] text-zinc-400 mb-3">Record the decision a client made on this shared deliverable.</p>
            <div className="space-y-2">
              <select value={respForm.decision} onChange={e => setRespForm({ ...respForm, decision: e.target.value })}
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200">
                <option value="approved">Approved</option>
                <option value="changes-requested">Changes requested</option>
                <option value="rejected">Rejected</option>
              </select>
              <input value={respForm.respondedBy} onChange={e => setRespForm({ ...respForm, respondedBy: e.target.value })} placeholder="Responded by"
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
              <textarea value={respForm.note} onChange={e => setRespForm({ ...respForm, note: e.target.value })} placeholder="Note (optional)" rows={2}
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200 resize-none" />
            </div>
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setRespondFor(null)} className="px-3 py-1.5 text-xs rounded bg-zinc-800 text-zinc-300 inline-flex items-center gap-1">
                <X className="w-3 h-3" />Cancel
              </button>
              <button onClick={respond} className="px-3 py-1.5 text-xs rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold inline-flex items-center gap-1">
                <Check className="w-3 h-3" />Record
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
