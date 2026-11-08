import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { safeLinkUrl } from '@/lib/safe-url';


afterEach(() => cleanup());

describe('safeLinkUrl allowlist', () => {
  it.each([
    'https://example.com/a?b=1#c', 'http://example.com', 'HTTPS://EXAMPLE.COM', '/dtu/abc', './x', '../x', '#frag', '?q=1', 'docs/readme', '//cdn.example.com/x.png',
  ])('allows %s', (u) => { expect(safeLinkUrl(u)).toBe(u); });

  it.each([
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'java\nscript:alert(1)', '\u0001javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>', 'data:image/svg+xml;base64,PHN2Zz4=', 'vbscript:msgbox(1)', 'blob:https://x/1', 'file:///etc/passwd', 'ftp://x', 'mailto:a@b.c', '',
  ])('blocks %j', (u) => { expect(safeLinkUrl(u)).toBeNull(); });

  it('blocks non-strings', () => {
    expect(safeLinkUrl(undefined)).toBeNull();
    expect(safeLinkUrl(42)).toBeNull();
  });
});

describe('BlockEditorRow embed sinks', () => {
  const mk = (url: string, kind: string) => ({ id: 'b1', type: 'embed', text: '', data: { url, kind } });
  const mount = async (url: string, kind: string) => {
    const { BlockEditorRow } = await import('@/components/docs/BlockEditorRow');
    const noop = () => {};
    return render(<BlockEditorRow block={mk(url, kind) as never} cursors={[]} onChange={noop} onDelete={noop} onUp={noop} onDown={noop} onFocus={noop} />);
  };

  it.each(['link', 'image', 'video'])('renders no %s sink for javascript:/data:/vbscript: and explains why', async (kind) => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x']) {
      const view = await mount(bad, kind);
      expect(view.container.querySelector('a[href], img[src], video[src]')).toBeNull();
      expect(view.container.textContent).toMatch(/Only http\(s\) or relative links/);
      cleanup();
    }
  });

  it('still renders http(s) and relative URLs for each kind', async () => {
    const link = await mount('https://example.com/x', 'link');
    expect(link.container.querySelector('a')?.getAttribute('href')).toBe('https://example.com/x');
    cleanup();
    const img = await mount('/uploads/a.png', 'image');
    expect(img.container.querySelector('img')?.getAttribute('src')).toBe('/uploads/a.png');
    cleanup();
    const vid = await mount('https://cdn.example.com/v.mp4', 'video');
    expect(vid.container.querySelector('video')?.getAttribute('src')).toBe('https://cdn.example.com/v.mp4');
    expect(vid.container.textContent).not.toMatch(/Only http/);
  });
});

describe('runtime baseline this guards (React 19 only rewrites javascript:)', () => {
  it('passes data: and vbscript: hrefs through untouched', () => {
    const v = render(<><a href="data:text/html,x">d</a><a href="vbscript:x">v</a><a href="javascript:alert(1)">j</a></>);
    const hrefs = Array.from(v.container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs[0]).toBe('data:text/html,x');
    expect(hrefs[1]).toBe('vbscript:x');
    expect(hrefs[2]).toMatch(/React has blocked a javascript: URL/);
  });
});
