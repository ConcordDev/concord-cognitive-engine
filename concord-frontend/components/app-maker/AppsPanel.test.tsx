/**
 * AppsPanel — the create/list/promote/validate/template-deploy desk, tested
 * directly. app-maker-lens-states.test.tsx already pins the page-level
 * loading/error/empty/populated wiring through this component; this file
 * exercises the panel's own real actions (create/promote/validate/search-
 * filter/template-deploy) that the page-level test never drives.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const appsList = vi.fn();
const appsCreate = vi.fn();
const appsPromote = vi.fn();
const appsValidate = vi.fn();
const addToastMock = vi.fn();

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    apps: {
      list: (...a: unknown[]) => appsList(...a),
      create: (...a: unknown[]) => appsCreate(...a),
      promote: (...a: unknown[]) => appsPromote(...a),
      validate: (...a: unknown[]) => appsValidate(...a),
    },
  },
}));
vi.mock('@/store/ui', () => ({
  useUIStore: Object.assign(() => {}, { getState: () => ({ addToast: addToastMock }) }),
}));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) }),
}));

import { AppsPanel } from './AppsPanel';

const APP_A = { id: 'app_a', name: 'Alpha CRM', status: 'draft', author: 'u1', version: '0.0.1', createdAt: '2026-06-27' };
const APP_B = { id: 'app_b', name: 'Beta Store', status: 'published', author: 'u1', version: '1.2.0', createdAt: '2026-06-28' };

beforeEach(() => {
  appsList.mockReset();
  appsCreate.mockReset();
  appsPromote.mockReset();
  appsValidate.mockReset();
  addToastMock.mockReset();
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  appsList.mockResolvedValue({ data: { apps: [APP_A, APP_B] } });
  appsCreate.mockResolvedValue({ data: {} });
  appsPromote.mockResolvedValue({ data: {} });
  appsValidate.mockResolvedValue({ data: { valid: true } });
});

describe('AppsPanel', () => {
  it('renders stat cards + real app rows once loaded', async () => {
    render(<AppsPanel />);
    await waitFor(() => expect(screen.getByText('Alpha CRM')).toBeInTheDocument());
    expect(screen.getByText('Beta Store')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument(); // Total Apps stat
    expect(screen.getByText('draft')).toBeInTheDocument();
    expect(screen.getByText('published')).toBeInTheDocument();
  });

  it('creates a new app with the real primitive/UI shape and reloads the list', async () => {
    render(<AppsPanel />);
    await waitFor(() => expect(screen.getByText('Alpha CRM')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText(/New app name/i), { target: { value: 'Gamma Booking' } });
    fireEvent.click(screen.getByRole('button', { name: /^Create$/i }));

    await waitFor(() =>
      expect(appsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Gamma Booking',
          primitives: expect.objectContaining({ artifacts: { types: [], schema: {} } }),
          ui: { lens: 'custom', layout: 'dashboard', panels: [] },
        }),
      ),
    );
    // list reloads after create
    await waitFor(() => expect(appsList.mock.calls.length).toBeGreaterThan(1));
  });

  it('does not create on an empty/whitespace name', async () => {
    render(<AppsPanel />);
    await waitFor(() => expect(screen.getByText('Alpha CRM')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /^Create$/i })).toBeDisabled();
  });

  it('validate reports a valid app via a real alert with the invariant-pass message', async () => {
    appsValidate.mockResolvedValue({ data: { valid: true } });
    render(<AppsPanel />);
    await waitFor(() => expect(screen.getByText('Alpha CRM')).toBeInTheDocument());

    fireEvent.click(screen.getAllByTitle('Validate')[0]);
    await waitFor(() => expect(appsValidate).toHaveBeenCalledWith('app_a'));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('all invariants pass')));
  });

  it('validate reports real violations when the app is invalid', async () => {
    appsValidate.mockResolvedValue({ data: { valid: false, violations: ['missing schema', 'no execution macros'] } });
    render(<AppsPanel />);
    await waitFor(() => expect(screen.getByText('Alpha CRM')).toBeInTheDocument());

    fireEvent.click(screen.getAllByTitle('Validate')[0]);
    await waitFor(() =>
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('missing schema')),
    );
  });

  it('promote calls apiHelpers.apps.promote and reloads the list', async () => {
    render(<AppsPanel />);
    await waitFor(() => expect(screen.getByText('Alpha CRM')).toBeInTheDocument());

    fireEvent.click(screen.getAllByTitle('Promote')[0]);
    await waitFor(() => expect(appsPromote).toHaveBeenCalledWith('app_a'));
    await waitFor(() => expect(appsList.mock.calls.length).toBeGreaterThan(1));
  });

  it('a rejected create surfaces an error toast, not a fabricated success', async () => {
    appsCreate.mockRejectedValue(new Error('name taken'));
    render(<AppsPanel />);
    await waitFor(() => expect(screen.getByText('Alpha CRM')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText(/New app name/i), { target: { value: 'Dupe App' } });
    fireEvent.click(screen.getByRole('button', { name: /^Create$/i }));

    await waitFor(() =>
      expect(addToastMock).toHaveBeenCalledWith({ type: 'error', message: 'Failed to create app' }),
    );
  });

  it('search filters the visible app list by name', async () => {
    render(<AppsPanel />);
    await waitFor(() => expect(screen.getByText('Alpha CRM')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText(/Filter.*focuses/i), { target: { value: 'beta' } });
    await waitFor(() => expect(screen.queryByText('Alpha CRM')).not.toBeInTheDocument());
    expect(screen.getByText('Beta Store')).toBeInTheDocument();
    expect(screen.getByText('(1 of 2)')).toBeInTheDocument();
  });

  it('status filter narrows to the selected status', async () => {
    render(<AppsPanel />);
    await waitFor(() => expect(screen.getByText('Alpha CRM')).toBeInTheDocument());

    fireEvent.change(screen.getByDisplayValue('All'), { target: { value: 'published' } });
    await waitFor(() => expect(screen.queryByText('Alpha CRM')).not.toBeInTheDocument());
    expect(screen.getByText('Beta Store')).toBeInTheDocument();
  });

  it('an empty-after-filter result shows the honest "no apps match" message', async () => {
    render(<AppsPanel />);
    await waitFor(() => expect(screen.getByText('Alpha CRM')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText(/Filter.*focuses/i), { target: { value: 'zzz-no-match' } });
    await waitFor(() => expect(screen.getByText(/No apps match the current filters/i)).toBeInTheDocument());
  });

  it('Build Your App: picking a template and deploying calls create() with that template and shows a success state', async () => {
    render(<AppsPanel />);
    await waitFor(() => expect(screen.getByText('Alpha CRM')).toBeInTheDocument());

    fireEvent.click(screen.getByText('E-Commerce'));
    fireEvent.change(screen.getByPlaceholderText('Enter your app name...'), { target: { value: 'My Shop' } });
    fireEvent.click(screen.getByRole('button', { name: /Deploy App/i }));

    await waitFor(() =>
      expect(appsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'My Shop',
          primitives: expect.objectContaining({ artifacts: { types: ['ecommerce'], schema: {} } }),
        }),
      ),
    );
    await waitFor(() => expect(screen.getByText(/Deployed Successfully!/i)).toBeInTheDocument());
  });

  it('Deploy App button is disabled until a build name is entered', async () => {
    render(<AppsPanel />);
    await waitFor(() => expect(screen.getByText('Alpha CRM')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Deploy App/i })).toBeDisabled();
  });
});
