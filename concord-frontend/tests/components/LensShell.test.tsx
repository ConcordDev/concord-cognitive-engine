import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock hooks and dependencies
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/lenses/test',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/hooks/useLensNav', () => ({
  useLensNav: vi.fn(),
}));

vi.mock('@/lib/design-system', () => ({
  ds: {
    pageContainer: 'page-container',
    sectionHeader: 'section-header',
    heading1: 'heading1',
    input: 'input-class',
    btnPrimary: 'btn-primary',
    badge: (color: string) => `badge-${color}`,
    grid2: 'grid-2',
    grid3: 'grid-3',
    grid4: 'grid-4',
  },
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: (string | boolean | undefined | null)[]) => args.filter(Boolean).join(' '),
}));

vi.mock('@/components/common/Loading', () => ({
  Loading: ({ text }: { text: string }) => <div data-testid="loading">{text}</div>,
}));

vi.mock('@/components/common/EmptyState', () => ({
  ErrorState: ({ error, onRetry }: { error?: string; onRetry?: () => void }) => (
    <div data-testid="error-state">
      {error && <p>{error}</p>}
      {onRetry && <button onClick={onRetry}>Retry</button>}
    </div>
  ),
}));


vi.mock('@/components/chat/PersistentChatRail', () => ({
  PersistentChatRail: () => <div data-testid="chat-rail" />,
}));

vi.mock('@/components/lens/ConnectiveTissueBar', () => ({
  ConnectiveTissueBar: () => <div data-testid="connective-tissue" />,
}));

// Mock lucide-react — use importOriginal to get all exports, then override with simple components
vi.mock('lucide-react', async (importOriginal) => {
  const React = await import('react');
  const actual = await importOriginal<Record<string, unknown>>();
  const makeMockIcon = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props })
    );
    Icon.displayName = name;
    return Icon;
  };
  const overrides: Record<string, unknown> = {};
  for (const key of Object.keys(actual)) {
    // Override all PascalCase exports (icon components) but skip utility functions/types
    if (key[0] >= 'A' && key[0] <= 'Z' && key !== 'createLucideIcon' && key !== 'default') {
      overrides[key] = makeMockIcon(key);
    }
  }
  return { ...actual, ...overrides };
});

import type { LucideIcon } from 'lucide-react';
import { LensShell, StatusBadge, ItemList } from '@/components/common/LensShell';
import type { LensTab } from '@/components/common/LensShell';

const MockTabIcon = (({ className }: { className?: string }) => <span data-testid="tab-icon" className={className}>T</span>) as LucideIcon;

describe('LensShell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the title', () => {
    render(
      <LensShell domain="test" title="Test Lens">
        <div>Content</div>
      </LensShell>
    );
    expect(screen.getByText('Test Lens')).toBeInTheDocument();
  });

  it('renders icon when provided', () => {
    render(
      <LensShell domain="test" title="Test" icon={<span data-testid="lens-icon">I</span>}>
        <div>Content</div>
      </LensShell>
    );
    expect(screen.getByTestId('lens-icon')).toBeInTheDocument();
  });

  it('renders actions when provided', () => {
    render(
      <LensShell domain="test" title="Test" actions={<button>Create</button>}>
        <div>Content</div>
      </LensShell>
    );
    expect(screen.getByText('Create')).toBeInTheDocument();
  });

  it('renders children when not loading or errored', () => {
    render(
      <LensShell domain="test" title="Test">
        <div data-testid="child-content">Hello</div>
      </LensShell>
    );
    expect(screen.getByTestId('child-content')).toBeInTheDocument();
  });

  it('renders loading state instead of children', () => {
    render(
      <LensShell domain="test" title="Test" isLoading>
        <div data-testid="child-content">Hello</div>
      </LensShell>
    );
    expect(screen.getByTestId('loading')).toBeInTheDocument();
    expect(screen.getByText('Loading test...')).toBeInTheDocument();
    expect(screen.queryByTestId('child-content')).not.toBeInTheDocument();
  });

  it('renders error state instead of children', () => {
    const onRetry = vi.fn();
    render(
      <LensShell domain="test" title="Test" isError error={{ message: 'Something failed' }} onRetry={onRetry}>
        <div data-testid="child-content">Hello</div>
      </LensShell>
    );
    expect(screen.getByTestId('error-state')).toBeInTheDocument();
    expect(screen.getByText('Something failed')).toBeInTheDocument();
    expect(screen.queryByTestId('child-content')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders tabs when provided', () => {
    const tabs: LensTab[] = [
      { id: 'all', icon: MockTabIcon, label: 'All Items' },
      { id: 'active', icon: MockTabIcon, label: 'Active' },
    ];
    const onTabChange = vi.fn();

    render(
      <LensShell domain="test" title="Test" tabs={tabs} activeTab="all" onTabChange={onTabChange}>
        <div>Content</div>
      </LensShell>
    );

    expect(screen.getByText('All Items')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('calls onTabChange when a tab is clicked', () => {
    const tabs: LensTab[] = [
      { id: 'all', icon: MockTabIcon, label: 'All' },
      { id: 'active', icon: MockTabIcon, label: 'Active' },
    ];
    const onTabChange = vi.fn();

    render(
      <LensShell domain="test" title="Test" tabs={tabs} activeTab="all" onTabChange={onTabChange}>
        <div>Content</div>
      </LensShell>
    );

    fireEvent.click(screen.getByText('Active'));
    expect(onTabChange).toHaveBeenCalledWith('active');
  });

  it('uses tab.id as label when tab.label is not provided', () => {
    const tabs: LensTab[] = [{ id: 'my-tab', icon: MockTabIcon }];

    render(
      <LensShell domain="test" title="Test" tabs={tabs} activeTab="my-tab">
        <div>Content</div>
      </LensShell>
    );

    expect(screen.getByText('my-tab')).toBeInTheDocument();
  });

  it('renders search bar when searchable', () => {
    const onSearchChange = vi.fn();

    render(
      <LensShell domain="test" title="Test" searchable searchQuery="" onSearchChange={onSearchChange}>
        <div>Content</div>
      </LensShell>
    );

    const input = screen.getByPlaceholderText('Search...');
    expect(input).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'hello' } });
    expect(onSearchChange).toHaveBeenCalledWith('hello');
  });

  it('renders clear button when searchQuery is non-empty', () => {
    const onSearchChange = vi.fn();

    render(
      <LensShell domain="test" title="Test" searchable searchQuery="test" onSearchChange={onSearchChange}>
        <div>Content</div>
      </LensShell>
    );

    // Clear button should exist
    const clearBtn = screen.getByTestId('icon-X').closest('button');
    expect(clearBtn).toBeInTheDocument();

    fireEvent.click(clearBtn!);
    expect(onSearchChange).toHaveBeenCalledWith('');
  });

  it('renders custom searchPlaceholder', () => {
    render(
      <LensShell domain="test" title="Test" searchable searchPlaceholder="Find items...">
        <div>Content</div>
      </LensShell>
    );

    expect(screen.getByPlaceholderText('Find items...')).toBeInTheDocument();
  });

  it('renders filters slot', () => {
    render(
      <LensShell domain="test" title="Test" filters={<div data-testid="filters">Filters</div>}>
        <div>Content</div>
      </LensShell>
    );

    expect(screen.getByTestId('filters')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <LensShell domain="test" title="Test" className="custom-class">
        <div>Content</div>
      </LensShell>
    );

    expect(container.firstChild).toHaveClass('custom-class');
  });
});

describe('StatusBadge', () => {
  it('renders the status text', () => {
    render(<StatusBadge status="active" />);
    expect(screen.getByText('active')).toBeInTheDocument();
  });

  it('uses default color map', () => {
    const { container } = render(<StatusBadge status="active" />);
    expect(container.firstChild).toHaveClass('badge-neon-green');
  });

  it('uses custom color map', () => {
    const customColors = { custom: 'red-500' };
    const { container } = render(<StatusBadge status="custom" colorMap={customColors} />);
    expect(container.firstChild).toHaveClass('badge-red-500');
  });

  it('falls back to gray-400 for unknown statuses', () => {
    const { container } = render(<StatusBadge status="unknown_status" />);
    expect(container.firstChild).toHaveClass('badge-gray-400');
  });
});

describe('ItemList', () => {
  it('renders items using renderItem', () => {
    const items = ['A', 'B', 'C'];
    render(
      <ItemList
        items={items}
        renderItem={(item, i) => <div key={i} data-testid={`item-${i}`}>{item}</div>}
      />
    );

    expect(screen.getByTestId('item-0')).toHaveTextContent('A');
    expect(screen.getByTestId('item-1')).toHaveTextContent('B');
    expect(screen.getByTestId('item-2')).toHaveTextContent('C');
  });

  it('renders empty state when no items', () => {
    render(
      <ItemList
        items={[]}
        renderItem={() => <div />}
        emptyTitle="Nothing here"
        emptyDescription="Try creating something"
      />
    );

    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(screen.getByText('Try creating something')).toBeInTheDocument();
  });

  it('renders "Create New" button when onCreateNew is provided and items are empty', () => {
    const onCreateNew = vi.fn();
    render(
      <ItemList
        items={[]}
        renderItem={() => <div />}
        onCreateNew={onCreateNew}
      />
    );

    const btn = screen.getByText('Create New');
    expect(btn).toBeInTheDocument();

    fireEvent.click(btn);
    expect(onCreateNew).toHaveBeenCalledTimes(1);
  });

  it('does not render Create New button when items exist', () => {
    render(
      <ItemList
        items={['A']}
        renderItem={(item) => <div key={item}>{item}</div>}
        onCreateNew={() => {}}
      />
    );

    expect(screen.queryByText('Create New')).not.toBeInTheDocument();
  });

  it('applies grid class based on grid prop', () => {
    const { container, rerender } = render(
      <ItemList items={['A']} renderItem={(item) => <div key={item}>{item}</div>} grid="2" />
    );
    expect(container.firstChild).toHaveClass('grid-2');

    rerender(
      <ItemList items={['A']} renderItem={(item) => <div key={item}>{item}</div>} grid="3" />
    );
    expect(container.firstChild).toHaveClass('grid-3');

    rerender(
      <ItemList items={['A']} renderItem={(item) => <div key={item}>{item}</div>} grid="4" />
    );
    expect(container.firstChild).toHaveClass('grid-4');
  });

  it('uses space-y-3 when no grid prop', () => {
    const { container } = render(
      <ItemList items={['A']} renderItem={(item) => <div key={item}>{item}</div>} />
    );
    expect(container.firstChild).toHaveClass('space-y-3');
  });
});
