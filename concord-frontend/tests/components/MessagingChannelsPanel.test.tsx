import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('@/lib/api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

import { api } from '@/lib/api/client';
import { MessagingChannelsPanel } from '@/components/messaging/MessagingChannelsPanel';

function binding(overrides: Partial<{ id: string; platform: string; external_id: string; display_name: string | null; permission_level: 'restricted' | 'standard' | 'elevated'; preferred: number }> = {}) {
  return {
    id: 'b1',
    platform: 'discord',
    external_id: '123456',
    display_name: 'Me on Discord',
    permission_level: 'standard' as const,
    preferred: 0,
    last_used_at: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{<MessagingChannelsPanel />}</QueryClientProvider>);
}

describe('MessagingChannelsPanel', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.patch).mockReset();
    vi.mocked(api.delete).mockReset();
  });
  afterEach(() => cleanup());

  it('shows a loading state before bindings resolve', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    renderPanel();
    expect(screen.getByText(/Loading connections/i)).toBeInTheDocument();
  });

  it('shows an error state when the bindings fetch rejects', async () => {
    vi.mocked(api.get).mockImplementation((url: string) =>
      url.includes('bindings') ? Promise.reject(new Error('down')) : Promise.resolve({ data: { platforms: {} } }),
    );
    renderPanel();
    await waitFor(() => expect(screen.getByText(/Failed to load messaging connections/i)).toBeInTheDocument());
  });

  it('shows the empty-state hint when there are no bindings', async () => {
    vi.mocked(api.get).mockImplementation((url: string) =>
      url.includes('bindings') ? Promise.resolve({ data: { bindings: [] } }) : Promise.resolve({ data: { platforms: {} } }),
    );
    renderPanel();
    await waitFor(() => expect(screen.getByText(/No platforms connected yet/i)).toBeInTheDocument());
  });

  it('renders a bound platform with its preferred badge and permission label', async () => {
    vi.mocked(api.get).mockImplementation((url: string) =>
      url.includes('bindings')
        ? Promise.resolve({ data: { bindings: [binding({ preferred: 1 })] } })
        : Promise.resolve({ data: { platforms: {} } }),
    );
    renderPanel();
    await waitFor(() => expect(screen.getByText('Me on Discord')).toBeInTheDocument());
    expect(screen.getByText('preferred')).toBeInTheDocument();
    expect(screen.getByText('Standard (create, no transactions)')).toBeInTheDocument();
  });

  it('falls back to the raw platform name and external_id for an unknown platform / missing display name', async () => {
    vi.mocked(api.get).mockImplementation((url: string) =>
      url.includes('bindings')
        ? Promise.resolve({ data: { bindings: [binding({ platform: 'carrier-pigeon', display_name: null, external_id: 'PIGEON-9' })] } })
        : Promise.resolve({ data: { platforms: {} } }),
    );
    renderPanel();
    await waitFor(() => expect(screen.getByText('carrier-pigeon')).toBeInTheDocument());
    expect(screen.getByText('PIGEON-9')).toBeInTheDocument();
  });

  it('changing the permission select calls PATCH with the new level', async () => {
    vi.mocked(api.get).mockImplementation((url: string) =>
      url.includes('bindings')
        ? Promise.resolve({ data: { bindings: [binding()] } })
        : Promise.resolve({ data: { platforms: {} } }),
    );
    vi.mocked(api.patch).mockResolvedValue({ data: { ok: true } });
    renderPanel();
    await waitFor(() => expect(screen.getByText('Me on Discord')).toBeInTheDocument());
    fireEvent.change(screen.getByDisplayValue('Standard'), { target: { value: 'elevated' } });
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/api/messaging/bindings/b1', { permission_level: 'elevated' }),
    );
  });

  it('clicking the trash icon deletes the binding', async () => {
    vi.mocked(api.get).mockImplementation((url: string) =>
      url.includes('bindings')
        ? Promise.resolve({ data: { bindings: [binding()] } })
        : Promise.resolve({ data: { platforms: {} } }),
    );
    vi.mocked(api.delete).mockResolvedValue({ data: { ok: true } });
    renderPanel();
    await waitFor(() => expect(screen.getByText('Me on Discord')).toBeInTheDocument());
    fireEvent.click(screen.getByTitle('Disconnect'));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/api/messaging/bindings/b1'));
  });

  it('shows all 6 platform tiles, disables an already-connected one, and flags an unconfigured one', async () => {
    vi.mocked(api.get).mockImplementation((url: string) =>
      url.includes('bindings')
        ? Promise.resolve({ data: { bindings: [binding({ platform: 'discord' })] } })
        : Promise.resolve({ data: { platforms: { slack: { configured: false } } } }),
    );
    renderPanel();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Discord' })).toBeDisabled());
    ['WhatsApp', 'Telegram', 'Discord', 'Signal', 'iMessage', 'Slack'].forEach((label) => {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'WhatsApp' })).not.toBeDisabled();
  });

  it('walks the full connect -> verify -> success flow for a new platform and returns to the grid', async () => {
    vi.mocked(api.get).mockImplementation((url: string) =>
      url.includes('bindings')
        ? Promise.resolve({ data: { bindings: [] } })
        : Promise.resolve({ data: { platforms: {} } }),
    );
    vi.mocked(api.post).mockImplementation((url: string) => {
      if (url.includes('/connect/')) {
        return Promise.resolve({ data: { bindingId: 'newid', verificationToken: 'TOK-123' } });
      }
      return Promise.resolve({ data: { ok: true } });
    });
    renderPanel();
    await waitFor(() => expect(screen.getByText('Add platform')).toBeInTheDocument());

    fireEvent.click(screen.getByText('WhatsApp').closest('button')!);
    expect(screen.getByPlaceholderText(/Phone number/i)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/Phone number/i), { target: { value: '+15551234567' } });
    fireEvent.click(screen.getByRole('button', { name: /^Connect WhatsApp$/i }));

    await waitFor(() => expect(screen.getByText('TOK-123')).toBeInTheDocument());
    expect(api.post).toHaveBeenCalledWith('/api/messaging/connect/whatsapp', {
      externalId: '+15551234567',
      displayName: '',
    });

    fireEvent.change(screen.getByPlaceholderText(/Confirmation token/i), { target: { value: 'CONFIRM-1' } });
    fireEvent.click(screen.getByRole('button', { name: /verify connection/i }));

    await waitFor(() => expect(screen.getByText('Add platform')).toBeInTheDocument());
    expect(api.post).toHaveBeenCalledWith('/api/messaging/verify', { platform: 'whatsapp', token: 'CONFIRM-1' });
  });

  it('shows a verification-failed message when the verify step returns ok:false', async () => {
    vi.mocked(api.get).mockImplementation((url: string) =>
      url.includes('bindings')
        ? Promise.resolve({ data: { bindings: [] } })
        : Promise.resolve({ data: { platforms: {} } }),
    );
    vi.mocked(api.post).mockImplementation((url: string) => {
      if (url.includes('/connect/')) return Promise.resolve({ data: { bindingId: 'x', verificationToken: 'TOK' } });
      return Promise.resolve({ data: { ok: false } });
    });
    renderPanel();
    await waitFor(() => expect(screen.getByText('Add platform')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Telegram').closest('button')!);
    fireEvent.change(screen.getByPlaceholderText(/Telegram user ID/i), { target: { value: '@me' } });
    fireEvent.click(screen.getByRole('button', { name: /^Connect Telegram$/i }));
    await waitFor(() => expect(screen.getByText('TOK')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/Confirmation token/i), { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: /verify connection/i }));
    await waitFor(() => expect(screen.getByText(/Verification failed/i)).toBeInTheDocument());
  });

  it('cancelling the connect form at the input step returns to the platform grid without a network call', async () => {
    vi.mocked(api.get).mockImplementation((url: string) =>
      url.includes('bindings')
        ? Promise.resolve({ data: { bindings: [] } })
        : Promise.resolve({ data: { platforms: {} } }),
    );
    renderPanel();
    await waitFor(() => expect(screen.getByText('Add platform')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Signal').closest('button')!);
    expect(screen.getByPlaceholderText(/Phone number/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    await waitFor(() => expect(screen.getByText('Add platform')).toBeInTheDocument());
    expect(api.post).not.toHaveBeenCalled();
  });
});
