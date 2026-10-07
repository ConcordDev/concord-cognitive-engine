/// <reference types="@testing-library/jest-dom/vitest" />
// ChatWorkspacePanel — the conversation canvas of the chat lens.
//
// Behavioral tests for the REGULAR chat surfaces (deliberately not the
// in-chat ConKay mode): sending a message and rendering the reply over the
// SSE stream / JSON / buffered-POST fallback paths, the offline + error
// replies, the empty-state starters, the conversation drawer (open / select /
// rename / delete / search, server hydration), the composer "+" menu panels,
// slash commands, per-message actions (copy / pin / quote / edit / delete /
// feedback / regenerate / branch / forge), export + transcript copy, global
// message search, Escape / outside-click menu closing, and the keyboard
// shortcuts the panel registers via useLensCommand.
//
// Child panels are stubbed with thin fakes that expose the props this panel
// wires (open flag + callbacks) so the assertions are about THIS component's
// wiring, not the children's internals (those have their own tests).

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

// ── api client ──────────────────────────────────────────────────────────────
const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPut = vi.fn();
const feedbackFn = vi.fn();
const forgeFn = vi.fn();
const lensDeleteFn = vi.fn();
const cogStatusFn = vi.fn();
// Choosing ConKay routes to its own lens; nothing here exercises that, but
// the panel holds a router.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async () => ({ data: { ok: true, result: {} } })),
  api: {
    get: (...a: unknown[]) => apiGet(...a),
    post: (...a: unknown[]) => apiPost(...a),
    put: (...a: unknown[]) => apiPut(...a),
  },
  apiHelpers: {
    cognitive: { status: () => cogStatusFn() },
    chat: { feedback: (...a: unknown[]) => feedbackFn(...a) },
    forge: { hybrid: (...a: unknown[]) => forgeFn(...a) },
    lens: { delete: (...a: unknown[]) => lensDeleteFn(...a) },
  },
}));
vi.mock('@/lib/api/base', () => ({ getApiBase: () => '' }));

// ── realtime ────────────────────────────────────────────────────────────────
const eventHandlers: Record<string, (d: unknown) => void> = {};
vi.mock('@/lib/realtime/event-bus', () => ({
  useEvent: (name: string, handler: (d: unknown) => void) => {
    eventHandlers[name] = handler;
  },
}));
vi.mock('@/lib/realtime/socket', () => ({
  subscribe: vi.fn(() => () => {}),
  connectSocket: vi.fn(),
  onConnectionLost: vi.fn(() => () => {}),
  onReconnected: vi.fn(() => () => {}),
}));

// ── hooks ───────────────────────────────────────────────────────────────────
type LensCmd = { id: string; keys: string; action: () => void };
let registeredCommands: LensCmd[] = [];
vi.mock('@/hooks/useLensCommand', () => ({
  useLensCommand: (cmds: LensCmd[]) => {
    registeredCommands = cmds;
  },
}));
vi.mock('@/hooks/useTilePush', () => ({ useTilePush: () => {} }));
vi.mock('@/hooks/useLensDTUs', () => ({
  useLensDTUs: () => ({
    hyperDTUs: [], megaDTUs: [], regularDTUs: [], tierDistribution: {},
    publishToMarketplace: vi.fn(), isLoading: false, refetch: vi.fn(),
  }),
}));
const authState: { isAuthenticated: boolean; user: { username: string } | null } = {
  isAuthenticated: false,
  user: null,
};
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => authState }));
const runArtifactMutateAsync = vi.fn();
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: () => ({ mutateAsync: (...a: unknown[]) => runArtifactMutateAsync(...a) }),
}));
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({ items: [{ id: 'conv-artifact-1' }] }),
}));
type OracleOpts = { onSuccess: (d: unknown) => void; onError: (e: unknown) => void };
const oracleMutate = vi.fn();
vi.mock('@/hooks/useOracleSolve', () => ({
  useOracleSolve: () => ({ mutate: (...a: unknown[]) => oracleMutate(...a), isPending: false }),
}));
vi.mock('@/components/conkay/useConKayVoice', () => ({
  useConKayVoice: () => ({
    supported: false, listening: false, speaking: false, interim: '',
    usingServerStt: false, voiceUnavailable: false, ttsAmplitudeRef: { current: 0 }, speak: vi.fn(),
  }),
}));

// ── heavy / unrelated children ─────────────────────────────────────────────
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ data, itemContent }: { data: unknown[]; itemContent: (i: number, d: unknown) => React.ReactNode }) => (
    <div data-testid="virtuoso">
      {data.map((d, i) => (
        <div key={i}>{itemContent(i, d)}</div>
      ))}
    </div>
  ),
}));
// framer-motion: render motion.* as the plain element and AnimatePresence as a
// passthrough, so exit animations (which never finish in jsdom) don't keep
// closed menus mounted.
vi.mock('framer-motion', () => {
  const MOTION_PROPS = new Set(['initial', 'animate', 'exit', 'transition', 'layout', 'whileHover', 'whileTap', 'variants']);
  const cache: Record<string, React.FC<Record<string, unknown>>> = {};
  const motion = new Proxy({}, {
    get: (_t, tag: string) => {
      if (!cache[tag]) {
        cache[tag] = function MotionStub({ children, ...rest }: Record<string, unknown>) {
          const clean: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(rest)) if (!MOTION_PROPS.has(k)) clean[k] = v;
          return React.createElement(tag, clean, children as React.ReactNode);
        };
      }
      return cache[tag];
    },
  });
  return {
    motion,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});
vi.mock('next/dynamic', () => ({
  default: () =>
    function DynamicStub({ open }: { open?: boolean }) {
      return open ? <div data-testid="agent-mode-panel">agent mode</div> : null;
    },
}));
vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ alt, src }: { alt: string; src: string }) => <img alt={alt} src={src} />,
}));
vi.mock('@/components/conkay/ConKayBackdrop', () => ({ ConKayBackdrop: () => null }));
vi.mock('@/components/conkay/ConKayHud', () => ({ ConKayHud: () => null }));
vi.mock('@/components/conkay/SessionContextBadge', () => ({ SessionContextBadge: () => null }));
vi.mock('@/components/conkay/ConKayViz', () => ({ ConKayMessage: () => null }));
vi.mock('@/components/conkay/ConKayActionConfirm', () => ({ ConKayActionConfirm: () => null }));
vi.mock('@/components/conkay/ConKayCockpit', () => ({
  ConKayCockpit: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/byo-keys/BrainModePanel', () => ({ BrainModePanel: () => null }));
vi.mock('@/components/chat/HackerNewsReference', () => ({ HackerNewsReference: () => null }));
vi.mock('@/components/lens/ExternalReferenceLocale', () => ({ ExternalReferenceLocale: () => null }));
vi.mock('@/components/mobile/MobileTabBar', () => ({ MobileTabBar: () => null }));
vi.mock('@/components/lens/LensContextPanel', () => ({ LensContextPanel: () => null }));
vi.mock('@/components/artifact/ArtifactUploader', () => ({ ArtifactUploader: () => null }));
vi.mock('@/components/feedback/FeedbackWidget', () => ({ FeedbackWidget: () => null }));
vi.mock('@/components/dtu/DTUDetailView', () => ({
  DTUDetailView: ({ dtuId, onClose, onNavigate }: { dtuId: string; onClose: () => void; onNavigate: (id: string) => void }) => (
    <div data-testid="dtu-detail">
      dtu:{dtuId}
      <button onClick={() => onNavigate('dtu-next')}>dtu-navigate</button>
      <button onClick={onClose}>dtu-close</button>
    </div>
  ),
}));
vi.mock('@/components/chat/MessageRenderer', () => ({
  default: ({ content }: { content: string }) => <div data-testid="message-renderer">{content}</div>,
}));
vi.mock('@/components/chat/OracleResponse', () => ({
  default: ({ response, onOpenDTU }: { response: { answer: string }; onOpenDTU: (id: string) => void }) => (
    <div data-testid="oracle-response">
      oracle:{response.answer}
      <button onClick={() => onOpenDTU('dtu-oracle')}>open-oracle-dtu</button>
    </div>
  ),
}));
vi.mock('@/components/chat/ToolCallCard', () => ({
  ToolCallCard: ({ call }: { call: { tool: string } }) => <div data-testid="tool-call-card">{call.tool}</div>,
}));
vi.mock('@/components/chat/ComputeBadge', () => ({ default: () => <div data-testid="compute-badge" /> }));
vi.mock('@/components/chat/CitationChips', () => ({ default: () => <div data-testid="citation-chips" /> }));
vi.mock('@/components/chat/AnonNudge', () => ({
  default: ({ onDismiss }: { onDismiss: () => void }) => (
    <div data-testid="anon-nudge">
      <button onClick={onDismiss}>dismiss-nudge</button>
    </div>
  ),
}));
vi.mock('@/components/chat/BranchForkButton', () => ({
  default: ({ onForked, onError }: { onForked: () => void; onError: () => void }) => (
    <span>
      <button onClick={onForked}>sync-fork</button>
      <button onClick={onError}>sync-fork-fail</button>
    </span>
  ),
}));
vi.mock('@/components/chat/BYOKeyDrawer', () => ({
  default: ({ open }: { open: boolean }) => (open ? <div data-testid="byo-drawer" /> : null),
}));
vi.mock('@/components/chat/ReasoningIndicator', () => ({
  ReasoningIndicator: ({ sessionId }: { sessionId: string }) => <div data-testid="reasoning">{sessionId}</div>,
}));
vi.mock('@/components/chat/MessageContinuationMarker', () => ({
  MessageContinuationMarker: () => <div data-testid="continuation-marker" />,
}));
vi.mock('@/components/chat/AtlasOverlay', () => ({ default: () => null }));
vi.mock('@/components/chat/ProjectsPanel', () => ({
  default: ({ open, onClose, onSelectProject }: { open: boolean; onClose: () => void; onSelectProject: (p: unknown) => void }) =>
    open ? (
      <div data-testid="projects-panel">
        <button onClick={() => onSelectProject({ id: 'p1', name: 'Thesis research' })}>pick-project</button>
        <button onClick={onClose}>close-projects</button>
      </div>
    ) : null,
}));
vi.mock('@/components/chat/PromptsLibrary', () => ({
  default: ({ open, onInsert, onClose }: { open: boolean; onInsert: (c: string) => void; onClose: () => void }) =>
    open ? (
      <div data-testid="prompts-panel">
        <button onClick={() => onInsert('Summarize this paper')}>insert-prompt</button>
        <button onClick={onClose}>close-prompts</button>
      </div>
    ) : null,
}));
vi.mock('@/components/chat/ThreadSearchOverlay', () => ({
  default: ({ open, onSelect, onClose }: { open: boolean; onSelect: (id: string) => void; onClose: () => void }) =>
    open ? (
      <div data-testid="thread-search">
        <button onClick={() => onSelect('conv-b')}>select-thread</button>
        <button onClick={onClose}>close-thread-search</button>
      </div>
    ) : null,
}));
vi.mock('@/components/chat/ScheduledTasksPanel', () => ({
  default: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? (
      <div data-testid="scheduled-panel">
        <button onClick={onClose}>close-scheduled</button>
      </div>
    ) : null,
}));
vi.mock('@/components/chat/ChatStudioPanel', () => ({
  default: ({
    open, onClose, onInsert, onActivateAssistant, messages,
  }: {
    open: boolean; onClose: () => void; onInsert: (t: string) => void;
    onActivateAssistant: (a: unknown) => void; messages: unknown[];
  }) =>
    open ? (
      <div data-testid="studio-panel">
        studio-msgs:{messages.length}
        <button onClick={() => onInsert('canvas text')}>studio-insert</button>
        <button
          onClick={() =>
            onActivateAssistant({ id: 'g1', name: 'Grant Writer', description: '', instructions: 'Write grants.', model: 'deep' })
          }
        >
          activate-gpt
        </button>
        <button onClick={onClose}>close-studio</button>
      </div>
    ) : null,
}));
vi.mock('@/components/chat/ChatModePanels', () => ({
  WelcomePanel: () => null, AssistPanel: () => null, ExplorePanel: () => null,
  ConnectPanel: () => null, ModeSelector: () => null, ChatPanel: () => null,
}));
vi.mock('@/components/chat/ChatRouteOverlay', () => ({ default: () => null }));
vi.mock('@/components/chat/ContextOverlay', () => ({
  ContextOverlay: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div data-testid="context-overlay">
        <button onClick={onClose}>close-context</button>
      </div>
    ) : null,
}));
vi.mock('@/components/chat/ForgeCard', () => ({ default: () => null }));
vi.mock('@/components/chat/FoundationCard', () => ({ default: () => null }));
vi.mock('@/components/chat/SessionSidebar', () => ({
  SessionSidebar: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div data-testid="session-sidebar">
        <button onClick={onClose}>close-session</button>
      </div>
    ) : null,
}));
vi.mock('@/components/chat/InitiativeChip', () => ({
  InitiativeChip: ({
    initiative, onDismiss, onRespond, onAction,
  }: {
    initiative: { id: string; message: string };
    onDismiss: (id: string) => void; onRespond: (id: string) => void;
    onAction: (id: string, a: string, p?: Record<string, unknown>) => void;
  }) => (
    <div data-testid="initiative-chip">
      {initiative.message}
      <button onClick={() => onDismiss(initiative.id)}>init-dismiss</button>
      <button onClick={() => onRespond(initiative.id)}>init-respond</button>
      <button onClick={() => onAction(initiative.id, 'snooze', { minutes: 5 })}>init-action</button>
    </div>
  ),
}));
vi.mock('@/components/chat/ChatSystemsDrawer', () => ({
  ChatSystemsDrawer: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? (
      <div data-testid="systems-drawer">
        <button onClick={onClose}>close-systems</button>
      </div>
    ) : null,
}));
vi.mock('@/components/chat/ChatToolsDrawer', () => ({
  ChatToolsDrawer: ({
    open, onClose, onChatAction, chatActionRunning,
    threadSummarizeResult, participantAnalysisResult, topicDetectionResult,
    onClearThreadSummarize, onClearParticipantAnalysis, onClearTopicDetection,
  }: {
    open: boolean; onClose: () => void; onChatAction: (a: string) => void; chatActionRunning: string | null;
    threadSummarizeResult: unknown; participantAnalysisResult: unknown; topicDetectionResult: unknown;
    onClearThreadSummarize: () => void; onClearParticipantAnalysis: () => void; onClearTopicDetection: () => void;
  }) =>
    open ? (
      <div data-testid="tools-drawer">
        <span data-testid="tools-running">{chatActionRunning ?? 'idle'}</span>
        <button onClick={() => onChatAction('threadSummarize')}>run-summarize</button>
        <button onClick={() => onChatAction('participantAnalysis')}>run-participants</button>
        <button onClick={() => onChatAction('topicDetection')}>run-topics</button>
        <pre data-testid="summarize-result">{JSON.stringify(threadSummarizeResult)}</pre>
        <pre data-testid="participants-result">{JSON.stringify(participantAnalysisResult)}</pre>
        <pre data-testid="topics-result">{JSON.stringify(topicDetectionResult)}</pre>
        <button onClick={onClearThreadSummarize}>clear-summarize</button>
        <button onClick={onClearParticipantAnalysis}>clear-participants</button>
        <button onClick={onClearTopicDetection}>clear-topics</button>
        <button onClick={onClose}>close-tools</button>
      </div>
    ) : null,
}));
vi.mock('@/components/chat/ChatWorkspaceMenu', () => ({
  ChatWorkspaceMenu: (p: Record<string, () => void>) => (
    <div data-testid="workspace-menu">
      <button onClick={p.onViewContext}>ws-context</button>
      <button onClick={p.onToolPalette}>ws-palette</button>
      <button onClick={p.onSearchChats}>ws-search</button>
      <button onClick={p.onProjects}>ws-projects</button>
      <button onClick={p.onPrompts}>ws-prompts</button>
      <button onClick={p.onSchedule}>ws-schedule</button>
      <button onClick={p.onStudio}>ws-studio</button>
      <button onClick={p.onToggleAnalysis}>ws-analysis</button>
      <button onClick={p.onToggleSystems}>ws-systems</button>
      <button onClick={p.onToggleInitiativesPaused}>ws-pause</button>
    </div>
  ),
}));
vi.mock('@/components/chat/ChatHandoffMenu', () => ({
  ChatHandoffMenu: ({ onNote }: { onNote: (t: string) => void }) => (
    <button onClick={() => onNote('Handed off to mail draft.')}>handoff</button>
  ),
}));
vi.mock('@/components/chat/SyncedBranchesSection', () => ({
  SyncedBranchesSection: ({ onOpen }: { onOpen: (b: unknown) => void }) => (
    <button
      onClick={() =>
        onOpen({
          id: 'sb1', sourceThreadId: 'conv-a', atMessageIdx: 1, note: 'Laptop fork',
          seededMessages: [
            { role: 'user', content: 'seed question' },
            { role: 'assistant', content: 'seed answer', ts: '2026-01-01T00:00:00Z' },
          ],
          createdAt: '2026-01-01T00:00:00Z',
        })
      }
    >
      open-synced-branch
    </button>
  ),
}));
vi.mock('@/components/chat/ToolTraceBlock', () => ({
  ToolTraceBlock: ({ trace }: { trace: { domain: string; action: string } }) => (
    <div data-testid="tool-trace">{`${trace.domain}.${trace.action}`}</div>
  ),
}));
vi.mock('@/components/chat/AssistantMoodChip', () => ({ AssistantMoodChip: () => null }));
vi.mock('@/components/chat/ToolPalette', () => ({
  ToolPalette: ({ open, onClose, onRunResult }: { open: boolean; onClose: () => void; onRunResult: (e: unknown, r: unknown) => void }) =>
    open ? (
      <div data-testid="tool-palette">
        <button onClick={() => onRunResult({ domain: 'math', action: 'solve' }, { x: 2 })}>palette-run</button>
        <button onClick={onClose}>close-palette</button>
      </div>
    ) : null,
}));
vi.mock('@/components/common/SafeCard', () => ({
  SafeCard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { ChatWorkspacePanel } from '@/components/chat/ChatWorkspacePanel';
import { useUIStore } from '@/store/ui';

// ── helpers ────────────────────────────────────────────────────────────────

const CONV_KEY = 'concord_chat_conversations';
const SESSION_KEY = 'concord_chat_session';
const MSGS_PREFIX = 'concord_chat_msgs_';

type FetchHandler = (url: string, init?: RequestInit) => Promise<unknown>;
let fetchHandler: FetchHandler;

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    headers: { get: () => 'application/json' },
    json: async () => body,
  };
}

function sseResponse(events: Array<Record<string, unknown>>) {
  const enc = new TextEncoder();
  const chunks = events.map((e) => enc.encode(`data: ${JSON.stringify(e)}\n`));
  // one malformed line too — must be skipped, not crash the stream
  chunks.splice(1, 0, enc.encode('data: {not json}\nignored line\n'));
  let i = 0;
  return {
    ok: true,
    headers: { get: () => 'text/event-stream' },
    body: {
      getReader: () => ({
        read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined }),
        cancel: vi.fn(),
      }),
    },
  };
}

function seedConversations(
  convs: Array<{ id: string; title: string; lastMessage?: string; messageCount?: number; updatedAt?: string }>,
) {
  window.localStorage.setItem(
    CONV_KEY,
    JSON.stringify(
      convs.map((c) => ({
        lastMessage: '',
        messageCount: 0,
        updatedAt: '2026-10-01T10:00:00Z',
        ...c,
      })),
    ),
  );
}

function seedMessages(sessionId: string, msgs: Array<Record<string, unknown>>) {
  window.localStorage.setItem(MSGS_PREFIX + sessionId, JSON.stringify(msgs));
}

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onActiveChange = vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <ChatWorkspacePanel active="chat" onActiveChange={onActiveChange} />
    </QueryClientProvider>,
  );
  return { ...utils, qc, onActiveChange };
}

/** The message log — conversation-drawer rows repeat last-message text, so
 *  thread assertions are scoped here. */
function thread(): HTMLElement {
  return screen.getByRole('log');
}

function composer(): HTMLTextAreaElement {
  return screen.getByPlaceholderText(/^Message /) as HTMLTextAreaElement;
}

function typeInComposer(text: string) {
  fireEvent.change(composer(), { target: { value: text } });
}

function send(text: string) {
  typeInComposer(text);
  fireEvent.click(screen.getByLabelText('Send message'));
}

function runCommand(id: string) {
  const cmd = registeredCommands.find((c) => c.id === id);
  if (!cmd) throw new Error(`command ${id} not registered`);
  act(() => cmd.action());
}

const clipboardWrite = vi.fn(async (_t: string) => {});

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, '', '/lenses/chat');
  authState.isAuthenticated = false;
  authState.user = null;
  registeredCommands = [];
  for (const k of Object.keys(eventHandlers)) delete eventHandlers[k];

  apiGet.mockReset().mockImplementation(async (url: string) => {
    if (url === '/api/initiative/settings') return { data: { settings: { disabled: false } } };
    if (url === '/api/initiative/pending') return { data: { pending: [] } };
    return { data: {} };
  });
  apiPost.mockReset().mockResolvedValue({ data: {} });
  apiPut.mockReset().mockResolvedValue({ data: {} });
  feedbackFn.mockReset().mockResolvedValue({ data: {} });
  forgeFn.mockReset().mockResolvedValue({ data: { dtu: { id: 'dtu-9', title: 'Forged insight' } } });
  lensDeleteFn.mockReset().mockResolvedValue({ data: {} });
  cogStatusFn.mockReset().mockResolvedValue({ data: { llm: { enabled: true } } });
  runArtifactMutateAsync.mockReset();
  oracleMutate.mockReset();

  fetchHandler = async (url: string) => {
    if (url.startsWith('/api/chat/sessions')) return jsonResponse({ ok: false });
    if (url.startsWith('/api/chat/messages')) return jsonResponse({ ok: false });
    if (url === '/api/chat/stream') {
      return sseResponse([{ chunk: 'Hello ' }, { chunk: 'there!' }, { done: true, out: { refs: [] } }]);
    }
    return jsonResponse({});
  };
  // Real network I/O always resolves on a later macrotask (never inside the
  // same microtask burst as the render that issued it) — model that, so React
  // commits the render + effects the send triggered before the reply lands.
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) =>
      new Promise((r) => setTimeout(r, 5)).then(() => fetchHandler(url, init)),
    ),
  );

  clipboardWrite.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: clipboardWrite }, configurable: true });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ── tests ──────────────────────────────────────────────────────────────────

describe('ChatWorkspacePanel — empty state', () => {
  it('greets with a time-of-day line, the north-star subtitle and starter prompts', async () => {
    authState.user = { username: 'ada' };
    renderPanel();
    expect(screen.getByText('How can I help you think today?')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /(Good (morning|afternoon|evening), Ada|Up late, Ada\?)/ })).toBeInTheDocument();
    expect(composer().placeholder).toBe('Message Concord');
    // Send is disabled with nothing typed
    expect(screen.getByLabelText('Send message')).toBeDisabled();
  });

  it('a starter chip fills the composer but does not send it', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Help me outline a plan' }));
    expect(composer().value).toBe('Help me outline a plan');
    expect(fetch).not.toHaveBeenCalledWith('/api/chat/stream', expect.anything());
  });

  it('shows the offline banner when the cognitive status says the LLM is disabled', async () => {
    cogStatusFn.mockResolvedValue({ data: { llm: { enabled: false } } });
    renderPanel();
    expect(await screen.findByText(/Language model is offline/)).toBeInTheDocument();
  });

  it('renders cognitive status stats when present', async () => {
    cogStatusFn.mockResolvedValue({
      data: {
        llm: { enabled: true },
        experience: { episodes: 4, patterns: 12 },
        attention: { activeThreads: 3 },
        reflection: { calibration: 0.8, strengths: ['recall'] },
      },
    });
    renderPanel();
    expect(await screen.findByText('12 patterns')).toBeInTheDocument();
    expect(screen.getByText('3 threads')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
  });

  it('consumes ?context=<domain> from the URL into the domain badge', async () => {
    window.history.pushState({}, '', '/lenses/chat?context=pharmacy');
    renderPanel();
    expect(await screen.findByText('pharmacy')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Clear domain context'));
    expect(screen.queryByText('pharmacy')).not.toBeInTheDocument();
  });
});

describe('ChatWorkspacePanel — sending', () => {
  it('streams a reply over SSE, renders both turns, and records a new conversation', async () => {
    renderPanel();
    send('What is a DTU?');

    expect(await within(thread()).findByText('Hello there!')).toBeInTheDocument();
    expect(within(thread()).getByText('What is a DTU?')).toBeInTheDocument();

    const streamCall = (fetch as ReturnType<typeof vi.fn>).mock.calls.find((c) => c[0] === '/api/chat/stream');
    const body = JSON.parse((streamCall![1] as RequestInit).body as string);
    expect(body.message).toBe('What is a DTU?');
    expect(body.mode).toBe('overview');
    expect(body.sessionId).toBeTruthy();

    const convs = JSON.parse(window.localStorage.getItem(CONV_KEY) || '[]');
    expect(convs).toHaveLength(1);
    expect(convs[0].title).toBe('What is a DTU?');
    expect(window.localStorage.getItem(SESSION_KEY)).toBe(convs[0].id);
    // composer clears after a successful send
    await waitFor(() => expect(composer().value).toBe(''));
  });

  it('regression: a reply that lands before the new-session effect flushes is kept (not clobbered by the stored user-only snapshot)', async () => {
    // Same-microtask response — the ordering that used to let the load
    // effect for the freshly-minted session overwrite the thread with the
    // [userMsg]-only snapshot saved at session creation, dropping the reply
    // from both the screen and storage.
    vi.stubGlobal('fetch', vi.fn((url: string) =>
      Promise.resolve(url === '/api/chat/stream' ? jsonResponse({ reply: 'Instant reply' }) : jsonResponse({ ok: false })),
    ));
    renderPanel();
    send('quick one');
    expect(await within(thread()).findByText('Instant reply')).toBeInTheDocument();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(within(thread()).getByText('Instant reply')).toBeInTheDocument();
    const sessionId = window.localStorage.getItem(SESSION_KEY)!;
    const stored = JSON.parse(window.localStorage.getItem(MSGS_PREFIX + sessionId) || '[]');
    expect(stored.map((m: { content: string }) => m.content)).toEqual(['quick one', 'Instant reply']);
  });

  it('falls back to the JSON body when the stream endpoint answers without SSE', async () => {
    fetchHandler = async (url) => {
      if (url === '/api/chat/stream') {
        return jsonResponse({
          reply: 'Plain JSON reply',
          refs: [{ id: 'dtu-1', title: 'Lattice primer', lineageHash: 'abcdef1234' }],
          sources: [{ type: 'web', title: 'Wiki page', url: 'https://example.org/x', source: 'example.org' }],
          webAugmented: true,
          toolCalls: [{ tool: 'math.solve', params: {}, result: 4, ok: true }],
          computed: { engineCount: 1 },
          dtuRefs: [{ id: 'dtu-2', title: 'Cited', tier: 'mega' }],
          reasoningSessionId: 'rs-1',
          wasSynthesized: true,
          shadowsUsed: 2,
          brain: 'conscious',
        });
      }
      return jsonResponse({ ok: false });
    };
    renderPanel();
    send('compute 2+2');
    expect(await within(thread()).findByText('Plain JSON reply')).toBeInTheDocument();
    expect(screen.getByText('Lattice primer')).toBeInTheDocument();
    expect(screen.getByText('Wiki page')).toBeInTheDocument();
    expect(screen.getByTestId('tool-call-card')).toHaveTextContent('math.solve');
    expect(screen.getByTestId('compute-badge')).toBeInTheDocument();
    expect(screen.getByTestId('citation-chips')).toBeInTheDocument();
    expect(screen.getByTestId('reasoning')).toHaveTextContent('rs-1');
    expect(screen.getByTestId('continuation-marker')).toBeInTheDocument();

    // clicking a referenced DTU opens the detail view; it can navigate + close
    fireEvent.click(screen.getByText('Lattice primer'));
    expect(screen.getByTestId('dtu-detail')).toHaveTextContent('dtu:dtu-1');
    fireEvent.click(screen.getByText('dtu-navigate'));
    expect(screen.getByTestId('dtu-detail')).toHaveTextContent('dtu:dtu-next');
    fireEvent.click(screen.getByText('dtu-close'));
    expect(screen.queryByTestId('dtu-detail')).not.toBeInTheDocument();
  });

  it('when the stream endpoint is unreachable, falls back to the buffered POST /api/chat', async () => {
    fetchHandler = async (url) => {
      if (url === '/api/chat/stream') throw new TypeError('Failed to fetch');
      return jsonResponse({ ok: false });
    };
    apiPost.mockImplementation(async (url: string) => {
      if (url === '/api/chat') return { data: { reply: 'Buffered fallback reply' } };
      return { data: {} };
    });
    renderPanel();
    send('hello?');
    expect(await screen.findByText('Buffered fallback reply')).toBeInTheDocument();
    const chatCall = apiPost.mock.calls.find((c) => c[0] === '/api/chat');
    expect(chatCall![1]).toMatchObject({ message: 'hello?', mode: 'overview' });
  });

  it('shows an honest "brain not responding" reply when the backend returns nothing usable', async () => {
    fetchHandler = async (url) => (url === '/api/chat/stream' ? jsonResponse({}) : jsonResponse({ ok: false }));
    renderPanel();
    send('anyone home?');
    expect(await screen.findByText(/The conscious brain is not responding/)).toBeInTheDocument();
  });

  it('surfaces a backend error field as the reply', async () => {
    fetchHandler = async (url) =>
      url === '/api/chat/stream' ? jsonResponse({ error: 'quota exceeded' }) : jsonResponse({ ok: false });
    renderPanel();
    send('hi');
    expect(await screen.findByText('Error: quota exceeded')).toBeInTheDocument();
  });

  it('when both stream and POST fail, posts a system "Failed to send" message', async () => {
    fetchHandler = async (url) => {
      if (url === '/api/chat/stream') throw new TypeError('offline');
      return jsonResponse({ ok: false });
    };
    apiPost.mockImplementation(async (url: string) => {
      if (url === '/api/chat') throw new Error('Network Error');
      return { data: {} };
    });
    renderPanel();
    send('are you there');
    expect(await screen.findByText(/Failed to send message: Network Error/)).toBeInTheDocument();
  });

  it('Enter sends, Shift+Enter does not', async () => {
    renderPanel();
    typeInComposer('line one');
    fireEvent.keyDown(composer(), { key: 'Enter', shiftKey: true });
    expect(fetch).not.toHaveBeenCalledWith('/api/chat/stream', expect.anything());
    fireEvent.keyDown(composer(), { key: 'Enter' });
    expect(await within(thread()).findByText('Hello there!')).toBeInTheDocument();
  });

  it('shows Stop while a reply is pending; Stop aborts the in-flight request', async () => {
    let resolveStream: (v: unknown) => void = () => {};
    let seenSignal: AbortSignal | undefined;
    fetchHandler = (url, init) => {
      if (url === '/api/chat/stream') {
        seenSignal = init?.signal as AbortSignal;
        return new Promise((r) => {
          resolveStream = r;
        });
      }
      return Promise.resolve(jsonResponse({ ok: false }));
    };
    renderPanel();
    send('slow question');
    const stop = await screen.findByLabelText('Stop generating');
    fireEvent.click(stop);
    expect(seenSignal?.aborted).toBe(true);
    resolveStream(jsonResponse({ reply: 'late' }));
  });

  it('Escape in the composer aborts generation while pending', async () => {
    let seenSignal: AbortSignal | undefined;
    fetchHandler = (url, init) => {
      if (url === '/api/chat/stream') {
        seenSignal = init?.signal as AbortSignal;
        return new Promise(() => {});
      }
      return Promise.resolve(jsonResponse({ ok: false }));
    };
    renderPanel();
    send('long one');
    await screen.findByLabelText('Stop generating');
    fireEvent.keyDown(composer(), { key: 'Escape' });
    expect(seenSignal?.aborted).toBe(true);
  });

  it('sends with the selected persona as system prompt and a quoted message prefix', async () => {
    seedConversations([{ id: 'conv-a', title: 'Alpha' }]);
    window.localStorage.setItem(SESSION_KEY, 'conv-a');
    seedMessages('conv-a', [
      { id: 'm1', role: 'user', content: 'first q', timestamp: '2026-10-01T10:00:00Z' },
      { id: 'm2', role: 'assistant', content: 'first answer', timestamp: '2026-10-01T10:00:05Z' },
    ]);
    window.history.pushState({}, '', '/lenses/chat?context=law');
    renderPanel();
    expect(await screen.findByText('first answer')).toBeInTheDocument();

    // pick a persona from the (header) persona picker
    fireEvent.click(screen.getByTitle('Select persona'));
    fireEvent.click(screen.getByRole('button', { name: /Socratic/i }));
    expect(await screen.findByText(/Persona switched to:/)).toBeInTheDocument();

    // quote the assistant answer
    fireEvent.click(screen.getAllByLabelText('Quote and reply')[1]);
    expect(screen.getByText('Replying to assistant')).toBeInTheDocument();

    send('follow up');
    await within(thread()).findByText('Hello there!');
    const streamCall = (fetch as ReturnType<typeof vi.fn>).mock.calls.find((c) => c[0] === '/api/chat/stream');
    const body = JSON.parse((streamCall![1] as RequestInit).body as string);
    expect(body.sessionId).toBe('conv-a');
    expect(body.message).toBe('[Quoting: "first answer"]\n\nfollow up');
    expect(body.systemPrompt).toContain('Current domain context: law');
    // the user bubble shows the "Replying to" reference
    expect(screen.getByText('Replying to')).toBeInTheDocument();
    // conversation metadata updated
    const convs = JSON.parse(window.localStorage.getItem(CONV_KEY) || '[]');
    expect(convs[0].lastMessage).toBe('Hello there!');
    expect(convs[0].messageCount).toBe(2);
  });

  it('cancel-reply clears the quote', async () => {
    seedConversations([{ id: 'conv-a', title: 'Alpha' }]);
    window.localStorage.setItem(SESSION_KEY, 'conv-a');
    seedMessages('conv-a', [{ id: 'm1', role: 'user', content: 'quote me', timestamp: '2026-10-01T10:00:00Z' }]);
    renderPanel();
    await screen.findByText('quote me');
    fireEvent.click(screen.getByLabelText('Quote and reply'));
    expect(screen.getByText('Replying to yourself')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Cancel reply'));
    expect(screen.queryByText('Replying to yourself')).not.toBeInTheDocument();
  });
});

describe('ChatWorkspacePanel — attachments', () => {
  it('attaches files (image preview + doc), lists chips, removes one, and sends metadata', async () => {
    renderPanel();
    const fileInput = screen.getByLabelText('Attach files') as HTMLInputElement;
    const img = new File(['png-bytes'], 'diagram.png', { type: 'image/png' });
    const doc = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [img, doc] } });
    });
    expect(await screen.findByText('notes.txt')).toBeInTheDocument();
    expect(screen.getByAltText('diagram.png')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Remove diagram.png'));
    expect(screen.queryByAltText('diagram.png')).not.toBeInTheDocument();

    send('see attached');
    await within(thread()).findByText('Hello there!');
    const streamCall = (fetch as ReturnType<typeof vi.fn>).mock.calls.find((c) => c[0] === '/api/chat/stream');
    const body = JSON.parse((streamCall![1] as RequestInit).body as string);
    expect(body.attachments).toHaveLength(1);
    expect(body.attachments[0]).toMatchObject({ name: 'notes.txt', type: 'text/plain' });
    expect(typeof body.attachments[0].data).toBe('string');
    // the user bubble lists its attachment chip; the composer chip is gone
    expect(screen.getAllByText('notes.txt')).toHaveLength(1);
  });
});

describe('ChatWorkspacePanel — conversation drawer', () => {
  beforeEach(() => {
    seedConversations([
      { id: 'conv-a', title: 'Alpha plans', lastMessage: 'about alpha', messageCount: 1 },
      { id: 'conv-b', title: 'Beta notes', lastMessage: 'beta stuff', messageCount: 2 },
    ]);
    seedMessages('conv-a', [{ id: 'a1', role: 'user', content: 'alpha message body', timestamp: '2026-10-01T09:00:00Z' }]);
    seedMessages('conv-b', [{ id: 'b1', role: 'assistant', content: 'beta message body', timestamp: '2026-10-01T09:00:00Z' }]);
  });

  it('lists conversations with counts; selecting one loads its messages', async () => {
    renderPanel();
    fireEvent.click(screen.getByLabelText('Open conversations'));
    const list = screen.getByRole('list', { name: 'Conversations' });
    expect(within(list).getByText('Alpha plans')).toBeInTheDocument();
    expect(within(list).getByText('1 message')).toBeInTheDocument();
    expect(within(list).getByText('2 messages')).toBeInTheDocument();

    fireEvent.click(within(list).getByText('Beta notes'));
    expect(await screen.findByText('beta message body')).toBeInTheDocument();
    expect(window.localStorage.getItem(SESSION_KEY)).toBe('conv-b');
  });

  it('keyboard Enter on a conversation row selects it', async () => {
    renderPanel();
    const row = screen.getAllByRole('listitem')[0];
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(await screen.findByText('alpha message body')).toBeInTheDocument();
  });

  it('search filters by title and last message, with an empty-result note', () => {
    renderPanel();
    const search = screen.getByLabelText('Search conversations');
    fireEvent.change(search, { target: { value: 'beta' } });
    const list = screen.getByRole('list', { name: 'Conversations' });
    expect(within(list).queryByText('Alpha plans')).not.toBeInTheDocument();
    expect(within(list).getByText('Beta notes')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByText('No matching conversations')).toBeInTheDocument();
  });

  it('renames a conversation via Enter and persists it; Escape cancels a rename', () => {
    renderPanel();
    fireEvent.click(screen.getByLabelText('Rename conversation: Alpha plans'));
    const input = screen.getByDisplayValue('Alpha plans');
    fireEvent.change(input, { target: { value: 'Alpha — final' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('Alpha — final')).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(CONV_KEY)!)[0].title).toBe('Alpha — final');

    fireEvent.click(screen.getByLabelText('Rename conversation: Beta notes'));
    const input2 = screen.getByDisplayValue('Beta notes');
    fireEvent.change(input2, { target: { value: 'nope' } });
    fireEvent.keyDown(input2, { key: 'Escape' });
    expect(screen.getByText('Beta notes')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('nope')).not.toBeInTheDocument();
  });

  it('deletes a conversation (server best-effort) and clears the open thread if it was selected', async () => {
    window.localStorage.setItem(SESSION_KEY, 'conv-a');
    lensDeleteFn.mockRejectedValue(new Error('404'));
    renderPanel();
    expect(await screen.findByText('alpha message body')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Delete conversation: Alpha plans'));
    await waitFor(() => expect(screen.queryByText('Alpha plans')).not.toBeInTheDocument());
    expect(lensDeleteFn).toHaveBeenCalledWith('chat', 'conv-a');
    expect(window.localStorage.getItem(MSGS_PREFIX + 'conv-a')).toBeNull();
    expect(screen.queryByText('alpha message body')).not.toBeInTheDocument();
    expect(screen.getByText('How can I help you think today?')).toBeInTheDocument();
  });

  it('New Chat resets to the empty canvas; backdrop click closes the drawer', async () => {
    window.localStorage.setItem(SESSION_KEY, 'conv-a');
    renderPanel();
    await screen.findByText('alpha message body');
    fireEvent.click(screen.getByLabelText('Open conversations'));
    fireEvent.click(screen.getByRole('button', { name: 'New Chat' }));
    expect(screen.getByText('How can I help you think today?')).toBeInTheDocument();
    expect(window.localStorage.getItem(SESSION_KEY)).toBeNull();

    fireEvent.click(screen.getByLabelText('Open conversations'));
    const aside = screen.getByRole('complementary', { name: 'Conversation list' });
    expect(aside.className).toContain('translate-x-0');
    const backdrop = aside.previousElementSibling as HTMLElement;
    fireEvent.click(backdrop);
    expect(aside.className).toContain('-translate-x-full');
  });

  it('settings button in the drawer opens the Studio', () => {
    renderPanel();
    fireEvent.click(screen.getByLabelText('Chat settings'));
    expect(screen.getByTestId('studio-panel')).toBeInTheDocument();
  });

  it('merges server-persisted sessions into the drawer', async () => {
    fetchHandler = async (url) => {
      if (url.startsWith('/api/chat/sessions')) {
        return jsonResponse({
          ok: true,
          sessions: [
            { id: 'conv-srv', title: 'From my laptop', lens: 'chat', updated_at: Date.parse('2026-10-05T00:00:00Z'), created_at: 0, msg_count: 7 },
            { id: 'conv-a', title: null, lens: 'chat', updated_at: Date.parse('2026-09-01T00:00:00Z'), created_at: 0, msg_count: 0 },
          ],
        });
      }
      return jsonResponse({ ok: false });
    };
    renderPanel();
    expect(await screen.findByText('From my laptop')).toBeInTheDocument();
    expect(screen.getByText('7 messages')).toBeInTheDocument();
    // a null server title keeps the local one
    expect(screen.getByText('Alpha plans')).toBeInTheDocument();
  });

  it('hydrates an empty local thread from /api/chat/messages (cross-device)', async () => {
    window.localStorage.setItem(SESSION_KEY, 'conv-remote');
    fetchHandler = async (url) => {
      if (url.startsWith('/api/chat/messages')) {
        return jsonResponse({
          ok: true,
          messages: [
            { role: 'user', content: 'remote question', ts: '2026-10-01T08:00:00Z' },
            { role: 'assistant', content: 'remote answer', ts: '2026-10-01T08:00:01Z', meta: { webAugmented: true, toolCalls: [] } },
          ],
        });
      }
      return jsonResponse({ ok: false });
    };
    renderPanel();
    expect(await screen.findByText('remote answer')).toBeInTheDocument();
    expect(screen.getByText('remote question')).toBeInTheDocument();
    const cached = JSON.parse(window.localStorage.getItem(MSGS_PREFIX + 'conv-remote') || '[]');
    expect(cached).toHaveLength(2);
  });

  it('authenticated users get BYO keys and synced branches in the drawer', () => {
    authState.isAuthenticated = true;
    renderPanel();
    fireEvent.click(screen.getByLabelText('BYO API keys'));
    expect(screen.getByTestId('byo-drawer')).toBeInTheDocument();
    fireEvent.click(screen.getByText('open-synced-branch'));
    expect(within(thread()).getByText('seed answer')).toBeInTheDocument();
    expect(screen.getByText('↳ Laptop fork')).toBeInTheDocument();
  });

  it('indexes the open thread for server-side search after a quiet period', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    window.localStorage.setItem(SESSION_KEY, 'conv-a');
    renderPanel();
    await screen.findByText('alpha message body');
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });
    const call = apiPost.mock.calls.find((c) => c[0] === '/api/lens/run' && (c[1] as { action: string }).action === 'thread-index');
    expect(call).toBeTruthy();
    expect((call![1] as { input: Record<string, unknown> }).input).toMatchObject({
      threadId: 'conv-a', title: 'Alpha plans', snippet: 'alpha message body',
    });
  });
});

describe('ChatWorkspacePanel — message actions', () => {
  beforeEach(() => {
    seedConversations([{ id: 'conv-a', title: 'Alpha plans' }]);
    window.localStorage.setItem(SESSION_KEY, 'conv-a');
    seedMessages('conv-a', [
      { id: 'u1', role: 'user', content: 'what is two plus two', timestamp: '2026-10-01T10:00:00Z' },
      { id: 'a1', role: 'assistant', content: 'It is four.', timestamp: '2026-10-01T10:00:02Z' },
    ]);
  });

  it('copy writes to the clipboard and flips the icon', async () => {
    renderPanel();
    await screen.findByText('It is four.');
    fireEvent.click(screen.getAllByLabelText('Copy message')[1]);
    await waitFor(() => expect(clipboardWrite).toHaveBeenCalledWith('It is four.'));
  });

  it('pin toggles a Pinned marker on and off', async () => {
    renderPanel();
    await screen.findByText('It is four.');
    fireEvent.click(screen.getAllByLabelText('Pin message')[0]);
    expect(screen.getByText('Pinned')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Unpin message'));
    expect(screen.queryByText('Pinned')).not.toBeInTheDocument();
  });

  it('edit saves new content with Save, and Escape cancels', async () => {
    renderPanel();
    await screen.findByText('what is two plus two');
    fireEvent.click(screen.getByLabelText('Edit message'));
    const editor = screen.getByDisplayValue('what is two plus two');
    fireEvent.change(editor, { target: { value: 'what is three plus three' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('what is three plus three')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Edit message'));
    const editor2 = screen.getByDisplayValue('what is three plus three');
    fireEvent.change(editor2, { target: { value: 'discard me' } });
    fireEvent.keyDown(editor2, { key: 'Escape' });
    expect(screen.queryByDisplayValue('discard me')).not.toBeInTheDocument();
    expect(screen.getByText('what is three plus three')).toBeInTheDocument();
  });

  it('edit saves with Enter; Cancel button also exits', async () => {
    renderPanel();
    await screen.findByText('what is two plus two');
    fireEvent.click(screen.getByLabelText('Edit message'));
    const editor = screen.getByDisplayValue('what is two plus two');
    fireEvent.change(editor, { target: { value: 'edited via enter' } });
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(screen.getByText('edited via enter')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Edit message'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('edited via enter')).toBeInTheDocument();
  });

  it('delete removes a user message', async () => {
    renderPanel();
    await screen.findByText('what is two plus two');
    fireEvent.click(screen.getByLabelText('Delete message'));
    expect(screen.queryByText('what is two plus two')).not.toBeInTheDocument();
  });

  it('thumbs up/down send feedback with the session and message index', async () => {
    renderPanel();
    await screen.findByText('It is four.');
    fireEvent.click(screen.getByLabelText('Thumbs up'));
    await waitFor(() =>
      expect(feedbackFn).toHaveBeenCalledWith({ sessionId: 'conv-a', rating: 'up', messageIndex: 1 }),
    );
    fireEvent.click(screen.getByLabelText('Thumbs down'));
    await waitFor(() => expect(feedbackFn).toHaveBeenCalledWith(expect.objectContaining({ rating: 'down' })));
  });

  it('a failed feedback call raises an error toast', async () => {
    const addToast = vi.spyOn(useUIStore.getState(), 'addToast');
    feedbackFn.mockRejectedValue(new Error('500'));
    renderPanel();
    await screen.findByText('It is four.');
    fireEvent.click(screen.getByLabelText('Thumbs up'));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    addToast.mockRestore();
  });

  it('regenerate replaces the last assistant reply using the last user prompt', async () => {
    apiPost.mockImplementation(async (url: string) => (url === '/api/chat' ? { data: { reply: 'It is 4, exactly.' } } : { data: {} }));
    renderPanel();
    await screen.findByText('It is four.');
    fireEvent.click(screen.getByLabelText('Regenerate'));
    expect(await screen.findByText('It is 4, exactly.')).toBeInTheDocument();
    expect(screen.queryByText('It is four.')).not.toBeInTheDocument();
    expect(apiPost).toHaveBeenCalledWith(
      '/api/chat',
      expect.objectContaining({ message: 'what is two plus two', sessionId: 'conv-a' }),
      expect.anything(),
    );
  });

  it('a failed regenerate posts an honest system message', async () => {
    apiPost.mockImplementation(async (url: string) => {
      if (url === '/api/chat') throw new Error('timeout');
      return { data: {} };
    });
    renderPanel();
    await screen.findByText('It is four.');
    fireEvent.click(screen.getByLabelText('Regenerate'));
    expect(await screen.findByText('Regeneration failed: timeout')).toBeInTheDocument();
  });

  it('branch-from-here forks the history into a new conversation', async () => {
    renderPanel();
    await screen.findByText('It is four.');
    fireEvent.click(screen.getByLabelText('Branch from here'));
    const convs = JSON.parse(window.localStorage.getItem(CONV_KEY)!);
    expect(convs).toHaveLength(2);
    expect(convs[0].title).toBe('↳ Alpha plans');
    expect(convs[0].messageCount).toBe(2);
    expect(window.localStorage.getItem(SESSION_KEY)).toBe(convs[0].id);
    expect(within(thread()).getByText('It is four.')).toBeInTheDocument();
  });

  it('forge turns a reply into a DTU and announces it', async () => {
    renderPanel();
    await screen.findByText('It is four.');
    fireEvent.click(screen.getByLabelText('Forge to DTU'));
    expect(await screen.findByText('Forged to DTU: Forged insight')).toBeInTheDocument();
    expect(forgeFn).toHaveBeenCalledWith({ content: 'It is four.', tags: ['chat-forged'], source: 'chat-lens' });
  });

  it('a failed forge raises an error toast', async () => {
    const addToast = vi.spyOn(useUIStore.getState(), 'addToast');
    forgeFn.mockRejectedValue(new Error('nope'));
    renderPanel();
    await screen.findByText('It is four.');
    fireEvent.click(screen.getByLabelText('Forge to DTU'));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    addToast.mockRestore();
  });

  it('authenticated users can save a synced branch (success + failure toasts)', async () => {
    authState.isAuthenticated = true;
    const addToast = vi.spyOn(useUIStore.getState(), 'addToast');
    renderPanel();
    await screen.findByText('It is four.');
    fireEvent.click(screen.getByText('sync-fork'));
    expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
    fireEvent.click(screen.getByText('sync-fork-fail'));
    expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    addToast.mockRestore();
  });
});

describe('ChatWorkspacePanel — anon nudge', () => {
  it('appears after the 3rd thread item for anon users and dismissal persists', async () => {
    seedConversations([{ id: 'conv-a', title: 'A' }]);
    window.localStorage.setItem(SESSION_KEY, 'conv-a');
    seedMessages('conv-a', [0, 1, 2, 3].map((i) => ({
      id: `n${i}`, role: i % 2 ? 'assistant' : 'user', content: `turn ${i}`, timestamp: `2026-10-01T10:00:0${i}Z`,
    })));
    renderPanel();
    expect(await screen.findByTestId('anon-nudge')).toBeInTheDocument();
    fireEvent.click(screen.getByText('dismiss-nudge'));
    expect(screen.queryByTestId('anon-nudge')).not.toBeInTheDocument();
    expect(window.localStorage.getItem('concord_anon_nudge_dismissed')).toBe('1');
  });
});

describe('ChatWorkspacePanel — "+" composer menu panels', () => {
  function openPlus() {
    fireEvent.click(screen.getByLabelText('Attachments and tools'));
  }

  it('Tools opens the analysis drawer; chat actions run and render results', async () => {
    runArtifactMutateAsync
      .mockResolvedValueOnce({ ok: true, result: { summary: 'Thread about plans' } })
      .mockResolvedValueOnce({ ok: false, error: 'not enough messages' })
      .mockRejectedValueOnce(new Error('boom'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderPanel();
    openPlus();
    fireEvent.click(screen.getByRole('button', { name: 'Tools' }));
    expect(screen.getByTestId('tools-drawer')).toBeInTheDocument();

    fireEvent.click(screen.getByText('run-summarize'));
    await waitFor(() => expect(screen.getByTestId('summarize-result')).toHaveTextContent('Thread about plans'));
    expect(runArtifactMutateAsync).toHaveBeenCalledWith({ id: 'conv-artifact-1', action: 'threadSummarize' });

    fireEvent.click(screen.getByText('run-participants'));
    await waitFor(() =>
      expect(screen.getByTestId('participants-result')).toHaveTextContent('Action failed: not enough messages'),
    );

    fireEvent.click(screen.getByText('run-topics'));
    await waitFor(() => expect(errSpy).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('tools-running')).toHaveTextContent('idle'));

    fireEvent.click(screen.getByText('clear-summarize'));
    expect(screen.getByTestId('summarize-result')).toHaveTextContent('null');
    fireEvent.click(screen.getByText('clear-participants'));
    fireEvent.click(screen.getByText('clear-topics'));
    fireEvent.click(screen.getByText('close-tools'));
    expect(screen.queryByTestId('tools-drawer')).not.toBeInTheDocument();
    errSpy.mockRestore();
  });

  it('topic detection error result is shown honestly', async () => {
    runArtifactMutateAsync.mockResolvedValueOnce({ ok: false });
    renderPanel();
    openPlus();
    fireEvent.click(screen.getByRole('button', { name: 'Tools' }));
    fireEvent.click(screen.getByText('run-topics'));
    await waitFor(() => expect(screen.getByTestId('topics-result')).toHaveTextContent('Action failed: Unknown error'));
  });

  it('Projects opens; picking a project shows the active-project chip', () => {
    renderPanel();
    openPlus();
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    fireEvent.click(screen.getByText('pick-project'));
    fireEvent.click(screen.getByText('close-projects'));
    expect(screen.queryByTestId('projects-panel')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Open active project'));
    expect(screen.getByTestId('projects-panel')).toBeInTheDocument();
    expect(screen.getByTitle('Open active project')).toHaveTextContent('Thesis researc');
  });

  it('Prompts inserts a saved prompt into the composer (appending to a draft)', () => {
    renderPanel();
    typeInComposer('Draft:');
    openPlus();
    fireEvent.click(screen.getByRole('button', { name: 'Prompts' }));
    fireEvent.click(screen.getByText('insert-prompt'));
    expect(composer().value).toBe('Draft:\n\nSummarize this paper');
    fireEvent.click(screen.getByText('close-prompts'));
    expect(screen.queryByTestId('prompts-panel')).not.toBeInTheDocument();
  });

  it('Schedule opens and closes the scheduled-tasks panel', () => {
    renderPanel();
    openPlus();
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    expect(screen.getByTestId('scheduled-panel')).toBeInTheDocument();
    fireEvent.click(screen.getByText('close-scheduled'));
    expect(screen.queryByTestId('scheduled-panel')).not.toBeInTheDocument();
  });

  it('Studio inserts canvas text and activates a custom GPT as the persona', async () => {
    renderPanel();
    openPlus();
    fireEvent.click(screen.getByRole('button', { name: 'Studio' }));
    fireEvent.click(screen.getByText('studio-insert'));
    expect(composer().value).toBe('canvas text');
    fireEvent.click(screen.getByText('activate-gpt'));
    expect(screen.queryByTestId('studio-panel')).not.toBeInTheDocument();
    expect(await screen.findByText(/Activated custom GPT "Grant Writer"/)).toBeInTheDocument();
    expect(composer().placeholder).toBe('Message Grant Writer');

    send('draft an intro');
    await within(thread()).findByText('Hello there!');
    const streamCall = (fetch as ReturnType<typeof vi.fn>).mock.calls.find((c) => c[0] === '/api/chat/stream');
    const body = JSON.parse((streamCall![1] as RequestInit).body as string);
    expect(body.systemPrompt).toBe('Write grants.');
    expect(body.mode).toBe('deep');
  });

  it('Agent Mode opens the agent panel', () => {
    renderPanel();
    openPlus();
    fireEvent.click(screen.getByRole('button', { name: 'Agent Mode' }));
    expect(screen.getByTestId('agent-mode-panel')).toBeInTheDocument();
  });

  it('Attach file triggers the hidden file input', () => {
    renderPanel();
    const fileInput = screen.getByLabelText('Attach files') as HTMLInputElement;
    const clickSpy = vi.spyOn(fileInput, 'click');
    openPlus();
    fireEvent.click(screen.getByRole('button', { name: 'Attach file' }));
    expect(clickSpy).toHaveBeenCalled();
  });

  it('Escape and an outside click close the open menu', () => {
    renderPanel();
    openPlus();
    expect(screen.getByRole('button', { name: 'Agent Mode' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Agent Mode' })).not.toBeInTheDocument();

    openPlus();
    // a click inside the menu does not close it
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Agent Mode' }));
    expect(screen.getByRole('button', { name: 'Agent Mode' })).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('button', { name: 'Agent Mode' })).not.toBeInTheDocument();
  });
});

describe('ChatWorkspacePanel — workspace menu + header', () => {
  it('each workspace entry opens its overlay', () => {
    renderPanel();
    fireEvent.click(screen.getByText('ws-context'));
    expect(screen.getByTestId('context-overlay')).toBeInTheDocument();
    fireEvent.click(screen.getByText('close-context'));

    fireEvent.click(screen.getByText('ws-palette'));
    expect(screen.getByTestId('tool-palette')).toBeInTheDocument();
    fireEvent.click(screen.getByText('close-palette'));

    fireEvent.click(screen.getByText('ws-search'));
    expect(screen.getByTestId('thread-search')).toBeInTheDocument();
    fireEvent.click(screen.getByText('close-thread-search'));

    fireEvent.click(screen.getByText('ws-projects'));
    expect(screen.getByTestId('projects-panel')).toBeInTheDocument();
    fireEvent.click(screen.getByText('ws-prompts'));
    expect(screen.getByTestId('prompts-panel')).toBeInTheDocument();
    fireEvent.click(screen.getByText('ws-schedule'));
    expect(screen.getByTestId('scheduled-panel')).toBeInTheDocument();
    fireEvent.click(screen.getByText('ws-studio'));
    expect(screen.getByTestId('studio-panel')).toBeInTheDocument();

    fireEvent.click(screen.getByText('ws-analysis'));
    expect(screen.getByTestId('tools-drawer')).toBeInTheDocument();
    fireEvent.click(screen.getByText('ws-analysis'));
    expect(screen.queryByTestId('tools-drawer')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('ws-systems'));
    expect(screen.getByTestId('systems-drawer')).toBeInTheDocument();
    fireEvent.click(screen.getByText('close-systems'));
    expect(screen.queryByTestId('systems-drawer')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Session history'));
    expect(screen.getByTestId('session-sidebar')).toBeInTheDocument();
    fireEvent.click(screen.getByText('close-session'));
    expect(screen.queryByTestId('session-sidebar')).not.toBeInTheDocument();
  });

  it('pause toggles initiative delivery server-side and reverts on failure', async () => {
    apiPut.mockRejectedValueOnce(new Error('403'));
    renderPanel();
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/initiative/settings'));
    fireEvent.click(screen.getByText('ws-pause'));
    expect(apiPut).toHaveBeenCalledWith('/api/initiative/settings', { disabled: true });
    // after the failure the state reverts, so the next toggle asks to pause again
    await waitFor(() => undefined);
    await act(async () => {});
    fireEvent.click(screen.getByText('ws-pause'));
    expect(apiPut).toHaveBeenLastCalledWith('/api/initiative/settings', { disabled: true });
  });

  it('thread search selects a thread into the canvas', async () => {
    seedConversations([{ id: 'conv-b', title: 'Beta' }]);
    seedMessages('conv-b', [{ id: 'b1', role: 'user', content: 'beta body', timestamp: '2026-10-01T10:00:00Z' }]);
    renderPanel();
    fireEvent.click(screen.getByText('ws-search'));
    fireEvent.click(screen.getByText('select-thread'));
    expect(await screen.findByText('beta body')).toBeInTheDocument();
    expect(screen.queryByTestId('thread-search')).not.toBeInTheDocument();
  });

  it('palette runs and realtime tool results land inline as traces', async () => {
    renderPanel();
    fireEvent.click(screen.getByText('ws-palette'));
    fireEvent.click(screen.getByText('palette-run'));
    expect(await screen.findByText('math.solve')).toBeInTheDocument();
    act(() => {
      eventHandlers['chat:tool_result']({ domain: 'weather', action: 'forecast', result: { t: 20 } });
      eventHandlers['chat:tool_result']({ domain: 'missing-action' });
    });
    expect(await screen.findByText('weather.forecast')).toBeInTheDocument();
    expect(screen.getAllByTestId('tool-trace')).toHaveLength(2);
  });

  it('header mode picker switches the AI mode used for sends', async () => {
    renderPanel();
    fireEvent.click(screen.getByLabelText('Choose mode'));
    const menus = screen.getAllByRole('button', { name: /Code/ });
    fireEvent.click(menus[menus.length - 1]);
    expect(screen.getByLabelText('Choose mode')).toHaveAttribute('title', 'Mode: Code');
    send('fix my loop');
    await within(thread()).findByText('Hello there!');
    const streamCall = (fetch as ReturnType<typeof vi.fn>).mock.calls.find((c) => c[0] === '/api/chat/stream');
    expect(JSON.parse((streamCall![1] as RequestInit).body as string).mode).toBe('code');
  });

  it('the classic header mode dropdown also switches the mode', () => {
    renderPanel();
    // the dense header button shows the current mode name ("Chat")
    const headerBtn = screen.getAllByRole('button', { name: /^Chat$/ })[0];
    fireEvent.click(headerBtn);
    fireEvent.click(screen.getByRole('button', { name: /Research Research mode with citations/ }));
    expect(screen.getByLabelText('Choose mode')).toHaveAttribute('title', 'Mode: Research');
  });
});

describe('ChatWorkspacePanel — chat options menu (export / transcript / handoff)', () => {
  let clickedDownloads: string[];
  beforeEach(() => {
    seedConversations([{ id: 'conv-a', title: 'Alpha plans!' }]);
    window.localStorage.setItem(SESSION_KEY, 'conv-a');
    seedMessages('conv-a', [
      { id: 'u1', role: 'user', content: 'export me', timestamp: '2026-10-01T10:00:00Z', pinned: true },
      {
        id: 'a1', role: 'assistant', content: 'exported answer', timestamp: '2026-10-01T10:00:01Z',
        refs: [{ id: 'd1', title: 'Ref title', lineageHash: '0123456789' }],
      },
      { id: 's1', role: 'system', content: '', timestamp: '' },
    ]);
    clickedDownloads = [];
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:mock'),
      revokeObjectURL: vi.fn(),
    }));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clickedDownloads.push(this.download);
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function openOptions() {
    fireEvent.click(screen.getAllByLabelText('Chat options')[0]);
  }

  it('exports JSON and Markdown downloads named after the conversation', async () => {
    renderPanel();
    await screen.findByText('exported answer');
    openOptions();
    fireEvent.click(screen.getByRole('button', { name: /Export JSON/ }));
    expect(clickedDownloads[0]).toMatch(/^chat-export-\d{4}-\d{2}-\d{2}\.json$/);

    openOptions();
    fireEvent.click(screen.getByRole('button', { name: /Export Markdown/ }));
    expect(clickedDownloads[1]).toMatch(/^alpha-plans-\d{4}-\d{2}-\d{2}\.md$/);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
  });

  it('copies a markdown transcript to the clipboard', async () => {
    renderPanel();
    await screen.findByText('exported answer');
    openOptions();
    fireEvent.click(screen.getByRole('button', { name: /Copy transcript/ }));
    await waitFor(() => expect(clipboardWrite).toHaveBeenCalled());
    const text = clipboardWrite.mock.calls[0][0];
    expect(text).toContain('**You:** export me');
    expect(text).toContain('**Concord:** exported answer');
    expect(text).toContain('**System:**');
  });

  it('a clipboard failure is logged, not thrown', async () => {
    clipboardWrite.mockRejectedValueOnce(new Error('denied'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderPanel();
    await screen.findByText('exported answer');
    openOptions();
    fireEvent.click(screen.getByRole('button', { name: /Copy transcript/ }));
    await waitFor(() => expect(warn).toHaveBeenCalledWith('[Chat] clipboard write failed'));
  });

  it('handoff notes land in the thread as a system message', async () => {
    renderPanel();
    await screen.findByText('exported answer');
    openOptions();
    fireEvent.click(screen.getAllByText('handoff')[0]);
    expect(await screen.findByText('Handed off to mail draft.')).toBeInTheDocument();
  });

  it('New Conversation and Delete Conversation from the options menu', async () => {
    renderPanel();
    await screen.findByText('exported answer');
    openOptions();
    fireEvent.click(screen.getByRole('button', { name: /Delete Conversation/ }));
    await waitFor(() => expect(screen.queryByText('exported answer')).not.toBeInTheDocument());
    expect(lensDeleteFn).toHaveBeenCalledWith('chat', 'conv-a');

    openOptions();
    fireEvent.click(screen.getByRole('button', { name: /New Conversation/ }));
    expect(screen.getByText('How can I help you think today?')).toBeInTheDocument();
  });

  it('the header "+" starts a new conversation', async () => {
    renderPanel();
    await screen.findByText('exported answer');
    fireEvent.click(screen.getByLabelText('New conversation'));
    expect(screen.getByText('How can I help you think today?')).toBeInTheDocument();
  });
});

describe('ChatWorkspacePanel — global message search', () => {
  beforeEach(() => {
    seedConversations([
      { id: 'conv-a', title: 'Alpha' },
      { id: 'conv-b', title: 'Beta' },
    ]);
    window.localStorage.setItem(SESSION_KEY, 'conv-a');
    seedMessages('conv-a', [{ id: 'a1', role: 'user', content: 'the quick brown fox', timestamp: '2026-10-01T10:00:00Z' }]);
    seedMessages('conv-b', [
      {
        id: 'b1', role: 'assistant',
        content: 'A long preamble that goes on and on for quite a while before the fox shows up and then keeps going past the match for many more words so the preview is clipped.',
        timestamp: '2026-10-01T10:00:00Z',
      },
    ]);
  });

  it('opens from the options menu, scans every conversation, and jumps to a hit', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderPanel();
    await screen.findByText('the quick brown fox');
    fireEvent.click(screen.getAllByLabelText('Chat options')[0]);
    fireEvent.click(screen.getByRole('button', { name: /Search all chats/ }));
    const input = screen.getByPlaceholderText(/Search every message/);
    expect(screen.getByText('Type at least 2 characters to search')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'zebra' } });
    expect(screen.getByText('No matches across 2 conversations')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'fox' } });
    expect(screen.getByText('2 matches')).toBeInTheDocument();
    expect(screen.getByText('scanning 2 conversations')).toBeInTheDocument();

    const betaHit = screen.getAllByText('Beta').find((e) => e.tagName === 'SPAN')!.closest('button') as HTMLButtonElement;
    fireEvent.click(betaHit);
    expect(screen.queryByPlaceholderText(/Search every message/)).not.toBeInTheDocument();
    expect(await screen.findByText(/A long preamble/)).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(1600);
    });
  });

  it('opens via the ⌘⇧F command; Escape and backdrop click close it', () => {
    renderPanel();
    runCommand('global-search');
    const input = screen.getByPlaceholderText(/Search every message/);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByPlaceholderText(/Search every message/)).not.toBeInTheDocument();

    runCommand('global-search');
    const dialogInput = screen.getByPlaceholderText(/Search every message/);
    // clicking inside the card keeps it open
    fireEvent.click(dialogInput);
    expect(screen.getByPlaceholderText(/Search every message/)).toBeInTheDocument();
    const backdrop = dialogInput.closest('.fixed') as HTMLElement;
    fireEvent.click(backdrop);
    expect(screen.queryByPlaceholderText(/Search every message/)).not.toBeInTheDocument();
  });
});

describe('ChatWorkspacePanel — slash commands', () => {
  it('typing "/" opens the command menu; arrows + Enter run an arg-less command', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderPanel();
    typeInComposer('/help');
    expect(screen.getByText('Commands')).toBeInTheDocument();
    expect(screen.getByText('Show available commands')).toBeInTheDocument();
    fireEvent.keyDown(composer(), { key: 'ArrowDown' });
    fireEvent.keyDown(composer(), { key: 'ArrowUp' });
    fireEvent.keyDown(composer(), { key: 'Enter' });
    await act(async () => {
      vi.advanceTimersByTime(5);
    });
    expect(await screen.findByText(/Available commands:/)).toBeInTheDocument();
  });

  it('Tab completes a command that takes args; Escape dismisses the menu', () => {
    renderPanel();
    typeInComposer('/cont');
    fireEvent.keyDown(composer(), { key: 'Tab' });
    expect(composer().value).toBe('/context ');
    typeInComposer('/');
    expect(screen.getByText('Commands')).toBeInTheDocument();
    fireEvent.keyDown(composer(), { key: 'Escape' });
    expect(screen.queryByText('Commands')).not.toBeInTheDocument();
  });

  it('clicking a menu entry with args just fills it; typing a space closes the menu', () => {
    renderPanel();
    typeInComposer('/ora');
    fireEvent.click(screen.getByText('/oracle [query]'));
    expect(composer().value).toBe('/oracle ');
    typeInComposer('/oracle what');
    expect(screen.queryByText('Commands')).not.toBeInTheDocument();
  });

  it('clicking an arg-less entry executes it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderPanel();
    typeInComposer('/to');
    fireEvent.mouseEnter(screen.getByText('/tool'));
    fireEvent.click(screen.getByText('/tool'));
    await act(async () => {
      vi.advanceTimersByTime(5);
    });
    expect(screen.getByTestId('tool-palette')).toBeInTheDocument();
  });

  it('/context sets and reports the domain context', async () => {
    renderPanel();
    send('/context');
    expect(await screen.findByText(/Current domain context: \(none\)/)).toBeInTheDocument();
    send('/context oncology');
    expect(await screen.findByText('Domain context set to: oncology')).toBeInTheDocument();
    send('/context');
    expect(await screen.findByText(/Current domain context: oncology\./)).toBeInTheDocument();
  });

  it('/mode with a known and an unknown mode', async () => {
    renderPanel();
    send('/mode deep');
    expect(await screen.findByText(/Switched to Deep mode/)).toBeInTheDocument();
    send('/mode banana');
    expect(await screen.findByText(/Unknown mode "banana"/)).toBeInTheDocument();
    send('/mode');
    // bare /mode opens the mode picker
    expect(screen.getByLabelText('Choose mode')).toHaveAttribute('aria-expanded', 'true');
  });

  it('/forge with no assistant reply says so; with one it forges the last reply', async () => {
    renderPanel();
    send('/forge');
    expect(await screen.findByText('No assistant message to forge.')).toBeInTheDocument();
    send('real question');
    await within(thread()).findByText('Hello there!');
    send('/forge');
    await waitFor(() => expect(forgeFn).toHaveBeenCalledWith(expect.objectContaining({ content: 'Hello there!' })));
  });

  it('/unknown reports an unknown command', async () => {
    renderPanel();
    send('/frobnicate');
    expect(await screen.findByText(/Unknown command: \/frobnicate/)).toBeInTheDocument();
  });

  it('/clear starts a fresh chat', async () => {
    seedConversations([{ id: 'conv-a', title: 'Alpha' }]);
    window.localStorage.setItem(SESSION_KEY, 'conv-a');
    seedMessages('conv-a', [{ id: 'a1', role: 'user', content: 'old stuff', timestamp: '2026-10-01T10:00:00Z' }]);
    renderPanel();
    await screen.findByText('old stuff');
    send('/clear');
    expect(screen.queryByText('old stuff')).not.toBeInTheDocument();
    expect(screen.getByText('How can I help you think today?')).toBeInTheDocument();
  });

  it('/export downloads the transcript', async () => {
    const createUrl = vi.fn(() => 'blob:x');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() }));
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderPanel();
    send('/export');
    expect(createUrl).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it('/oracle without a query shows usage; with a query renders the rich Oracle answer', async () => {
    oracleMutate.mockImplementation((_vars: unknown, opts: OracleOpts) => {
      opts.onSuccess({ answer: 'Forty-two', sources: [] });
    });
    renderPanel();
    send('/oracle');
    expect(await screen.findByText(/Usage: \/oracle/)).toBeInTheDocument();
    send('/oracle meaning of life');
    expect(await screen.findByTestId('oracle-response')).toHaveTextContent('oracle:Forty-two');
    expect(screen.getByText('/oracle meaning of life')).toBeInTheDocument();
    expect(oracleMutate).toHaveBeenCalledWith(
      { query: 'meaning of life', context: null },
      expect.anything(),
    );
    fireEvent.click(screen.getByText('open-oracle-dtu'));
    expect(screen.getByTestId('dtu-detail')).toHaveTextContent('dtu:dtu-oracle');
  });

  it('/oracle failure is reported, with the domain context passed through', async () => {
    oracleMutate.mockImplementation((_vars: unknown, opts: OracleOpts) => {
      opts.onError(new Error('pipeline down'));
    });
    window.history.pushState({}, '', '/lenses/chat?context=physics');
    renderPanel();
    await screen.findByText('physics');
    send('/oracle dark matter');
    expect(await screen.findByText('Oracle Engine failed: pipeline down')).toBeInTheDocument();
    expect(oracleMutate).toHaveBeenCalledWith({ query: 'dark matter', context: { domain: 'physics' } }, expect.anything());
  });
});

describe('ChatWorkspacePanel — initiatives', () => {
  it('renders Concord initiatives inline with an away banner and wires dismiss/respond/action', async () => {
    const now = new Date().toISOString();
    apiGet.mockImplementation(async (url: string) => {
      if (url === '/api/initiative/pending') {
        return {
          data: {
            pending: [
              { id: 'i1', triggerType: 'pendingWorkReminder', message: 'You left the report half-done', priority: 'normal', score: 1, status: 'delivered', createdAt: now },
              { id: 'i2', triggerType: 'insight', message: 'Something new in your lattice', priority: 'low', score: 1, status: 'read', createdAt: now, deliveredAt: now },
            ],
          },
        };
      }
      if (url === '/api/initiative/settings') return { data: { settings: { disabled: true } } };
      return { data: {} };
    });
    renderPanel();
    expect(await screen.findByText('You left the report half-done')).toBeInTheDocument();
    expect(screen.getByText(/Concord wrote you 1 time while you were away/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create quest from this/ })).toBeInTheDocument();

    fireEvent.click(screen.getAllByText('init-dismiss')[0]);
    fireEvent.click(screen.getAllByText('init-respond')[0]);
    fireEvent.click(screen.getAllByText('init-action')[0]);
    expect(apiPost).toHaveBeenCalledWith('/api/initiative/i1/dismiss', {});
    expect(apiPost).toHaveBeenCalledWith('/api/initiative/i1/respond', { responded: true });
    expect(apiPost).toHaveBeenCalledWith('/api/initiative/i1/respond', { action: 'snooze', minutes: 5 });
  });
});

describe('ChatWorkspacePanel — keyboard shortcuts (useLensCommand)', () => {
  it('registers the documented shortcuts and they open the right surfaces', () => {
    renderPanel();
    const ids = registeredCommands.map((c) => c.id);
    expect(ids).toEqual(
      expect.arrayContaining(['send', 'focus-input', 'tool-palette', 'toggle-pause', 'global-search', 'thread-search', 'projects-panel']),
    );
    runCommand('tool-palette');
    expect(screen.getByTestId('tool-palette')).toBeInTheDocument();
    runCommand('thread-search');
    expect(screen.getByTestId('thread-search')).toBeInTheDocument();
    runCommand('projects-panel');
    expect(screen.getByTestId('projects-panel')).toBeInTheDocument();
    runCommand('focus-input');
    expect(document.activeElement).toBe(composer());
    runCommand('toggle-pause');
    expect(apiPut).toHaveBeenCalledWith('/api/initiative/settings', { disabled: true });
  });

  it('mod+enter sends the current draft', async () => {
    renderPanel();
    typeInComposer('sent by shortcut');
    // re-read after the rerender so the action closes over the new input
    runCommand('send');
    expect(await within(thread()).findByText('Hello there!')).toBeInTheDocument();
  });
});
