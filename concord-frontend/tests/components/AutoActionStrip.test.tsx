import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiGet = vi.fn();
const apiPost = vi.fn();

vi.mock('@/lib/api/client', () => ({
  api: { get: (...args: unknown[]) => apiGet(...args), post: (...args: unknown[]) => apiPost(...args) },
}));

vi.mock('lucide-react', async (importOriginal) => {
  const React = await import('react');
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props })
    );
    Icon.displayName = name;
    return Icon;
  };
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) {
    if (k[0] >= 'A' && k[0] <= 'Z' && k !== 'createLucideIcon' && k !== 'default') o[k] = make(k);
  }
  return { ...actual, ...o };
});

import { AutoActionStrip } from '@/components/lens/AutoActionStrip';

function renderWithClient(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

// Base action fixture shared across tests — one hinted, one unhinted.
const HINTED_ACTION = {
  action: 'compose_rule',
  desc: null,
  brain: null,
  isAi: false,
  isGenerative: false,
  isAnalysis: false,
  isLive: false,
  isCompute: true,
  fields: [
    { name: 'naturalLanguage', optional: false },
    { name: 'id', optional: true },
  ],
};

const UNHINTED_ACTION = {
  action: 'freeform_compute',
  desc: null,
  brain: null,
  isAi: false,
  isGenerative: false,
  isAnalysis: false,
  isLive: false,
  isCompute: true,
};

describe('AutoActionStrip', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiPost.mockResolvedValue({ data: { ok: true, result: 'done' } });
  });

  it('renders one button per discovered action', async () => {
    apiGet.mockResolvedValue({ data: { ok: true, domain: 'foundry', total: 2, actions: [HINTED_ACTION, UNHINTED_ACTION] } });
    renderWithClient(<AutoActionStrip domain="foundry" />);
    expect(await screen.findByText('Compose rule')).toBeInTheDocument();
    expect(screen.getByText('Freeform compute')).toBeInTheDocument();
  });

  it('hint-populated rows render as locked labels with required/optional markers', async () => {
    apiGet.mockResolvedValue({ data: { ok: true, domain: 'foundry', total: 1, actions: [HINTED_ACTION] } });
    renderWithClient(<AutoActionStrip domain="foundry" />);
    await screen.findByText('Compose rule');

    // The "{}" toggle button is the second button inside the action's span.
    fireEvent.click(screen.getByTitle('Edit input fields'));

    const form = await screen.findByTestId('auto-action-field-form');
    // Locked field labels (not inputs) for both hinted fields.
    expect(within(form).getByText('naturalLanguage')).toBeInTheDocument();
    expect(within(form).getByText('id')).toBeInTheDocument();
    // Required marker on naturalLanguage only.
    expect(within(form).getByTitle('required')).toBeInTheDocument();
    // No editable "field name" input for hinted rows.
    expect(within(form).queryByPlaceholderText('field')).not.toBeInTheDocument();
  });

  it('ad-hoc add-field flow works for an unhinted action and posts the built input', async () => {
    apiGet.mockResolvedValue({ data: { ok: true, domain: 'foundry', total: 1, actions: [UNHINTED_ACTION] } });
    renderWithClient(<AutoActionStrip domain="foundry" artifactId="art-1" />);
    await screen.findByText('Freeform compute');

    fireEvent.click(screen.getByTitle('Edit input'));
    const form = await screen.findByTestId('auto-action-field-form');

    // One ad-hoc row exists by default (unlocked rows default to optional); fill it in.
    fireEvent.change(within(form).getByPlaceholderText('field'), { target: { value: 'query' } });
    fireEvent.change(within(form).getByPlaceholderText('optional'), { target: { value: 'hello world' } });

    // Add a second ad-hoc row.
    fireEvent.click(within(form).getByText('+ Add field'));
    const fieldInputs = within(form).getAllByPlaceholderText('field');
    fireEvent.change(fieldInputs[1], { target: { value: 'limit' } });
    const valueInputs = within(form).getAllByPlaceholderText('optional');
    fireEvent.change(valueInputs[valueInputs.length - 1], { target: { value: '5' } });

    fireEvent.click(screen.getByText(/^Run Freeform compute$/));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/api/lens/foundry/art-1/run',
        expect.objectContaining({
          action: 'freeform_compute',
          input: { query: 'hello world', limit: 5 },
        }),
      );
    });
  });

  it('raw-JSON fallback still works and produces an equivalent onRun call', async () => {
    apiGet.mockResolvedValue({ data: { ok: true, domain: 'foundry', total: 1, actions: [UNHINTED_ACTION] } });
    renderWithClient(<AutoActionStrip domain="foundry" artifactId="art-2" />);
    await screen.findByText('Freeform compute');

    fireEvent.click(screen.getByTitle('Edit input'));
    fireEvent.click(screen.getByText('Advanced: raw JSON'));

    const textarea = screen.getByPlaceholderText('{"key": "value"}') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '{"foo": "bar", "n": 3}' } });
    fireEvent.click(screen.getByText(/^Run Freeform compute$/));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/api/lens/foundry/art-2/run',
        expect.objectContaining({
          action: 'freeform_compute',
          input: { foo: 'bar', n: 3 },
        }),
      );
    });
  });

  it('coerces booleans and numbers but leaves plain strings alone', async () => {
    apiGet.mockResolvedValue({ data: { ok: true, domain: 'foundry', total: 1, actions: [HINTED_ACTION] } });
    renderWithClient(<AutoActionStrip domain="foundry" artifactId="art-3" />);
    await screen.findByText('Compose rule');

    fireEvent.click(screen.getByTitle('Edit input fields'));
    const form = await screen.findByTestId('auto-action-field-form');

    fireEvent.change(within(form).getByPlaceholderText('required'), { target: { value: 'true' } });
    fireEvent.change(within(form).getByPlaceholderText('optional'), { target: { value: '42' } });

    fireEvent.click(screen.getByText(/^Run Compose rule$/));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/api/lens/foundry/art-3/run',
        expect.objectContaining({
          input: { naturalLanguage: true, id: 42 },
        }),
      );
    });
  });

  it('omits a blank optional field but keeps a filled required one', async () => {
    apiGet.mockResolvedValue({ data: { ok: true, domain: 'foundry', total: 1, actions: [HINTED_ACTION] } });
    renderWithClient(<AutoActionStrip domain="foundry" artifactId="art-4" />);
    await screen.findByText('Compose rule');

    fireEvent.click(screen.getByTitle('Edit input fields'));
    const form = await screen.findByTestId('auto-action-field-form');
    fireEvent.change(within(form).getByPlaceholderText('required'), { target: { value: 'make a sword' } });
    // leave the optional "id" field blank

    fireEvent.click(screen.getByText(/^Run Compose rule$/));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/api/lens/foundry/art-4/run',
        expect.objectContaining({
          input: { naturalLanguage: 'make a sword' },
        }),
      );
    });
  });
});
