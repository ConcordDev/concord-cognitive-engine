'use client';

import { useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { SlackShell, MsgNav } from './SlackShell';
import { ChannelList, Channel } from './ChannelList';
import { MessageStream, Message } from './MessageStream';
import { ThreadPane } from './ThreadPane';
import { MessageAskBar } from './MessageAskBar';
import { ActivityFeed, ScheduledList, SnoozedList, InboxOverview } from './SidePanels';

export function SlackSection() {
  const [nav, setNav] = useState<MsgNav>('channels');
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [threadRootId, setThreadRootId] = useState<string | null>(null);
  const [threadRoot, setThreadRoot] = useState<Message | null>(null);
  const [badges, setBadges] = useState<Partial<Record<MsgNav, number>>>({});

  useEffect(() => { refreshBadges(); }, [nav]);

  async function refreshBadges() {
    try {
      const r = await lensRun({ domain: 'message', action: 'inbox-summary', input: {} });
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
    } catch {}
  }

  async function selectChannel(id: string) {
    setActiveChannelId(id);
    setNav('channels');
    try {
      // Fetch channel meta by re-listing then finding
      const r = await lensRun({ domain: 'message', action: 'channels-list', input: {} });
      const ch = ((r.data?.result?.channels || []) as Channel[]).find(c => c.id === id);
      setActiveChannel(ch || null);
    } catch {}
    setThreadRootId(null); setThreadRoot(null);
  }

  function openThread(rootId: string) {
    setThreadRootId(rootId);
    // Find the root message
    if (!activeChannelId) return;
    lensRun({ domain: 'message', action: 'messages-list', input: { channelId: activeChannelId, limit: 200 } })
      .then(r => {
        const msgs = (r.data?.result?.messages || []) as Message[];
        setThreadRoot(msgs.find(m => m.id === rootId) || null);
      });
  }

  function closeThread() { setThreadRootId(null); setThreadRoot(null); }

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
          {nav === 'saved'     && (
            <div className="p-6 text-center text-sm text-gray-400 bg-black/30 border border-white/10 rounded m-4">
              Saved messages live in the existing MessageWorkbench panel (the `save-message` macro).
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
