// @vitest-environment node
//
// This file is pure-logic (real fflate zip/unzip round trips + static
// source pins) with no DOM interaction, so it's pinned to the `node`
// environment rather than the project default `jsdom`. That's not
// incidental: under jsdom, fflate's internal `instanceof Uint8Array`
// check (used by zipSync's `fltn` flattener) silently fails, because
// jsdom's realm provides its own `Uint8Array` global distinct from
// Node's — `bytes instanceof Uint8Array` is false even though
// `bytes.constructor.name === 'Uint8Array'`. zipSync then treats every
// entry as unrecognised and produces an empty archive with NO error,
// which would have been a nasty silent-failure trap in production if it
// reached the browser bundle. It doesn't: real browsers have exactly one
// Uint8Array realm, so the component code (which vitest's jsdom
// environment cannot faithfully emulate for this specific check) is
// unaffected — only this cross-realm test-runner artifact is.
import { describe, it, expect } from 'vitest';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { dedupeFilenames } from '@/components/export/ObsidianVaultExport';

// Wave 4 gap-closure — export-capability-map.md: `export.obsidian` is a
// real backend macro (one Markdown note per DTU, YAML frontmatter,
// [[wikilink]] lineage) that had no frontend because packing many files
// into one downloadable archive needs a zip library. fflate is already a
// real, resolved dependency in this app (transitive via @react-three/drei
// -> three-stdlib and @types/three — see package-lock.json), so this test
// exercises the REAL fflate zipSync/unzipSync round trip against a small
// in-memory set of {filename, content} pairs shaped exactly like what
// export.obsidian returns, and independently verifies the raw ZIP magic
// number on the produced bytes. No mocking of fflate anywhere in this file.

describe('Obsidian vault export — real fflate zip round trip', () => {
  const sampleFiles = [
    {
      filename: 'First Note.md',
      content: [
        '---',
        'id: dtu-1',
        'tier: regular',
        'tags: ["alpha", "beta"]',
        'created: 2026-01-01T00:00:00.000Z',
        '---',
        '',
        '# First Note',
        '',
        'A summary of the first note.',
        '',
        '## Lineage',
        '- [[dtu-0]]',
      ].join('\n'),
    },
    {
      filename: 'Second Note.md',
      content: [
        '---',
        'id: dtu-2',
        'tier: mega',
        'tags: []',
        'created: 2026-01-02T00:00:00.000Z',
        '---',
        '',
        '# Second Note',
        '',
        'A summary of the second note, referencing [[dtu-1]].',
      ].join('\n'),
    },
  ];

  it('produces bytes with a genuine ZIP local-file-header magic number (PK\\x03\\x04)', () => {
    const input: Record<string, Uint8Array> = {};
    for (const f of sampleFiles) input[f.filename] = strToU8(f.content);

    const zipped = zipSync(input, { level: 6 });

    expect(zipped).toBeInstanceOf(Uint8Array);
    expect(zipped.length).toBeGreaterThan(0);
    // ZIP local file header signature: 0x50 0x4B 0x03 0x04 ("PK\x03\x04").
    expect(Array.from(zipped.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it('round-trips through fflate unzipSync with byte-for-byte content equality', () => {
    const input: Record<string, Uint8Array> = {};
    for (const f of sampleFiles) input[f.filename] = strToU8(f.content);

    const zipped = zipSync(input, { level: 6 });
    const unzipped = unzipSync(zipped);

    expect(Object.keys(unzipped).sort()).toEqual(sampleFiles.map((f) => f.filename).sort());
    for (const f of sampleFiles) {
      expect(strFromU8(unzipped[f.filename])).toBe(f.content);
    }
  });

  it('preserves frontmatter and [[wikilink]] syntax exactly through the zip round trip', () => {
    const input: Record<string, Uint8Array> = {};
    for (const f of sampleFiles) input[f.filename] = strToU8(f.content);
    const unzipped = unzipSync(zipSync(input));

    const first = strFromU8(unzipped['First Note.md']);
    expect(first).toMatch(/^---\nid: dtu-1\n/);
    expect(first).toContain('- [[dtu-0]]');

    const second = strFromU8(unzipped['Second Note.md']);
    expect(second).toContain('[[dtu-1]]');
  });

  it('rejects garbage bytes as not a valid zip (negative control on the magic-number check)', () => {
    const notAZip = strToU8('this is definitely not a zip file');
    expect(Array.from(notAZip.slice(0, 4))).not.toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(() => unzipSync(notAZip)).toThrow();
  });
});

describe('dedupeFilenames — collision-safe before handing to zipSync', () => {
  it('leaves unique filenames untouched', () => {
    const files = [
      { filename: 'A.md', content: 'a' },
      { filename: 'B.md', content: 'b' },
    ];
    expect(dedupeFilenames(files)).toEqual(files);
  });

  it('suffixes duplicate filenames so no two entries collide, and zipSync keeps both', () => {
    const files = [
      { filename: 'Same Title.md', content: 'first' },
      { filename: 'Same Title.md', content: 'second' },
      { filename: 'Same Title.md', content: 'third' },
    ];
    const deduped = dedupeFilenames(files);

    expect(deduped.map((f) => f.filename)).toEqual([
      'Same Title.md',
      'Same Title (1).md',
      'Same Title (2).md',
    ]);
    // Filenames are now unique keys, so zipSync (which is keyed by path)
    // cannot silently drop any of the three notes on the floor.
    expect(new Set(deduped.map((f) => f.filename)).size).toBe(3);

    const input: Record<string, Uint8Array> = {};
    for (const f of deduped) input[f.filename] = strToU8(f.content);
    const unzipped = unzipSync(zipSync(input));

    expect(Object.keys(unzipped)).toHaveLength(3);
    expect(strFromU8(unzipped['Same Title.md'])).toBe('first');
    expect(strFromU8(unzipped['Same Title (1).md'])).toBe('second');
    expect(strFromU8(unzipped['Same Title (2).md'])).toBe('third');
  });

  it('handles filenames with no extension', () => {
    const files = [
      { filename: 'NoExt', content: 'x' },
      { filename: 'NoExt', content: 'y' },
    ];
    const deduped = dedupeFilenames(files);
    expect(deduped.map((f) => f.filename)).toEqual(['NoExt', 'NoExt (1)']);
  });
});

// The former "ObsidianVaultExport component — real backend wiring" describe
// block that used to live here (source-string regex pins against the
// component file) was a stale-lying-test-detector finding: this file is
// pinned to `@vitest-environment node` for the fflate cross-realm reason
// explained above, which rules out rendering the real React component (that
// needs jsdom). Those 4 claims now live in
// tests/obsidian-vault-export-panel.test.tsx instead, driven through a real
// render + fireEvent + button click with `lensRun` mocked at the network
// boundary and `fflate`'s zipSync wrapped as a pass-through spy around the
// REAL implementation (imported via `importOriginal`) — see that file for
// the "imports the real fflate primitives" / "calls the real export.obsidian
// macro" / "honestly reports an empty corpus" / "never truncates the DTU
// set" assertions, now proven at runtime rather than by regexing source
// text.
