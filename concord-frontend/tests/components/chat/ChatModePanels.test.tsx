import { describe, it, expect, vi } from 'vitest';
import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  WelcomePanel,
  AssistPanel,
  ExplorePanel,
  ConnectPanel,
  ChatPanel,
  ModeSelector,
  ResponseActions,
  CrossLensMemoryBar,
  ProactiveChip,
  MessageActions,
} from '@/components/chat/ChatModePanels';

// ExplorePanel mounts SaveAsDtuButton, which calls useQueryClient() — needs a
// QueryClientProvider ancestor. Wrap every render() in this file with one
// rather than touching each call site individually.
function render(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

// ── WelcomePanel ──────────────────────────────────────────────────────────────

describe('WelcomePanel', () => {
  const defaultProps = {
    currentLens: 'healthcare',
    onSendMessage: vi.fn(),
    onLensNavigate: vi.fn(),
  };

  it('renders without crashing', () => {
    render(<WelcomePanel {...defaultProps} />);
    expect(screen.getByText(/Quick actions/i)).toBeInTheDocument();
  });

  it('displays a time-based greeting', () => {
    render(<WelcomePanel {...defaultProps} />);
    // The greeting is dynamic based on time; just verify some greeting exists
    const greetings = [
      'Good morning',
      'Good afternoon',
      'Good evening',
      'Burning the midnight oil',
    ];
    const found = greetings.some((g) => screen.queryByText(g) !== null);
    expect(found).toBe(true);
  });

  it('shows current lens context', () => {
    render(<WelcomePanel {...defaultProps} />);
    expect(screen.getByText('healthcare')).toBeInTheDocument();
    expect(screen.getByText(/Currently in/i)).toBeInTheDocument();
  });

  it('does not show lens context when currentLens is empty', () => {
    render(<WelcomePanel {...defaultProps} currentLens="" />);
    expect(screen.queryByText(/Currently in/i)).not.toBeInTheDocument();
  });

  it('fires onSendMessage when "What\'s new?" is clicked', () => {
    const onSendMessage = vi.fn();
    render(<WelcomePanel {...defaultProps} onSendMessage={onSendMessage} />);

    fireEvent.click(screen.getByText("What's new?"));
    expect(onSendMessage).toHaveBeenCalledTimes(1);
    expect(onSendMessage).toHaveBeenCalledWith(
      expect.stringContaining('new in my substrate')
    );
  });

  it('fires onSendMessage when "Show my DTUs" is clicked', () => {
    const onSendMessage = vi.fn();
    render(<WelcomePanel {...defaultProps} onSendMessage={onSendMessage} />);

    fireEvent.click(screen.getByText('Show my DTUs'));
    expect(onSendMessage).toHaveBeenCalledWith(
      expect.stringContaining('recent DTUs')
    );
  });

  it('fires onSendMessage when "Today\'s insights" is clicked', () => {
    const onSendMessage = vi.fn();
    render(<WelcomePanel {...defaultProps} onSendMessage={onSendMessage} />);

    fireEvent.click(screen.getByText("Today's insights"));
    expect(onSendMessage).toHaveBeenCalledWith(
      expect.stringContaining('insights')
    );
  });

  it('renders descriptive help text about capabilities', () => {
    render(<WelcomePanel {...defaultProps} />);
    expect(
      screen.getByText(/create DTUs, search your knowledge base/i)
    ).toBeInTheDocument();
  });
});

// ── AssistPanel ───────────────────────────────────────────────────────────────

describe('AssistPanel', () => {
  const defaultProps = {
    currentLens: 'finance',
    onSendMessage: vi.fn(),
    onLensNavigate: vi.fn(),
  };

  it('renders without crashing', () => {
    render(<AssistPanel {...defaultProps} />);
    expect(screen.getByText('Task Assistant Mode')).toBeInTheDocument();
  });

  it('shows current lens in context-aware section', () => {
    render(<AssistPanel {...defaultProps} />);
    expect(screen.getByText('finance')).toBeInTheDocument();
  });

  it('fires onSendMessage when "Create DTU" is clicked', () => {
    const onSendMessage = vi.fn();
    render(<AssistPanel {...defaultProps} onSendMessage={onSendMessage} />);

    fireEvent.click(screen.getByText('Create DTU'));
    expect(onSendMessage).toHaveBeenCalledWith(
      expect.stringContaining('finance')
    );
  });

  it('fires onSendMessage when "Search Knowledge" is clicked', () => {
    const onSendMessage = vi.fn();
    render(<AssistPanel {...defaultProps} onSendMessage={onSendMessage} />);

    fireEvent.click(screen.getByText('Search Knowledge'));
    expect(onSendMessage).toHaveBeenCalledTimes(1);
  });

  it('fires onSendMessage when "Run Pipeline" is clicked', () => {
    const onSendMessage = vi.fn();
    render(<AssistPanel {...defaultProps} onSendMessage={onSendMessage} />);

    fireEvent.click(screen.getByText('Run Pipeline'));
    expect(onSendMessage).toHaveBeenCalledWith(
      expect.stringContaining('pipelines')
    );
  });

  it('fires onSendMessage when "Generate Report" is clicked', () => {
    const onSendMessage = vi.fn();
    render(<AssistPanel {...defaultProps} onSendMessage={onSendMessage} />);

    fireEvent.click(screen.getByText('Generate Report'));
    expect(onSendMessage).toHaveBeenCalledWith(
      expect.stringContaining('finance')
    );
  });

  it('displays common operations label', () => {
    render(<AssistPanel {...defaultProps} />);
    expect(screen.getByText('Common operations')).toBeInTheDocument();
  });
});

// ── ExplorePanel ──────────────────────────────────────────────────────────────

describe('ExplorePanel', () => {
  const defaultProps = {
    currentLens: 'science',
    onSendMessage: vi.fn(),
    onLensNavigate: vi.fn(),
  };

  it('renders without crashing', () => {
    render(<ExplorePanel {...defaultProps} />);
    expect(screen.getByText('Explore Mode')).toBeInTheDocument();
  });

  it('shows current lens context', () => {
    render(<ExplorePanel {...defaultProps} />);
    expect(screen.getByText('science')).toBeInTheDocument();
  });

  it('fires onSendMessage when "Trending Topics" is clicked', () => {
    const onSendMessage = vi.fn();
    render(<ExplorePanel {...defaultProps} onSendMessage={onSendMessage} />);

    fireEvent.click(screen.getByText('Trending Topics'));
    expect(onSendMessage).toHaveBeenCalledWith(
      expect.stringContaining('trending')
    );
  });

  it('fires onSendMessage when "Cross-Domain Links" is clicked', () => {
    const onSendMessage = vi.fn();
    render(<ExplorePanel {...defaultProps} onSendMessage={onSendMessage} />);

    fireEvent.click(screen.getByText('Cross-Domain Links'));
    expect(onSendMessage).toHaveBeenCalledTimes(1);
  });

  it('fires onSendMessage when "Knowledge Gaps" is clicked', () => {
    const onSendMessage = vi.fn();
    render(<ExplorePanel {...defaultProps} onSendMessage={onSendMessage} />);

    fireEvent.click(screen.getByText('Knowledge Gaps'));
    expect(onSendMessage).toHaveBeenCalledWith(
      expect.stringContaining('knowledge gaps')
    );
  });

  it('fires onSendMessage when "Surprise me" is clicked', () => {
    const onSendMessage = vi.fn();
    render(<ExplorePanel {...defaultProps} onSendMessage={onSendMessage} />);

    fireEvent.click(screen.getByText('Surprise me'));
    expect(onSendMessage).toHaveBeenCalledTimes(1);
  });

  it('disables "Surprise me" button briefly after click', () => {
    const onSendMessage = vi.fn();
    render(<ExplorePanel {...defaultProps} onSendMessage={onSendMessage} />);

    const surpriseBtn = screen.getByText('Surprise me').closest('button')!;
    fireEvent.click(surpriseBtn);
    // After clicking the button is disabled briefly
    expect(surpriseBtn).toBeDisabled();
  });
});

// ── ConnectPanel ──────────────────────────────────────────────────────────────

describe('ConnectPanel', () => {
  const defaultProps = {
    currentLens: 'collaboration',
    onSendMessage: vi.fn(),
    onLensNavigate: vi.fn(),
  };

  it('renders without crashing', () => {
    render(<ConnectPanel {...defaultProps} />);
    expect(screen.getByText('Connect Mode')).toBeInTheDocument();
  });

  it('shows collaboration tools label', () => {
    render(<ConnectPanel {...defaultProps} />);
    expect(screen.getByText('Collaboration tools')).toBeInTheDocument();
  });

  it('fires onSendMessage when "Invite Collaborator" is clicked', () => {
    const onSendMessage = vi.fn();
    render(<ConnectPanel {...defaultProps} onSendMessage={onSendMessage} />);

    fireEvent.click(screen.getByText('Invite Collaborator'));
    expect(onSendMessage).toHaveBeenCalledWith(
      expect.stringContaining('invite a collaborator')
    );
  });

  it('fires onSendMessage when "Social Feed" is clicked', () => {
    const onSendMessage = vi.fn();
    render(<ConnectPanel {...defaultProps} onSendMessage={onSendMessage} />);

    fireEvent.click(screen.getByText('Social Feed'));
    expect(onSendMessage).toHaveBeenCalledWith(
      expect.stringContaining('social activity')
    );
  });

  it('shows active sessions placeholder with 0 live', () => {
    render(<ConnectPanel {...defaultProps} />);
    expect(screen.getByText('0 live')).toBeInTheDocument();
    expect(
      screen.getByText(/No active shared sessions/i)
    ).toBeInTheDocument();
  });
});

// ── ChatPanel ─────────────────────────────────────────────────────────────────

describe('ChatPanel', () => {
  it('renders lens indicator (minimal mode)', () => {
    const { container } = render(
      <ChatPanel
        currentLens="general"
        onSendMessage={vi.fn()}
        onLensNavigate={vi.fn()}
      />
    );
    expect(container.innerHTML).not.toBe('');
    expect(container.textContent).toContain('general');
  });
});

// ── ModeSelector ──────────────────────────────────────────────────────────────

describe('ModeSelector', () => {
  it('renders all five mode buttons', () => {
    render(<ModeSelector activeMode="welcome" onModeChange={vi.fn()} />);
    expect(screen.getByTitle('Welcome')).toBeInTheDocument();
    expect(screen.getByTitle('Assist')).toBeInTheDocument();
    expect(screen.getByTitle('Explore')).toBeInTheDocument();
    expect(screen.getByTitle('Connect')).toBeInTheDocument();
    expect(screen.getByTitle('Chat')).toBeInTheDocument();
  });

  it('calls onModeChange when a mode button is clicked', () => {
    const onModeChange = vi.fn();
    render(<ModeSelector activeMode="welcome" onModeChange={onModeChange} />);

    fireEvent.click(screen.getByTitle('Assist'));
    expect(onModeChange).toHaveBeenCalledWith('assist');

    fireEvent.click(screen.getByTitle('Explore'));
    expect(onModeChange).toHaveBeenCalledWith('explore');
  });

  it('highlights the active mode button', () => {
    const { rerender } = render(
      <ModeSelector activeMode="explore" onModeChange={vi.fn()} />
    );
    // The active "Explore" button should have the mode label visible
    const exploreButton = screen.getByTitle('Explore');
    // Active mode contains a visible label span with "Explore" text
    expect(exploreButton).toHaveTextContent('Explore');

    rerender(<ModeSelector activeMode="connect" onModeChange={vi.fn()} />);
    const connectButton = screen.getByTitle('Connect');
    expect(connectButton).toHaveTextContent('Connect');
  });
});

// ── ResponseActions ───────────────────────────────────────────────────────────

describe('ResponseActions', () => {
  const defaultProps = {
    mode: 'chat' as const,
    responseContent: 'This is a detailed response about knowledge management and how DTUs work in your substrate.',
    currentLens: 'healthcare',
    onSendMessage: vi.fn(),
  };

  it('renders without crashing', () => {
    render(<ResponseActions {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'Save as DTU' })).toBeInTheDocument();
  });

  it('shows assist mode actions', () => {
    // "Create DTU from this" was consolidated into the shared SaveAsDtuButton
    // ("Save as DTU") — assist mode's own action list now has only "What's next?".
    render(<ResponseActions {...defaultProps} mode="assist" />);
    expect(screen.getByRole('button', { name: 'Save as DTU' })).toBeInTheDocument();
    expect(screen.getByText("What's next?")).toBeInTheDocument();
  });

  it('shows explore mode actions', () => {
    render(<ResponseActions {...defaultProps} mode="explore" />);
    expect(screen.getByText('Go deeper')).toBeInTheDocument();
    expect(screen.getByText('Find connections')).toBeInTheDocument();
  });

  it('shows connect mode actions', () => {
    render(<ResponseActions {...defaultProps} mode="connect" />);
    expect(screen.getByText('Share this')).toBeInTheDocument();
  });

  it('Save as DTU opens the real confirm modal (SaveAsDtuButton saves directly, not via a chat message)', () => {
    // SaveAsDtuButton (components/dtu/SaveAsDtuButton.tsx) manages its own
    // save mutation — it never took/called an onSendMessage prop. Mounted
    // here with `confirm`, so a click opens its confirm modal (real submit
    // button "Save DTU") rather than firing any message.
    const onSendMessage = vi.fn();
    render(<ResponseActions {...defaultProps} onSendMessage={onSendMessage} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save as DTU' }));
    expect(screen.getByRole('button', { name: /save dtu/i })).toBeInTheDocument();
    expect(onSendMessage).not.toHaveBeenCalled();
  });
});

// ── MessageActions ────────────────────────────────────────────────────────────

describe('MessageActions', () => {
  it('renders without crashing', () => {
    render(
      <MessageActions
        messageContent="Some message content here"
        onSendMessage={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Save as DTU' })).toBeInTheDocument();
    expect(screen.getByText('Explore deeper')).toBeInTheDocument();
  });

  it('Save as DTU opens the real confirm modal (SaveAsDtuButton saves directly, not via a chat message)', () => {
    const onSendMessage = vi.fn();
    render(
      <MessageActions
        messageContent="Some message content here"
        onSendMessage={onSendMessage}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save as DTU' }));
    expect(screen.getByRole('button', { name: /save dtu/i })).toBeInTheDocument();
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it('fires onSendMessage with explore prompt when Explore deeper is clicked', () => {
    const onSendMessage = vi.fn();
    render(
      <MessageActions
        messageContent="Some message content here"
        onSendMessage={onSendMessage}
      />
    );

    fireEvent.click(screen.getByText('Explore deeper'));
    expect(onSendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Explore this topic deeper')
    );
  });
});

// ── CrossLensMemoryBar ────────────────────────────────────────────────────────

describe('CrossLensMemoryBar', () => {
  const defaultProps = {
    trail: [
      { lens: 'healthcare', messageCount: 5 },
      { lens: 'finance', messageCount: 3 },
    ],
    totalLensCount: 2,
    memoryPreserved: true,
    onToggleMemory: vi.fn(),
    onClearTrail: vi.fn(),
  };

  it('renders without crashing when totalLensCount > 1', () => {
    render(<CrossLensMemoryBar {...defaultProps} />);
    expect(screen.getByText('healthcare')).toBeInTheDocument();
    expect(screen.getByText('finance')).toBeInTheDocument();
  });

  it('renders null when totalLensCount is 1 or less', () => {
    const { container } = render(
      <CrossLensMemoryBar {...defaultProps} totalLensCount={1} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('shows the lens count context text', () => {
    render(<CrossLensMemoryBar {...defaultProps} />);
    expect(screen.getByText('2 lenses of context')).toBeInTheDocument();
  });

  it('expands to show trail details on click', () => {
    render(<CrossLensMemoryBar {...defaultProps} />);

    // Before expansion, expanded details should not be visible
    expect(screen.queryByText('Memory: ON')).not.toBeInTheDocument();

    // Click to expand
    fireEvent.click(screen.getByText('2 lenses of context'));
    expect(screen.getByText('Memory: ON')).toBeInTheDocument();
    expect(screen.getByText('Clear trail')).toBeInTheDocument();
  });

  it('calls onToggleMemory when Memory toggle is clicked', () => {
    const onToggleMemory = vi.fn();
    render(
      <CrossLensMemoryBar {...defaultProps} onToggleMemory={onToggleMemory} />
    );

    // Expand first
    fireEvent.click(screen.getByText('2 lenses of context'));
    fireEvent.click(screen.getByText('Memory: ON'));
    expect(onToggleMemory).toHaveBeenCalledTimes(1);
  });

  it('calls onClearTrail when Clear trail is clicked', () => {
    const onClearTrail = vi.fn();
    render(
      <CrossLensMemoryBar {...defaultProps} onClearTrail={onClearTrail} />
    );

    fireEvent.click(screen.getByText('2 lenses of context'));
    fireEvent.click(screen.getByText('Clear trail'));
    expect(onClearTrail).toHaveBeenCalledTimes(1);
  });

  it('shows Memory: OFF when memoryPreserved is false', () => {
    render(
      <CrossLensMemoryBar {...defaultProps} memoryPreserved={false} />
    );

    fireEvent.click(screen.getByText('2 lenses of context'));
    expect(screen.getByText('Memory: OFF')).toBeInTheDocument();
  });

  it('truncates trail to last 4 entries and shows overflow count', () => {
    const longTrail = [
      { lens: 'a', messageCount: 1 },
      { lens: 'b', messageCount: 2 },
      { lens: 'c', messageCount: 3 },
      { lens: 'd', messageCount: 4 },
      { lens: 'e', messageCount: 5 },
    ];
    render(
      <CrossLensMemoryBar
        {...defaultProps}
        trail={longTrail}
        totalLensCount={5}
      />
    );

    expect(screen.getByText('+1')).toBeInTheDocument();
  });
});

// ── ProactiveChip ─────────────────────────────────────────────────────────────

describe('ProactiveChip', () => {
  const defaultProps = {
    content: 'You might want to check your recent DTUs.',
    actionLabel: 'Show DTUs',
    onAction: vi.fn(),
    onDismiss: vi.fn(),
  };

  it('renders without crashing', () => {
    render(<ProactiveChip {...defaultProps} />);
    expect(
      screen.getByText('You might want to check your recent DTUs.')
    ).toBeInTheDocument();
  });

  it('shows action label button', () => {
    render(<ProactiveChip {...defaultProps} />);
    expect(screen.getByText('Show DTUs')).toBeInTheDocument();
  });

  it('fires onAction when action button is clicked', () => {
    const onAction = vi.fn();
    render(<ProactiveChip {...defaultProps} onAction={onAction} />);

    fireEvent.click(screen.getByText('Show DTUs'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('fires onDismiss when Dismiss is clicked', () => {
    const onDismiss = vi.fn();
    render(<ProactiveChip {...defaultProps} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByText('Dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not show action label when actionLabel is undefined', () => {
    render(
      <ProactiveChip {...defaultProps} actionLabel={undefined} />
    );
    expect(screen.queryByText('Show DTUs')).not.toBeInTheDocument();
    // Dismiss should still be there
    expect(screen.getByText('Dismiss')).toBeInTheDocument();
  });
});
