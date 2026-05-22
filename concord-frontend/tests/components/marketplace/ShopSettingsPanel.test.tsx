import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { ShopSettingsPanel } from '@/components/marketplace/ShopSettingsPanel';

const SHOP = {
  id: 's1', name: 'Aria Goods', slug: 'aria-goods', tagline: 'Handmade joy',
  bio: 'We make things.', currency: 'USD', country: 'US',
  bannerUrl: 'http://b.png', avatarUrl: 'http://a.png',
  socials: { web: 'http://w', instagram: 'aria', twitter: 'aria_t' },
  policies: { shipping: 'ships fast', returns: '30 days', custom: '' },
  active: true,
};

describe('ShopSettingsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { shop: SHOP } } });
  });

  it('shows loading spinner initially', () => {
    lensRun.mockReturnValue(new Promise(() => {}));
    const { container } = render(<ShopSettingsPanel />);
    expect(container.querySelector('.animate-spin')).toBeTruthy();
  });

  it('shows shop-not-found when result has no shop', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { shop: null } } });
    render(<ShopSettingsPanel />);
    expect(await screen.findByText('Shop not found.')).toBeInTheDocument();
  });

  it('renders the form populated with shop data', async () => {
    render(<ShopSettingsPanel />);
    expect(await screen.findByDisplayValue('Aria Goods')).toBeInTheDocument();
    expect(screen.getByDisplayValue('aria-goods')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Handmade joy')).toBeInTheDocument();
    expect(screen.getByDisplayValue('aria')).toBeInTheDocument();
  });

  it('edits a field and saves; calls onUpdated', async () => {
    const onUpdated = vi.fn();
    lensRun.mockImplementation((d: { action: string }) => {
      if (d.action === 'shop-update')
        return Promise.resolve({
          data: { ok: true, result: { shop: { ...SHOP, name: 'New Name' } } },
        });
      return Promise.resolve({ data: { ok: true, result: { shop: SHOP } } });
    });
    render(<ShopSettingsPanel onUpdated={onUpdated} />);
    const nameInput = await screen.findByDisplayValue('Aria Goods');
    fireEvent.change(nameInput, { target: { value: 'New Name' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'shop-update' }),
      ),
    );
    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ name: 'New Name' })));
  });

  it('updates a nested social field', async () => {
    render(<ShopSettingsPanel />);
    const igInput = await screen.findByDisplayValue('aria');
    fireEvent.change(igInput, { target: { value: 'aria_new' } });
    expect(screen.getByDisplayValue('aria_new')).toBeInTheDocument();
  });

  it('updates a nested policy field', async () => {
    render(<ShopSettingsPanel />);
    const shipInput = await screen.findByDisplayValue('ships fast');
    fireEvent.change(shipInput, { target: { value: 'ships in 2 days' } });
    expect(screen.getByDisplayValue('ships in 2 days')).toBeInTheDocument();
  });

  it('alerts when save returns ok:false', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    lensRun.mockImplementation((d: { action: string }) => {
      if (d.action === 'shop-update')
        return Promise.resolve({ data: { ok: false, error: 'slug taken' } });
      return Promise.resolve({ data: { ok: true, result: { shop: SHOP } } });
    });
    render(<ShopSettingsPanel />);
    await screen.findByDisplayValue('Aria Goods');
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('slug taken'));
    alertSpy.mockRestore();
  });

  it('tolerates a get rejection by showing shop-not-found', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<ShopSettingsPanel />);
    expect(await screen.findByText('Shop not found.')).toBeInTheDocument();
  });

  it('updates every editable field — exercises all onChange handlers', async () => {
    render(<ShopSettingsPanel />);
    await screen.findByDisplayValue('Aria Goods');
    const changes: [string, string][] = [
      ['Aria Goods', 'Edited Shop'],
      ['aria-goods', 'edited-slug'],
      ['USD', 'GBP'],
      ['Handmade joy', 'New tagline'],
      ['We make things.', 'New bio text'],
      ['http://b.png', 'http://banner2.png'],
      ['http://a.png', 'http://avatar2.png'],
      ['http://w', 'http://web2'],
      ['aria', 'aria2'],
      ['aria_t', 'aria_t2'],
      ['ships fast', 'ships faster'],
      ['30 days', '60 days'],
    ];
    for (const [from, to] of changes) {
      fireEvent.change(screen.getByDisplayValue(from), { target: { value: to } });
      expect(screen.getByDisplayValue(to)).toBeInTheDocument();
    }
  });

  it('tolerates a save rejection without crashing', async () => {
    lensRun.mockImplementation((d: { action: string }) => {
      if (d.action === 'shop-update') return Promise.reject(new Error('save down'));
      return Promise.resolve({ data: { ok: true, result: { shop: SHOP } } });
    });
    render(<ShopSettingsPanel />);
    await screen.findByDisplayValue('Aria Goods');
    fireEvent.click(screen.getByText('Save'));
    // form still rendered
    await waitFor(() => expect(screen.getByDisplayValue('Aria Goods')).toBeInTheDocument());
  });
});
