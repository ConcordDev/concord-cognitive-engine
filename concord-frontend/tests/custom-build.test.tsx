/**
 * Custom lens build (B2) — source pins for S1–S5:
 *  S1/S2: no native dialogs remain in the Builder; create / binding /
 *         wiring / publish are in-page forms driven by state, and the
 *         page CTA dispatches the event the builder listens for.
 *  S3:    no surface claims publishing adds a main-sidebar entry.
 *  S4:    the Schema Designer sends every field (no pre-filter) and
 *         renders the macro's issues.
 *  S5:    the gist gallery always states the fetch time — cached or not.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) =>
  readFileSync(join(process.cwd(), rel), 'utf8');

const builder = read('components/custom/CanvasBuilder.tsx');
const page = read('app/lenses/custom/page.tsx');
const utils = read('components/custom/DataUtilities.tsx');
const gists = read('components/custom/PublicGistGallery.tsx');

describe('custom build — native dialogs are gone (S1/S2)', () => {
  it('CanvasBuilder makes no window.prompt / window.confirm calls', () => {
    expect(builder).not.toMatch(/window\.(prompt|confirm|alert)\s*\(/);
  });

  it('the create form is in-page state, opened by the New Lens button and the page event', () => {
    expect(builder).toContain('concord:custom-new-canvas');
    expect(builder).toContain('id="custom-new-canvas-name"');
    expect(builder).toContain("call<{ canvas: Canvas }>('canvasCreate', { name })");
    expect(page).toContain("new CustomEvent('concord:custom-new-canvas')");
  });

  it('canvas delete is a two-step in-page confirm, not window.confirm', () => {
    expect(builder).toContain('setConfirmDeleteId(c.id)');
    expect(builder).toContain('Delete “{c.name}”?');
  });

  it('the binding form renders from the Data Sources Add toggle with macro and rest fields', () => {
    expect(builder).toContain('setShowBindingForm');
    expect(builder).toContain('Create binding');
    expect(builder).toContain("input = { kind: 'rest', name, url }");
    expect(builder).toContain("input = { kind: 'macro', name, domain, macro }");
  });

  it('the wiring form renders in the inspector with a refresh-widget select', () => {
    expect(builder).toContain('setWiringDraft');
    expect(builder).toContain('Wire action');
    expect(builder).toContain('refreshWidgetId: wiringDraft.refreshWidgetId || undefined');
  });

  it('publish confirms through an inline label row', () => {
    expect(builder).toContain('id="custom-publish-label"');
    expect(builder).toContain('Recorded under Published lenses here');
  });
});

describe('custom build — copy and utility honesty (S3/S4/S5)', () => {
  it('the subtitle no longer promises the main sidebar (S3)', () => {
    expect(page).not.toContain('publish straight into the sidebar');
    expect(page).toContain('recorded under Published lenses here');
  });

  it('the Schema Designer sends every field and renders issues (S4)', () => {
    expect(utils).not.toContain('fields.filter((f) => f.name.trim())');
    expect(utils).toContain('schema: fields');
    expect(utils).toContain('result.issues');
  });

  it('the gist gallery states the fetch time for fresh data too (S5)', () => {
    expect(gists).toContain('silently stale list');
    expect(gists).toContain('Fetched {new Date(gists.data.fetchedAt)');
    expect(gists).toContain('Showing cached GitHub gists from');
  });
});
