'use client';

/**
 * Chat — one messaging app (Claude.ai / ChatGPT reference).
 *
 * Single view-state machine (`active` ChatMode) drives the ModeSelector rail
 * inside ChatWorkspacePanel. Conversation canvas, composer, ConKay, and the
 * overlay union live in that panel. Welded pile extracted per
 * LENS_CONSOLIDATION_PLAYBOOK.
 */

import { useCallback, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import type { ChatMode } from '@/components/chat/ChatModeTypes';
import { ChatWorkspacePanel } from '@/components/chat/ChatWorkspacePanel';

const MODES: { id: ChatMode; label: string; keys: string; hint: string }[] = [
  { id: 'chat', label: 'Chat', keys: '1', hint: 'Free-form conversation' },
  { id: 'assist', label: 'Assist', keys: '2', hint: 'Task-focused assistant' },
  { id: 'explore', label: 'Explore', keys: '3', hint: 'Discover and learn' },
  { id: 'connect', label: 'Connect', keys: '4', hint: 'Collaborate' },
  { id: 'welcome', label: 'Welcome', keys: '5', hint: 'Home / greeting' },
];

export default function ChatLensPage() {
  useLensNav('chat');
  useLensIdentity('chat');
  const [active, setActive] = useState<'chat' | 'assist' | 'explore' | 'connect' | 'welcome'>('chat');

  const go = useCallback((id: ChatMode) => setActive(id), []);

  useLensCommand(
    MODES.map((m) => ({
      id: `chat-mode-${m.id}`,
      keys: m.keys,
      description: `${m.label} — ${m.hint}`,
      category: 'navigation' as const,
      action: () => go(m.id),
    })),
    { lensId: 'chat' },
  );

  return (
    <LensShell lensId="chat" asMain={false} disableAgentFab={true}>
      <FirstRunTour lensId="chat" />
      <DepthBadge lensId="chat" size="sm" className="ml-2" />
      <div data-lens-theme="chat" className="h-full min-h-0 flex flex-col">
        <header className="sr-only">
          <h1 className="text-2xl font-bold">
            <MessageSquare className="inline w-5 h-5 mr-2" aria-hidden />
            Chat
          </h1>
        </header>
        <ChatWorkspacePanel active={active} onActiveChange={go} />
      </div>
    </LensShell>
  );
}
