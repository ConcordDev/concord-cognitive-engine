/**
 * lens-manifest — ESLint rule plugin for Concord lens chrome consistency.
 *
 * Provides three rules:
 *   - lens-shell-id-matches-path: <LensShell lensId="x"> in
 *     app/lenses/<id>/page.tsx must have lensId === <id> (kebab/snake/camel
 *     normalised so lens dirs and lensId props can disagree on case).
 *   - lens-page-uses-shell: every page.tsx under app/lenses/<id>/ must
 *     mount <LensShell> (or re-export from a wrapper that does).
 *   - lens-id-is-known: <LensShell lensId="x"> must reference a domain
 *     present in LENS_MANIFEST_INDEX (loaded at lint time from
 *     concord-frontend/lib/lenses/manifest.ts).
 *
 * The plugin is consumed by eslint.config.mjs via `plugins.lensManifest`
 * and rule-key `lensManifest/<rule-name>`.
 */
'use strict';

// ESLint plugin loader is CJS — require() is the correct shape here.
/* eslint-disable @typescript-eslint/no-require-imports */
const path = require('path');
const fs = require('fs');
/* eslint-enable @typescript-eslint/no-require-imports */

// ── Manifest index loader ────────────────────────────────────────────────────
//
// We can't import the .ts manifest file from a CJS rule, so we extract the
// known lens-id list at lint time by parsing LENS_MANIFESTS entries with a
// regex. Cheap enough to run on every lint pass given the file is one
// big array literal.

let cachedIndex = null;
let cachedAt = 0;
const INDEX_TTL_MS = 5_000;

function loadKnownLensIds(rootDir) {
  const now = Date.now();
  if (cachedIndex && now - cachedAt < INDEX_TTL_MS) return cachedIndex;
  const manifestPath = path.join(rootDir, 'lib/lenses/manifest.ts');
  if (!fs.existsSync(manifestPath)) {
    cachedIndex = new Set();
    cachedAt = now;
    return cachedIndex;
  }
  try {
    const src = fs.readFileSync(manifestPath, 'utf8');
    const ids = new Set();
    const re = /domain:\s*['"]([a-z0-9_-]+)['"]/gi;
    let m;
    while ((m = re.exec(src)) !== null) ids.add(m[1]);
    cachedIndex = ids;
    cachedAt = now;
    return ids;
  } catch {
    cachedIndex = new Set();
    cachedAt = now;
    return cachedIndex;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function normaliseId(id) {
  return id.toLowerCase().replace(/[-_\s]+/g, '');
}

function lensDirForFile(filename) {
  const norm = filename.replace(/\\/g, '/');
  const m = norm.match(/\/app\/lenses\/([^/]+)\/(?:[^/]+\/)*page\.tsx$/);
  return m ? m[1] : null;
}

function getLensShellLensIdAttr(node) {
  if (!node.openingElement) return null;
  const name = node.openingElement.name;
  if (!name || name.type !== 'JSXIdentifier' || name.name !== 'LensShell') {
    return null;
  }
  const attr = node.openingElement.attributes.find(
    (a) =>
      a.type === 'JSXAttribute' &&
      a.name &&
      a.name.type === 'JSXIdentifier' &&
      a.name.name === 'lensId'
  );
  return attr || null;
}

function readStringLiteral(attr) {
  if (!attr || !attr.value) return null;
  if (attr.value.type === 'Literal' && typeof attr.value.value === 'string') {
    return attr.value.value;
  }
  if (
    attr.value.type === 'JSXExpressionContainer' &&
    attr.value.expression.type === 'Literal' &&
    typeof attr.value.expression.value === 'string'
  ) {
    return attr.value.expression.value;
  }
  return null;
}

// ── Rule: lens-shell-id-matches-path ─────────────────────────────────────────

const lensShellIdMatchesPath = {
  meta: {
    type: 'problem',
    docs: {
      description:
        '<LensShell lensId="…"> in app/lenses/<dir>/page.tsx must match the directory.',
    },
    schema: [],
    messages: {
      mismatch:
        '<LensShell lensId="{{used}}"> does not match its directory "{{dir}}". Use lensId="{{dir}}" or rename the directory.',
      missingId:
        '<LensShell> requires a static string lensId prop matching the lens directory.',
    },
  },
  create(context) {
    const filename = context.getFilename();
    const dir = lensDirForFile(filename);
    if (!dir) return {};
    return {
      JSXElement(node) {
        const attr = getLensShellLensIdAttr(node);
        if (!attr) return;
        const value = readStringLiteral(attr);
        if (!value) {
          context.report({ node: attr, messageId: 'missingId' });
          return;
        }
        if (normaliseId(value) !== normaliseId(dir)) {
          context.report({
            node: attr,
            messageId: 'mismatch',
            data: { used: value, dir },
          });
        }
      },
    };
  },
};

// ── Rule: lens-page-uses-shell ───────────────────────────────────────────────

const lensPageUsesShell = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Every app/lenses/<id>/page.tsx must mount <LensShell> for substrate plumbing.',
    },
    schema: [],
    messages: {
      missing:
        'app/lenses/{{dir}}/page.tsx does not mount <LensShell>. Wrap the lens body in <LensShell lensId="{{dir}}">.',
    },
  },
  create(context) {
    const filename = context.getFilename();
    const dir = lensDirForFile(filename);
    if (!dir) return {};
    let foundShell = false;
    let programNode = null;
    return {
      Program(node) {
        programNode = node;
      },
      JSXElement(node) {
        const name = node.openingElement && node.openingElement.name;
        if (
          name &&
          name.type === 'JSXIdentifier' &&
          name.name === 'LensShell'
        ) {
          foundShell = true;
        }
      },
      'Program:exit'() {
        if (!foundShell && programNode) {
          context.report({
            node: programNode,
            messageId: 'missing',
            data: { dir },
          });
        }
      },
    };
  },
};

// ── Rule: lens-id-is-known ───────────────────────────────────────────────────

const lensIdIsKnown = {
  meta: {
    type: 'problem',
    docs: {
      description:
        '<LensShell lensId="…"> must reference a domain in LENS_MANIFESTS (lib/lenses/manifest.ts).',
    },
    schema: [
      {
        type: 'object',
        properties: { rootDir: { type: 'string' } },
        additionalProperties: false,
      },
    ],
    messages: {
      unknown:
        'lensId "{{used}}" is not in LENS_MANIFESTS. Add a manifest entry in lib/lenses/manifest.ts or correct the id.',
    },
  },
  create(context) {
    const opts = (context.options && context.options[0]) || {};
    const rootDir = opts.rootDir || process.cwd();
    return {
      JSXElement(node) {
        const attr = getLensShellLensIdAttr(node);
        if (!attr) return;
        const value = readStringLiteral(attr);
        if (!value) return;
        const known = loadKnownLensIds(rootDir);
        // If the manifest file is unreadable / empty, do not report — fail open.
        if (!known || known.size === 0) return;
        if (!known.has(value) && !known.has(value.toLowerCase())) {
          context.report({
            node: attr,
            messageId: 'unknown',
            data: { used: value },
          });
        }
      },
    };
  },
};

module.exports = {
  rules: {
    'lens-shell-id-matches-path': lensShellIdMatchesPath,
    'lens-page-uses-shell': lensPageUsesShell,
    'lens-id-is-known': lensIdIsKnown,
  },
};
