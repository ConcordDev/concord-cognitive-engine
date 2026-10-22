import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import fs from 'node:fs';
import path from 'node:path';

describe('FirstRunTour', () => {
  it('renders nothing', () => {
    const { container } = render(<FirstRunTour lensId="social" force />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is not imported or mounted under app/lenses or components (except itself)', () => {
    const roots = [
      path.join(process.cwd(), 'app'),
      path.join(process.cwd(), 'components'),
    ];
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name);
        const st = fs.statSync(p);
        if (st.isDirectory()) {
          walk(p);
          continue;
        }
        if (!/\.(tsx|ts|jsx|js)$/.test(name)) continue;
        if (p.endsWith(`${path.sep}FirstRunTour.tsx`)) continue;
        const text = fs.readFileSync(p, 'utf8');
        if (text.includes("from '@/components/lens/FirstRunTour'") || /<FirstRunTour\b/.test(text)) {
          hits.push(p);
        }
      }
    };
    for (const root of roots) walk(root);
    expect(hits).toEqual([]);
  });
});
