'use client';

/**
 * ConcordMsgAIPanel — Message lens Sprint A side panel.
 *
 * Sprint A surface: lists DB-backed conversations + channels for the
 * caller (real /api/lens/run → messaging.convo_list + channel_browse),
 * one-click create DM/channel, browse channels with member counts,
 * read-receipt rendering. The composer + thread surface stays in the
 * existing message lens page; this panel is the structured nav rail.
 *
 * All calls real macros — no mocks.
 */

import { useEffect, useState, useCallback } from 'react';
import { Hash, Users, Inbox, Loader2, AlertCircle, Plus, Search, MessageCircle } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface ConversationRow {
  id: string;
  kind: 'dm' | 'group' | 'channel' | 'external';
  title?: string | null;
  topic?: string | null;
  workspace_id?: string | null;
  owner_id?: string;
  created_at: number;
  updated_at: number;
  unreadCount?: number;
}
interface ChannelBrowseRow extends ConversationRow {
  memberCount: number;
  joined: boolean;
}

interface ConcordMsgAIPanelProps {
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
}

async function callMacro<T>(name: string, input: Record<string, unknown>): Promise<{ ok: boolean } & T & { reason?: string }> {
  const r = await api.post('/api/lens/run', { domain: 'messaging', name, input });
  return (r.data?.result ?? r.data) as { ok: boolean } & T;
}

export function ConcordMsgAIPanel({ activeConversationId, onSelectConversation }: ConcordMsgAIPanelProps) {
  const [tab, setTab] = useState<'inbox' | 'channels' | 'browse'>('inbox');
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [channels, setChannels] = useState<ChannelBrowseRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Browse state
  const [browseQuery, setBrowseQuery] = useState('');

  // Create state
  const [showCreate, setShowCreate] = useState(false);
  const [createKind, setCreateKind] = useState<'dm' | 'group' | 'channel'>('channel');
  const [createTitle, setCreateTitle] = useState('');
  const [createParticipants, setCreateParticipants] = useState('');

  const refreshInbox = useCallback(async () => {
    setBusy('inbox'); setErr(null);
    try {
      const r = await callMacro<{ conversations?: ConversationRow[]; reason?: string }>('convo_list', {});
      if (r?.ok && r.conversations) setConversations(r.conversations);
      else if (r?.reason) setErr(r.reason);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'inbox failed');
    } finally {
      setBusy(null);
    }
  }, []);

  const refreshChannels = useCallback(async () => {
    setBusy('channels'); setErr(null);
    try {
      const r = await callMacro<{ channels?: ChannelBrowseRow[]; reason?: string }>('channel_browse', { q: browseQuery || undefined });
      if (r?.ok && r.channels) setChannels(r.channels);
      else if (r?.reason) setErr(r.reason);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'browse failed');
    } finally {
      setBusy(null);
    }
  }, [browseQuery]);

  useEffect(() => {
    if (tab === 'inbox' || tab === 'channels') refreshInbox();
    if (tab === 'browse') refreshChannels();
  }, [tab, refreshInbox, refreshChannels]);

  async function handleCreate() {
    setBusy('create'); setErr(null);
    try {
      if (createKind === 'channel') {
        if (!createTitle.trim()) { setErr('channel name required'); return; }
        const r = await callMacro<{ id?: string; reason?: string }>('channel_create', { name: createTitle.trim() });
        if (r?.ok && r.id) {
          setShowCreate(false); setCreateTitle('');
          await refreshInbox();
          onSelectConversation(r.id);
        } else setErr(r?.reason || 'create failed');
      } else {
        const participants = createParticipants.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
        if (createKind === 'dm' && participants.length !== 1) { setErr('DM needs exactly one other user'); return; }
        if (createKind === 'group' && participants.length < 1) { setErr('group needs at least one other user'); return; }
        const r = await callMacro<{ id?: string; reason?: string }>('convo_create', {
          kind: createKind, title: createTitle.trim() || undefined, participants,
        });
        if (r?.ok && r.id) {
          setShowCreate(false); setCreateTitle(''); setCreateParticipants('');
          await refreshInbox();
          onSelectConversation(r.id);
        } else setErr(r?.reason || 'create failed');
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'create failed');
    } finally {
      setBusy(null);
    }
  }

  const dms = conversations.filter((c) => c.kind === 'dm' || c.kind === 'group');
  const memberChannels = conversations.filter((c) => c.kind === 'channel');

  return (
    <div className="flex flex-col h-full bg-lattice-deep border-r border-lattice-border text-sm">
      <header className="px-3 py-2 border-b border-lattice-border flex items-center gap-2">
        <MessageCircle className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Concord messaging</span>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="ml-auto p-1 rounded text-gray-400 hover:text-white hover:bg-white/10"
          title="New conversation"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </header>
      <nav className="flex gap-1 px-2 py-1 border-b border-lattice-border text-[10px]">
        {(['inbox', 'channels', 'browse'] as const).map((t) => (
          <button
            key={t} onClick={() => setTab(t)}
            className={cn(
              'px-2 py-1 rounded uppercase tracking-wider flex items-center gap-1',
              tab === t ? 'bg-cyan-500/20 text-cyan-200' : 'text-gray-500 hover:text-white'
            )}
          >
            {t === 'inbox' && <Inbox className="w-3 h-3" />}
            {t === 'channels' && <Hash className="w-3 h-3" />}
            {t === 'browse' && <Search className="w-3 h-3" />}
            {t}
          </button>
        ))}
      </nav>

      {err && (
        <div className="m-2 px-2 py-1 text-[10px] text-red-300 bg-red-500/10 rounded flex items-center gap-1">
          <AlertCircle className="w-3 h-3" /> {err}
          <button onClick={() => setErr(null)} className="ml-auto">×</button>
        </div>
      )}

      {showCreate && (
        <div className="px-3 py-2 border-b border-lattice-border space-y-1.5">
          <select
            value={createKind} onChange={(e) => setCreateKind(e.target.value as typeof createKind)}
            className="w-full text-[10px] bg-lattice-deep border border-lattice-border rounded px-1.5 py-1 text-white"
          >
            <option value="channel">channel</option>
            <option value="dm">direct message</option>
            <option value="group">group DM</option>
          </select>
          <input
            type="text" value={createTitle}
            onChange={(e) => setCreateTitle(e.target.value)}
            placeholder={createKind === 'channel' ? 'channel name (e.g. general)' : 'title (optional)'}
            className="w-full text-[10px] bg-lattice-deep border border-lattice-border rounded px-1.5 py-1 text-white"
          />
          {(createKind === 'dm' || createKind === 'group') && (
            <input
              type="text" value={createParticipants}
              onChange={(e) => setCreateParticipants(e.target.value)}
              placeholder={createKind === 'dm' ? 'other user id' : 'comma/space-separated user ids'}
              className="w-full text-[10px] bg-lattice-deep border border-lattice-border rounded px-1.5 py-1 text-white"
            />
          )}
          <button
            onClick={handleCreate} disabled={busy !== null}
            className="text-[10px] px-3 py-1 rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-50 inline-flex items-center gap-1"
          >
            {busy === 'create' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
            Create
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {tab === 'inbox' && (
          <ul>
            {dms.length === 0 && memberChannels.length === 0 ? (
              <li className="px-3 py-3 text-[10px] text-gray-500">No conversations yet. Use + to start one.</li>
            ) : (
              <>
                {memberChannels.length > 0 && (
                  <>
                    <li className="px-3 py-1 text-[10px] uppercase tracking-wider text-gray-500">Channels</li>
                    {memberChannels.map((c) => (
                      <li key={c.id}>
                        <button
                          onClick={() => onSelectConversation(c.id)}
                          className={cn(
                            'w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-white/[0.04]',
                            activeConversationId === c.id && 'bg-cyan-500/10 text-cyan-200'
                          )}
                        >
                          <Hash className="w-3 h-3 text-cyan-400" />
                          <span className="truncate flex-1">{c.title || c.id}</span>
                          {(c.unreadCount || 0) > 0 && (
                            <span className="text-[9px] font-bold px-1.5 rounded-full bg-cyan-500 text-black">{c.unreadCount}</span>
                          )}
                        </button>
                      </li>
                    ))}
                  </>
                )}
                {dms.length > 0 && (
                  <>
                    <li className="px-3 py-1 text-[10px] uppercase tracking-wider text-gray-500 mt-1">DMs</li>
                    {dms.map((c) => (
                      <li key={c.id}>
                        <button
                          onClick={() => onSelectConversation(c.id)}
                          className={cn(
                            'w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-white/[0.04]',
                            activeConversationId === c.id && 'bg-cyan-500/10 text-cyan-200'
                          )}
                        >
                          <Users className="w-3 h-3 text-gray-400" />
                          <span className="truncate flex-1">{c.title || c.id.replace(/^dm:/, '')}</span>
                          {(c.unreadCount || 0) > 0 && (
                            <span className="text-[9px] font-bold px-1.5 rounded-full bg-cyan-500 text-black">{c.unreadCount}</span>
                          )}
                        </button>
                      </li>
                    ))}
                  </>
                )}
              </>
            )}
          </ul>
        )}

        {tab === 'channels' && (
          <ul>
            {memberChannels.length === 0 ? (
              <li className="px-3 py-3 text-[10px] text-gray-500">No channels joined.</li>
            ) : (
              memberChannels.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => onSelectConversation(c.id)}
                    className={cn(
                      'w-full text-left px-3 py-2 text-xs hover:bg-white/[0.04]',
                      activeConversationId === c.id && 'bg-cyan-500/10 text-cyan-200'
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Hash className="w-3 h-3 text-cyan-400" />
                      <span className="truncate flex-1 font-medium">{c.title}</span>
                    </div>
                    {c.topic && <div className="text-[10px] text-gray-500 mt-0.5 truncate pl-5">{c.topic}</div>}
                  </button>
                </li>
              ))
            )}
          </ul>
        )}

        {tab === 'browse' && (
          <>
            <div className="px-3 py-2 border-b border-lattice-border flex gap-2">
              <input
                type="text" value={browseQuery}
                onChange={(e) => setBrowseQuery(e.target.value)}
                placeholder="search channels…"
                className="flex-1 text-[10px] bg-lattice-deep border border-lattice-border rounded px-1.5 py-1 text-white"
              />
              <button
                onClick={refreshChannels} disabled={busy === 'channels'}
                className="text-[10px] px-2 rounded bg-white/5 border border-white/10 hover:bg-white/10"
              >
                {busy === 'channels' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
              </button>
            </div>
            <ul>
              {channels.length === 0 ? (
                <li className="px-3 py-3 text-[10px] text-gray-500">No channels.</li>
              ) : (
                channels.map((c) => (
                  <li key={c.id} className="px-3 py-2 border-b border-white/5 text-xs">
                    <div className="flex items-center gap-2">
                      <Hash className="w-3 h-3 text-cyan-400" />
                      <span className="truncate flex-1 font-medium">{c.title}</span>
                      <span className="text-[10px] text-gray-500">{c.memberCount}</span>
                    </div>
                    {c.topic && <div className="text-[10px] text-gray-400 mt-0.5 truncate pl-5">{c.topic}</div>}
                    <div className="mt-1 flex gap-2 pl-5">
                      {c.joined ? (
                        <button
                          onClick={async () => {
                            await callMacro('channel_leave', { conversationId: c.id });
                            await refreshChannels();
                          }}
                          className="text-[10px] text-red-400 hover:text-red-300"
                        >Leave</button>
                      ) : (
                        <button
                          onClick={async () => {
                            await callMacro('channel_join', { conversationId: c.id });
                            await refreshChannels();
                            onSelectConversation(c.id);
                          }}
                          className="text-[10px] text-emerald-400 hover:text-emerald-300"
                        >Join</button>
                      )}
                    </div>
                  </li>
                ))
              )}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

export default ConcordMsgAIPanel;
