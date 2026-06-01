// Sere frontend surfaces: the satire frame banner, the Ledger lens, and the
// registry entry. Structural pins (render verification needs a real GPU pass).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

describe('Sere satire frame banner', () => {
  const src = read('components/world/SereFrameBanner.tsx');
  it('reads the fiction provenance from the world frame endpoint', () => {
    expect(src).toMatch(/\/api\/worlds\/\$\{encodeURIComponent\(worldId\)\}\/frame/);
  });
  it('is one-time (dismissal persists per-world)', () => {
    expect(src).toMatch(/localStorage\.setItem\(`concord:frame-seen:\$\{worldId\}`/);
  });
  it('asserts the no-villain / no-real-names satire frame', () => {
    expect(src).toMatch(/no villain and no mastermind/);
    expect(src).toMatch(/never a claim about any real individual or organization/i);
  });
  it('is mounted in the world lens', () => {
    expect(read('app/lenses/world/page.tsx')).toMatch(/<SereFrameBanner worldId=/);
  });
});

describe('Ledger lens', () => {
  const src = read('app/lenses/ledger/page.tsx');
  it('reads the anomalies macro (the flows the Curtain hides)', () => {
    expect(src).toMatch(/lensRun\('ledger', 'anomalies'/);
  });
  it('renders both managed-parity and extraction-lien sections', () => {
    expect(src).toMatch(/data-testid="managed-parity"/);
    expect(src).toMatch(/data-testid="extraction-liens"/);
  });
  it('is registered in the lens registry', () => {
    expect(read('lib/lens-registry.ts')).toMatch(/id: 'ledger'.*path: '\/lenses\/ledger'/s);
  });
});
