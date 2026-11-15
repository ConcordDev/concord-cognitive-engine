/**
 * FIX-bio-002 — a valid 39 bp sequence with a clean ATG…TGA frame
 * reported 'ORFs 0' with no explanation: the finder defaults to a
 * 90 nt floor and the analyze result never stated it (the codebase's
 * own doctrine: a silent floor is a half-kept promise — the plasmid
 * path already states its floor). sequence-analyze now returns
 * orfMinNt from the same constant the finder defaults to, and the
 * Analyzer words the floor when zero ORFs come back.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-bio-002 — the ORF floor is stated', () => {
  const server = read('../server/domains/bio.js');
  const fe = read('components/bio/SequenceAnalyzer.tsx');

  it('the server returns the floor from the finder default constant', () => {
    expect(server).toContain('const ORF_MIN_NT_DEFAULT = 90;');
    expect(server).toContain('function findOrfs(seq, minOrfNt = ORF_MIN_NT_DEFAULT)');
    expect(server).toContain('result.orfMinNt = ORF_MIN_NT_DEFAULT');
  });

  it('the analyzer words the floor on a zero-ORF result', () => {
    expect(fe).toContain('orfMinNt?: number;');
    expect(fe).toContain('analysis.orfs.length === 0 && analysis.orfMinNt !== undefined');
    expect(fe).toContain('frames shorter than {analysis.orfMinNt} nt are not reported');
  });
});
