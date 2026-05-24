'use client';

/**
 * ProposalBuilder — assemble proposals from reusable section templates,
 * fill section content, track completeness, and capture an e-signature
 * acceptance. Wires consulting.proposal-templates / proposal-create /
 * proposal-list / proposal-update-section / proposal-sign / proposal-delete.
 */

import { useCallback, useEffect, useState } from 'react';
import { FileSignature, Loader2, Trash2, Plus, PenTool } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Section { key: string; prompt: string; content: string }
interface Signature { signerName: string; signedAt: string; ip: string }
interface Proposal {
  id: string; title: string; client: string; value: number;
  sections: Section[]; status: string; signature: Signature | null; completeness: number;
}
interface TemplateSection { key: string; prompt: string }

export function ProposalBuilder() {
  const [templates, setTemplates] = useState<TemplateSection[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [client, setClient] = useState('');
  const [value, setValue] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [signFor, setSignFor] = useState<string | null>(null);
  const [signerName, setSignerName] = useState('');

  const refresh = useCallback(async () => {
    const [t, p] = await Promise.all([
      lensRun('consulting', 'proposal-templates', {}),
      lensRun('consulting', 'proposal-list', {}),
    ]);
    setTemplates(((t.data?.result as { sections?: TemplateSection[] } | null)?.sections) || []);
    setProposals(((p.data?.result as { proposals?: Proposal[] } | null)?.proposals) || []);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  function openCreate() {
    setTitle(''); setClient(''); setValue('');
    setPicked(templates.map(t => t.key));
    setOpen(true);
  }
  async function create() {
    if (!title.trim()) return;
    await lensRun('consulting', 'proposal-create', {
      title: title.trim(), client: client.trim(),
      value: value ? Number(value) : 0,
      sections: picked,
    });
    setOpen(false);
    await refresh();
  }
  async function del(id: string) {
    await lensRun('consulting', 'proposal-delete', { id });
    await refresh();
  }
  async function saveSection(id: string, sectionKey: string, content: string) {
    await lensRun('consulting', 'proposal-update-section', { id, sectionKey, content });
    await refresh();
  }
  async function sign() {
    if (!signFor || !signerName.trim()) return;
    await lensRun('consulting', 'proposal-sign', { id: signFor, signerName: signerName.trim() });
    setSignFor(null); setSignerName('');
    await refresh();
  }

  if (loading) return <div className="flex justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button onClick={openCreate}
          className="px-3 py-1.5 text-xs rounded bg-indigo-600 hover:bg-indigo-500 text-white font-semibold inline-flex items-center gap-1">
          <Plus className="w-3 h-3" />New Proposal
        </button>
      </div>

      <ul className="space-y-1.5">
        {proposals.length === 0 && <li className="text-xs text-zinc-400 italic py-3 text-center">No proposals yet.</li>}
        {proposals.map(p => (
          <li key={p.id} className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2">
            <div className="group flex items-center gap-2">
              <FileSignature className="w-4 h-4 text-indigo-400 shrink-0" />
              <button onClick={() => setExpanded(expanded === p.id ? null : p.id)} className="text-left min-w-0 flex-1">
                <p className="text-xs font-semibold text-zinc-100 truncate">{p.title}</p>
                <p className="text-[10px] text-zinc-400">{p.client} · ${p.value.toLocaleString()} · {p.completeness}% complete · {p.status}</p>
              </button>
              {p.signature ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-semibold">SIGNED</span>
              ) : (
                <button onClick={() => { setSignFor(p.id); setSignerName(''); }}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 inline-flex items-center gap-1">
                  <PenTool className="w-3 h-3" />Sign
                </button>
              )}
              <button onClick={() => del(p.id)} aria-label="Delete" className="opacity-0 group-hover:opacity-100 text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
            <div className="mt-1.5 h-1 rounded-full bg-zinc-800 overflow-hidden">
              <div className="h-full bg-indigo-500" style={{ width: `${p.completeness}%` }} />
            </div>
            {expanded === p.id && (
              <div className="mt-2 pt-2 border-t border-zinc-800 space-y-2">
                {p.signature && (
                  <p className="text-[10px] text-emerald-400">Accepted by {p.signature.signerName} on {new Date(p.signature.signedAt).toLocaleDateString()}</p>
                )}
                {p.sections.map(sec => (
                  <div key={sec.key}>
                    <p className="text-[11px] font-semibold text-zinc-300 capitalize">{sec.key.replace(/-/g, ' ')}</p>
                    <p className="text-[10px] text-zinc-400 mb-1">{sec.prompt}</p>
                    <textarea
                      defaultValue={sec.content}
                      onBlur={e => { if (e.target.value !== sec.content) void saveSection(p.id, sec.key, e.target.value); }}
                      rows={2}
                      placeholder="Write this section…"
                      className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200 resize-none" />
                  </div>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          <div className="w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-xl p-4 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
            <h4 className="text-sm font-bold text-zinc-100 mb-3">New Proposal</h4>
            <div className="space-y-2">
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Proposal title"
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
              <input value={client} onChange={e => setClient(e.target.value)} placeholder="Client"
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
              <input value={value} onChange={e => setValue(e.target.value)} placeholder="Estimated value ($)"
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
              <p className="text-[10px] text-zinc-400 uppercase mt-2">Sections</p>
              <div className="grid grid-cols-2 gap-1">
                {templates.map(t => (
                  <label key={t.key} className="flex items-center gap-1.5 text-[11px] text-zinc-300 cursor-pointer">
                    <input type="checkbox" checked={picked.includes(t.key)}
                      onChange={() => setPicked(picked.includes(t.key) ? picked.filter(k => k !== t.key) : [...picked, t.key])} />
                    <span className="capitalize">{t.key.replace(/-/g, ' ')}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setOpen(false)} className="px-3 py-1.5 text-xs rounded bg-zinc-800 text-zinc-300">Cancel</button>
              <button onClick={create} disabled={!title.trim()}
                className="px-3 py-1.5 text-xs rounded bg-indigo-600 hover:bg-indigo-500 text-white font-semibold disabled:opacity-40">Create</button>
            </div>
          </div>
        </div>
      )}

      {signFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setSignFor(null)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          <div className="w-full max-w-xs bg-zinc-950 border border-zinc-800 rounded-xl p-4" onClick={e => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
            <h4 className="text-sm font-bold text-zinc-100 mb-1">E-signature acceptance</h4>
            <p className="text-[10px] text-zinc-400 mb-3">Typing a name records a binding acceptance with a timestamp.</p>
            <input value={signerName} onChange={e => setSignerName(e.target.value)} placeholder="Signer full name"
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200 mb-3" />
            <div className="flex justify-end gap-2">
              <button onClick={() => setSignFor(null)} className="px-3 py-1.5 text-xs rounded bg-zinc-800 text-zinc-300">Cancel</button>
              <button onClick={sign} disabled={!signerName.trim()}
                className="px-3 py-1.5 text-xs rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold disabled:opacity-40">Accept &amp; Sign</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
