'use client';

import { useEffect, useState } from 'react';
import { FileText, Plus, Camera, Loader2, Clock, Check, X, DollarSign } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface Claim {
  id: string;
  policyId: string;
  carrier: string;
  kind: 'collision' | 'comprehensive' | 'property' | 'health' | 'life' | 'liability' | 'other';
  description: string;
  incidentDate: string;
  submittedDate?: string;
  status: 'draft' | 'submitted' | 'in_review' | 'approved' | 'paid' | 'denied';
  claimAmount: number;
  approvedAmount?: number;
  paidAmount?: number;
  daysSinceSubmit?: number;
  documents: number;
  adjusterName?: string;
}

const STATUS_COLORS: Record<Claim['status'], string> = {
  draft: 'bg-gray-500/20 text-gray-300',
  submitted: 'bg-blue-500/20 text-blue-300',
  in_review: 'bg-yellow-500/20 text-yellow-300',
  approved: 'bg-cyan-500/20 text-cyan-300',
  paid: 'bg-green-500/20 text-green-300',
  denied: 'bg-red-500/20 text-red-300',
};

interface ClaimDoc { id: string; title: string; kind: string; url?: string | null }

export function ClaimTracker() {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Partial<Claim>>({ kind: 'collision', claimAmount: 0 });
  // Photos staged in the new-claim form; attached via claim-document-add
  // right after the claim is filed (a document needs the claim's id).
  const [draftPhotos, setDraftPhotos] = useState<{ title: string; url: string }[]>([]);
  const [photoTitle, setPhotoTitle] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [showPhotoForm, setShowPhotoForm] = useState(false);
  // Per-claim attach editor (existing claims).
  const [attachFor, setAttachFor] = useState<string | null>(null);
  const [claimDocs, setClaimDocs] = useState<ClaimDoc[]>([]);
  const [attachTitle, setAttachTitle] = useState('');

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'insurance', action: 'claim-list', input: {} });
      setClaims((res.data?.result?.claims || []) as Claim[]);
    } catch (e) { console.error('[Claims] failed', e); }
    finally { setLoading(false); }
  }

  async function fileNew() {
    if (!draft.carrier?.trim() || !draft.description?.trim()) return;
    try {
      const res = await lensRun({ domain: 'insurance', action: 'claim-file', input: draft });
      const claimId = (res.data?.result as { claim?: Claim } | undefined)?.claim?.id;
      if (claimId) {
        for (const p of draftPhotos) {
          await lensRun({ domain: 'insurance', action: 'claim-document-add', input: { claimId, title: p.title, kind: 'photo', url: p.url || undefined } });
        }
      }
      setDraft({ kind: 'collision', claimAmount: 0 });
      setDraftPhotos([]);
      setPhotoTitle(''); setPhotoUrl(''); setShowPhotoForm(false);
      setAdding(false);
      await refresh();
    } catch (e) { console.error('[Claim] file failed', e); }
  }

  function stagePhoto() {
    if (!photoTitle.trim()) return;
    setDraftPhotos(prev => [...prev, { title: photoTitle.trim(), url: photoUrl.trim() }]);
    setPhotoTitle(''); setPhotoUrl('');
  }

  async function openAttach(claimId: string) {
    if (attachFor === claimId) { setAttachFor(null); return; }
    setAttachFor(claimId);
    setAttachTitle('');
    try {
      const res = await lensRun({ domain: 'insurance', action: 'claim-document-list', input: { claimId } });
      setClaimDocs((res.data?.result?.documents || []) as ClaimDoc[]);
    } catch (e) { console.error('[Claim] documents failed', e); setClaimDocs([]); }
  }

  async function addClaimPhoto(claimId: string) {
    if (!attachTitle.trim()) return;
    try {
      await lensRun({ domain: 'insurance', action: 'claim-document-add', input: { claimId, title: attachTitle.trim(), kind: 'photo' } });
      setAttachTitle('');
      const res = await lensRun({ domain: 'insurance', action: 'claim-document-list', input: { claimId } });
      setClaimDocs((res.data?.result?.documents || []) as ClaimDoc[]);
      await refresh();
    } catch (e) { console.error('[Claim] attach failed', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <FileText className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Claims</span>
        <span className="ml-auto text-[10px] text-gray-400">{claims.length} claims</span>
        <button onClick={() => setAdding(v => !v)} className="p-1 text-gray-400 hover:text-white" title="File new claim">
          <Plus className="w-4 h-4" />
        </button>
      </header>

      {adding && (
        <div className="p-3 border-b border-white/10 space-y-2 text-xs">
          <div className="grid grid-cols-3 gap-2">
            <select value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value as Claim['kind'] })} className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white">
              <option value="collision">Collision</option>
              <option value="comprehensive">Comprehensive</option>
              <option value="property">Property</option>
              <option value="health">Health</option>
              <option value="liability">Liability</option>
              <option value="other">Other</option>
            </select>
            <input value={draft.carrier || ''} onChange={e => setDraft({ ...draft, carrier: e.target.value })} placeholder="Carrier" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
            <input type="number" value={draft.claimAmount || 0} onChange={e => setDraft({ ...draft, claimAmount: Number(e.target.value) })} placeholder="Amount $" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
          </div>
          <textarea value={draft.description || ''} onChange={e => setDraft({ ...draft, description: e.target.value })} placeholder="Describe what happened…" rows={3} className="w-full px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white resize-y" />
          <input type="date" value={draft.incidentDate || ''} onChange={e => setDraft({ ...draft, incidentDate: e.target.value })} className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
          <div className="flex items-center gap-2">
            <button onClick={fileNew} className="px-3 py-1 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">File claim</button>
            <button onClick={() => setAdding(false)} className="px-3 py-1 text-xs rounded border border-white/10 text-gray-400 hover:text-white">Cancel</button>
            <button type="button" onClick={() => setShowPhotoForm(v => !v)} aria-label="Attach photos" title="Attach photos — they are added to the claim when you file it" className="ml-auto inline-flex items-center gap-1 px-2 py-1 text-[10px] rounded border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/10">
              <Camera className="w-3 h-3" /> Attach photos{draftPhotos.length > 0 ? ` (${draftPhotos.length})` : ''}
            </button>
          </div>
          {showPhotoForm && (
            <div className="space-y-1.5 pt-1">
              {draftPhotos.map((p, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px] text-gray-300">
                  <Camera className="w-3 h-3 text-cyan-400 shrink-0" />
                  <span className="truncate">{p.title}</span>
                  {p.url && <span className="text-gray-500 truncate">{p.url}</span>}
                  <button type="button" onClick={() => setDraftPhotos(prev => prev.filter((_, j) => j !== i))} className="ml-auto text-gray-500 hover:text-white" aria-label={`Remove photo ${p.title}`}><X className="w-3 h-3" /></button>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <input value={photoTitle} onChange={e => setPhotoTitle(e.target.value)} placeholder="Photo title (e.g. Front bumper damage)" className="flex-1 px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
                <input value={photoUrl} onChange={e => setPhotoUrl(e.target.value)} placeholder="URL (optional)" className="w-36 px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
                <button type="button" onClick={stagePhoto} className="px-2 py-1.5 rounded border border-white/10 text-gray-300 hover:text-white">Add photo</button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="max-h-[500px] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : claims.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><FileText className="w-6 h-6 mx-auto mb-2 opacity-30" /> No claims filed. Hit + when you need to file one.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {claims.map(c => {
              const STATUS_ICON: Record<Claim['status'], React.ReactNode> = {
                draft: <FileText className="w-3.5 h-3.5 text-gray-400" />,
                submitted: <Clock className="w-3.5 h-3.5 text-blue-400" />,
                in_review: <Loader2 className="w-3.5 h-3.5 text-yellow-400 animate-spin" />,
                approved: <Check className="w-3.5 h-3.5 text-cyan-400" />,
                paid: <DollarSign className="w-3.5 h-3.5 text-green-400" />,
                denied: <X className="w-3.5 h-3.5 text-red-400" />,
              };
              return (
                <li key={c.id} className="px-3 py-2 hover:bg-white/[0.03]">
                  <div className="flex items-center gap-2">
                    {STATUS_ICON[c.status]}
                    <span className="text-sm text-white font-medium">{c.carrier} #{c.id.slice(-6)}</span>
                    <span className={cn('text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded font-bold', STATUS_COLORS[c.status])}>{c.status.replace(/_/g, ' ')}</span>
                    <span className="ml-auto text-sm font-mono tabular-nums">
                      <span className="text-cyan-300">${c.claimAmount.toFixed(0)}</span>
                      {c.paidAmount != null && <span className="text-green-400"> → ${c.paidAmount.toFixed(0)}</span>}
                    </span>
                  </div>
                  <p className="text-xs text-gray-300 mt-1 line-clamp-2">{c.description}</p>
                  <div className="text-[10px] text-gray-400 mt-1 flex items-center gap-3">
                    <span>{c.kind} · incident {new Date(c.incidentDate).toLocaleDateString()}</span>
                    {c.daysSinceSubmit != null && <span>{c.daysSinceSubmit}d in pipeline</span>}
                    {c.adjusterName && <span>Adjuster: {c.adjusterName}</span>}
                    <span>{c.documents} docs</span>
                    <button type="button" onClick={() => openAttach(c.id)} className="inline-flex items-center gap-1 text-cyan-300 hover:text-cyan-200" aria-label={`Attach photos to claim ${c.id.slice(-6)}`}>
                      <Camera className="w-3 h-3" /> Attach
                    </button>
                  </div>
                  {attachFor === c.id && (
                    <div className="mt-2 space-y-1.5">
                      {claimDocs.map(d => (
                        <div key={d.id} className="flex items-center gap-2 text-[11px] text-gray-300">
                          <Camera className="w-3 h-3 text-cyan-400 shrink-0" />
                          <span className="truncate">{d.title}</span>
                          <span className="text-gray-500">{d.kind}</span>
                        </div>
                      ))}
                      {claimDocs.length === 0 && <p className="text-[11px] text-gray-500">No photos or documents attached yet.</p>}
                      <div className="flex items-center gap-2">
                        <input value={attachTitle} onChange={e => setAttachTitle(e.target.value)} placeholder="Photo title (e.g. Front bumper damage)" className="flex-1 px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white text-xs" />
                        <button type="button" onClick={() => addClaimPhoto(c.id)} className="px-2 py-1.5 text-xs rounded border border-white/10 text-gray-300 hover:text-white">Add photo</button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default ClaimTracker;
