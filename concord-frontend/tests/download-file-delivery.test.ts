// downloadFile must actually deliver: the anchor has to be in the document
// when it is clicked, and the blob URL must outlive the click's task —
// revoking it synchronously can cancel the download before the browser
// starts fetching the blob (silent non-delivery: no error, no file).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { downloadFile } from '@/lib/utils';

describe('downloadFile', () => {
  let createSpy: ReturnType<typeof vi.fn>;
  let revokeSpy: ReturnType<typeof vi.fn>;
  let attachedAtClick: boolean[] = [];
  let clickedAnchor: HTMLAnchorElement | null = null;

  beforeEach(() => {
    attachedAtClick = [];
    clickedAnchor = null;
    createSpy = vi.fn(() => 'blob:mock-url');
    revokeSpy = vi.fn();
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = createSpy;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeSpy;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      attachedAtClick.push(document.body.contains(this));
      clickedAnchor = this;
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('clicks an anchor that is attached to the document', () => {
    downloadFile('hello', 'note.txt', 'text/plain');
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(attachedAtClick).toEqual([true]);
    expect(clickedAnchor?.download).toBe('note.txt');
    // The anchor is removed again once the click has been dispatched.
    expect(clickedAnchor && document.body.contains(clickedAnchor)).toBe(false);
  });

  it('does not revoke the blob URL in the click task, and revokes it later', () => {
    downloadFile('hello', 'note.txt', 'text/plain');
    expect(revokeSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(999);
    expect(revokeSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revokeSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith('blob:mock-url');
  });
});
