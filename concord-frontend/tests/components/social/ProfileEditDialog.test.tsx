/**
 * ProfileEditDialog — accent colour picker (job oc-social-5, Social
 * identity / JOB 8).
 *
 * The accent is real profile data persisted through POST
 * /api/social/profile, and the picker refuses colours under the WCAG
 * 4.5:1 contrast bar against the dark Social surface BEFORE anything is
 * sent — the save button is disabled and the honest error is shown.
 * Only the HTTP layer is mocked.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiPost = vi.fn();
const invalidateSpy = vi.fn();

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(), post: (...a: unknown[]) => apiPost(...a) },
}));
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: invalidateSpy }),
  };
});

import { ProfileEditDialog } from '@/components/social/ProfileEditDialog';

function renderDialog(initial?: { accent?: string | null }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ProfileEditDialog
        userId="user-1"
        initial={{
          displayName: 'Alice',
          bio: '',
          avatar: '',
          website: '',
          isPublic: true,
          accent: initial?.accent ?? null,
        }}
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

function accentHexInput() {
  return screen.getByLabelText('Accent colour hex') as HTMLInputElement;
}

function saveButton() {
  return screen.getByRole('button', { name: 'Save profile' }) as HTMLButtonElement;
}

describe('ProfileEditDialog accent picker', () => {
  beforeEach(() => {
    apiPost.mockReset();
    invalidateSpy.mockReset();
    apiPost.mockResolvedValue({ data: { ok: true } });
  });
  afterEach(() => {
    cleanup();
  });

  it('renders the accent field prefilled from the profile', () => {
    renderDialog({ accent: '#14b8a6' });
    expect(accentHexInput().value).toBe('#14b8a6');
  });

  it('refuses a low-contrast accent: save disabled + honest error, nothing sent', () => {
    renderDialog();
    // #767676 is ~4.10:1 against the dark surface — under the 4.5:1 bar.
    fireEvent.change(accentHexInput(), { target: { value: '#767676' } });
    expect(screen.getByText(/too low/i)).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/at least 4\.5:1/);
    expect(saveButton().disabled).toBe(true);
    // A refused colour is never sent to the server.
    fireEvent.click(saveButton());
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('refuses non-hex input the same way', () => {
    renderDialog();
    fireEvent.change(accentHexInput(), { target: { value: 'chartreuse' } });
    expect(screen.getByRole('alert').textContent).toMatch(/hex colour/);
    expect(saveButton().disabled).toBe(true);
  });

  it('accepts a high-contrast accent and saves it through the profile POST', async () => {
    renderDialog();
    fireEvent.change(accentHexInput(), { target: { value: '#FFFFFF' } });
    expect(screen.getByText(/passes/i)).toBeTruthy();
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(saveButton());
    await vi.waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/api/social/profile', expect.objectContaining({ accent: '#ffffff' }));
    });
  });

  it('clearing the accent saves null (the accent is removed, not silently kept)', async () => {
    renderDialog({ accent: '#14b8a6' });
    fireEvent.click(screen.getByRole('button', { name: 'Clear accent colour' }));
    expect(accentHexInput().value).toBe('');
    fireEvent.click(saveButton());
    await vi.waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/api/social/profile',
        expect.objectContaining({ accent: null }),
      );
    });
  });

  it('saving without an accent still persists the standard profile fields', async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText(/Display name/), { target: { value: 'Alice Two' } });
    fireEvent.click(saveButton());
    await vi.waitFor(() => {
      const [path, body] = apiPost.mock.calls[apiPost.mock.calls.length - 1] as [string, Record<string, unknown>];
      expect(path).toBe('/api/social/profile');
      expect(body.displayName).toBe('Alice Two');
      expect(body.isPublic).toBe(true);
    });
  });
});