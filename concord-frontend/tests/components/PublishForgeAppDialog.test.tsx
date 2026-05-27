import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();

vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { PublishForgeAppDialog } from '@/components/forge/PublishForgeAppDialog';

describe('PublishForgeAppDialog', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
  });

  it('renders title + description + price-tier row', () => {
    const { container } = render(
      <PublishForgeAppDialog
        templateId="t1" appName="my-app" sourceCode="// app"
        manifest={null} onClose={() => undefined}
      />,
    );
    expect(screen.getByDisplayValue('my-app')).toBeTruthy();
    expect(screen.getByPlaceholderText(/what does this app do/i)).toBeTruthy();
    // 5 price-tier buttons identified by visible text content
    const tierButtons = Array.from(container.querySelectorAll('button'))
      .filter((b) => ['Free', '99¢', '$4.99', '$9.99', '$19.99'].includes(b.textContent?.trim() ?? ''));
    expect(tierButtons.length).toBe(5);
  });

  it('clicking Publish calls mint, then list when checkbox on', async () => {
    lensRunMock.mockImplementation((_d: string, action: string) => {
      if (action === 'mint') {
        return Promise.resolve({ data: { ok: true, dtuId: 'dtu_1', citationId: 'cit_1' } });
      }
      if (action === 'list') {
        return Promise.resolve({ data: { ok: true, listingId: 'list_1', schemaVersion: 'v2' } });
      }
      return Promise.resolve({ data: { ok: false } });
    });
    render(
      <PublishForgeAppDialog
        templateId="t1" appName="my-app" sourceCode="// code"
        manifest={{ stats: {} }} onClose={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Publish$/ }));
    await waitFor(() => {
      const mintCall = lensRunMock.mock.calls.find((c) => c[1] === 'mint');
      const listCall = lensRunMock.mock.calls.find((c) => c[1] === 'list');
      expect(mintCall).toBeTruthy();
      expect(listCall).toBeTruthy();
      expect(mintCall?.[2]).toMatchObject({
        templateId: 't1',
        appName: 'my-app',
        sourceCode: '// code',
      });
      expect(listCall?.[2]).toMatchObject({ dtuId: 'dtu_1', priceCents: 0 });
    });
  });

  it('skips list call when checkbox is unchecked', async () => {
    lensRunMock.mockImplementation((_d: string, action: string) => {
      if (action === 'mint') {
        return Promise.resolve({ data: { ok: true, dtuId: 'dtu_1' } });
      }
      return Promise.resolve({ data: { ok: false } });
    });
    render(
      <PublishForgeAppDialog
        templateId="t1" appName="my-app" sourceCode="// code"
        manifest={null} onClose={() => undefined}
      />,
    );
    // Toggle off the "List on marketplace" checkbox
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /^Publish$/ }));
    await waitFor(() => {
      expect(lensRunMock.mock.calls.find((c) => c[1] === 'mint')).toBeTruthy();
      expect(lensRunMock.mock.calls.find((c) => c[1] === 'list')).toBeFalsy();
    });
  });

  it('renders mint error inline', async () => {
    lensRunMock.mockImplementation(() => Promise.resolve({ data: { ok: false, reason: 'no_actor' } }));
    render(
      <PublishForgeAppDialog
        templateId="t1" appName="my-app" sourceCode="// code"
        manifest={null} onClose={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Publish$/ }));
    await waitFor(() => {
      expect(screen.getByText(/no_actor/i)).toBeTruthy();
    });
  });

  it('disables Publish when sourceCode is empty', () => {
    render(
      <PublishForgeAppDialog
        templateId="t1" appName="my-app" sourceCode=""
        manifest={null} onClose={() => undefined}
      />,
    );
    const btn = screen.getByRole('button', { name: /^Publish$/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('selecting a price tier highlights the active one', () => {
    const { container } = render(
      <PublishForgeAppDialog
        templateId="t1" appName="my-app" sourceCode="// code"
        manifest={null} onClose={() => undefined}
      />,
    );
    const fourNinetyNine = Array.from(container.querySelectorAll('button'))
      .find((b) => b.textContent?.trim() === '$4.99') as HTMLButtonElement;
    expect(fourNinetyNine).toBeTruthy();
    fireEvent.click(fourNinetyNine);
    expect(fourNinetyNine.className).toMatch(/violet/);
  });

  it('backdrop click closes', () => {
    const onClose = vi.fn();
    render(
      <PublishForgeAppDialog
        templateId="t1" appName="my-app" sourceCode="// code"
        manifest={null} onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalled();
  });
});
