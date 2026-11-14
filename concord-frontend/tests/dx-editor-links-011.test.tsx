// FIX-dx-platform-011 — the dx-platform empty states sent users to
// install the VS Code / JetBrains extensions from marketplace pages
// that 404 (the extensions were never published; both URLs re-verified
// 404 at fix time). The panels now say the extensions are not published
// yet and route to the working web-editor path instead. This pin holds
// both panels' no-codebase states to that: the truth renders, and no
// anchor anywhere points at the dead listings.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async () => ({ data: { ok: true, result: { codebases: [] }, error: null } })),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
  apiHelpers: {},
}));

import { SeverityWeightsPanel } from '@/components/dx-platform/SeverityWeightsPanel';
import { ShadowsPanel } from '@/components/dx-platform/ShadowsPanel';

describe('dx-platform editor links (FIX-dx-platform-011)', () => {
  it('SeverityWeightsPanel: no dead marketplace links; the unpublished state is stated', async () => {
    const { container } = render(<SeverityWeightsPanel />);
    expect(await screen.findByText(/not\s+published yet/)).toBeTruthy();
    const hrefs = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href') || '');
    expect(hrefs.some((h) => h.includes('marketplace.visualstudio.com'))).toBe(false);
    expect(hrefs.some((h) => h.includes('plugins.jetbrains.com'))).toBe(false);
    expect(hrefs.some((h) => h.includes('/lenses/dx-platform/web-editor'))).toBe(true);
  });

  it('ShadowsPanel: no dead marketplace links; the unpublished state is stated', async () => {
    const { container } = render(<ShadowsPanel />);
    expect(await screen.findByText(/not\s+published yet/)).toBeTruthy();
    const hrefs = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href') || '');
    expect(hrefs.some((h) => h.includes('marketplace.visualstudio.com'))).toBe(false);
    expect(hrefs.some((h) => h.includes('plugins.jetbrains.com'))).toBe(false);
    expect(hrefs.some((h) => h.includes('/lenses/dx-platform/web-editor'))).toBe(true);
  });
});
