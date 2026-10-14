import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import {
  UploadSourcePanel,
  humanUploadError,
} from '@/components/expert-mode/UploadSourcePanel';

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (_domain: string, action: string) => {
    if (action === 'upload_list') {
      return { data: { ok: true, result: { uploads: [], total: 0 } } };
    }
    return { data: { ok: false, result: null, error: 'service_overloaded' } };
  });
});

describe('humanUploadError (expert-mode F2)', () => {
  it('maps service_overloaded to a human busy message', () => {
    expect(humanUploadError('service_overloaded')).toMatch(/Server is busy/i);
    expect(humanUploadError('service_overloaded')).not.toMatch(/service_overloaded/);
  });

  it('maps event_loop_lag_critical shaped codes without echoing them', () => {
    expect(humanUploadError('event_loop_lag_critical')).toMatch(/busy/i);
    expect(humanUploadError('busy_retry')).toMatch(/retry/i);
  });
});

describe('UploadSourcePanel busy failure (expert-mode F2)', () => {
  it('shows a human message, keeps the paste, and leaves retry available', async () => {
    const onSelect = vi.fn();
    render(<UploadSourcePanel selectedId={null} onSelect={onSelect} />);

    await waitFor(() => {
      expect(lensRunMock).toHaveBeenCalledWith('expert_mode', 'upload_list', {});
    });

    fireEvent.click(screen.getByRole('button', { name: /Add/i }));
    const paste = 'Sweep document. The sweep token is MAGENTA-ORCHID-kznt. End of extract.';
    fireEvent.change(screen.getByPlaceholderText(/Paste the extracted/i), {
      target: { value: paste },
    });
    fireEvent.change(screen.getByPlaceholderText(/Document name/i), {
      target: { value: 'Sweep source 20261014' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Store as source/i }));

    await waitFor(() => {
      expect(screen.getByText(/Server is busy right now/i)).toBeTruthy();
    });
    expect(screen.queryByText('service_overloaded')).toBeNull();
    expect((screen.getByPlaceholderText(/Paste the extracted/i) as HTMLTextAreaElement).value).toBe(paste);
    expect((screen.getByPlaceholderText(/Document name/i) as HTMLInputElement).value).toBe(
      'Sweep source 20261014',
    );
    expect(screen.getByRole('button', { name: /Store as source/i })).toBeTruthy();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
