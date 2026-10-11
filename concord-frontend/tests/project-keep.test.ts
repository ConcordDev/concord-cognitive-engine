import { describe, expect, it } from 'vitest';
import {
  projectDtuCall,
  projectSentence,
  projectThreadDraftCall,
  projectThreadDraftOutcome,
} from '@/components/projects/projectKeep';

const project = { id: 'prj_1', name: 'Bridge', key: 'BR', status: 'started', health: 'on_track' };

describe('project keep', () => {
  it('builds a private DTU and a Thread draft that cites it', () => {
    expect(projectSentence(project)).toBe('BR Bridge');
    const dtu = projectDtuCall(project);
    expect(dtu?.input.skipAutoTag).toBe(true);
    expect((dtu?.input.meta as { skipAutoTag?: boolean }).skipAutoTag).toBe(true);
    const draft = projectThreadDraftCall(project, 'dtu_9');
    expect(draft?.input.citedDtuId).toBe('dtu_9');
    expect(draft?.action).toBe('thread-draft');
    expect(projectThreadDraftCall(project, '')).toBeNull();
    expect(projectThreadDraftOutcome({
      ok: true,
      result: { draft: { id: 'dr_1', citedDtuId: 'dtu_9', status: 'draft' } },
    }, 'dtu_9')).toEqual({ draftId: 'dr_1', status: 'draft', citedDtuId: 'dtu_9' });
    expect(projectThreadDraftOutcome({ ok: false }, 'dtu_9')).toBeNull();
  });
});
