import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  ModeSelector,
  WelcomePanel,
  AssistPanel,
  ExplorePanel,
  ConnectPanel,
  ChatPanel,
  MessageActions,
  ResponseActions,
  CrossLensMemoryBar,
  ProactiveChip,
} from '@/components/chat/ChatModePanels';

// ExplorePanel mounts SaveAsDtuButton, which calls useQueryClient() — needs a
// QueryClientProvider ancestor. Wrap every render() in this file with one
// rather than touching each call site individually.
function render(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(React.createElement(QueryClientProvider, { client: queryClient }, ui));
}

// ── ModeSelector ─────────────────────────────────────────────────────────────

describe('ModeSelector', () => {
  const onModeChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders 5 mode buttons', () => {
    render(<ModeSelector activeMode="welcome" onModeChange={onModeChange} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(5);
  });

  it('renders all mode labels', () => {
    render(<ModeSelector activeMode="welcome" onModeChange={onModeChange} />);
    expect(screen.getByText('Welcome')).toBeDefined();
    expect(screen.getByText('Assist')).toBeDefined();
    expect(screen.getByText('Explore')).toBeDefined();
    expect(screen.getByText('Connect')).toBeDefined();
    expect(screen.getByText('Chat')).toBeDefined();
  });

  it('highlights the active mode button', () => {
    render(<ModeSelector activeMode="explore" onModeChange={onModeChange} />);
    const exploreButton = screen.getByTitle('Explore');
    expect(exploreButton.className).toContain('neon-purple');
  });

  it('calls onModeChange when a mode button is clicked', () => {
    render(<ModeSelector activeMode="welcome" onModeChange={onModeChange} />);
    fireEvent.click(screen.getByTitle('Assist'));
    expect(onModeChange).toHaveBeenCalledWith('assist');
  });

  it('calls onModeChange with correct mode for each button', () => {
    render(<ModeSelector activeMode="welcome" onModeChange={onModeChange} />);
    fireEvent.click(screen.getByTitle('Explore'));
    expect(onModeChange).toHaveBeenCalledWith('explore');
    fireEvent.click(screen.getByTitle('Connect'));
    expect(onModeChange).toHaveBeenCalledWith('connect');
    fireEvent.click(screen.getByTitle('Chat'));
    expect(onModeChange).toHaveBeenCalledWith('chat');
  });
});

// ── WelcomePanel ─────────────────────────────────────────────────────────────

describe('WelcomePanel', () => {
  const onSendMessage = vi.fn();
  const defaultProps = {
    currentLens: 'healthcare',
    onSendMessage,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a time-based greeting', () => {
    render(<WelcomePanel {...defaultProps} />);
    // The greeting should be one of the time-based greetings
    const greetings = ['Good morning', 'Good afternoon', 'Good evening', 'Burning the midnight oil'];
    const found = greetings.some(g => screen.queryByText(g) !== null);
    expect(found).toBe(true);
  });

  it('shows quick action buttons', () => {
    render(<WelcomePanel {...defaultProps} />);
    expect(screen.getByText("What's new?")).toBeDefined();
    expect(screen.getByText('Show my DTUs')).toBeDefined();
    expect(screen.getByText("Today's insights")).toBeDefined();
  });

  it('clicking quick action fires onSendMessage', () => {
    render(<WelcomePanel {...defaultProps} />);
    fireEvent.click(screen.getByText("What's new?"));
    expect(onSendMessage).toHaveBeenCalledTimes(1);
    expect(onSendMessage.mock.calls[0][0]).toContain("What's new");
  });

  it('shows current lens context', () => {
    render(<WelcomePanel {...defaultProps} />);
    expect(screen.getByText('healthcare')).toBeDefined();
  });

  it('shows proactive suggestion placeholder', () => {
    render(<WelcomePanel {...defaultProps} />);
    expect(screen.getByText(/create DTUs/i)).toBeDefined();
  });
});

// ── AssistPanel ──────────────────────────────────────────────────────────────

describe('AssistPanel', () => {
  const onSendMessage = vi.fn();
  const defaultProps = {
    currentLens: 'finance',
    onSendMessage,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders task buttons', () => {
    render(<AssistPanel {...defaultProps} />);
    expect(screen.getByText('Create DTU')).toBeDefined();
    expect(screen.getByText('Search Knowledge')).toBeDefined();
    expect(screen.getByText('Run Pipeline')).toBeDefined();
    expect(screen.getByText('Generate Report')).toBeDefined();
  });

  it('renders the mode header', () => {
    render(<AssistPanel {...defaultProps} />);
    expect(screen.getByText('Task Assistant Mode')).toBeDefined();
  });

  it('clicking Create DTU fires sendMessage with lens context', () => {
    render(<AssistPanel {...defaultProps} />);
    fireEvent.click(screen.getByText('Create DTU'));
    expect(onSendMessage).toHaveBeenCalledTimes(1);
    expect(onSendMessage.mock.calls[0][0]).toContain('finance');
  });

  it('clicking Search Knowledge fires sendMessage', () => {
    render(<AssistPanel {...defaultProps} />);
    fireEvent.click(screen.getByText('Search Knowledge'));
    expect(onSendMessage).toHaveBeenCalledWith(expect.stringContaining('Search my knowledge base'));
  });

  it('shows context-aware lens info', () => {
    render(<AssistPanel {...defaultProps} />);
    expect(screen.getByText('finance')).toBeDefined();
  });
});

// ── ExplorePanel ─────────────────────────────────────────────────────────────

describe('ExplorePanel', () => {
  const onSendMessage = vi.fn();
  const defaultProps = {
    currentLens: 'education',
    onSendMessage,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders discovery prompt buttons', () => {
    render(<ExplorePanel {...defaultProps} />);
    expect(screen.getByText('Trending Topics')).toBeDefined();
    expect(screen.getByText('Cross-Domain Links')).toBeDefined();
    expect(screen.getByText('Knowledge Gaps')).toBeDefined();
  });

  it('renders Surprise me button', () => {
    render(<ExplorePanel {...defaultProps} />);
    expect(screen.getByText('Surprise me')).toBeDefined();
  });

  it('clicking Surprise me fires onSendMessage', () => {
    render(<ExplorePanel {...defaultProps} />);
    fireEvent.click(screen.getByText('Surprise me'));
    expect(onSendMessage).toHaveBeenCalledTimes(1);
  });

  it('clicking Trending Topics fires sendMessage', () => {
    render(<ExplorePanel {...defaultProps} />);
    fireEvent.click(screen.getByText('Trending Topics'));
    expect(onSendMessage).toHaveBeenCalledWith(expect.stringContaining('trending'));
  });

  it('shows mode header', () => {
    render(<ExplorePanel {...defaultProps} />);
    expect(screen.getByText('Explore Mode')).toBeDefined();
  });
});

// ── ConnectPanel ─────────────────────────────────────────────────────────────

describe('ConnectPanel', () => {
  const onSendMessage = vi.fn();
  const onLensNavigate = vi.fn();
  const defaultProps = {
    currentLens: 'creative',
    onSendMessage,
    onLensNavigate,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders collaboration buttons', () => {
    render(<ConnectPanel {...defaultProps} />);
    expect(screen.getByText('Invite Collaborator')).toBeDefined();
    expect(screen.getByText('Shared Sessions')).toBeDefined();
    expect(screen.getByText('Social Feed')).toBeDefined();
  });

  it('renders connect mode header', () => {
    render(<ConnectPanel {...defaultProps} />);
    expect(screen.getByText('Connect Mode')).toBeDefined();
  });

  it('clicking Invite Collaborator fires sendMessage', () => {
    render(<ConnectPanel {...defaultProps} />);
    fireEvent.click(screen.getByText('Invite Collaborator'));
    expect(onSendMessage).toHaveBeenCalledWith(expect.stringContaining('collaborator'));
  });

  it('shows active sessions section', () => {
    render(<ConnectPanel {...defaultProps} />);
    expect(screen.getByText('Active sessions')).toBeDefined();
    expect(screen.getByText('0 live')).toBeDefined();
  });
});

// ── ChatPanel ────────────────────────────────────────────────────────────────

describe('ChatPanel', () => {
  it('renders lens indicator for free-form chat', () => {
    const { container } = render(
      <ChatPanel currentLens="healthcare" onSendMessage={vi.fn()} />
    );
    expect(container.innerHTML).not.toBe('');
    expect(container.textContent).toContain('healthcare');
  });
});

// ── MessageActions ───────────────────────────────────────────────────────────

describe('MessageActions', () => {
  const onSendMessage = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Save as DTU button', () => {
    render(
      <MessageActions messageContent="Some message content" onSendMessage={onSendMessage} />
    );
    expect(screen.getByRole('button', { name: 'Save as DTU' })).toBeDefined();
  });

  it('renders Explore deeper button', () => {
    render(
      <MessageActions messageContent="Some message content" onSendMessage={onSendMessage} />
    );
    expect(screen.getByText('Explore deeper')).toBeDefined();
  });

  it('clicking Save as DTU opens the real confirm modal (SaveAsDtuButton now saves directly, not via a chat message)', () => {
    // SaveAsDtuButton (components/dtu/SaveAsDtuButton.tsx) manages its own
    // save mutation — it never took/called an onSendMessage prop. Mounted
    // here with `confirm`, so a click opens its confirm modal (real submit
    // button "Save DTU") rather than firing any message.
    render(
      <MessageActions messageContent="Test message" onSendMessage={onSendMessage} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save as DTU' }));
    expect(screen.getByRole('button', { name: /save dtu/i })).toBeInTheDocument();
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it('clicking Explore deeper fires sendMessage', () => {
    render(
      <MessageActions messageContent="Test message" onSendMessage={onSendMessage} />
    );
    fireEvent.click(screen.getByText('Explore deeper'));
    expect(onSendMessage).toHaveBeenCalledWith(expect.stringContaining('Explore this topic deeper'));
  });
});

// ── ResponseActions ──────────────────────────────────────────────────────────

describe('ResponseActions', () => {
  const onSendMessage = vi.fn();
  const baseProps = {
    responseContent: 'AI response content here for testing',
    currentLens: 'healthcare',
    onSendMessage,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders assist mode actions', () => {
    // "Create DTU from this" was consolidated into the shared SaveAsDtuButton
    // ("Save as DTU") — assist mode's own action list now has only "What's next?".
    render(<ResponseActions mode="assist" {...baseProps} />);
    expect(screen.getByRole('button', { name: 'Save as DTU' })).toBeDefined();
    expect(screen.getByText("What's next?")).toBeDefined();
  });

  it('renders explore mode actions', () => {
    render(<ResponseActions mode="explore" {...baseProps} />);
    expect(screen.getByText('Go deeper')).toBeDefined();
    expect(screen.getByText('Find connections')).toBeDefined();
  });

  it('renders connect mode actions', () => {
    render(<ResponseActions mode="connect" {...baseProps} />);
    expect(screen.getByText('Share this')).toBeDefined();
  });

  it('renders default mode actions (Save as DTU)', () => {
    render(<ResponseActions mode="welcome" {...baseProps} />);
    expect(screen.getByRole('button', { name: 'Save as DTU' })).toBeDefined();
  });

  it('clicking an action fires onSendMessage', () => {
    render(<ResponseActions mode="assist" {...baseProps} />);
    fireEvent.click(screen.getByText("What's next?"));
    expect(onSendMessage).toHaveBeenCalledTimes(1);
    expect(onSendMessage.mock.calls[0][0]).toContain('what should I do next');
  });
});

// ── CrossLensMemoryBar ───────────────────────────────────────────────────────

describe('CrossLensMemoryBar', () => {
  const onToggleMemory = vi.fn();
  const onClearTrail = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders null when totalLensCount <= 1', () => {
    const { container } = render(
      <CrossLensMemoryBar
        trail={[{ lens: 'healthcare', messageCount: 3 }]}
        totalLensCount={1}
        memoryPreserved={true}
        onToggleMemory={onToggleMemory}
        onClearTrail={onClearTrail}
      />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders lens trail when totalLensCount > 1', () => {
    render(
      <CrossLensMemoryBar
        trail={[
          { lens: 'healthcare', messageCount: 3 },
          { lens: 'finance', messageCount: 5 },
        ]}
        totalLensCount={2}
        memoryPreserved={true}
        onToggleMemory={onToggleMemory}
        onClearTrail={onClearTrail}
      />
    );
    expect(screen.getByText('healthcare')).toBeDefined();
    expect(screen.getByText('finance')).toBeDefined();
  });

  it('shows lens count badge', () => {
    render(
      <CrossLensMemoryBar
        trail={[
          { lens: 'healthcare', messageCount: 3 },
          { lens: 'finance', messageCount: 5 },
        ]}
        totalLensCount={2}
        memoryPreserved={true}
        onToggleMemory={onToggleMemory}
        onClearTrail={onClearTrail}
      />
    );
    expect(screen.getByText(/2 lenses of context/)).toBeDefined();
  });

  it('toggle button expands trail details', () => {
    render(
      <CrossLensMemoryBar
        trail={[
          { lens: 'healthcare', messageCount: 3 },
          { lens: 'finance', messageCount: 5 },
        ]}
        totalLensCount={2}
        memoryPreserved={true}
        onToggleMemory={onToggleMemory}
        onClearTrail={onClearTrail}
      />
    );
    // Click to expand
    fireEvent.click(screen.getByText(/2 lenses of context/));
    expect(screen.getByText('Memory: ON')).toBeDefined();
    expect(screen.getByText('Clear trail')).toBeDefined();
  });

  it('toggle memory button calls onToggleMemory', () => {
    render(
      <CrossLensMemoryBar
        trail={[
          { lens: 'healthcare', messageCount: 3 },
          { lens: 'finance', messageCount: 5 },
        ]}
        totalLensCount={2}
        memoryPreserved={true}
        onToggleMemory={onToggleMemory}
        onClearTrail={onClearTrail}
      />
    );
    // Expand first
    fireEvent.click(screen.getByText(/2 lenses of context/));
    fireEvent.click(screen.getByText('Memory: ON'));
    expect(onToggleMemory).toHaveBeenCalledTimes(1);
  });

  it('clear trail button calls onClearTrail', () => {
    render(
      <CrossLensMemoryBar
        trail={[
          { lens: 'healthcare', messageCount: 3 },
          { lens: 'finance', messageCount: 5 },
        ]}
        totalLensCount={2}
        memoryPreserved={true}
        onToggleMemory={onToggleMemory}
        onClearTrail={onClearTrail}
      />
    );
    fireEvent.click(screen.getByText(/2 lenses of context/));
    fireEvent.click(screen.getByText('Clear trail'));
    expect(onClearTrail).toHaveBeenCalledTimes(1);
  });

  it('shows +N when trail has more than 4 entries', () => {
    const trail = Array.from({ length: 6 }, (_, i) => ({
      lens: `lens-${i}`,
      messageCount: i + 1,
    }));
    render(
      <CrossLensMemoryBar
        trail={trail}
        totalLensCount={6}
        memoryPreserved={false}
        onToggleMemory={onToggleMemory}
        onClearTrail={onClearTrail}
      />
    );
    expect(screen.getByText('+2')).toBeDefined();
  });
});

// ── ProactiveChip ────────────────────────────────────────────────────────────

describe('ProactiveChip', () => {
  const onAction = vi.fn();
  const onDismiss = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders content text', () => {
    render(
      <ProactiveChip
        content="Here is a proactive suggestion"
        onAction={onAction}
        onDismiss={onDismiss}
      />
    );
    expect(screen.getByText('Here is a proactive suggestion')).toBeDefined();
  });

  it('renders action button when actionLabel is provided', () => {
    render(
      <ProactiveChip
        content="Suggestion"
        actionLabel="Try it"
        onAction={onAction}
        onDismiss={onDismiss}
      />
    );
    expect(screen.getByText('Try it')).toBeDefined();
  });

  it('does not render action button when actionLabel is absent', () => {
    render(
      <ProactiveChip
        content="Suggestion"
        onAction={onAction}
        onDismiss={onDismiss}
      />
    );
    // Only Dismiss button should exist
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(screen.getByText('Dismiss')).toBeDefined();
  });

  it('clicking action button fires onAction', () => {
    render(
      <ProactiveChip
        content="Suggestion"
        actionLabel="Try it"
        onAction={onAction}
        onDismiss={onDismiss}
      />
    );
    fireEvent.click(screen.getByText('Try it'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('clicking dismiss button fires onDismiss', () => {
    render(
      <ProactiveChip
        content="Suggestion"
        actionLabel="Try it"
        onAction={onAction}
        onDismiss={onDismiss}
      />
    );
    fireEvent.click(screen.getByText('Dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
