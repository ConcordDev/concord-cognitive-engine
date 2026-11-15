/// <reference types="@testing-library/jest-dom/vitest" />
/**
 * FIX-plugins-001 — the gallery had install + rating but NO publish
 * path in the UI, although POST /api/plugins/gallery/publish exists:
 * an empty gallery could never gain its first plugin from this
 * surface. Pin: the publish form posts the manifest fields to the
 * endpoint and refreshes the gallery; a server refusal surfaces
 * verbatim.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('@/components/plugins/PluginInstallConsent', () => ({
  PluginInstallConsent: () => null,
}));

import { PluginGalleryList } from '@/components/plugins/PluginGalleryList';

function fetchMock(publishOk = true) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/api/plugins/gallery/publish')) {
      return { ok: publishOk, status: publishOk ? 200 : 422, json: async () => (publishOk ? { ok: true } : { ok: false, error: 'missing_pluginId_authorId_or_source' }) };
    }
    if (u.includes('/api/plugins/gallery')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, plugins: [] }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

beforeEach(() => { vi.restoreAllMocks(); });

describe('FIX-plugins-001 publish path', () => {
  it('publishes through the form and refreshes the gallery', async () => {
    const fm = fetchMock(true);
    vi.stubGlobal('fetch', fm);
    render(<PluginGalleryList />);
    await waitFor(() => expect(screen.getByText(/No plugins have been published/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Publish a plugin' }));
    fireEvent.change(screen.getByLabelText('Plugin ID'), { target: { value: 'my.plugin' } });
    fireEvent.change(screen.getByLabelText('Plugin name'), { target: { value: 'My Plugin' } });
    fireEvent.change(screen.getByLabelText('Plugin source'), { target: { value: 'export default {}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish to gallery' }));
    await waitFor(() => {
      const pub = fm.mock.calls.find((c) => String(c[0]).includes('/publish'));
      expect(pub).toBeTruthy();
      const body = JSON.parse(String((pub![1] as RequestInit).body));
      expect(body.pluginId).toBe('my.plugin');
      expect(body.source).toContain('export default');
    });
    await waitFor(() => expect(screen.getByText(/Published My Plugin/)).toBeInTheDocument());
  });

  it('surfaces a server refusal verbatim', async () => {
    vi.stubGlobal('fetch', fetchMock(false));
    render(<PluginGalleryList />);
    await waitFor(() => expect(screen.getByText(/No plugins have been published/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Publish a plugin' }));
    fireEvent.change(screen.getByLabelText('Plugin ID'), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText('Plugin name'), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText('Plugin source'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish to gallery' }));
    await waitFor(() => expect(screen.getByText('missing_pluginId_authorId_or_source')).toBeInTheDocument());
  });
});
