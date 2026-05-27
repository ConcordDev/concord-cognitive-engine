#!/usr/bin/env node
/**
 * replace-emoji-icons — swap inline emoji literals in JSX text for
 * <Icon name="..." /> using the EMOJI_TO_ICON registry.
 *
 * Opt-in per-component. Pass a file path as the first arg:
 *
 *     node scripts/replace-emoji-icons.mjs components/world/ActionWheel.tsx [--dry]
 *
 * The script only replaces emojis that appear inside JSX text children
 * (between `>` and `<`) or simple string literals exactly equal to a
 * single emoji. It is intentionally conservative: emojis embedded in
 * larger strings, inside template literals, or inside JS expressions
 * are left untouched.
 *
 * --dry      report changes without writing
 * --report   print which emojis would be replaced in this file
 */

import { readFile, writeFile, access } from 'node:fs/promises';
import { argv, exit } from 'node:process';

const args = argv.slice(2);
const dry = args.includes('--dry');
const report = args.includes('--report');
const target = args.find((a) => !a.startsWith('--'));

if (!target) {
  console.error('Usage: node scripts/replace-emoji-icons.mjs <component-path> [--dry] [--report]');
  exit(1);
}

const EMOJI_TO_ICON_SOURCE = await readFile(
  new URL('../components/icons/Icon.tsx', import.meta.url),
  'utf8',
);
const match = EMOJI_TO_ICON_SOURCE.match(/EMOJI_TO_ICON[^=]*=\s*\{([\s\S]*?)\};/);
if (!match) {
  console.error('Could not locate EMOJI_TO_ICON map in components/icons/Icon.tsx');
  exit(2);
}
const mapBody = match[1];
const ICON_MAP = {};
const entryRx = /'([^']+)'\s*:\s*'([^']+)'/g;
for (const m of mapBody.matchAll(entryRx)) {
  ICON_MAP[m[1]] = m[2];
}

try { await access(target); } catch {
  console.error(`File not found: ${target}`);
  exit(3);
}

const src = await readFile(target, 'utf8');
const replacements = [];
let out = src;

// 1. JSX text children: `>EMOJI<` → `><Icon name="X" /><`
//    Allow surrounding whitespace, also handle single-char text children
//    that are just an emoji.
for (const [emoji, name] of Object.entries(ICON_MAP)) {
  // Escape emoji for regex
  const eEsc = emoji.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Pattern: >\s*EMOJI\s*<
  const rx = new RegExp(`>(\\s*)${eEsc}(\\s*)<`, 'g');
  out = out.replace(rx, (_, pre, post) => {
    replacements.push({ emoji, name, kind: 'jsx-text' });
    return `>${pre}<Icon name="${name}" />${post}<`;
  });
  // Pattern: ={'EMOJI'} or ="EMOJI"
  const propRx = new RegExp(`(['"\`])${eEsc}\\1`, 'g');
  out = out.replace(propRx, (full) => {
    // Only replace if it's a single-emoji string. Don't touch multi-char.
    if (full.length === emoji.length + 2) {
      replacements.push({ emoji, name, kind: 'string-literal' });
      return `'icon:${name}'`; // sentinel that the caller can render
    }
    return full;
  });
}

// 2. Inject `import { Icon } from '@/components/icons';` if any JSX
//    replacement happened and Icon isn't already imported.
const usedJsxIcon = replacements.some((r) => r.kind === 'jsx-text');
if (usedJsxIcon && !/from\s+['"]@\/components\/icons['"]/.test(out)) {
  // Insert after the last top-level import line.
  const lines = out.split('\n');
  let lastImport = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^import\s/.test(lines[i])) lastImport = i;
  }
  const newImport = `import { Icon } from '@/components/icons';`;
  if (lastImport >= 0) {
    lines.splice(lastImport + 1, 0, newImport);
  } else {
    lines.unshift(newImport);
  }
  out = lines.join('\n');
}

if (report) {
  if (replacements.length === 0) {
    console.log(`${target}: no replaceable emojis`);
  } else {
    console.log(`${target}: ${replacements.length} replacements`);
    for (const r of replacements) console.log(`  ${r.emoji} → ${r.name}  (${r.kind})`);
  }
  exit(0);
}

if (dry) {
  console.log(`[dry] ${target}: ${replacements.length} replacements would be made`);
  exit(replacements.length > 0 ? 0 : 0);
}

if (replacements.length === 0) {
  console.log(`${target}: nothing to do`);
  exit(0);
}

await writeFile(target, out, 'utf8');
console.log(`${target}: ${replacements.length} replacements written`);
