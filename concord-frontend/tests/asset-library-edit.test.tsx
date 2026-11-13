// FIX-ar-007 — "My Models" rows have an Edit control: it opens the
// model form prefilled, and saving calls useLensData.update with the
// model's id instead of creating a new entry.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const updateMock = vi.fn(async () => ({}));
const createMock = vi.fn(async () => ({}));

vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({
    items: [{
      id: 'mdl_1', title: 'Dragon',
      data: { name: 'Dragon', format: 'GLB', polyCount: 1200, fileSize: '4.2 MB', sourceUrl: '', description: 'A dragon' },
      meta: {},
    }],
    isLoading: false, isError: false, error: null,
    refetch: vi.fn(), create: createMock, update: updateMock, remove: vi.fn(async () => ({})),
  }),
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: () => ({ mutateAsync: vi.fn(async () => ({})) }),
}));
vi.mock('@/components/ar/SketchfabModels', () => ({
  SketchfabModels: () => null,
}));
vi.mock('@/components/ui', () => ({
  EmptyState: () => null,
  ErrorState: () => null,
}));

import { AssetLibrary } from '@/components/ar/AssetLibrary';

beforeEach(() => { updateMock.mockClear(); createMock.mockClear(); });
afterEach(() => cleanup());

describe('AssetLibrary model edit', () => {
  it('Edit opens the form prefilled; Save changes calls update, not create', async () => {
    render(<AssetLibrary onPreview={() => {}} />);
    const edit = await screen.findByRole('button', { name: 'Edit Dragon' });
    await act(async () => { fireEvent.click(edit); });
    const saveBtn = await screen.findByRole('button', { name: 'Save changes' });
    const nameInput = document.querySelectorAll('input')[0];
    expect((nameInput as HTMLInputElement).value).toBe('Dragon');
    await act(async () => { fireEvent.change(nameInput, { target: { value: 'Dragon II' } }); });
    await act(async () => { fireEvent.click(saveBtn); });
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock.mock.calls[0][0]).toBe('mdl_1');
    expect((updateMock.mock.calls[0][1] as { title: string }).title).toBe('Dragon II');
    expect(createMock).not.toHaveBeenCalled();
  });
});
