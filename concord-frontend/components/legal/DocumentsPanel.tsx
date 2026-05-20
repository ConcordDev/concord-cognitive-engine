'use client';

import { useEffect, useState } from 'react';
import { FolderOpen, Loader2, Plus, FileText, Send, Eye } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Matter { id: string; name: string }
interface Template { id: string; name: string; body: string; kind: string }
interface LegalDoc {
  id: string; number: string; name: string;
  matterId: string; matterName: string;
  templateName: string; body: string; version: number;
  status: 'draft' | 'sent_for_signature' | 'signed';
  createdAt: string;
}

export function DocumentsPanel({ defaultTab = 'documents' }: { defaultTab?: 'documents' | 'templates' }) {
  const [tab, setTab] = useState<'documents' | 'templates'>(defaultTab);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [docs, setDocs] = useState<LegalDoc[]>([]);
  const [matters, setMatters] = useState<Matter[]>([]);
  const [loading, setLoading] = useState(true);
  const [genTemplate, setGenTemplate] = useState('');
  const [genMatter, setGenMatter] = useState('');
  const [genExtras, setGenExtras] = useState({ relief_sought: '', opposing_party: '' });
  const [showGen, setShowGen] = useState(false);
  const [showTplForm, setShowTplForm] = useState(false);
  const [tplForm, setTplForm] = useState({ name: '', body: '', kind: 'document' });
  const [viewDoc, setViewDoc] = useState<LegalDoc | null>(null);
  const [esignDoc, setEsignDoc] = useState<LegalDoc | null>(null);
  const [esignRecipients, setEsignRecipients] = useState([{ name: '', email: '' }]);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const [t, d, m] = await Promise.all([
        lensRun({ domain: 'legal', action: 'doc-templates-list', input: {} }),
        lensRun({ domain: 'legal', action: 'documents-list', input: {} }),
        lensRun({ domain: 'legal', action: 'matters-list', input: { status: 'open' } }),
      ]);
      setTemplates((t.data?.result?.templates || []) as Template[]);
      setDocs((d.data?.result?.documents || []) as LegalDoc[]);
      setMatters((m.data?.result?.matters || []) as Matter[]);
    } catch (e) { console.error('[Docs] refresh failed', e); }
    finally { setLoading(false); }
  }

  async function generate() {
    if (!genTemplate || !genMatter) return;
    try {
      const r = await lensRun({
        domain: 'legal', action: 'doc-generate',
        input: { templateId: genTemplate, matterId: genMatter, ...genExtras },
      });
      if (r.data?.ok === false) { alert(r.data?.error); return; }
      setShowGen(false);
      setGenTemplate(''); setGenMatter(''); setGenExtras({ relief_sought: '', opposing_party: '' });
      await refresh();
    } catch (e) { console.error('[Docs] generate failed', e); }
  }

  async function createTemplate() {
    if (!tplForm.name.trim() || !tplForm.body.trim()) return;
    try {
      await lensRun({ domain: 'legal', action: 'doc-templates-create', input: tplForm });
      setTplForm({ name: '', body: '', kind: 'document' });
      setShowTplForm(false);
      await refresh();
    } catch (e) { console.error('[Templates] create failed', e); }
  }

  async function sendEsign() {
    if (!esignDoc) return;
    const recipients = esignRecipients.filter(r => r.name && r.email);
    if (recipients.length === 0) { alert('Add at least one recipient with name + email.'); return; }
    try {
      const r = await lensRun({
        domain: 'legal', action: 'esign-envelope-create',
        input: { documentId: esignDoc.id, recipients },
      });
      if (r.data?.ok === false) { alert(r.data?.error); return; }
      setEsignDoc(null);
      setEsignRecipients([{ name: '', email: '' }]);
      await refresh();
    } catch (e) { console.error('[Esign] failed', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-amber-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <FolderOpen className="w-4 h-4 text-amber-400" />
        <span className="text-sm font-semibold text-gray-200">Documents</span>
        <div className="flex items-center gap-1 ml-2">
          <button onClick={() => setTab('documents')} className={cn('px-2 py-1 text-xs rounded', tab === 'documents' ? 'bg-amber-500/15 text-amber-300' : 'text-gray-400 hover:text-white')}>Documents ({docs.length})</button>
          <button onClick={() => setTab('templates')} className={cn('px-2 py-1 text-xs rounded', tab === 'templates' ? 'bg-amber-500/15 text-amber-300' : 'text-gray-400 hover:text-white')}>Templates ({templates.length})</button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {tab === 'documents' && (
            <button onClick={() => setShowGen(v => !v)} className="px-2.5 py-1 text-xs rounded bg-amber-500 text-black font-semibold hover:bg-amber-400 inline-flex items-center gap-1">
              <Plus className="w-3 h-3" />Generate
            </button>
          )}
          {tab === 'templates' && (
            <button onClick={() => setShowTplForm(v => !v)} className="px-2.5 py-1 text-xs rounded bg-amber-500 text-black font-semibold hover:bg-amber-400 inline-flex items-center gap-1">
              <Plus className="w-3 h-3" />New template
            </button>
          )}
        </div>
      </header>

      {/* Generate from template */}
      {tab === 'documents' && showGen && (
        <div className="p-3 grid grid-cols-12 gap-2 border-b border-white/10">
          <select value={genTemplate} onChange={e => setGenTemplate(e.target.value)} className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="">Pick template *</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select value={genMatter} onChange={e => setGenMatter(e.target.value)} className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="">Matter *</option>
            {matters.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <input value={genExtras.opposing_party} onChange={e => setGenExtras({ ...genExtras, opposing_party: e.target.value })} placeholder="Opposing party (optional)" className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={genExtras.relief_sought} onChange={e => setGenExtras({ ...genExtras, relief_sought: e.target.value })} placeholder="Relief sought (for demand letters)" className="col-span-9 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <button onClick={generate} disabled={!genTemplate || !genMatter} className="col-span-3 px-3 py-1.5 text-xs rounded bg-amber-500 text-black font-bold hover:bg-amber-400 disabled:opacity-40">Generate</button>
        </div>
      )}

      {/* New template form */}
      {tab === 'templates' && showTplForm && (
        <div className="p-3 grid grid-cols-12 gap-2 border-b border-white/10">
          <input value={tplForm.name} onChange={e => setTplForm({ ...tplForm, name: e.target.value })} placeholder="Template name *" className="col-span-8 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <select value={tplForm.kind} onChange={e => setTplForm({ ...tplForm, kind: e.target.value })} className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="letter">Letter</option>
            <option value="agreement">Agreement</option>
            <option value="motion">Motion</option>
            <option value="document">Other document</option>
          </select>
          <textarea value={tplForm.body} onChange={e => setTplForm({ ...tplForm, body: e.target.value })} placeholder="Body — use {{client_name}}, {{matter_name}}, {{case_number}}, {{hourly_rate}}, {{opposing_party}}, {{attorney_name}}, {{today}} as merge fields" rows={6} className="col-span-12 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <button onClick={createTemplate} className="col-span-12 px-3 py-1.5 text-xs rounded bg-amber-500 text-black font-bold hover:bg-amber-400">Save template</button>
        </div>
      )}

      {/* List body */}
      <div className="max-h-[28rem] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : tab === 'documents' ? (
          docs.length === 0 ? (
            <div className="px-3 py-10 text-center text-xs text-gray-500"><FolderOpen className="w-6 h-6 mx-auto mb-2 opacity-30" />No documents yet. Generate one from a template.</div>
          ) : (
            <ul className="divide-y divide-white/5">
              {docs.map(d => (
                <li key={d.id} className="px-4 py-2.5 hover:bg-white/[0.02] group flex items-center gap-3">
                  <FileText className={cn('w-3.5 h-3.5', d.status === 'signed' ? 'text-emerald-400' : d.status === 'sent_for_signature' ? 'text-amber-400' : 'text-gray-400')} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white truncate">{d.name}</div>
                    <div className="text-[10px] text-gray-500 truncate">{d.matterName} · {d.templateName} · v{d.version}</div>
                  </div>
                  <span className={cn(
                    'text-[9px] uppercase px-1.5 py-0.5 rounded font-mono',
                    d.status === 'signed' ? 'bg-emerald-500/20 text-emerald-300' : d.status === 'sent_for_signature' ? 'bg-amber-500/20 text-amber-300' : 'bg-white/5 text-gray-400',
                  )}>{d.status.replace(/_/g, ' ')}</span>
                  <button onClick={() => setViewDoc(d)} className="p-1.5 rounded hover:bg-white/[0.05] text-gray-300" title="View"><Eye className="w-3.5 h-3.5" /></button>
                  {d.status === 'draft' && (
                    <button onClick={() => setEsignDoc(d)} className="p-1.5 rounded hover:bg-amber-500/20 text-amber-300" title="Send for e-signature">
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )
        ) : templates.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500"><FileText className="w-6 h-6 mx-auto mb-2 opacity-30" />No templates.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {templates.map(t => (
              <li key={t.id} className="px-4 py-2.5 hover:bg-white/[0.02] flex items-center gap-3">
                <FileText className="w-3.5 h-3.5 text-amber-400" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">{t.name}</div>
                  <div className="text-[10px] text-gray-500 truncate">{t.kind}</div>
                </div>
                <details className="text-[10px] text-amber-300 cursor-pointer">
                  <summary>Preview</summary>
                  <pre className="mt-2 p-2 bg-black/30 rounded border border-white/10 font-mono whitespace-pre-wrap max-w-xl text-gray-300">{t.body}</pre>
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* View modal */}
      {viewDoc && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setViewDoc(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-[#0d1117] border border-amber-500/30 rounded-lg max-w-3xl w-full max-h-[80vh] overflow-hidden flex flex-col">
            <header className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
              <FileText className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-semibold text-gray-200 flex-1">{viewDoc.name}</span>
              <button onClick={() => setViewDoc(null)} className="text-gray-400 hover:text-white text-xl">×</button>
            </header>
            <pre className="flex-1 overflow-y-auto p-6 text-xs text-gray-200 font-mono whitespace-pre-wrap">{viewDoc.body}</pre>
          </div>
        </div>
      )}

      {/* E-sign envelope modal */}
      {esignDoc && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setEsignDoc(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-[#0d1117] border border-amber-500/30 rounded-lg max-w-xl w-full overflow-hidden">
            <header className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
              <Send className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-semibold text-gray-200 flex-1">Send for e-signature</span>
              <button onClick={() => setEsignDoc(null)} className="text-gray-400 hover:text-white text-xl">×</button>
            </header>
            <div className="p-4 space-y-3">
              <div className="text-xs text-gray-300">Document: <span className="text-white">{esignDoc.name}</span></div>
              <div className="space-y-2">
                {esignRecipients.map((r, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2">
                    <input value={r.name} onChange={(e) => setEsignRecipients(prev => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} placeholder="Recipient name" className="col-span-5 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                    <input value={r.email} onChange={(e) => setEsignRecipients(prev => prev.map((x, j) => j === i ? { ...x, email: e.target.value } : x))} placeholder="Email" className="col-span-7 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                  </div>
                ))}
                <button onClick={() => setEsignRecipients([...esignRecipients, { name: '', email: '' }])} className="text-[11px] text-amber-300 hover:text-amber-200">+ Add another recipient</button>
              </div>
              <div className="text-[10px] text-gray-500 italic">Consents recorded under E-SIGN Act 15 USC § 7001 + UETA § 7.</div>
              <button onClick={sendEsign} className="w-full px-3 py-2 text-xs rounded bg-amber-500 text-black font-bold hover:bg-amber-400">Create envelope + mark sent</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DocumentsPanel;
