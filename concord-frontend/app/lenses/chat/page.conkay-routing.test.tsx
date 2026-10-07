/// <reference types="@testing-library/jest-dom/vitest" />
// concord-frontend/app/lenses/chat/page.conkay-routing.test.tsx
//
// ConKay is its own lens (/lenses/conkay). Chat no longer hosts an in-chat
// ConKay mode: every way of choosing ConKay from Chat routes to the ConKay
// workspace via conkayWorkspaceHref. These tests pin that contract:
//   - `/mode conkay` opens /lenses/conkay WITHOUT carrying the slash command
//     as the request, and Chat stays in its current mode;
//   - choosing ConKay from the composer's mode menu carries the draft as `ask`;
//   - the empty-state mic button opens ConKay;
//   - the `?mode=conkay` deep link redirects to the workspace.
//
// Heavy chrome unrelated to this (sidebar panels, DTU widgets, realtime hooks)
// is stubbed so the test exercises the panel's own routing, same spirit as
// app/lenses/sessions/page.test.tsx.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

const pushMock = vi.fn();
const replaceMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock, back: vi.fn(), prefetch: vi.fn() }),
}));

const apiPostMock = vi.fn((..._args: unknown[]) => Promise.resolve({ data: {} }));
vi.mock('@/lib/api/client', () => ({
  // BrainModePanel (composer chrome) reads its mode via lensRun.
  lensRun: vi.fn(() => Promise.resolve({ data: { ok: false, result: null, error: null } })),
  api: {
    get: vi.fn(() => Promise.resolve({ data: {} })),
    post: (...args: unknown[]) => apiPostMock(...args),
    put: vi.fn(() => Promise.resolve({ data: {} })),
  },
  apiHelpers: {
    cognitive: { status: () => Promise.resolve({ data: {} }) },
    chat: { feedback: vi.fn(() => Promise.resolve({ data: {} })) },
    forge: { hybrid: vi.fn(() => Promise.resolve({ data: {} })) },
  },
}));

vi.mock('@/lib/realtime/event-bus', () => ({
  useEvent: () => {},
}));

// next/dynamic-loaded heavy chrome (AgentModePanel/InitiativeBell) — render
// nothing, irrelevant here.
vi.mock('next/dynamic', () => ({
  default: () => () => null,
}));

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
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => ({ accent: '#0ff', secondaryAccent: '#0aa', gradient: 'none' }) }));
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

function renderWithQueryClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

async function openChat(url = '/lenses/chat') {
  window.history.pushState({}, '', url);
  renderWithQueryClient(<ChatLensPage />);
  return screen.findByPlaceholderText(/^Message /);
}

describe('Chat lens — choosing ConKay opens the ConKay lens', () => {
  beforeEach(() => {
    pushMock.mockClear();
    replaceMock.mockClear();
    apiPostMock.mockClear();
    try { window.localStorage.clear(); } catch { /* storage unavailable */ }
  });
  afterEach(() => cleanup());

  it('`/mode conkay` routes to /lenses/conkay without sending the command as a request', async () => {
    const input = await openChat();
    fireEvent.change(input, { target: { value: '/mode conkay' } });
    fireEvent.click(screen.getByLabelText('Send message'));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/lenses/conkay'));
    expect(pushMock).toHaveBeenCalledTimes(1);
    // Chat did not switch into a ConKay mode or send anything to the chat API.
    expect(screen.getByLabelText('Choose mode')).not.toHaveAttribute('title', 'Mode: ConKay');
    expect(apiPostMock).not.toHaveBeenCalled();
  });

  it('choosing ConKay from the mode menu carries the composer draft as `ask`', async () => {
    const input = await openChat();
    fireEvent.change(input, { target: { value: 'size a steel beam for 4 m' } });

    const menuToggle = screen.getByLabelText('Choose mode');
    fireEvent.click(menuToggle);
    const menu = menuToggle.closest('[data-chat-menu]') as HTMLElement;
    fireEvent.click(await within(menu).findByRole('button', { name: 'ConKay' }));

    expect(pushMock).toHaveBeenCalledTimes(1);
    const href = pushMock.mock.calls[0][0] as string;
    const url = new URL(href, 'http://x');
    expect(url.pathname).toBe('/lenses/conkay');
    expect(url.searchParams.get('ask')).toBe('size a steel beam for 4 m');
    expect(screen.getByLabelText('Choose mode')).not.toHaveAttribute('title', 'Mode: ConKay');
  });

  it('the empty-state mic button opens ConKay', async () => {
    await openChat();
    fireEvent.click(screen.getByLabelText('Open ConKay'));
    expect(pushMock).toHaveBeenCalledWith('/lenses/conkay');
  });

  it('the `?mode=conkay` deep link redirects to the ConKay workspace', async () => {
    await openChat('/lenses/chat?mode=conkay');
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/lenses/conkay'));
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe('Chat lens — ?project= deep link', () => {
  afterEach(() => cleanup());

  it('opens Chat with that project active when it is one of the user\'s projects', async () => {
    const { lensRun } = await import('@/lib/api/client');
    const mock = vi.mocked(lensRun);
    mock.mockImplementation(((domain: string, action: string) => Promise.resolve(
      domain === 'chat' && action === 'projects-list'
        ? { data: { ok: true, result: { projects: [{ id: 'proj_b', name: 'Bridge', systemPrompt: '', attachedDtuIds: [], color: 'cyan', threadIds: [] }] }, error: null } }
        : { data: { ok: false, result: null, error: null } },
    )) as unknown as typeof lensRun);
    await openChat('/lenses/chat?project=proj_b');
    await waitFor(() => expect(screen.getAllByText('Bridge').length).toBeGreaterThan(0));
    cleanup();
    await openChat('/lenses/chat?project=proj_other');
    await waitFor(() => expect(mock).toHaveBeenCalledWith('chat', 'projects-list', {}));
    expect(screen.queryByText('Bridge')).toBeNull();
    mock.mockImplementation((() => Promise.resolve({ data: { ok: false, result: null, error: null } })) as unknown as typeof lensRun);
  });
});
