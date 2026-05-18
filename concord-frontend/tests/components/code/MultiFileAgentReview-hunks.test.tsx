/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MultiFileAgentReview, { type MultiFileEdit, type HunkAcceptance } from '@/components/code/MultiFileAgentReview';

// Stub the dynamic MonacoDiffViewer — testing the per-hunk control
// surface, not Monaco.
vi.mock('next/dynamic', () => ({
  default: () => () => null,
}));

const before30 = Array.from({ length: 30 }, (_, i) => `line${i}`).join('\n') + '\n';
const afterArr = Array.from({ length: 30 }, (_, i) => `line${i}`);
afterArr[0] = 'FIRST_CHANGED';
afterArr[29] = 'LAST_CHANGED';
const after30 = afterArr.join('\n') + '\n';

const edits: MultiFileEdit[] = [{
  filename: 'src/hello.txt',
  scriptId: 'dtu_test_1',
  language: 'plaintext',
  before: before30,
  after: after30,
}];

describe('MultiFileAgentReview — per-hunk acceptance UI', () => {
  it('shows the Per-hunk Review toggle when a file is expanded', async () => {
    const onApply = vi.fn(async () => undefined);
    render(
      <MultiFileAgentReview
        open prompt="rename first + last lines"
        edits={edits} onClose={() => undefined} onApply={onApply}
      />
    );
    // First file is auto-expanded; toggle should be visible.
    await waitFor(() => {
      expect(screen.getByText(/Per-hunk review/i)).toBeTruthy();
    });
  });

  it('expanding hunks shows two hunks for the distant-change diff', async () => {
    render(
      <MultiFileAgentReview
        open prompt="test"
        edits={edits} onClose={() => undefined} onApply={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText(/Per-hunk review/i));
    const hunkHeaders = await screen.findAllByText(/^@@ -/);
    expect(hunkHeaders.length).toBe(2);
  });

  it('clicking accept-all-hunks then file accept then Apply passes the right hunkAcceptance map', async () => {
    const onApply = vi.fn(async () => undefined);
    render(
      <MultiFileAgentReview
        open prompt="test"
        edits={edits} onClose={() => undefined} onApply={onApply}
      />
    );
    fireEvent.click(screen.getByText(/Per-hunk review/i));
    fireEvent.click(screen.getByText(/Accept all hunks/i));
    // File-level Accept buttons are titled "Accept"
    const fileAcceptBtn = screen.getByTitle('Accept');
    fireEvent.click(fileAcceptBtn);
    fireEvent.click(screen.getByText(/Apply 1$/));
    await waitFor(() => expect(onApply).toHaveBeenCalled());
    const [, hunkMap] = onApply.mock.calls[0] as [MultiFileEdit[], HunkAcceptance];
    expect(hunkMap.dtu_test_1).toBeTruthy();
    expect(hunkMap.dtu_test_1[0]).toBe(true);
    expect(hunkMap.dtu_test_1[1]).toBe(true);
  });

  it('rejecting all hunks empties the map for that file', async () => {
    const onApply = vi.fn(async () => undefined);
    render(
      <MultiFileAgentReview
        open prompt="test"
        edits={edits} onClose={() => undefined} onApply={onApply}
      />
    );
    fireEvent.click(screen.getByText(/Per-hunk review/i));
    fireEvent.click(screen.getByText(/Accept all hunks/i));
    fireEvent.click(screen.getByText(/Reject all hunks/i));
    fireEvent.click(screen.getByTitle('Accept'));
    fireEvent.click(screen.getByText(/Apply 1$/));
    await waitFor(() => expect(onApply).toHaveBeenCalled());
    const [, hunkMap] = onApply.mock.calls[0] as [MultiFileEdit[], HunkAcceptance];
    expect(Object.keys(hunkMap.dtu_test_1 || {}).length).toBe(0);
  });

  it('individual hunk checkbox toggles only that hunk', async () => {
    const onApply = vi.fn(async () => undefined);
    render(
      <MultiFileAgentReview
        open prompt="test"
        edits={edits} onClose={() => undefined} onApply={onApply}
      />
    );
    fireEvent.click(screen.getByText(/Per-hunk review/i));
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    fireEvent.click(screen.getByTitle('Accept'));
    fireEvent.click(screen.getByText(/Apply 1$/));
    await waitFor(() => expect(onApply).toHaveBeenCalled());
    const [, hunkMap] = onApply.mock.calls[0] as [MultiFileEdit[], HunkAcceptance];
    expect(hunkMap.dtu_test_1[0]).toBe(true);
    expect(hunkMap.dtu_test_1[1]).toBeFalsy();
  });
});
