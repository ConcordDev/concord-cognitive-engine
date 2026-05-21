'use client';

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { SlackShell, MsgNav } from './SlackShell';
import { ChannelList, Channel } from './ChannelList';
import { MessageStream, Message } from './MessageStream';
import { ThreadPane } from './ThreadPane';
import { MessageAskBar } from './MessageAskBar';
import { ActivityFeed, ScheduledList, SnoozedList, InboxOverview } from './SidePanels';
import { HuddlePanel } from './HuddlePanel';
import { FilesPanel } from './FilesPanel';
import { IntegrationsPanel } from './IntegrationsPanel';
import { NotificationPrefsPanel } from './NotificationPrefsPanel';
import { DirectoryPanel } from './DirectoryPanel';

export function SlackSection() {
  const [nav, setNav] = useState<MsgNav>('channels');
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [threadRootId, setThreadRootId] = useState<string | null>(null);
  const [threadRoot, setThreadRoot] = useState<Message | null>(null);
  const [badges, setBadges] = useState<Partial<Record<MsgNav, number>>>({});
  const [allChannels, setAllChannels] = useState<Channel[]>([]);

  const loadChannels = useCallback(async () => {
    try {
      const r = await lensRun('message', 'channels-list', {});
      if (r.data?.ok) setAllChannels((r.data.result?.channels as Channel[]) ?? []);
    } catch { /* best-effort */ }
  }, []);

  const refreshBadges = useCallback(async () => {
    try {
      const r = await lensRun('message', 'inbox-summary', {});
      const d = r.data?.result;
      if (d) {
        setBadges({
          channels: d.totalUnread || 0,
          inbox: d.totalUnread || 0,
          activity: d.mentionCount || 0,
          scheduled: d.scheduledCount || 0,
          snoozed: d.snoozedCount || 0,
        });
      }
    } catch { /* best-effort */ }
  }, []);

  useEffect(() => { void refreshBadges(); void loadChannels(); }, [nav, refreshBadges, loadChannels]);

  async function selectChannel(id: string) {
    setActiveChannelId(id);
    setNav('channels');
    try {
      const r = await lensRun('message', 'channels-list', {});
      const list = (r.data?.result?.channels || []) as Channel[];
      setAllChannels(list);
      setActiveChannel(list.find((c) => c.id === id) || null);
    } catch { /* best-effort */ }
    setThreadRootId(null); setThreadRoot(null);
  }

  function openThread(rootId: string) {
    setThreadRootId(rootId);
    if (!activeChannelId) return;
    void lensRun('message', 'messages-list', { channelId: activeChannelId, limit: 200 })
      .then((r) => {
        const msgs = (r.data?.result?.messages || []) as Message[];
        setThreadRoot(msgs.find((m) => m.id === rootId) || null);
      });
  }

  function closeThread() { setThreadRootId(null); setThreadRoot(null); }

  // The channel-scoped panels need a target channel; fall back to the
  // first channel in the workspace so the panel is never empty.
  const panelChannel = activeChannel ?? allChannels[0] ?? null;

  return (
    <SlackShell
      activeNav={nav}
      onNavChange={(n) => { setNav(n); if (n !== 'channels') { closeThread(); } }}
      badges={badges}
      channelList={<ChannelList activeId={activeChannelId} onSelect={selectChannel} onRefresh={refreshBadges} />}
      askBar={<MessageAskBar onOpenChannel={selectChannel} />}
      thread={threadRootId && activeChannelId ? (
        <ThreadPane channelId={activeChannelId} rootId={threadRootId} root={threadRoot} onClose={closeThread} onActivity={refreshBadges} />
      ) : undefined}
      main={
        <>
          {nav === 'channels' && <MessageStream channel={activeChannel} onOpenThread={openThread} onMessageActivity={refreshBadges} />}
          {nav === 'inbox'     && <div className="p-4 overflow-y-auto"><InboxOverview onJump={() => setNav('channels')} /></div>}
          {nav === 'activity'  && <div className="p-4 overflow-y-auto"><ActivityFeed /></div>}
          {nav === 'scheduled' && <div className="p-4 overflow-y-auto"><ScheduledList onChanged={refreshBadges} /></div>}
          {nav === 'snoozed'   && <div className="p-4 overflow-y-auto"><SnoozedList /></div>}
          {nav === 'huddles' && (
            panelChannel
              ? <HuddlePanel channelId={panelChannel.id} channelName={panelChannel.name} />
              : <div className="p-6 text-sm text-gray-500">No channel yet — create one to start a huddle.</div>
          )}
          {nav === 'files' && (
            panelChannel
              ? <FilesPanel channelId={panelChannel.id} channelName={panelChannel.name} />
              : <div className="p-6 text-sm text-gray-500">No channel yet — create one to share files.</div>
          )}
          {nav === 'integrations' && (
            panelChannel
              ? <IntegrationsPanel channelId={panelChannel.id} channelName={panelChannel.name} />
              : <div className="p-6 text-sm text-gray-500">No channel yet — create one to use integrations.</div>
          )}
          {nav === 'notifications' && (
            <NotificationPrefsPanel channels={allChannels.map((c) => ({ id: c.id, name: c.name }))} />
          )}
          {nav === 'directory' && <DirectoryPanel />}
          {nav === 'saved'     && (
            <div className="p-6 text-center text-sm text-gray-400 bg-black/30 border border-white/10 rounded m-4">
              Saved messages live in the Message Workbench panel (the `save-message` macro).
            </div>
          )}
          {nav === 'search'    && (
            <div className="p-6 text-sm text-gray-400 m-4">
              Use the Ask anything bar above — it runs natural-language search across all your channels + DMs.
            </div>
          )}
        </>
      }
    />
  );
}

export default SlackSection;
