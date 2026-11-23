// uploadTrackFile refuses a file the edge would 413, and turns a real 413
// into a sentence. No measurements are invented here — this is only the transport.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  MAX_TRACK_UPLOAD_BYTES,
  trackTooLargeMessage,
  uploadTrackFile,
} from '@/components/music/liner/linerApi';

afterEach(() => {
  vi.unstubAllGlobals();
});

function fileWithSize(name: string, type: string, size: number): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('uploadTrackFile size', () => {
  it('refuses a file over 95 MB before opening a request', async () => {
    const open = vi.fn();
    class XHR {
      upload = {};
      open = open;
      setRequestHeader() {}
      send() {}
    }
    vi.stubGlobal('XMLHttpRequest', XHR);
    const file = fileWithSize('huge.aiff', 'audio/aiff', MAX_TRACK_UPLOAD_BYTES + 1);
    const r = await uploadTrackFile(file, 'Huge', 1);
    expect(r).toEqual({ ok: false, error: trackTooLargeMessage('huge.aiff') });
    expect(open).not.toHaveBeenCalled();
  });

  it('still sends a file of exactly 95 MB', async () => {
    const open = vi.fn();
    class XHR {
      status = 201;
      responseText = JSON.stringify({ mediaDTU: { id: 'm-exact' } });
      withCredentials = false;
      upload = {};
      onload: (() => void) | null = null;
      open = open;
      setRequestHeader() {}
      send() {
        this.onload?.();
      }
    }
    vi.stubGlobal('XMLHttpRequest', XHR);
    const file = fileWithSize('exact.wav', 'audio/wav', MAX_TRACK_UPLOAD_BYTES);
    const r = await uploadTrackFile(file, 'Exact', 2);
    expect(r).toEqual({ ok: true, result: { mediaId: 'm-exact' } });
    expect(open).toHaveBeenCalled();
  });

  it('omits duration when none was measured, and sends it when it was', async () => {
    let url = '';
    class XHR {
      status = 201;
      responseText = JSON.stringify({ mediaDTU: { id: 'm1' } });
      withCredentials = false;
      upload = {};
      onload: (() => void) | null = null;
      open(_method: string, next: string) { url = next; }
      setRequestHeader() {}
      send() { this.onload?.(); }
    }
    vi.stubGlobal('XMLHttpRequest', XHR);
    const file = new File(['x'], 'a.mp3', { type: 'audio/mpeg' });
    expect((await uploadTrackFile(file, 'A', 0)).ok).toBe(true);
    expect(url).not.toContain('duration=');
    expect((await uploadTrackFile(file, 'B', 4.2)).ok).toBe(true);
    expect(url).toContain('duration=4');
  });

  it('maps a bare HTTP 413 to a readable message', async () => {
    class XHR {
      status = 413;
      responseText = '<html>Request Entity Too Large</html>';
      withCredentials = false;
      upload = {};
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      open() {}
      setRequestHeader() {}
      send() {
        this.onload?.();
      }
    }
    vi.stubGlobal('XMLHttpRequest', XHR);
    const file = new File(['x'], 'edge.mp3', { type: 'audio/mpeg' });
    const r = await uploadTrackFile(file, 'Edge', 3);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/edge\.mp3/);
    expect(r.error).toMatch(/too large/);
    expect(r.error).toMatch(/413/);
    expect(r.error).toMatch(/100 MB/);
  });

  it('keeps a server 413 explanation when one was sent', async () => {
    class XHR {
      status = 413;
      responseText = JSON.stringify({
        error: 'file_too_large',
        message: 'File is 120000000 bytes; the audio limit is 500000000 bytes.',
      });
      withCredentials = false;
      upload = {};
      onload: (() => void) | null = null;
      open() {}
      setRequestHeader() {}
      send() {
        this.onload?.();
      }
    }
    vi.stubGlobal('XMLHttpRequest', XHR);
    const r = await uploadTrackFile(new File(['x'], 'big.flac', { type: 'audio/flac' }), 'Big', 4);
    expect(r.ok).toBe(false);
    expect(r.error).toBe(
      'big.flac is too large to upload. File is 120000000 bytes; the audio limit is 500000000 bytes.'
    );
  });
});
