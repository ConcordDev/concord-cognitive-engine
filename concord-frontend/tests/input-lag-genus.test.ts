/**
 * CB-0452 guard: the input-lag genus fixes. Typing state must live in the
 * smallest component that uses it, and a post-save refresh must not
 * unmount the surface it refreshes.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('input-lag genus (CB-0452)', () => {
  it('DM composer owns its draft; the inbox holds none', () => {
    const src = read('components/social/feed/DMInbox.tsx');
    expect(src).toContain('function DMComposer');
    expect(src).toContain('<DMComposer onSend={send} sending={sending} />');
    const parent = src.slice(0, src.indexOf('function DMComposer'));
    expect(parent).not.toContain('const [draft, setDraft]');
  });

  it('healthcare chart refreshes silently after mutations and the draft forms are extracted', () => {
    const src = read('components/healthcare/PatientChartPanel.tsx');
    expect(src).toContain('async function refresh(silent = false)');
    expect(src).toContain('if (!silent) setLoading(true)');
    expect(src).toContain('function ProblemDraftForm');
    expect(src).toContain('function AllergyDraftForm');
    const parent = src.slice(0, src.indexOf('function ProblemDraftForm'));
    expect(parent).not.toContain('const [problemDraft, setProblemDraft]');
    expect(parent).not.toContain('const [allergyDraft, setAllergyDraft]');
  });

  it('photos album + caption forms own their text locally', () => {
    const src = read('app/lenses/photos/page.tsx');
    expect(src).toContain('function CreateAlbumForm');
    expect(src).toContain('function CaptionEditForm');
    expect(src).not.toContain('const [newAlbum, setNewAlbum]');
    expect(src).not.toContain('const [editText, setEditText]');
  });
});
