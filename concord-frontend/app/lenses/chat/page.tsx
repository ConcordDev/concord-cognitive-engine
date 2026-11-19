'use client';

/**
 * Chat — the Notebook. A lab notebook where every reply is a numbered entry
 * and what backs it (citations, tool runs, computed numbers) is pinned in the
 * margin. One "Answer as" control in the composer; signed in, the server is
 * the record of every conversation. The app lives in ChatWorkspacePanel.
 */

import { LensShell } from '@/components/lens/LensShell';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { ChatWorkspacePanel } from '@/components/chat/ChatWorkspacePanel';

export default function ChatLensPage() {
  useLensNav('chat');
  useLensIdentity('chat');
  return (
    <LensShell lensId="chat" asMain={false} disableAgentFab={true}>
      <div data-lens-theme="chat" className="h-full min-h-0 flex flex-col">
        <h1 className="sr-only">Chat</h1>
        <ChatWorkspacePanel />
      </div>
    </LensShell>
  );
}
