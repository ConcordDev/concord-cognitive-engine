import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { FederationBadge } from '@/components/federation/FederationBadge';

describe('FederationBadge', () => {
  it('renders the status label for each known status', () => {
    const cases: Array<['local' | 'mirrored' | 'remote' | 'pending' | 'suspended' | 'failed', string]> = [
      ['local', 'Local'],
      ['mirrored', 'Mirrored'],
      ['remote', 'Remote'],
      ['pending', 'Pending'],
      ['suspended', 'Suspended'],
      ['failed', 'Sync failed'],
    ];
    for (const [status, expected] of cases) {
      const { unmount } = render(<FederationBadge status={status} />);
      expect(screen.getByText(expected)).toBeInTheDocument();
      unmount();
    }
  });

  it('shows the instance name when supplied', () => {
    render(<FederationBadge status="remote" instanceName="berlin-hack.space" />);
    expect(screen.getByText(/berlin-hack\.space/)).toBeInTheDocument();
  });

  it('shows the lastSync hint when supplied', () => {
    render(<FederationBadge status="mirrored" lastSync="2h ago" />);
    expect(screen.getByText(/2h ago/)).toBeInTheDocument();
  });

  it('respects size prop', () => {
    const { container, rerender } = render(<FederationBadge status="local" size="sm" />);
    expect(container.firstChild).toHaveClass('text-[10px]');
    rerender(<FederationBadge status="local" size="lg" />);
    expect(container.firstChild).toHaveClass('text-sm');
  });
});
