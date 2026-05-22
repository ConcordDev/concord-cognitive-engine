import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { lucideMockFactory, okResult } from './_helpers';

vi.mock('lucide-react', async (orig) => lucideMockFactory(orig as never));
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { StudioWorkbench } from '@/components/studio/StudioWorkbench';

const PROJECTS = [
  { id: 'p1', name: 'First Song', bpm: 120, timeSignature: '4/4', masterVolume: 1, tracks: [], trackCount: 2, createdAt: '', updatedAt: '' },
];
const PROJECT_DETAIL = {
  id: 'p1', name: 'First Song', bpm: 120, timeSignature: '4/4', masterVolume: 1, createdAt: '', updatedAt: '',
  tracks: [
    { id: 't1', name: 'Drum 1', kind: 'drum', volume: 0.8, pan: 0, muted: false, solo: false, effects: [
      { id: 'e1', kind: 'reverb', params: {}, bypassed: false },
    ] },
  ],
};

beforeEach(() => { lensRun.mockReset(); });

describe('StudioWorkbench', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<StudioWorkbench open={false} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the project list when open', async () => {
    lensRun.mockResolvedValue(okResult({ projects: PROJECTS }) as never);
    // ProjectList reads r.data.result.projects directly
    lensRun.mockResolvedValue({ data: { result: { projects: PROJECTS } } });
    render(<StudioWorkbench open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('First Song')).toBeInTheDocument());
  });

  it('closes via the header X', async () => {
    lensRun.mockResolvedValue({ data: { result: { projects: [] } } });
    const onClose = vi.fn();
    render(<StudioWorkbench open onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('No projects.')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('toggles + submits the new-project form', async () => {
    lensRun.mockResolvedValue({ data: { result: { projects: [] } } });
    render(<StudioWorkbench open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('No projects.')).toBeInTheDocument());

    fireEvent.click(screen.getByText('New project'));
    fireEvent.change(screen.getByPlaceholderText('Project name'), { target: { value: 'Track Two' } });
    const numInput = document.querySelector('input[type="number"]')!;
    fireEvent.change(numInput, { target: { value: '128' } });
    fireEvent.click(screen.getByText('Create'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'project-create', input: expect.objectContaining({ name: 'Track Two', bpm: 128 }) }),
    ));
  });

  it('deletes a project after confirm', async () => {
    lensRun.mockResolvedValue({ data: { result: { projects: PROJECTS } } });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<StudioWorkbench open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('First Song')).toBeInTheDocument());
    fireEvent.click(document.querySelector('button.hover\\:text-rose-300')!);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'project-delete' }),
    ));
  });

  it('does not delete when confirm is cancelled', async () => {
    lensRun.mockResolvedValue({ data: { result: { projects: PROJECTS } } });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<StudioWorkbench open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('First Song')).toBeInTheDocument());
    fireEvent.click(document.querySelector('button.hover\\:text-rose-300')!);
    // only the initial list call
    expect(lensRun).toHaveBeenCalledTimes(1);
  });

  it('opens a project detail view, adds tracks and effects', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'project-list') return Promise.resolve({ data: { result: { projects: PROJECTS } } });
      if (spec.action === 'project-get') return Promise.resolve({ data: { result: { project: PROJECT_DETAIL } } });
      return Promise.resolve({ data: { result: {} } });
    });
    render(<StudioWorkbench open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('First Song')).toBeInTheDocument());
    fireEvent.click(screen.getByText('First Song'));
    await waitFor(() => expect(screen.getByText('Drum 1')).toBeInTheDocument());

    fireEvent.click(screen.getByText('audio'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'track-add' }),
    ));

    fireEvent.click(screen.getByText('+ delay'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'effect-add' }),
    ));
  });

  it('mutes a track and updates volume from the detail view', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'project-list') return Promise.resolve({ data: { result: { projects: PROJECTS } } });
      if (spec.action === 'project-get') return Promise.resolve({ data: { result: { project: PROJECT_DETAIL } } });
      return Promise.resolve({ data: { result: {} } });
    });
    render(<StudioWorkbench open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('First Song')).toBeInTheDocument());
    fireEvent.click(screen.getByText('First Song'));
    await waitFor(() => expect(screen.getByText('Drum 1')).toBeInTheDocument());

    fireEvent.click(screen.getByText('M'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'track-update', input: expect.objectContaining({ muted: true }) }),
    ));

    const volSlider = document.querySelectorAll('input[type="range"]')[0];
    fireEvent.change(volSlider, { target: { value: '0.4' } });
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'track-update' }),
    ));
  });

  it('goes back from the detail view to the project list', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'project-list') return Promise.resolve({ data: { result: { projects: PROJECTS } } });
      if (spec.action === 'project-get') return Promise.resolve({ data: { result: { project: PROJECT_DETAIL } } });
      return Promise.resolve({ data: { result: {} } });
    });
    render(<StudioWorkbench open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('First Song')).toBeInTheDocument());
    fireEvent.click(screen.getByText('First Song'));
    await waitFor(() => expect(screen.getByText('← Back to projects')).toBeInTheDocument());
    fireEvent.click(screen.getByText('← Back to projects'));
    await waitFor(() => expect(screen.getByText('New project')).toBeInTheDocument());
  });
});
