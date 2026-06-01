import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock next/navigation
const mockPathname = vi.fn().mockReturnValue('/');
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}));

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

// Mock UI store
const mockUIStore = {
  sidebarCollapsed: false,
  setSidebarCollapsed: vi.fn(),
  sidebarOpen: false,
  setSidebarOpen: vi.fn(),
  userRole: 'sovereign' as 'sovereign' | 'user',
};

vi.mock('@/store/ui', () => ({
  useUIStore: () => mockUIStore,
}));

// Mock lens-registry
vi.mock('@/lib/lens-registry', () => ({
  CORE_LENSES: [
    { id: 'chat', name: 'Chat', path: '/lenses/chat', icon: () => <span data-testid="icon-chat">C</span>, color: 'neon-cyan', absorbedLensIds: ['finance'] },
    { id: 'board', name: 'Board', path: '/lenses/board', icon: () => <span data-testid="icon-board">B</span>, color: 'neon-blue', absorbedLensIds: [] },
    { id: 'graph', name: 'Graph', path: '/lenses/graph', icon: () => <span data-testid="icon-graph">G</span>, color: 'neon-purple', absorbedLensIds: [] },
    { id: 'code', name: 'Code', path: '/lenses/code', icon: () => <span data-testid="icon-code">Co</span>, color: 'neon-yellow', absorbedLensIds: [] },
    { id: 'studio', name: 'Studio', path: '/lenses/studio', icon: () => <span data-testid="icon-studio">S</span>, color: 'neon-green', absorbedLensIds: [] },
  ],
  getAbsorbedLenses: (coreId: string) => {
    if (coreId === 'chat') {
      return [{ id: 'finance', name: 'Finance', path: '/lenses/finance', tabLabel: 'Finance', icon: () => <span>F</span> }];
    }
    return [];
  },
  getExtensionLenses: () => [
    { id: 'ext1', name: 'Extension 1', path: '/lenses/ext1', category: 'tools', icon: () => <span>E1</span>, description: 'First extension', keywords: [] },
  ],
  getExtensionsByCategory: () => [
    {
      category: 'Tools',
      color: 'text-neon-cyan',
      lenses: [
        { id: 'ext1', name: 'Extension 1', path: '/lenses/ext1', category: 'tools', icon: () => <span>E1</span>, description: 'First extension', keywords: [] },
      ],
    },
  ],
  getLensById: (id: string) => {
    if (id === 'ext1') return { id: 'ext1', name: 'Extension 1', path: '/lenses/ext1', category: 'tools', description: 'First extension', keywords: ['tool'] };
    return undefined;
  },
  isLensVisible: () => true,
  type: { CoreLensConfig: {}, LensEntry: {} },
}));

// Mock cn utility
vi.mock('@/lib/utils', () => ({
  cn: (...args: (string | boolean | undefined | null)[]) => args.filter(Boolean).join(' '),
}));

import { Sidebar } from '@/components/shell/Sidebar';

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUIStore.sidebarCollapsed = false;
    mockUIStore.sidebarOpen = false;
    mockUIStore.userRole = 'sovereign';
    mockPathname.mockReturnValue('/');
  });

  it('renders the Concord logo', () => {
    const { container } = render(<Sidebar />);
    // The logo is a decorative <img> (alt="" aria-hidden) inside the
    // "Go to dashboard" brand link; the brand wordmark renders as
    // uppercase "CONCORD" when labels are shown.
    const logo = container.querySelector('img[src="/logo-cosmic.svg"]');
    expect(logo).toBeInTheDocument();
    expect(screen.getByText('CONCORD')).toBeInTheDocument();
  });

  it('renders Dashboard link', () => {
    render(<Sidebar />);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('renders all 5 core workspace links', () => {
    render(<Sidebar />);
    expect(screen.getByText('Chat')).toBeInTheDocument();
    expect(screen.getByText('Board')).toBeInTheDocument();
    expect(screen.getByText('Graph')).toBeInTheDocument();
    expect(screen.getByText('Code')).toBeInTheDocument();
    expect(screen.getByText('Studio')).toBeInTheDocument();
  });

  it('renders Lens Hub link', () => {
    render(<Sidebar />);
    expect(screen.getByText('Lens Hub')).toBeInTheDocument();
  });

  it('renders Workspaces section label', () => {
    render(<Sidebar />);
    expect(screen.getByText('Workspaces')).toBeInTheDocument();
  });

  it('has aria-label on main navigation', () => {
    render(<Sidebar />);
    expect(screen.getByRole('navigation', { name: /main navigation/i })).toBeInTheDocument();
  });

  it('has aria-label on lens navigation', () => {
    render(<Sidebar />);
    expect(screen.getByRole('navigation', { name: /lens navigation/i })).toBeInTheDocument();
  });

  it('highlights Dashboard when on / route', () => {
    mockPathname.mockReturnValue('/');
    render(<Sidebar />);
    const dashLink = screen.getByText('Dashboard').closest('a');
    expect(dashLink?.className).toContain('bg-neon-blue/20');
  });

  it('highlights Chat when on /lenses/chat route', () => {
    mockPathname.mockReturnValue('/lenses/chat');
    render(<Sidebar />);
    const chatLink = screen.getByText('Chat').closest('a');
    expect(chatLink?.getAttribute('aria-current')).toBe('page');
  });

  describe('Extensions section', () => {
    it('renders Extensions toggle button', () => {
      render(<Sidebar />);
      expect(screen.getByText('Extensions')).toBeInTheDocument();
    });

    it('toggles extensions visibility on click', () => {
      render(<Sidebar />);
      const toggle = screen.getByText('Extensions').closest('button')!;

      // Extensions hidden by default
      expect(screen.queryByText('Extension 1')).not.toBeInTheDocument();

      // Click to show — extensions are grouped by category, need to expand category
      fireEvent.click(toggle);

      // Category header is shown
      expect(screen.getByText('Tools')).toBeInTheDocument();

      // Expand the "Tools" category to see the lens
      const categoryToggle = screen.getByText('Tools').closest('button')!;
      fireEvent.click(categoryToggle);
      expect(screen.getByText('Extension 1')).toBeInTheDocument();

      // Click extensions toggle to hide
      fireEvent.click(toggle);
      expect(screen.queryByText('Extension 1')).not.toBeInTheDocument();
    });

    it('has aria-expanded attribute on extensions toggle', () => {
      render(<Sidebar />);
      const toggle = screen.getByText('Extensions').closest('button')!;
      expect(toggle).toHaveAttribute('aria-expanded', 'false');

      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
    });

    it('shows search input when extensions are expanded', () => {
      render(<Sidebar />);
      const toggle = screen.getByText('Extensions').closest('button')!;
      fireEvent.click(toggle);
      expect(screen.getByPlaceholderText('Filter lenses...')).toBeInTheDocument();
    });

    it('filters lenses by search query', () => {
      render(<Sidebar />);
      const toggle = screen.getByText('Extensions').closest('button')!;
      fireEvent.click(toggle);

      const searchInput = screen.getByPlaceholderText('Filter lenses...');
      fireEvent.change(searchInput, { target: { value: 'Extension' } });

      // When searching, categories auto-expand to show results
      expect(screen.getByText('Extension 1')).toBeInTheDocument();
    });

    it('shows empty state when search has no results', () => {
      render(<Sidebar />);
      const toggle = screen.getByText('Extensions').closest('button')!;
      fireEvent.click(toggle);

      const searchInput = screen.getByPlaceholderText('Filter lenses...');
      fireEvent.change(searchInput, { target: { value: 'zzzznonexistent' } });

      expect(screen.queryByText('Extension 1')).not.toBeInTheDocument();
    });
  });

  describe('mobile overlay', () => {
    it('shows overlay when sidebarOpen is true', () => {
      mockUIStore.sidebarOpen = true;
      render(<Sidebar />);
      const overlay = document.querySelector('[aria-hidden="true"]');
      expect(overlay).toBeInTheDocument();
    });

    it('calls setSidebarOpen(false) when overlay clicked', () => {
      mockUIStore.sidebarOpen = true;
      render(<Sidebar />);
      const overlay = document.querySelector('[aria-hidden="true"]');
      fireEvent.click(overlay!);
      expect(mockUIStore.setSidebarOpen).toHaveBeenCalledWith(false);
    });
  });

  describe('collapsed mode', () => {
    it('hides labels when sidebar is collapsed', () => {
      mockUIStore.sidebarCollapsed = true;
      render(<Sidebar />);
      // Label text should not be rendered when collapsed
      expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
    });
  });

  describe('escape key', () => {
    it('closes mobile sidebar on Escape', () => {
      mockUIStore.sidebarOpen = true;
      render(<Sidebar />);
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(mockUIStore.setSidebarOpen).toHaveBeenCalledWith(false);
    });
  });

  describe('version footer', () => {
    it('shows version info', () => {
      render(<Sidebar />);
      expect(screen.getByText('Concord OS v5.0')).toBeInTheDocument();
      expect(screen.getByText('70% Sovereign')).toBeInTheDocument();
    });
  });

  describe('sovereign role gating', () => {
    it('reads userRole from UI store', () => {
      mockUIStore.userRole = 'user';
      render(<Sidebar />);
      // Should render without error with non-sovereign role — the brand
      // wordmark still renders, proving the store-driven render path ran.
      expect(screen.getByText('CONCORD')).toBeInTheDocument();
    });
  });
});
