import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { lucideMockFactory, okResult, errResult } from './_helpers';

vi.mock('lucide-react', async (orig) => lucideMockFactory(orig as never));
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { ScenesLauncher } from '@/components/studio/ScenesLauncher';

const SCENES = [
  { id: 's1', projectId: 'p1', name: 'Intro', order: 0, tempoBpm: null, launchedAt: null },
  { id: 's2', projectId: 'p1', name: 'Chorus', order: 1, tempoBpm: 128, launchedAt: new Date().toISOString() },
];

beforeEach(() => { lensRun.mockReset(); });

describe('ScenesLauncher', () => {
  it('shows the empty state', async () => {
    lensRun.mockResolvedValue(okResult({ scenes: [] }));
    render(<ScenesLauncher projectId="p1" />);
    await waitFor(() => expect(screen.getByText(/No scenes/)).toBeInTheDocument());
  });

  it('renders scenes; a launched one shows the timestamp', async () => {
    lensRun.mockResolvedValue(okResult({ scenes: SCENES }));
    render(<ScenesLauncher projectId="p1" />);
    await waitFor(() => expect(screen.getByText('Intro')).toBeInTheDocument());
    expect(screen.getByText('Chorus')).toBeInTheDocument();
    expect(screen.getByText(/Last launched/)).toBeInTheDocument();
  });

  it('does not render the add form without projectId', async () => {
    render(<ScenesLauncher />);
    await waitFor(() => expect(screen.getByText(/No scenes/)).toBeInTheDocument());
    expect(screen.queryByText('Add scene')).not.toBeInTheDocument();
  });

  it('creates a scene', async () => {
    lensRun.mockResolvedValue(okResult({ scenes: [] }));
    render(<ScenesLauncher projectId="p1" />);
    await waitFor(() => expect(screen.getByText(/No scenes/)).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/Scene name/), { target: { value: 'Bridge' } });
    fireEvent.click(screen.getByText('Add scene'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'scenes-create', input: expect.objectContaining({ name: 'Bridge' }) }),
    ));
  });

  it('does not create a scene with empty name', async () => {
    lensRun.mockResolvedValue(okResult({ scenes: [] }));
    render(<ScenesLauncher projectId="p1" />);
    await waitFor(() => expect(screen.getByText(/No scenes/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Add scene'));
    expect(lensRun).toHaveBeenCalledTimes(1);
  });

  it('launches a scene', async () => {
    lensRun.mockResolvedValue(okResult({ scenes: SCENES }));
    render(<ScenesLauncher projectId="p1" />);
    await waitFor(() => expect(screen.getByText('Intro')).toBeInTheDocument());
    fireEvent.click(screen.getAllByText('Launch')[0]);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'scenes-launch' }),
    ));
  });

  it('handles list error', async () => {
    lensRun.mockResolvedValue(errResult());
    render(<ScenesLauncher projectId="p1" />);
    await waitFor(() => expect(screen.getByText(/No scenes/)).toBeInTheDocument());
  });

  it('survives a refresh exception', async () => {
    lensRun.mockRejectedValue(new Error('x'));
    render(<ScenesLauncher projectId="p1" />);
    await waitFor(() => expect(screen.getByText(/No scenes/)).toBeInTheDocument());
  });
});
