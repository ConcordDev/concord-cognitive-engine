'use client';

/**
 * PhilosophyChannels — Are.na 2026-shape idea curation: channels of
 * blocks (text / link / quote), with blocks connectable across
 * channels. Wires the philosophy.channel-* and philosophy.block-* macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { Library, Plus, Trash2, Quote, Link2, FileText, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { StickyDeleteConfirm } from '@/components/common/StickyDeleteConfirm';

interface ChannelMeta { id: string; title: string; description: string; blockCount: number; role?: 'owner' | 'collaborator' }
interface Block { id: string; kind: string; content: string; source: string | null; channelIds: string[]; canDelete?: boolean }
interface Channel { id: string; title: string; description: string; role?: 'owner' | 'collaborator' }

const KIND_ICON: Record<string, typeof Quote> = { quote: Quote, link: Link2, text: FileText };

export function PhilosophyChannels() {
  const [channels, setChannels] = useState<ChannelMeta[]>([]);
  const [active, setActive] = useState<{ channel: Channel; blocks: Block[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState('');
  const [draft, setDraft] = useState({ kind: 'text', content: '', source: '' });
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmChannelId, setConfirmChannelId] = useState<string | null>(null);
  const [confirmBlockId, setConfirmBlockId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await lensRun('philosophy', 'channel-list', {});
    setChannels((r.data?.result?.channels as ChannelMeta[]) || []);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const open = useCallback(async (id: string) => {
    const r = await lensRun('philosophy', 'channel-detail', { id });
    if (r.data?.ok) setActive({ channel: r.data.result?.channel as Channel, blocks: (r.data.result?.blocks as Block[]) || [] });
  }, []);
  async function reload() { if (active) await open(active.channel.id); }

  async function createChannel() {
    if (!newTitle.trim()) return;
    const r = await lensRun('philosophy', 'channel-create', { title: newTitle.trim() });
    if (!r.data?.ok) {
      // A refusal (e.g. a duplicate title) speaks — it used to vanish.
      setNotice(r.data?.error || 'Channel could not be created.');
      return;
    }
    setNotice(null);
    setNewTitle('');
    await refresh();
    await open(r.data.result?.channel.id);
  }
  async function deleteChannel(id: string) {
    // In-page two-step (the fleet standard): the native confirm() this
    // used to gate on is a dead control in the platform's dialog
    // handling — suppressed, the delete verb never fired (F3).
    const title = channels.find(c => c.id === id)?.title || 'channel';
    const r = await lensRun('philosophy', 'channel-delete', { id });
    setConfirmChannelId(null);
    if (!r.data?.ok) { setNotice(r.data?.error || 'Channel could not be deleted.'); return; }
    if (active?.channel.id === id) setActive(null);
    setNotice(`Channel "${title}" deleted.`);
    await refresh();
  }
  async function addBlock() {
    if (!active || !draft.content.trim()) return;
    await lensRun('philosophy', 'block-add', {
      channelId: active.channel.id, kind: draft.kind, content: draft.content.trim(), source: draft.source.trim(),
    });
    setDraft({ kind: 'text', content: '', source: '' });
    await reload(); await refresh();
  }
  async function deleteBlock(id: string) {
    const r = await lensRun('philosophy', 'block-delete', { id });
    setConfirmBlockId(null);
    if (!r.data?.ok) { setNotice(r.data?.error || 'Block could not be deleted.'); return; }
    setNotice('Block deleted.');
    await reload(); await refresh();
  }

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Library className="w-4 h-4 text-indigo-400" />
        <h2 className="text-sm font-bold text-zinc-100">Idea Channels</h2>
      </div>

      <div className="flex gap-1.5 mb-3">
        <input value={newTitle} onChange={e => setNewTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void createChannel(); }}
          placeholder="New channel title…"
          className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-sm text-zinc-200" />
        <button onClick={createChannel} disabled={!newTitle.trim()}
          className="px-3 py-1.5 text-xs rounded bg-indigo-600 hover:bg-indigo-500 text-white font-semibold disabled:opacity-40">New channel</button>
      </div>

      {!newTitle.trim() && <p className="text-[11px] text-zinc-500 mb-3" role="note">Give the channel a title to create it.</p>}
      {notice && <p className="text-[11px] text-amber-300 mb-3" role="status">{notice}</p>}

      <div className="grid sm:grid-cols-[200px_1fr] gap-3">
        <ul className="space-y-1">
          {channels.length === 0 && <li className="text-[11px] text-zinc-400 italic">No channels yet.</li>}
          {channels.map(c => (
            <li key={c.id} className="group flex items-center gap-1">
              <button onClick={() => open(c.id)}
                className={cn('flex-1 text-left rounded-lg px-2.5 py-2 border', active?.channel.id === c.id ? 'bg-indigo-600/15 border-indigo-700/50' : 'bg-zinc-900/60 border-zinc-800 hover:border-zinc-700')}>
                <p className="text-xs font-semibold text-zinc-100 truncate">{c.title}</p>
                <p className="text-[10px] text-zinc-400">{c.blockCount} blocks</p>
              </button>
              {c.role !== 'collaborator' && (
                <StickyDeleteConfirm
                  armed={confirmChannelId === c.id}
                  onArm={() => setConfirmChannelId(c.id)}
                  onConfirm={() => { void deleteChannel(c.id); }}
                  onCancel={() => setConfirmChannelId(null)}
                  armLabel={<Trash2 className="w-3 h-3" />}
                  confirmLabel={`Delete "${c.title}"?`}
                  className="opacity-0 group-hover:opacity-100 p-1 text-rose-400 shrink-0"
                />
              )}
            </li>
          ))}
        </ul>

        {active ? (
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3">
            <h3 className="text-sm font-bold text-zinc-100 mb-2">{active.channel.title}</h3>

            <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-2 mb-3 space-y-1.5">
              <div className="flex gap-1.5">
                <select aria-label="Block kind" value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value })}
                  className="min-h-11 bg-zinc-900 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200">
                  <option value="text">Text</option>
                  <option value="quote">Quote</option>
                  <option value="link">Link</option>
                </select>
                <input value={draft.source} onChange={e => setDraft({ ...draft, source: e.target.value })} placeholder="Source (optional)"
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
              </div>
              <div className="flex gap-1.5">
                <input value={draft.content} onChange={e => setDraft({ ...draft, content: e.target.value })}
                  onKeyDown={e => { if (e.key === 'Enter') void addBlock(); }}
                  placeholder="Block content…"
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
                <button onClick={addBlock} disabled={!draft.content.trim()}
                  className="px-3 py-1 text-xs rounded bg-indigo-600 hover:bg-indigo-500 text-white font-semibold disabled:opacity-40 inline-flex items-center gap-1">
                  <Plus className="w-3 h-3" />Add
                </button>
              </div>
            </div>

            {active.blocks.length === 0 ? (
              <p className="text-xs text-zinc-400 italic">No blocks yet — add ideas, quotes and links above.</p>
            ) : (
              <div className="grid sm:grid-cols-2 gap-2">
                {active.blocks.map(b => {
                  const Icon = KIND_ICON[b.kind] || FileText;
                  return (
                    <div key={b.id} className="group bg-zinc-950 border border-zinc-800 rounded-lg p-2">
                      <div className="flex items-center gap-1 mb-1">
                        <Icon className="w-3 h-3 text-indigo-400" />
                        <span className="text-[9px] uppercase text-zinc-400">{b.kind}</span>
                        {b.channelIds.length > 1 && <span className="text-[9px] text-indigo-400">· in {b.channelIds.length} channels</span>}
                        {b.canDelete !== false && (confirmBlockId === b.id ? (
                          <span className="ml-auto flex items-center gap-1 shrink-0">
                            <button aria-label="Confirm delete" onClick={() => deleteBlock(b.id)} className="px-1.5 py-0.5 text-[10px] rounded bg-rose-600 text-white font-semibold">Delete?</button>
                            <button aria-label="Cancel delete" onClick={() => setConfirmBlockId(null)} className="px-1.5 py-0.5 text-[10px] rounded bg-zinc-800 text-zinc-300">Keep</button>
                          </span>
                        ) : (
                          <button aria-label="Delete" onClick={() => setConfirmBlockId(b.id)} className="ml-auto opacity-0 group-hover:opacity-100 text-rose-400"><Trash2 className="w-3 h-3" /></button>
                        ))}
                      </div>
                      {b.kind === 'link' && /^https?:\/\//i.test(b.content.trim()) ? (
                        <a href={b.content.trim()} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-300 underline break-all">{b.content}</a>
                      ) : (
                        <p className={cn('text-xs text-zinc-200', b.kind === 'quote' && 'italic')}>{b.content}</p>
                      )}
                      {b.source && <p className="text-[10px] text-zinc-400 mt-1">— {b.source}</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="bg-zinc-900/20 border border-dashed border-zinc-800 rounded-lg flex items-center justify-center text-xs text-zinc-400 min-h-[140px]">
            Select or create a channel.
          </div>
        )}
      </div>
    </div>
  );
}
