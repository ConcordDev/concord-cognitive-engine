import { describe, expect, it } from 'vitest';
import { lensItemToTask, taskPatchToLensUpdate } from '@/components/board/board-shared';
import type { LensItem } from '@/lib/hooks/use-lens-data';

describe('board task title persistence', () => {
  it('sends a title edit as the artifact title, not only inside data', () => {
    const update = taskPatchToLensUpdate({ title: 'Renamed', description: 'note' });
    expect(update.title).toBe('Renamed');
    expect(update.data.title).toBe('Renamed');
    expect(update.data.description).toBe('note');
  });

  it('reads a title that was saved on the record data after reload', () => {
    const item = {
      id: 't1',
      title: 'Original',
      data: { title: 'Renamed', status: 'backlog' },
    } as LensItem<Record<string, unknown>>;
    expect(lensItemToTask(item).title).toBe('Renamed');
  });
});
