/// <reference types="@testing-library/jest-dom/vitest" />
// concord-frontend/app/lenses/chat/page.conkay-backport.test.tsx
//
// EXECUTION UNIT (Track A / A5-backport) — pins the ConKay cockpit machinery
// backported into the chat lens's `/mode conkay` surface, mirroring
// components/conkay/ConKayOverlay.test.tsx's Unit A2 pattern (same
// assertions, same mocking strategy) so the two surfaces are provably
// held to the same confirm-gate contract, not just visually similar:
//   - a macro `isMutatingMacro` flags as a write renders <ConKayActionConfirm>
//     inside the chat lens and does NOT call `lensRun` until confirmed;
//   - a read macro calls `lensRun` immediately, no confirm card;
//   - Cancel resolves the gate WITHOUT ever calling lensRun, and the
//     cancellation is reported honestly in the transcript;
//   - the cockpit's panel lanes (the SAME <ConKayCockpit> the overlay uses)
//     are mounted once ConKay mode has messages.
//
// Heavy chrome unrelated to this unit (sidebar panels, DTU widgets, realtime
// hooks, voice, the world-tree backdrop) is stubbed so the test exercises the
// page's own ConKay wiring, not those subsystems — same spirit as
// app/lenses/sessions/page.test.tsx.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

// ── lensRun / api client ────────────────────────────────────────────────────
const lensRunMock = vi.fn(async (_domain: string, _macro: string, _input: Record<string, unknown>, _runId?: string) => ({
  data: { ok: true, result: { done: true }, error: null },
}));
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: Parameters<typeof lensRunMock>) => lensRunMock(...args),
  api: {
    get: vi.fn(() => Promise.resolve({ data: {} })),
    post: vi.fn(() => Promise.resolve({ data: {} })),
    put: vi.fn(() => Promise.resolve({ data: {} })),
  },
  apiHelpers: {
    cognitive: { status: () => Promise.resolve({ data: {} }) },
    chat: { feedback: vi.fn(() => Promise.resolve({ data: {} })) },
    forge: { hybrid: vi.fn(() => Promise.resolve({ data: {} })) },
  },
}));

// ── socket lifecycle (same mock shape as ConKayOverlay.test.tsx) ───────────
vi.mock('@/lib/realtime/socket', () => ({
  subscribe: vi.fn(() => () => {}),
  connectSocket: vi.fn(),
  onConnectionLost: vi.fn(() => () => {}),
  onReconnected: vi.fn(() => () => {}),
}));

vi.mock('@/lib/realtime/event-bus', () => ({
  useEvent: () => {},
}));

// ── voice: disabled, matches ConKayOverlay.test.tsx's stub shape ───────────
vi.mock('@/components/conkay/useConKayVoice', () => ({
  useConKayVoice: () => ({
    supported: false,
    listening: false,
    speaking: false,
    interim: '',
    usingServerStt: false,
    voiceUnavailable: false,
    ttsAmplitudeRef: { current: 0 },
    speak: vi.fn(),
  }),
}));

// next/dynamic-loaded heavy chrome (AgentModePanel/InitiativeBell + anything
// ConKayBackdrop lazy-loads internally) — render nothing, irrelevant here.
vi.mock('next/dynamic', () => ({
  default: () => () => null,
}));
vi.mock('@/components/conkay/ConKayBackdrop', () => ({ ConKayBackdrop: () => null }));
vi.mock('@/components/conkay/ConKayHud', () => ({ ConKayHud: () => null }));

// ── unrelated lens chrome — stubbed passthrough/no-op, same pattern as
//    app/lenses/sessions/page.test.tsx ──────────────────────────────────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/chat/HackerNewsReference', () => ({ HackerNewsReference: () => null }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useTilePush', () => ({ useTilePush: () => {} }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/components/mobile/MobileTabBar', () => ({ MobileTabBar: () => null }));
vi.mock('@/hooks/useLensDTUs', () => ({
  useLensDTUs: () => ({
    hyperDTUs: [], megaDTUs: [], regularDTUs: [], tierDistribution: {},
    publishToMarketplace: vi.fn(), isLoading: false, refetch: vi.fn(),
  }),
}));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: () => ({ mutateAsync: vi.fn(async () => ({ ok: true, result: {} })) }),
}));
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({ items: [] }),
}));
vi.mock('@/hooks/useOracleSolve', () => ({
  useOracleSolve: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ isAuthenticated: false }),
}));
vi.mock('@/components/lens/LensContextPanel', () => ({ LensContextPanel: () => null }));
vi.mock('@/components/artifact/ArtifactUploader', () => ({ ArtifactUploader: () => null }));
vi.mock('@/components/feedback/FeedbackWidget', () => ({ FeedbackWidget: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/lens/LensFeaturePanel', () => ({ LensFeaturePanel: () => null }));
vi.mock('@/components/dtu/DTUDetailView', () => ({ DTUDetailView: () => null }));
vi.mock('@/components/chat/MessageRenderer', () => ({
  default: ({ content }: { content: string }) => <div data-testid="message-renderer">{content}</div>,
}));
vi.mock('@/components/chat/OracleResponse', () => ({ default: () => null }));
vi.mock('@/components/chat/ToolCallCard', () => ({
  ToolCallCard: ({ call }: { call: { tool: string } }) => <div data-testid="tool-call-card">{call.tool}</div>,
}));
vi.mock('@/components/chat/ComputeBadge', () => ({ default: () => null }));
vi.mock('@/components/chat/CitationChips', () => ({ default: () => null }));
vi.mock('@/components/chat/AnonNudge', () => ({ default: () => null }));
vi.mock('@/components/chat/BranchForkButton', () => ({ default: () => null }));
vi.mock('@/components/chat/BYOKeyDrawer', () => ({ default: () => null }));
vi.mock('@/components/chat/ReasoningIndicator', () => ({ ReasoningIndicator: () => null }));
vi.mock('@/components/chat/MessageContinuationMarker', () => ({ MessageContinuationMarker: () => null }));
vi.mock('@/components/chat/AtlasOverlay', () => ({ default: () => null }));
vi.mock('@/components/chat/AtlasViewer', () => ({ default: () => null }));
vi.mock('@/components/chat/ProjectsPanel', () => ({ default: () => null }));
vi.mock('@/components/chat/PromptsLibrary', () => ({ default: () => null }));
vi.mock('@/components/chat/ThreadSearchOverlay', () => ({ default: () => null }));
vi.mock('@/components/chat/ScheduledTasksPanel', () => ({ default: () => null }));
vi.mock('@/components/chat/ChatStudioPanel', () => ({ default: () => null }));
vi.mock('@/components/chat/ChatModePanels', () => ({
  WelcomePanel: () => null,
  ModeSelector: () => null,
  ChatPanel: () => null,
}));
vi.mock('@/components/chat/ChatRouteOverlay', () => ({ default: () => null }));
vi.mock('@/components/chat/ContextOverlay', () => ({ ContextOverlay: () => null }));
vi.mock('@/components/chat/ForgeCard', () => ({ default: () => null }));
vi.mock('@/components/chat/FoundationCard', () => ({ default: () => null }));
vi.mock('@/components/chat/SessionSidebar', () => ({ SessionSidebar: () => null }));
vi.mock('@/components/chat/ShieldCard', () => ({ default: () => null }));
vi.mock('@/components/chat/MeshStatusCard', () => ({ default: () => null }));
vi.mock('@/components/chat/IntelligenceCard', () => ({ default: () => null }));
vi.mock('@/components/chat/AtlasPrivacyMonitor', () => ({ default: () => null }));
vi.mock('@/components/chat/InitiativeChip', () => ({ InitiativeChip: () => null }));
vi.mock('@/components/chat/AssistantMoodChip', () => ({ AssistantMoodChip: () => null }));
vi.mock('@/components/chat/ToolPalette', () => ({ ToolPalette: () => null }));
vi.mock('@/components/common/SafeCard', () => ({ SafeCard: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/common/GracefulFallback', () => ({
  GracefulFallback: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/common/EmptyState', () => ({ ErrorState: () => null }));

import ChatLensPage from './page';
import { useConkayHudStore } from '@/components/conkay/conkayHudStore';

function renderWithQueryClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

async function openChatInConKayMode() {
  // The page reads `?mode=conkay` off window.location on mount to enter
  // ConKay mode — the same deep-link mechanism "Summon Kay" / the command
  // palette use in production.
  window.history.pushState({}, '', '/lenses/chat?mode=conkay');
  renderWithQueryClient(<ChatLensPage />);
  await waitFor(() => expect(screen.getByPlaceholderText(/Message ConKay mode/i)).toBeInTheDocument());
}

/** Calls made to a specific domain.macro pair — the cockpit's OWN panels
 *  (e.g. `conkay.connector-status`) make real, legitimate read-only lensRun
 *  calls of their own once mounted (proof the cockpit is genuinely live, not
 *  a static shell), so assertions must be scoped to the macro under test
 *  rather than "lensRun was never called at all". */
function callsFor(domain: string, macro: string) {
  return lensRunMock.mock.calls.filter((c) => c[0] === domain && c[1] === macro);
}

function typeAndSend(text: string) {
  const input = screen.getByPlaceholderText(/Message ConKay mode/i);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.click(screen.getByLabelText('Send message'));
}

describe('Chat lens — ConKay mode cockpit backport (Unit A5)', () => {
  beforeEach(() => {
    lensRunMock.mockClear();
  });
  afterEach(() => cleanup());

  it('a MUTATING macro renders the confirm card inside the chat lens and does NOT call lensRun until confirmed', async () => {
    await openChatInConKayMode();

    typeAndSend('run creatures.create {"name":"fenrir"}');

    await waitFor(() => expect(screen.getByTestId('conkay-action-confirm')).toBeInTheDocument());
    const confirmCard = screen.getByTestId('conkay-action-confirm');
    expect(confirmCard).toHaveTextContent('creatures.create');
    expect(confirmCard).toHaveTextContent('fenrir');
    // The specific mutating call is blocked while the card is up — even
    // though OTHER cockpit panels (e.g. conkay.connector-status) may have
    // already made their own legitimate read-only lensRun calls by now.
    expect(callsFor('creatures', 'create')).toHaveLength(0);

    // The cockpit's panel lanes are mounted alongside the pending confirm —
    // the SAME <ConKayCockpit> grid the global overlay uses.
    expect(screen.getByTestId('ck-cockpit-grid')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Confirm and run creatures.create'));

    await waitFor(() => expect(callsFor('creatures', 'create')).toHaveLength(1));
    expect(lensRunMock).toHaveBeenCalledWith('creatures', 'create', { name: 'fenrir' }, expect.any(String));
    expect(screen.queryByTestId('conkay-action-confirm')).not.toBeInTheDocument();
  });

  it('a READ macro runs immediately — no confirm card ever appears', async () => {
    await openChatInConKayMode();

    typeAndSend('run creatures.list');

    await waitFor(() => expect(callsFor('creatures', 'list')).toHaveLength(1));
    expect(lensRunMock).toHaveBeenCalledWith('creatures', 'list', {}, expect.any(String));
    expect(screen.queryByTestId('conkay-action-confirm')).not.toBeInTheDocument();
  });

  it('Cancel resolves the gate WITHOUT ever calling lensRun, and reports the cancellation honestly', async () => {
    await openChatInConKayMode();

    typeAndSend('run creatures.create {"name":"fenrir"}');
    await waitFor(() => expect(screen.getByTestId('conkay-action-confirm')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Cancel — do not run this action'));

    await waitFor(() => expect(screen.queryByTestId('conkay-action-confirm')).not.toBeInTheDocument());
    expect(callsFor('creatures', 'create')).toHaveLength(0);
    expect(await screen.findByText(/Cancelled — I didn't run creatures\.create/)).toBeInTheDocument();
  });

  it('a genuine artifact-shaped macro result feeds the SAME conkayHudStore the cockpit Artifact Viewer panel reads', async () => {
    // foundry.preview is a READ macro (isMutatingMacro classifies "preview"
    // via READ_VERBS) — runs with no confirm gate. Its real return shape
    // (previewWorldId/universeType/activatedSystems/skippedStubs) is exactly
    // what lib/conkay/artifact-kinds.ts#normalizeFoundry requires to detect a
    // genuine 'foundry-worldspec' artifact — never a guessed/fabricated one.
    // foundry.preview's real result shape differs from the default lensRun mock's
    // inferred type — cast the mock's one-off return (test-only, real macro shape).
    lensRunMock.mockImplementationOnce((async () => ({
      data: {
        ok: true,
        result: {
          previewWorldId: 'world_preview_123',
          universeType: 'fantasy',
          activatedSystems: ['weather', 'combat'],
          skippedStubs: [],
        },
        error: null,
      },
    })) as any);

    await openChatInConKayMode();
    expect(useConkayHudStore.getState().lastArtifact).toBeNull();

    typeAndSend('run foundry.preview {"seed":"a"}');

    await waitFor(() => expect(callsFor('foundry', 'preview')).toHaveLength(1));
    // No confirm gate for a read macro.
    expect(screen.queryByTestId('conkay-action-confirm')).not.toBeInTheDocument();

    // The chat lens's own executor ran the result through the SAME
    // detectArtifact registry ConKayOverlay's executeMacro uses, and wrote
    // the SAME store field the cockpit's Artifact Viewer panel (registered
    // as `conkay.artifact-viewer`) reads — real parity, not a visual copy.
    await waitFor(() => {
      const artifact = useConkayHudStore.getState().lastArtifact;
      expect(artifact).not.toBeNull();
      expect(artifact?.kind).toBe('foundry-worldspec');
      if (artifact?.kind === 'foundry-worldspec') {
        expect(artifact.previewWorldId).toBe('world_preview_123');
      }
    });
  });
});
