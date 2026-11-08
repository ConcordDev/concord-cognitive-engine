// Linguistics build — FE pins + bracket-tree behaviour (S-LIN-2/3/4/6).
// Run: node --experimental-strip-types --test tests/linguistics-remainder.test.ts
// (vitest also picks this file up in the full FE run.)

import { test } from 'vitest';
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { parseBracketTree } from "../components/linguistics/linguistics-shared";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, "..", rel), "utf8");

test("parseBracketTree parses a balanced tree into nested nodes", () => {
  const out = parseBracketTree("[S [NP the fox] [VP sat]]");
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.root.label, "S");
  assert.equal(out.root.children.length, 2);
  assert.equal(out.root.children[0].label, "NP");
  assert.equal(out.root.children[0].word, "the fox");
  assert.equal(out.root.children[1].children.length, 0);
});

test("parseBracketTree refuses the pass's unbalanced probe, naming the position", () => {
  const out = parseBracketTree("[S [NP the fox");
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.match(out.error, /Unbalanced tree/);
  assert.match(out.error, /character \d+/);
});

test("parseBracketTree refuses trailing content after the tree closes", () => {
  const out = parseBracketTree("[S [NP the fox]] ]");
  assert.equal(out.ok, false);
});

test("NotebookPanel: the lifecycle is real (edit form, two-step delete, duplicate guard, receipts)", () => {
  const src = read("components/linguistics/NotebookPanel.tsx");
  assert.match(src, /const startEdit = /);
  assert.match(src, /editingId \? 'Save changes' : 'Create'/);
  assert.match(src, /already exists\. Rename it or edit the existing record\./);
  assert.match(src, /Delete \\u201c\{selected\.title\}\\u201d\?/);
  assert.match(src, /setNotice\(`Deleted /);
  assert.match(src, /parseBracketTree\(formSyntaxTree\)/);
});

test("NotebookPanel: dashboard panels are union-scoped and honestly named", () => {
  const src = read("components/linguistics/NotebookPanel.tsx");
  assert.match(src, /const allRecords = \[\.\.\.analyses, \.\.\.lexicon, \.\.\.grammars, \.\.\.corpora, \.\.\.translations\]/);
  assert.match(src, /Entries by Subfield/);
  assert.doesNotMatch(src, /Proficiency by Subfield/);
  assert.match(src, /label: 'Corpora', value: corpora\.length/);
  assert.match(src, /Member Texts \(\{selected\.data\.texts\.length\}\)/);
  assert.match(src, /TYPE_PLURALS/);
  assert.doesNotMatch(src, /toLowerCase\(\)\}s yet/);
});

test("Workbench + Word Tools + Quick Analysis honesty pins", () => {
  const panel = read("components/linguistics/LinguisticsActionPanel.tsx");
  assert.match(panel, /The mnemonic agent returned nothing this time/);
  assert.match(panel, /Content words only — stopwords/);
  assert.match(panel, /setTextResult\(null\); setSentimentResult\(null\); setFrequencyResult\(null\)/);
  const tools = read("components/linguistics/WordTools.tsx");
  assert.match(tools, /from your Lexicon/);
  assert.match(tools, /useLensData<LinguisticsArtifact>\('linguistics', 'LexiconEntry'/);
  const quick = read("components/linguistics/AnalyzePanel.tsx");
  assert.match(quick, /if \(!e\.target\.value\.trim\(\)\) setAnalyzeResult\(null\)/);
});
