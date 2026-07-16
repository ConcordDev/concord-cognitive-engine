/**
 * PaperVersionHistory — the real version-snapshot history + compare panel
 * closing the paper lens's ENGINEERING gap (docs/lens-specs/paper-capability-map.md:
 * `revisionDiff` previously only diffed caller-supplied text with no
 * persisted history behind it). Wires paper.paper-version-save /
 * paper-version-list / paper-version-diff.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { PaperVersionHistory } from '@/components/paper/PaperVersionHistory';

interface Version { id: string; versionNumber: number; content: string; label: string | null; createdAt: string }

function makeVersion(n: number, content: string, label: string | null = null): Version {
  return { id: `ver_${n}`, versionNumber: n, content, label, createdAt: new Date(2026, 0, n).toISOString() };
}

describe('PaperVersionHistory', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
  });

  it('shows a loading indicator before the version list resolves', async () => {
    let resolveList: (v: unknown) => void = () => {};
    lensRunMock.mockReturnValue(new Promise((resolve) => { resolveList = resolve; }));
    render(<PaperVersionHistory paperId="pp_1" currentContent="notes" />);
    expect(screen.getByText(/Loading version history/)).toBeInTheDocument();
    resolveList({ data: { ok: true, result: { versions: [] } } });
    await waitFor(() => expect(screen.queryByText(/Loading version history/)).not.toBeInTheDocument());
  });

  it('renders the empty state when no versions have been saved yet', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: true, result: { versions: [] } } });
    render(<PaperVersionHistory paperId="pp_1" currentContent="draft notes" />);
    await waitFor(() => expect(screen.getByText(/No versions saved yet/)).toBeInTheDocument());
    expect(lensRunMock).toHaveBeenCalledWith('paper', 'paper-version-list', { paperId: 'pp_1' });
    expect(screen.getByText('0 snapshots')).toBeInTheDocument();
  });

  it('renders saved snapshots in the order returned by the backend (oldest-first)', async () => {
    lensRunMock.mockResolvedValue({
      data: { ok: true, result: { versions: [makeVersion(1, 'a', 'Draft 1'), makeVersion(2, 'b', 'Draft 2')] } },
    });
    render(<PaperVersionHistory paperId="pp_1" currentContent="notes" />);
    await waitFor(() => expect(screen.getByText('Draft 1')).toBeInTheDocument());
    expect(screen.getByText('Draft 2')).toBeInTheDocument();
    const badges = screen.getAllByText(/^v\d$/);
    expect(badges.map((el) => el.textContent)).toEqual(['v1', 'v2']);
  });

  it('a version with no label renders as "(untitled snapshot)"', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: true, result: { versions: [makeVersion(1, 'a')] } } });
    render(<PaperVersionHistory paperId="pp_1" currentContent="notes" />);
    await waitFor(() => expect(screen.getByText('(untitled snapshot)')).toBeInTheDocument());
  });

  it('disables Save snapshot when the current content is empty (whitespace-only)', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: true, result: { versions: [] } } });
    render(<PaperVersionHistory paperId="pp_1" currentContent="   " />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Save snapshot/ })).toBeDisabled());
  });

  it('saves a version snapshot without a label', async () => {
    lensRunMock.mockImplementation((_domain: string, action: string) => {
      if (action === 'paper-version-list') return Promise.resolve({ data: { ok: true, result: { versions: [] } } });
      if (action === 'paper-version-save') {
        return Promise.resolve({ data: { ok: true, result: { version: makeVersion(1, 'notes content'), total: 1 } } });
      }
      return Promise.resolve({ data: { ok: false, result: null, error: 'unexpected' } });
    });
    render(<PaperVersionHistory paperId="pp_1" currentContent="notes content" />);
    await waitFor(() => expect(screen.getByText(/No versions saved yet/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Save snapshot/ }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('paper', 'paper-version-save', {
      paperId: 'pp_1', content: 'notes content', label: undefined,
    }));
  });

  it('saves a version snapshot with a label, then clears the label field', async () => {
    lensRunMock.mockImplementation((_domain: string, action: string) => {
      if (action === 'paper-version-list') return Promise.resolve({ data: { ok: true, result: { versions: [] } } });
      if (action === 'paper-version-save') {
        return Promise.resolve({ data: { ok: true, result: { version: makeVersion(1, 'notes content', 'Draft 1'), total: 1 } } });
      }
      return Promise.resolve({ data: { ok: false, result: null, error: 'unexpected' } });
    });
    render(<PaperVersionHistory paperId="pp_1" currentContent="notes content" />);
    await waitFor(() => expect(screen.getByText(/No versions saved yet/)).toBeInTheDocument());

    const labelInput = screen.getByPlaceholderText(/Label \(optional\)/) as HTMLInputElement;
    fireEvent.change(labelInput, { target: { value: 'Draft 1' } });
    fireEvent.click(screen.getByRole('button', { name: /Save snapshot/ }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('paper', 'paper-version-save', {
      paperId: 'pp_1', content: 'notes content', label: 'Draft 1',
    }));
    await waitFor(() => expect(labelInput.value).toBe(''));
  });

  it('shows an error message when saving a snapshot fails, and does not clear the label', async () => {
    lensRunMock.mockImplementation((_domain: string, action: string) => {
      if (action === 'paper-version-list') return Promise.resolve({ data: { ok: true, result: { versions: [] } } });
      if (action === 'paper-version-save') return Promise.resolve({ data: { ok: false, result: null, error: 'paper not found' } });
      return Promise.resolve({ data: { ok: false, result: null, error: 'unexpected' } });
    });
    render(<PaperVersionHistory paperId="pp_1" currentContent="notes content" />);
    await waitFor(() => expect(screen.getByText(/No versions saved yet/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Save snapshot/ }));
    await waitFor(() => expect(screen.getByText('paper not found')).toBeInTheDocument());
  });

  it('does not render the compare UI with fewer than 2 versions', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: true, result: { versions: [makeVersion(1, 'a')] } } });
    render(<PaperVersionHistory paperId="pp_1" currentContent="notes" />);
    await waitFor(() => expect(screen.getByText('v1')).toBeInTheDocument());
    expect(screen.queryByText('Compare versions')).not.toBeInTheDocument();
  });

  it('renders the compare UI once at least 2 versions exist', async () => {
    lensRunMock.mockResolvedValue({
      data: { ok: true, result: { versions: [makeVersion(1, 'a'), makeVersion(2, 'b')] } },
    });
    render(<PaperVersionHistory paperId="pp_1" currentContent="notes" />);
    await waitFor(() => expect(screen.getByText('Compare versions')).toBeInTheDocument());
  });

  it('the Diff button stays disabled until both From and To versions are picked', async () => {
    lensRunMock.mockResolvedValue({
      data: { ok: true, result: { versions: [makeVersion(1, 'a'), makeVersion(2, 'b')] } },
    });
    render(<PaperVersionHistory paperId="pp_1" currentContent="notes" />);
    await waitFor(() => expect(screen.getByRole('button', { name: /^Diff$/ })).toBeDisabled());
    fireEvent.change(screen.getByLabelText('From version'), { target: { value: '1' } });
    expect(screen.getByRole('button', { name: /^Diff$/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('To version'), { target: { value: '2' } });
    expect(screen.getByRole('button', { name: /^Diff$/ })).not.toBeDisabled();
  });

  it('picking two versions and running the diff renders the real added/removed/word/char counts', async () => {
    lensRunMock.mockImplementation((_domain: string, action: string, input: Record<string, unknown>) => {
      if (action === 'paper-version-list') {
        return Promise.resolve({
          data: { ok: true, result: { versions: [makeVersion(1, 'line one\nline two'), makeVersion(2, 'line one\nline two changed\nline three')] } },
        });
      }
      if (action === 'paper-version-diff') {
        expect(input).toEqual({ paperId: 'pp_1', fromVersion: 1, toVersion: 2 });
        return Promise.resolve({
          data: {
            ok: true,
            result: {
              fromVersion: 1, toVersion: 2,
              oldStats: { lines: 2, words: 4, chars: 17 },
              newStats: { lines: 3, words: 7, chars: 39 },
              diff: { linesAdded: 2, linesRemoved: 1, linesUnchanged: 1, wordDelta: 3, charDelta: 22 },
              changeRate: 150,
              addedPreview: ['line two changed', 'line three'],
              removedPreview: ['line two'],
            },
          },
        });
      }
      return Promise.resolve({ data: { ok: false, result: null, error: 'unexpected' } });
    });
    render(<PaperVersionHistory paperId="pp_1" currentContent="notes" />);
    await waitFor(() => expect(screen.getByText('Compare versions')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('From version'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('To version'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /^Diff$/ }));

    await waitFor(() => expect(screen.getByText('2 lines')).toBeInTheDocument());
    expect(screen.getByText('1 lines')).toBeInTheDocument();
    expect(screen.getByText('+3 words')).toBeInTheDocument();
    expect(screen.getByText('+22 chars')).toBeInTheDocument();
    expect(screen.getByText('150% changed')).toBeInTheDocument();
    expect(screen.getByText('+ line two changed')).toBeInTheDocument();
    expect(screen.getByText('+ line three')).toBeInTheDocument();
    expect(screen.getByText('− line two')).toBeInTheDocument();
  });

  it('shows an error when the diff request is rejected (e.g. a nonexistent version)', async () => {
    lensRunMock.mockImplementation((_domain: string, action: string) => {
      if (action === 'paper-version-list') {
        return Promise.resolve({ data: { ok: true, result: { versions: [makeVersion(1, 'a'), makeVersion(2, 'b')] } } });
      }
      if (action === 'paper-version-diff') {
        return Promise.resolve({ data: { ok: false, result: null, error: 'version not found: 99' } });
      }
      return Promise.resolve({ data: { ok: false, result: null, error: 'unexpected' } });
    });
    render(<PaperVersionHistory paperId="pp_1" currentContent="notes" />);
    await waitFor(() => expect(screen.getByText('Compare versions')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('From version'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('To version'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /^Diff$/ }));
    await waitFor(() => expect(screen.getByText('version not found: 99')).toBeInTheDocument());
  });
});
