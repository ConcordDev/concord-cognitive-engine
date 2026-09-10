/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error vitest/vite raw import
import src from './ErpBomPanel.tsx?raw';

describe('ErpBomPanel source contract', () => {
  it('exposes cert data-testids + ERP honesty', () => {
    const text = String(src);
    for (const id of [
      'ck-erp-bom-panel',
      'ck-erp-bom-export-json',
      'ck-erp-bom-export-csv',
      'ck-erp-bom-table',
      'ck-erp-bom-rollup',
      'ck-erp-bom-filter',
      'ck-erp-bom-sort',
      'ck-erp-bom-selection',
      'ck-erp-bom-load-feedback',
      'ck-erp-bom-honesty',
    ]) {
      expect(text).toContain(`data-testid="${id}"`);
    }
    expect(text).toMatch(/mintConkayArtifactDtu/);
    expect(text).toMatch(/not SAP\/Oracle/i);
    expect(text).toMatch(/downloadErpBomCsv/);
  });
});
