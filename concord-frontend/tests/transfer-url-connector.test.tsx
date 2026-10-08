/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRunMock(...a) }));

import { EtlWorkbench } from '@/components/transfer/EtlWorkbench';

beforeEach(() => { lensRunMock.mockReset(); });

describe('EtlWorkbench — URL source connector', () => {
  it('creates a URL connector, fetches it, and reports a failed fetch honestly', async () => {
    const calls: [string, Record<string, unknown>][] = [];
    lensRunMock.mockImplementation((_d: string, name: string, input: Record<string, unknown>) => {
      calls.push([name, input]);
      if (name === 'connector-upsert') return Promise.resolve({ data: { ok: true, result: { connector: { id: 'c1', name: 'remote', role: 'source', kind: 'url' } } } });
      if (name === 'connector-refresh') return Promise.resolve({ data: { ok: false, error: 'Fetch failed: HTTP 404' } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    await act(async () => { render(<EtlWorkbench />); });
    fireEvent.change(screen.getByPlaceholderText('Connector name…'), { target: { value: 'remote' } });
    fireEvent.change(screen.getByLabelText('Connector kind'), { target: { value: 'url' } });
    fireEvent.change(screen.getByLabelText('Source URL'), { target: { value: 'https://data.example/a.csv' } });
    await act(async () => { fireEvent.click(screen.getByText('Register connector')); });
    await waitFor(() => expect(calls.some(([n]) => n === 'connector-refresh')).toBe(true));
    expect(calls.find(([n]) => n === 'connector-upsert')![1]).toMatchObject({ kind: 'url', url: 'https://data.example/a.csv', format: 'csv', role: 'source' });
    expect(await screen.findByText(/saved, but the fetch failed: Fetch failed: HTTP 404/)).toBeInTheDocument();
  });
});
