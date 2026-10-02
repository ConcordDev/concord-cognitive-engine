import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock next/navigation
const mockPathname = vi.fn().mockReturnValue('/lenses/chat');
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}));

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

// Mock lens-registry
const MockIcon = ({ className }: { className?: string }) => <span data-testid="mock-icon" className={className}>I</span>;

vi.mock('@/lib/lens-registry', () => ({
  getCoreLensConfig: (id: string) => {
    if (id === 'chat') {
      return {
        id: 'chat',
        name: 'Chat',
        path: '/lenses/chat',
        icon: MockIcon,
        color: 'neon-cyan',
      };
    }
    if (id === 'unknown') return null;
    return null;
  },
  getAbsorbedLenses: (coreId: string) => {
    if (coreId === 'chat') {
      return [
        { id: 'finance', name: 'Finance', tabLabel: 'Finance', path: '/lenses/finance', icon: MockIcon },
        { id: 'health', name: 'Health', tabLabel: undefined, path: '/lenses/health', icon: MockIcon },
      ];
    }
    return [];
  },
}));

// Mock cn utility
vi.mock('@/lib/utils', () => ({
  cn: (...args: (string | boolean | undefined | null)[]) => args.filter(Boolean).join(' '),
}));

import type { CoreLensId } from '@/lib/lens-registry';
import { CoreLensNav } from '@/components/common/CoreLensNav';

describe('CoreLensNav', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname.mockReturnValue('/lenses/chat');
  });

  it('renders null when config is not found', () => {
    const { container } = render(<CoreLensNav coreLensId={'unknown' as CoreLensId} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders null when there are no absorbed lenses', () => {
    // Override for this test: getAbsorbedLenses returns empty for 'board'
    const { container } = render(<CoreLensNav coreLensId={'board' as CoreLensId} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders navigation bar with core lens tab and absorbed lens tabs', () => {
    render(<CoreLensNav coreLensId={'chat' as CoreLensId} />);
    const nav = screen.getByRole('navigation', { name: /Chat workspace navigation/i });
    expect(nav).toBeInTheDocument();
  });

  it('renders the core lens as the first tab', () => {
    render(<CoreLensNav coreLensId={'chat' as CoreLensId} />);
    expect(screen.getByText('Chat')).toBeInTheDocument();
  });

  it('renders absorbed lenses with tabLabel or name', () => {
    render(<CoreLensNav coreLensId={'chat' as CoreLensId} />);
    expect(screen.getByText('Finance')).toBeInTheDocument();
    // 'Health' has no tabLabel, so its name is used
    expect(screen.getByText('Health')).toBeInTheDocument();
  });

  it('renders links with correct href', () => {
    render(<CoreLensNav coreLensId={'chat' as CoreLensId} />);
    const chatLink = screen.getByText('Chat').closest('a');
    expect(chatLink).toHaveAttribute('href', '/lenses/chat');

    const financeLink = screen.getByText('Finance').closest('a');
    expect(financeLink).toHaveAttribute('href', '/lenses/finance');
  });

  it('marks the active tab with aria-current="page"', () => {
    mockPathname.mockReturnValue('/lenses/chat');
    render(<CoreLensNav coreLensId={'chat' as CoreLensId} />);

    const chatLink = screen.getByText('Chat').closest('a');
    expect(chatLink).toHaveAttribute('aria-current', 'page');

    const financeLink = screen.getByText('Finance').closest('a');
    expect(financeLink).not.toHaveAttribute('aria-current');
  });

  it('renders text-only pill tabs (lens north stars: no per-tab icons)', () => {
    render(<CoreLensNav coreLensId={'chat' as CoreLensId} />);
    expect(screen.queryAllByTestId('mock-icon')).toHaveLength(0);
    // 3 tabs: chat, finance, health
    expect(screen.getAllByRole('link')).toHaveLength(3);
  });

  it('highlights absorbed lens when it is the active path', () => {
    mockPathname.mockReturnValue('/lenses/finance');
    render(<CoreLensNav coreLensId={'chat' as CoreLensId} />);

    const financeLink = screen.getByText('Finance').closest('a');
    expect(financeLink).toHaveAttribute('aria-current', 'page');

    const chatLink = screen.getByText('Chat').closest('a');
    expect(chatLink).not.toHaveAttribute('aria-current');
  });
});
