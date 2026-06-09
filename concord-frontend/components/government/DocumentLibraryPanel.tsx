'use client';

import { useEffect, useState, useCallback } from 'react';
import { FileSignature, Loader2, Plus, Trash2, PenLine, ShieldCheck, FileText } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Signature { id: string; signerName: string; signerEmail: string; signedAt: string; fingerprint: string }
interface GovDocument {
  id: string; title: string; category: string; bodyText: string; fileUrl: string;
  requiresSignature: boolean; signatures: Signature[]; publishedAt: string;
}

const CATEGORIES = [
  ['application_form', 'Application Form'], ['permit_form', 'Permit Form'], ['tax_form', 'Tax Form'],
  ['policy', 'Policy'], ['ordinance', 'Ordinance'], ['notice', 'Notice'],
  ['agreement', 'Agreement'], ['other', 'Other'],
];

export function DocumentLibraryPanel() {
  const [documents, setDocuments] = useState<GovDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ title: '', category: 'application_form', bodyText: '', fileUrl: '', requiresSignature: true });
  const [pubError, setPubError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [signForm, setSignForm] = useState({ signerName: '', signerEmail: '', typedSignature: '' });
  const [signError, setSignError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'government', action: 'documents-list', input: {} });
      setDocuments((res.data?.result?.documents || []) as GovDocument[]);
    } catch (e) { console.error('[Docs] refresh', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function publish() {
    setPubError(null);
    if (!form.title.trim() || !form.bodyText.trim()) { setPubError('Title and body text required.'); return; }
    try {
      const res = await lensRun({ domain: 'government', action: 'documents-publish', input: form });
      if (res.data?.ok === false) { setPubError((res.data?.error as string) || 'publish failed'); return; }
      setForm({ title: '', category: 'application_form', bodyText: '', fileUrl: '', requiresSignature: true });
      await refresh();
    } catch (e) { setPubError(e instanceof Error ? e.message : 'failed'); }
  }

  async function remove(id: string) {
    try {
      await lensRun({ domain: 'government', action: 'documents-delete', input: { id } });
      setDocuments(prev => prev.filter(d => d.id !== id));
    } catch (e) { console.error('[Docs] delete', e); }
  }

  async function sign(id: string) {
    setSignError(null);
    if (!signForm.signerName.trim() || !signForm.signerEmail.trim() || !signForm.typedSignature.trim()) {
      setSignError('All signature fields required.');
      return;
    }
    try {
      const res = await lensRun({ domain: 'government', action: 'documents-sign', input: { id, ...signForm } });
      if (res.data?.ok === false) { setSignError((res.data?.error as string) || 'sign failed'); return; }
      setSignForm({ signerName: '', signerEmail: '', typedSignature: '' });
      await refresh();
    } catch (e) { setSignError(e instanceof Error ? e.message : 'failed'); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <FileSignature className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Document &amp; form library</span>
        <span className="ml-auto text-[10px] text-gray-400">{documents.length} documents</span>
      </header>

      {/* Publish a document */}
      <div className="p-3 border-b border-white/10 space-y-2">
        <div className="grid grid-cols-6 gap-2">
          <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Document title" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <label className="text-[10px] text-gray-400 inline-flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={form.requiresSignature} onChange={e => setForm({ ...form, requiresSignature: e.target.checked })} className="accent-cyan-500" />
            Needs signature
          </label>
        </div>
        <input value={form.fileUrl} onChange={e => setForm({ ...form, fileUrl: e.target.value })} placeholder="Attachment URL (optional)" className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <textarea value={form.bodyText} onChange={e => setForm({ ...form, bodyText: e.target.value })} placeholder="Document body / form text" rows={3} className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        {pubError && <div className="text-[10px] text-rose-400">{pubError}</div>}
        <button onClick={publish} className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 inline-flex items-center gap-1"><Plus className="w-3 h-3" />Publish document</button>
      </div>

      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" />Loading…</div>
        ) : documents.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><FileText className="w-6 h-6 mx-auto mb-2 opacity-30" />No documents published yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {documents.map(d => {
              const isOpen = expanded === d.id;
              return (
                <li key={d.id} className="px-3 py-2 hover:bg-white/[0.03] group">
                  <div className="flex items-center gap-2">
                    <button onClick={() => { setExpanded(isOpen ? null : d.id); setSignError(null); setSignForm({ signerName: '', signerEmail: '', typedSignature: '' }); }} className="flex-1 min-w-0 text-left">
                      <div className="text-sm text-white truncate">{d.title}</div>
                      <div className="text-[10px] text-gray-400">
                        {CATEGORIES.find(c => c[0] === d.category)?.[1] || d.category}
                        {d.requiresSignature && ` · ${d.signatures.length} signature${d.signatures.length === 1 ? '' : 's'}`}
                      </div>
                    </button>
                    {d.requiresSignature && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/15 text-amber-300 inline-flex items-center gap-0.5">
                        <PenLine className="w-2.5 h-2.5" />signable
                      </span>
                    )}
                    <button aria-label="Delete" onClick={() => remove(d.id)} className="opacity-0 group-hover:opacity-100 p-1 text-rose-400"><Trash2 className="w-3 h-3" /></button>
                  </div>
                  {isOpen && (
                    <div className="mt-2 pl-2 border-l-2 border-cyan-500/20 space-y-2">
                      <p className="text-xs text-gray-300 whitespace-pre-wrap">{d.bodyText}</p>
                      {d.fileUrl && (
                        <a href={d.fileUrl} target="_blank" rel="noreferrer" className="text-[10px] text-cyan-400 hover:underline inline-flex items-center gap-1">
                          <FileText className="w-3 h-3" />Open attachment
                        </a>
                      )}
                      {d.signatures.length > 0 && (
                        <div>
                          <div className="text-[10px] uppercase text-gray-400 mb-1">Signatures</div>
                          <ul className="space-y-1">
                            {d.signatures.map(s => (
                              <li key={s.id} className="text-[11px] text-gray-300 bg-white/[0.03] rounded px-2 py-1 inline-flex items-center gap-2 w-full">
                                <ShieldCheck className="w-3 h-3 text-emerald-400 shrink-0" />
                                <span className="flex-1">{s.signerName} ({s.signerEmail})</span>
                                <span className="font-mono text-[10px] text-gray-400">{s.fingerprint}</span>
                                <span className="text-[10px] text-gray-400">{new Date(s.signedAt).toLocaleDateString()}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {d.requiresSignature && (
                        <div className="space-y-1.5">
                          <div className="text-[10px] uppercase text-gray-400 inline-flex items-center gap-1"><PenLine className="w-3 h-3" />E-sign this document</div>
                          <div className="grid grid-cols-2 gap-2">
                            <input value={signForm.signerName} onChange={e => setSignForm({ ...signForm, signerName: e.target.value })} placeholder="Full legal name" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                            <input value={signForm.signerEmail} onChange={e => setSignForm({ ...signForm, signerEmail: e.target.value })} placeholder="Email" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                          </div>
                          <input value={signForm.typedSignature} onChange={e => setSignForm({ ...signForm, typedSignature: e.target.value })} placeholder="Type your full name to sign" className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white italic" />
                          {signError && <div className="text-[10px] text-rose-400">{signError}</div>}
                          <button onClick={() => sign(d.id)} className="px-3 py-1 text-[10px] rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 inline-flex items-center gap-1">
                            <PenLine className="w-3 h-3" />Sign document
                          </button>
                        </div>
                      )}
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

export default DocumentLibraryPanel;
