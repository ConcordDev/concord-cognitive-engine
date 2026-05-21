'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChannelIcon } from './SlackShell';
import { cn } from '@/lib/utils';

export interface Channel {
  id: string;
  number: string;
  name: string;
  kind: 'channel' | 'dm' | 'group_dm';
  isPrivate?: boolean;
  topic?: string;
  unread: number;
  lastTs: string | null;
  lastPreview: string;
  archived?: boolean;
}

export function ChannelList({
  activeId, onSelect, onRefresh,
}: {
  activeId: string | null;
  onSelect: (id: string) => void;
  onRefresh?: () => void;
}) {
  const [list, setList] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: '', kind: 'channel' as 'channel' | 'dm' | 'group_dm', isPrivate: false });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'message', action: 'channels-list', input: {} });
      setList((r.data?.result?.channels || []) as Channel[]);
      onRefresh?.();
    } catch (e) { console.error('[Channels] failed', e); }
    finally { setLoading(false); }
  }

  async function create() {
    if (!draft.name.trim()) return;
    try {
      const r = await lensRun({ domain: 'message', action: 'channels-create', input: draft });
      if (r.data?.ok === false) { alert(r.data?.error); return; }
      setDraft({ name: '', kind: 'channel', isPrivate: false });
      setCreating(false);
      await refresh();
      if (r.data?.result?.channel) onSelect(r.data.result.channel.id);
    } catch (e) { console.error('[Channels] create', e); }
  }

  const channels = list.filter(c => c.kind === 'channel' && !c.archived);
  const dms = list.filter(c => c.kind === 'dm' || c.kind === 'group_dm');

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
        <span className="text-xs font-semibold text-gray-200">Workspace</span>
        <button onClick={() => setCreating(v => !v)} className="ml-auto p-0.5 text-gray-400 hover:text-white" title="New channel"><Plus className="w-3.5 h-3.5" /></button>
      </div>

      {creating && (
        <div className="p-2 border-b border-white/10 space-y-1.5 bg-black/30">
          <input
            value={draft.name}
            onChange={e => setDraft({ ...draft, name: e.target.value })}
            placeholder="channel-name"
            className="w-full px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono"
          />
          <select value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value as typeof draft.kind })} className="w-full px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="channel">Channel</option>
            <option value="dm">Direct message</option>
            <option value="group_dm">Group DM</option>
          </select>
          {draft.kind === 'channel' && (
            <label className="text-[10px] text-gray-300 inline-flex items-center gap-1.5">
              <input type="checkbox" checked={draft.isPrivate} onChange={e => setDraft({ ...draft, isPrivate: e.target.checked })} />
              Private
            </label>
          )}
          <button onClick={create} className="w-full px-2 py-1 text-xs rounded bg-violet-500 text-white font-bold hover:bg-violet-400">Create</button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-3 text-xs text-gray-500"><Loader2 className="w-3 h-3 animate-spin inline mr-1" />Loading…</div>
        ) : list.length === 0 ? (
          <div className="p-3 text-xs text-gray-500 italic">No channels.</div>
        ) : (
          <>
            <Section title="Channels" items={channels} activeId={activeId} onSelect={onSelect} />
            {dms.length > 0 && <Section title="Direct messages" items={dms} activeId={activeId} onSelect={onSelect} />}
          </>
        )}
      </div>
    </div>
  );
}

function Section({ title, items, activeId, onSelect }: { title: string; items: Channel[]; activeId: string | null; onSelect: (id: string) => void }) {
  return (
    <div className="border-b border-white/5">
      <div className="px-3 py-1 text-[9px] uppercase tracking-wider text-gray-500 font-semibold">{title}</div>
      <ul>
        {items.map(c => {
          const active = activeId === c.id;
          return (
            <li key={c.id}>
              <button
                onClick={() => onSelect(c.id)}
                className={cn(
                  'w-full flex items-center gap-1.5 px-3 py-1 text-xs text-left',
                  active ? 'bg-violet-500/15 text-white' : 'text-gray-400 hover:text-white hover:bg-white/[0.04]',
                  c.unread > 0 && !active && 'text-white font-semibold',
                )}
              >
                <ChannelIcon kind={c.kind} isPrivate={c.isPrivate} className={cn('w-3 h-3 flex-shrink-0', active ? 'text-violet-300' : 'text-gray-500')} />
                <span className="truncate flex-1">{c.name}</span>
                {c.unread > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[9px] font-mono">{c.unread}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default ChannelList;
