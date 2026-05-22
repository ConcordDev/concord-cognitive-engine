import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { lucideMockFactory, okResult, errResult } from './_helpers';

vi.mock('lucide-react', async (orig) => lucideMockFactory(orig as never));
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { ProjectIOPanel } from '@/components/studio/ProjectIOPanel';

beforeEach(() => {
  lensRun.mockReset();
  if (!URL.createObjectURL) URL.createObjectURL = vi.fn(() => 'blob:x');
  else vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
  if (!URL.revokeObjectURL) URL.revokeObjectURL = vi.fn();
  else vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

describe('ProjectIOPanel', () => {
  it('renders the no-project hint', () => {
    render(<ProjectIOPanel />);
    expect(screen.getByText(/Open a project to export stems/)).toBeInTheDocument();
  });

  it('changes format + sample-rate selects and exports stems', async () => {
    const job = { id: 'j1', projectName: 'Demo', format: 'flac', sampleRate: 96000, stemCount: 2, stems: [
      { trackId: 't1', trackName: 'Drums', index: 0, outputUrl: '/a' },
      { trackId: 't2', trackName: 'Bass', index: 1, outputUrl: '/b' },
    ] };
    lensRun.mockResolvedValue(okResult({ job }));
    const { container } = render(<ProjectIOPanel projectId="p1" />);
    const selects = container.querySelectorAll('select');
    fireEvent.change(selects[0], { target: { value: 'flac' } });
    fireEvent.change(selects[1], { target: { value: '96000' } });
    fireEvent.click(screen.getByText('Export stems'));
    await waitFor(() => expect(screen.getByText(/2 stems · flac/)).toBeInTheDocument());
    expect(screen.getByText(/Drums/)).toBeInTheDocument();
  });

  it('shows an error when stem export fails', async () => {
    lensRun.mockResolvedValue(errResult('stem fail'));
    render(<ProjectIOPanel projectId="p1" />);
    fireEvent.click(screen.getByText('Export stems'));
    await waitFor(() => expect(screen.getByText('stem fail')).toBeInTheDocument());
  });

  it('exports the project .json file', async () => {
    lensRun.mockResolvedValue(okResult({ bundle: { project: { name: 'My Song' }, tracks: [] } }));
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<ProjectIOPanel projectId="p1" />);
    fireEvent.click(screen.getByText('Export .json'));
    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
    clickSpy.mockRestore();
  });

  it('shows an error when project export fails', async () => {
    lensRun.mockResolvedValue(errResult('export fail'));
    render(<ProjectIOPanel projectId="p1" />);
    fireEvent.click(screen.getByText('Export .json'));
    await waitFor(() => expect(screen.getByText('export fail')).toBeInTheDocument());
  });

  it('imports a project bundle file', async () => {
    lensRun.mockResolvedValue(okResult({
      project: { id: 'np', name: 'Imported' },
      imported: { tracks: 3, clips: 5, notes: 9, markers: 2 },
    }));
    const { container } = render(<ProjectIOPanel projectId="p1" />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([JSON.stringify({ project: { name: 'Imported' } })], 'b.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(JSON.stringify({ project: { name: 'Imported' } })) });
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText(
      (content, el) => el?.tagName === 'DIV'
        && !!el?.textContent?.includes('3 tracks')
        && !!el?.textContent?.includes('5 clips')
        && !el.querySelector('div'),
    )).toBeInTheDocument());
  });

  it('shows an error for an invalid import bundle', async () => {
    const { container } = render(<ProjectIOPanel projectId="p1" />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['not json'], 'b.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: () => Promise.resolve('not json') });
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText(/invalid bundle file/)).toBeInTheDocument());
  });

  it('opens the file picker when Import .json is clicked', () => {
    const { container } = render(<ProjectIOPanel projectId="p1" />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(fileInput, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByText('Import .json'));
    expect(clickSpy).toHaveBeenCalled();
  });
});
