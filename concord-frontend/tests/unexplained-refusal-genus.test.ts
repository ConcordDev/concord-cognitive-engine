/**
 * Unexplained-refusal genus guard (CB-0479) — FIX-translation-006,
 * FIX-wellness-007, FIX-move-builder-013, FIX-schema-003,
 * FIX-app-maker-006, FIX-atlas-006, FIX-philosophy-004, FIX-sports-003.
 *
 * Each surface refused, failed, or sat disabled with no message saying
 * why: Translate buttons disabled on empty input, a goal create whose
 * result was never checked, a Mint disabled by a blank name nobody
 * named, a schema create that returned in silence, a project create
 * with no error state at all, a place form that alerted a raw token,
 * curation buttons disabled until filled with no hint, and junk scores
 * silently discarded on save. The pins hold the words each surface
 * now says at the point of refusal.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel: string) =>
  fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

describe('translation-006: empty input says what the disabled button needs', () => {
  const src = read('components/translation/TranslationPanels.tsx');
  it('both translate panels hint at the point of refusal', () => {
    expect(src).toContain('Enter text to translate.');
    expect(src).toContain('Add at least one line to translate.');
  });
});

describe('wellness-007: a goal create checks its length and its result', () => {
  const src = read('components/wellness/WellnessSection.tsx');
  it('over-length names and refused creates speak', () => {
    expect(src).toContain('Goal names can be up to 200 characters');
    expect(src).toContain("action: 'goals-create'");
    expect(src).toContain('That goal could not be created.');
  });
});

describe('move-builder-013: a blank name is named as the Mint blocker', () => {
  const src = read('components/move-builder/ComposePanel.tsx');
  it('the hint sits beside the Mint button', () => {
    expect(src).toContain('Name the move to mint it.');
  });
});

describe('schema-003: blank and failed schema creates speak', () => {
  const src = read('components/database/SchemaDesigner.tsx');
  it('both refusal paths use the say() channel', () => {
    expect(src).toContain('Name the schema first — Add needs a name to create it.');
    expect(src).toContain('Schema not created');
  });
});

describe('app-maker-006: a refused project create shows its reason and limit', () => {
  const src = read('components/app-maker/AppBuilderStudio.tsx');
  it('the create path has an error line, a cap, and a counter', () => {
    expect(src).toContain('Project names can be up to 200 characters');
    expect(src).toContain('createError');
    expect(src).toContain('maxLength={200}');
  });
});

describe('atlas-006: the place form refuses in words, never a raw token', () => {
  const src = read('components/atlas/AtlasSection.tsx');
  it('blank, latitude, longitude, and invalid_input all speak', () => {
    expect(src).toContain('A place needs a name, a latitude and a longitude');
    expect(src).toContain('Latitude must be a number between -90 and 90.');
    expect(src).toContain('Longitude must be a number between -180 and 180.');
    expect(src).toContain('The server could not use those details');
  });
});

describe('philosophy-004: disabled curation/channel buttons state their requirement', () => {
  const channels = read('components/philosophy/PhilosophyChannels.tsx');
  const curation = read('components/philosophy/PhilosophyCuration.tsx');
  it('each create-class form hints while its requirement is unmet', () => {
    expect(channels).toContain('Give the channel a title to create it.');
    expect(curation).toContain('Add an image URL and a caption to add the image.');
    expect(curation).toContain('Enter a Wikipedia article title to embed it.');
  });
});

describe('sports-003: junk scores refuse in words instead of saving scoreless', () => {
  const src = read('components/sports/SportsMatchesPanel.tsx');
  it('unusable score text is named before the save', () => {
    expect(src).toContain("Scores must be whole numbers of 0 or more");
    expect(src).toContain("pair.kind === 'blank'");
  });
});
