// downloadFile must actually deliver: the anchor has to be in the document
// when it is clicked, and the blob URL must outlive the click's task —
// revoking it synchronously can cancel the download before the browser
// starts fetching the blob (silent non-delivery: no error, no file).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { downloadFile, downloadFromUrl } from '@/lib/utils';

describe('downloadFile', () => {
  let createSpy: ReturnType<typeof vi.fn>;
  let revokeSpy: ReturnType<typeof vi.fn>;
  let attachedAtClick: boolean[] = [];
  let clickSpy: ReturnType<typeof vi.spyOn>;
  const clickedAnchor = () => (clickSpy.mock.contexts[0] as HTMLAnchorElement | undefined) ?? null;

  beforeEach(() => {
    attachedAtClick = [];
    createSpy = vi.fn(() => 'blob:mock-url');
    revokeSpy = vi.fn();
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = createSpy;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeSpy;
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      attachedAtClick.push(document.body.contains(this));
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
    expect(clickedAnchor()?.download).toBe('note.txt');
    // The anchor is removed again once the click has been dispatched.
    expect((() => { const a = clickedAnchor(); return a && document.body.contains(a); })()).toBe(false);
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

describe('downloadFromUrl (server attachment navigation)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('clicks an attached anchor pointing at the URL with no download attribute (server names the file), then removes it', () => {
    const seen: Array<{ href: string; hasDownload: boolean; attached: boolean }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      seen.push({ href: this.getAttribute('href') ?? '', hasDownload: this.hasAttribute('download'), attached: document.body.contains(this) });
    });
    downloadFromUrl('/api/lens/crafting/export/download?format=json&limit=1000');
    expect(seen).toEqual([{ href: '/api/lens/crafting/export/download?format=json&limit=1000', hasDownload: false, attached: true }]);
    expect(document.querySelectorAll('a[href*="export/download"]').length).toBe(0);
  });

  it('builds no blob URL (nothing for a blob-hostile seat to drop)', () => {
    const create = vi.fn(); (URL as unknown as { createObjectURL: unknown }).createObjectURL = create;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    downloadFromUrl('/x');
    expect(create).not.toHaveBeenCalled();
  });
});
