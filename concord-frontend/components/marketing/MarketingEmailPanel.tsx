'use client';

/**
 * MarketingEmailPanel — block-based email builder + send engine.
 * Wires: email-create, email-update, email-list, email-delete, email-send.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Mail, Trash2, Send, ChevronDown, ChevronUp, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type BlockType = 'heading' | 'text' | 'image' | 'button' | 'divider' | 'spacer';
const BLOCK_TYPES: BlockType[] = ['heading', 'text', 'image', 'button', 'divider', 'spacer'];

interface EmailBlock { type: BlockType; content: string }
interface EmailStats { sent: number; opened: number; clicked: number; openRate: number; clickRate: number }
interface EmailDoc {
  id: string; name: string; subject: string; preheader: string | null;
  fromName: string; blocks: EmailBlock[]; blockCount: number; status: string;
  stats: EmailStats;
}

export function MarketingEmailPanel() {
  const [emails, setEmails] = useState<EmailDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EmailDoc | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  // editor form
  const [fName, setFName] = useState('');
  const [fSubject, setFSubject] = useState('');
  const [fPreheader, setFPreheader] = useState('');
  const [fFromName, setFFromName] = useState('');
  const [fBlocks, setFBlocks] = useState<EmailBlock[]>([]);

  // send form
  const [sendTarget, setSendTarget] = useState<string | null>(null);
  const [recipients, setRecipients] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('marketing', 'email-list', {});
    setEmails(r.data?.result?.emails || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const openCreate = () => {
    setEditing(null); setCreating(true);
    setFName(''); setFSubject(''); setFPreheader(''); setFFromName('');
    setFBlocks([]);
  };
  const openEdit = (e: EmailDoc) => {
    setEditing(e); setCreating(true);
    setFName(e.name); setFSubject(e.subject); setFPreheader(e.preheader || '');
    setFFromName(e.fromName); setFBlocks(e.blocks.map((b) => ({ ...b })));
  };

  const addBlock = (type: BlockType) => setFBlocks((b) => [...b, { type, content: '' }]);
  const updateBlock = (i: number, content: string) =>
    setFBlocks((b) => b.map((blk, idx) => (idx === i ? { ...blk, content } : blk)));
  const removeBlock = (i: number) => setFBlocks((b) => b.filter((_, idx) => idx !== i));
  const moveBlock = (i: number, dir: -1 | 1) => setFBlocks((b) => {
    const j = i + dir;
    if (j < 0 || j >= b.length) return b;
    const next = [...b];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  const save = async () => {
    if (!fName.trim()) { setError('Email name is required.'); return; }
    setBusy(true); setError(null);
    const payload = {
      name: fName.trim(), subject: fSubject.trim(), preheader: fPreheader.trim(),
      fromName: fFromName.trim(), blocks: fBlocks,
    };
    const r = editing
      ? await lensRun('marketing', 'email-update', { id: editing.id, ...payload })
      : await lensRun('marketing', 'email-create', payload);
    setBusy(false);
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setCreating(false);
    await refresh();
  };

  const del = async (id: string) => {
    const r = await lensRun('marketing', 'email-delete', { id });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    await refresh();
  };

  const send = async () => {
    if (!sendTarget) return;
    const list = recipients.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
    if (list.length === 0) { setError('Add at least one recipient.'); return; }
    setBusy(true); setError(null);
    const r = await lensRun('marketing', 'email-send', { id: sendTarget, recipients: list });
    setBusy(false);
    if (r.data?.ok === false) { setError(r.data?.error || 'Send failed'); return; }
    setSendTarget(null); setRecipients('');
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
          <Mail className="w-3.5 h-3.5 text-orange-400" /> Email builder &amp; send engine
        </h3>
        <button type="button" onClick={openCreate}
          className="flex items-center gap-1 bg-orange-600 hover:bg-orange-500 text-white text-xs font-medium rounded-lg px-3 py-1.5">
          <Plus className="w-3.5 h-3.5" /> New email
        </button>
      </div>

      {emails.length === 0 ? (
        <p className="text-[11px] text-zinc-500 italic">No emails yet. Build one with content blocks, then send.</p>
      ) : (
        <ul className="space-y-2">
          {emails.map((e) => (
            <li key={e.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-100 truncate">{e.name}</p>
                  <p className="text-[11px] text-zinc-500 truncate">{e.subject} · {e.blockCount} blocks · {e.status}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button type="button" onClick={() => openEdit(e)}
                    className="text-[11px] text-zinc-300 hover:text-white px-2 py-1 rounded border border-zinc-700">Edit</button>
                  <button type="button" onClick={() => { setSendTarget(e.id); setRecipients(''); }}
                    className="flex items-center gap-1 text-[11px] text-emerald-300 hover:text-emerald-200 px-2 py-1 rounded border border-emerald-800/60">
                    <Send className="w-3 h-3" /> Send
                  </button>
                  <button type="button" onClick={() => del(e.id)} aria-label="Delete email"
                    className="text-rose-400 hover:text-rose-300 p-1"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
              {e.stats.sent > 0 && (
                <div className="mt-2 flex gap-4 text-[10px] text-zinc-400">
                  <span>{e.stats.sent} sent</span>
                  <span className="text-blue-300">{e.stats.openRate}% open</span>
                  <span className="text-emerald-300">{e.stats.clickRate}% click</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Builder modal */}
      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setCreating(false)}>
          <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-3"
            onClick={(ev) => ev.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-white">{editing ? 'Edit' : 'New'} email</h4>
              <button type="button" onClick={() => setCreating(false)} aria-label="Close"><X className="w-4 h-4 text-zinc-400" /></button>
            </div>
            <input placeholder="Email name" value={fName} onChange={(e) => setFName(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100" />
            <input placeholder="Subject line" value={fSubject} onChange={(e) => setFSubject(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100" />
            <div className="grid grid-cols-2 gap-2">
              <input placeholder="Preheader" value={fPreheader} onChange={(e) => setFPreheader(e.target.value)}
                className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100" />
              <input placeholder="From name" value={fFromName} onChange={(e) => setFFromName(e.target.value)}
                className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100" />
            </div>

            <div>
              <div className="flex flex-wrap gap-1 mb-2">
                {BLOCK_TYPES.map((t) => (
                  <button key={t} type="button" onClick={() => addBlock(t)}
                    className="text-[10px] capitalize bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded px-2 py-1">+ {t}</button>
                ))}
              </div>
              {fBlocks.length === 0 ? (
                <p className="text-[11px] text-zinc-500 italic">Add content blocks to build the email body.</p>
              ) : (
                <ul className="space-y-1.5">
                  {fBlocks.map((b, i) => (
                    <li key={i} className="bg-zinc-900 border border-zinc-800 rounded-lg p-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] uppercase tracking-wider text-orange-400 font-semibold">{b.type}</span>
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={() => moveBlock(i, -1)} aria-label="Move up"
                            className="text-zinc-500 hover:text-white"><ChevronUp className="w-3.5 h-3.5" /></button>
                          <button type="button" onClick={() => moveBlock(i, 1)} aria-label="Move down"
                            className="text-zinc-500 hover:text-white"><ChevronDown className="w-3.5 h-3.5" /></button>
                          <button type="button" onClick={() => removeBlock(i)} aria-label="Remove block"
                            className="text-rose-400 hover:text-rose-300"><Trash2 className="w-3 h-3" /></button>
                        </div>
                      </div>
                      {b.type !== 'divider' && b.type !== 'spacer' && (
                        <input value={b.content} onChange={(e) => updateBlock(i, e.target.value)}
                          placeholder={b.type === 'image' ? 'Image URL' : b.type === 'button' ? 'Button label' : `${b.type} content`}
                          className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-100" />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setCreating(false)}
                className="text-xs text-zinc-400 hover:text-white px-3 py-1.5">Cancel</button>
              <button type="button" onClick={save} disabled={busy}
                className={cn('text-xs font-medium rounded-lg px-3 py-1.5 text-white',
                  busy ? 'bg-zinc-700' : 'bg-orange-600 hover:bg-orange-500')}>
                {busy ? 'Saving…' : 'Save email'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Send modal */}
      {sendTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setSendTarget(null)}>
          <div className="w-full max-w-sm bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-3"
            onClick={(ev) => ev.stopPropagation()}>
            <h4 className="text-sm font-semibold text-white">Send email</h4>
            <p className="text-[11px] text-zinc-500">One recipient per line (or comma-separated).</p>
            <textarea value={recipients} onChange={(e) => setRecipients(e.target.value)} rows={5}
              placeholder="recipient@example.com" className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 font-mono" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setSendTarget(null)}
                className="text-xs text-zinc-400 hover:text-white px-3 py-1.5">Cancel</button>
              <button type="button" onClick={send} disabled={busy}
                className={cn('flex items-center gap-1 text-xs font-medium rounded-lg px-3 py-1.5 text-white',
                  busy ? 'bg-zinc-700' : 'bg-emerald-600 hover:bg-emerald-500')}>
                <Send className="w-3.5 h-3.5" /> {busy ? 'Sending…' : 'Send now'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
