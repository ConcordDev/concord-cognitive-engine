import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { StudioPreview } from '@/components/lens/ShellPreview';

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockResolvedValue({
    data: {
      ok: true,
      result: { projectCount: 0, latestProject: null },
    },
  });
});

describe('StudioPreview live session (INC-SWEEP studio F2)', () => {
  it('shows the open project name instead of (no project yet) while dashboard is empty', async () => {
    render(
      <StudioPreview
        liveSession={{ name: 'Sweep Studio 7shq68', bpm: 128, timeSignatureNum: 4, timeSignatureDen: 4 }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText('Sweep Studio 7shq68')).toBeTruthy();
    });
    expect(screen.queryByText('(no project yet)')).toBeNull();
    expect(screen.getByText(/128 BPM/i)).toBeTruthy();
  });

  it('falls back to (no project yet) when nothing is open and dashboard has no latest', async () => {
    render(<StudioPreview liveSession={null} />);
    await waitFor(() => {
      expect(screen.getByText('(no project yet)')).toBeTruthy();
    });
  });
});
