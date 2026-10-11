import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'user-1', username: 'ramaj', email: 'r@example.com', role: 'user' },
    isLoading: false,
    isAuthenticated: true,
  }),
}));

vi.mock('@/hooks/useConnectiveTissue', () => ({
  useTip: () => ({ mutate: vi.fn(), isPending: false }),
  usePostBounty: () => ({ mutate: vi.fn(), isPending: false }),
  useForkDTU: () => ({ mutate: vi.fn(), isPending: false }),
  useMeritCredit: () => ({ data: undefined }),
  useDTUSearch: () => ({ data: undefined }),
}));

vi.mock('@/components/dtu/DTUDetailView', () => ({
  DTUDetailView: () => null,
}));

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(),
}));

import { ConnectiveTissueBar } from '@/components/lens/ConnectiveTissueBar';

const componentSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../components/lens/ConnectiveTissueBar.tsx'),
  'utf8',
);

describe('ConnectiveTissueBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render Tip or Fork without a real target', () => {
    render(<ConnectiveTissueBar lensId="docs" getPublishable={() => ({ title: 'Notes', content: 'body' })} />);
    expect(screen.queryByRole('button', { name: 'Tip' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Fork' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Publish DTU' })).toBeInTheDocument();
  });

  it('does not render Publish when the lens has no payload', () => {
    render(<ConnectiveTissueBar lensId="queue" />);
    expect(screen.queryByRole('button', { name: 'Publish DTU' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tip' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Fork' })).toBeNull();
  });

  it('hides Tip and Fork when the target id is a placeholder', () => {
    render(
      <ConnectiveTissueBar
        lensId="docs"
        tipTarget={{ creatorId: 'target_creator', contentId: 'target_content' }}
        forkTarget={{ dtuId: 'target_dtu' }}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Tip' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Fork' })).toBeNull();
  });

  it('has no literal placeholder ids', () => {
    expect(componentSrc).not.toMatch(/target_/);
    expect(componentSrc).not.toContain('New DTU');
    expect(componentSrc).not.toContain('anonymous');
  });
});
