/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error vitest/vite raw import
import src from './FeatureTreePanel.tsx?raw';

describe('FeatureTreePanel source contract', () => {
  it('exposes cert data-testids + feature types for authoring UI', () => {
    const text = String(src);
    for (const id of [
      'ck-feature-tree-panel',
      'ck-feature-tree-list',
      'ck-feature-tree-add-form',
      'ck-feature-tree-params-grid',
      'ck-feature-tree-type',
      'ck-feature-tree-add',
      'ck-feature-tree-undo',
      'ck-feature-tree-rebuild',
      'ck-feature-tree-rebuild-stats',
      'ck-feature-tree-rebuild-feedback',
      'ck-feature-tree-rebuild-phase',
      'ck-feature-tree-selection',
      'ck-feature-tree-honesty',
    ]) {
      expect(text).toContain(`data-testid="${id}"`);
    }
    for (const t of ['box', 'cylinder', 'extrude', 'cut', 'fillet', 'chamfer', 'shell', 'revolve', 'pattern', 'union']) {
      expect(text).toContain(`'${t}'`);
    }
    expect(text).toMatch(/PARAM_META/);
    expect(text).toMatch(/onSelectFeature/);
    expect(text).toMatch(/mintConkayArtifactDtu/);
    expect(text).toMatch(/not SolidWorks/i);
  });
});
