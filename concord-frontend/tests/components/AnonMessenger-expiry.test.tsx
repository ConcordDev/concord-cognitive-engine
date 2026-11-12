// @vitest-environment jsdom
/**
 * FIX-anon-005 — disappearing messages only vanished after a reload.
 * The server pruned expired messages on read, but an already-open view
 * kept showing them until the next fetch. The messenger now drops a
 * message from the open view at its expiry moment (Signal-style), so
 * it vanishes live on both sides with no reload and no manual sweep.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

// ── Socket mock (no live connection needed for this behaviour) ──────
vi.mock('@/hooks/useSocket', () => ({
  useSocket: () => ({
    socket: null,
    isConnected: true,
    status: 'connected',
    connect: vi.fn(),
    disconnect: vi.fn(),
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  }),
}));

// ── Client E2E off: exercise the server-held identity path ──────────
vi.mock('@/lib/anon/client-e2e', () => ({
  isAnonClientE2EFlagOn: () => false,
  buildIdentityParams: () => ({}),
  buildAnonSendPayload: (p: Record<string, unknown>) => p,
  loadOrCreateClientKey: vi.fn(async () => null),
  createClientKeyPair: vi.fn(async () => null),
  writeStoredClientKey: vi.fn(),
  openSealed: vi.fn(async () => ''),
  sealEnvelopes: vi.fn(async () => ({})),
  safetyNumberGroups: vi.fn(async () => []),
}));

// ── framer-motion: render rows as plain divs ─────────────────────────
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ── lensRun mock — real macro names, fake network ────────────────────
type LensRunResult = { data: { ok: boolean; result: unknown; error: string | null } };
const lensRunMock = vi.fn<(...args: unknown[]) => Promise<LensRunResult>>();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { AnonMessenger } from '@/components/anon/AnonMessenger';

const IDENTITY = {
  anonId: 'anon_me',
  alias: 'Me',
  publicKey: 'pk-me',
  fingerprint: 'fp-me',
  keyCustody: 'server' as const,
  createdAt: 1700000000000,
  rotatedAt: null,
  verifiedPeerCount: 0,
};

const PEER = { anonId: 'anon_peer', alias: 'Peer One', publicKey: 'pk-peer', keyCustody: 'server' as const };

const CONVERSATION = {
  conversationId: 'conv_1',
  kind: 'direct' as const,
  title: null,
  members: [
    { anonId: 'anon_me', alias: 'Me' },
    { anonId: 'anon_peer', alias: 'Peer One' },
  ],
  memberCount: 2,
  disappearDefaultSec: 30,
  messageCount: 3,
  lastActivityAt: 1700000000000,
  lastSenderAnonId: 'anon_peer',
};

function msg(id: string, content: string, expiresAt: number | null) {
  return {
    id,
    fromAnonId: 'anon_peer',
    fromAlias: 'Peer One',
    sealedSender: false,
    mine: false,
    content,
    decryptError: null,
    sentAt: Date.now(),
    expiresAt,
  };
}

function mockBackend(messages: unknown[]) {
  lensRunMock.mockImplementation(async (...args: unknown[]) => {
    const [domain, action] = args as [string, string];
    if (domain !== 'anon') return { data: { ok: true, result: null, error: null } };
    if (action === 'identity') return { data: { ok: true, result: IDENTITY, error: null } };
    if (action === 'directory') return { data: { ok: true, result: { peers: [PEER] }, error: null } };
    if (action === 'listConversations') {
      return { data: { ok: true, result: { conversations: [CONVERSATION] }, error: null } };
    }
    if (action === 'readConversation') {
      return {
        data: {
          ok: true,
          result: {
            conversationId: 'conv_1',
            kind: 'direct',
            title: null,
            members: CONVERSATION.members,
            disappearDefaultSec: 30,
            messages,
            messageCount: messages.length,
            sweptExpired: 0,
          },
          error: null,
        },
      };
    }
    return { data: { ok: true, result: null, error: null } };
  });
}

async function openConversation() {
  render(<AnonMessenger />);
  const entry = await screen.findByRole('button', { name: /Peer One/ }, { timeout: 5000 });
  fireEvent.click(entry);
}

describe('AnonMessenger — disappearing messages vanish live (FIX-anon-005)', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
  });

  it('removes a message from the open view when its timer expires, without a reload', async () => {
    mockBackend([
      msg('m_keep', 'stays here', null),
      msg('m_vanish', 'vanish soon', Date.now() + 1200),
    ]);
    await openConversation();
    expect(await screen.findByText('vanish soon')).toBeTruthy();
    expect(screen.getByText('stays here')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('vanish soon')).toBeNull(), { timeout: 6000 });
    expect(screen.getByText('stays here')).toBeTruthy();
  }, 15000);

  it('drops a message that is already expired when the view opens', async () => {
    mockBackend([
      msg('m_keep', 'stays here', null),
      msg('m_dead', 'already gone', Date.now() - 1000),
    ]);
    await openConversation();
    expect(await screen.findByText('stays here')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('already gone')).toBeNull(), { timeout: 5000 });
  }, 15000);
});
