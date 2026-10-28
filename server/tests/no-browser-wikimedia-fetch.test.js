// Pins phase 8c: the Wikipedia / Wikidata / Commons widgets read through the server's
// public-lookup domain (shared feed-cache), never straight from the browser. A browser-side
// fetch() to these hosts would bypass the shared cache + User-Agent + budgets again.
//
// StackExchange and HN Algolia widgets are intentionally NOT listed yet (phase 8c-2).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "concord-frontend", "components");

const MIGRATED = [
  "deities/PantheonExplorer.tsx", "carpentry/WoodSpeciesReference.tsx", "organ/AnatomyExplorer.tsx",
  "psyops/PsyopsReference.tsx", "kingdoms/HistoryExplorer.tsx", "personas/CharacterStudio.tsx",
  "suffering/SufferingRef.tsx", "goddess/GoddessGallery.tsx", "consulting/ConsultingFirmReference.tsx",
  "genesis/OriginExplorer.tsx", "timeline/TimelineWiki.tsx", "event-timeline/OnThisDay.tsx",
  "entity/WikidataSearch.tsx", "entity/KnowledgeGraphWorkbench.tsx", "artistry/WikimediaArt.tsx",
];

const HOST_RE = /(wikipedia\.org|wikidata\.org|commons\.wikimedia\.org)/;

describe("phase 8c: migrated widgets do not fetch Wikimedia hosts from the browser", () => {
  for (const rel of MIGRATED) {
    it(rel, () => {
      const src = fs.readFileSync(path.join(root, rel), "utf8");
      // any fetch( call whose argument text (up to the closing paren on that line) names a Wikimedia host
      for (const line of src.split("\n")) {
        if (/\bfetch\s*\(/.test(line)) assert.ok(!HOST_RE.test(line), `${rel}: browser fetch to a Wikimedia host: ${line.trim()}`);
      }
      assert.ok(!/\bfetch\s*\(\s*`?https?:\/\/[^)]*(wikipedia|wikidata|wikimedia)/.test(src), `${rel}: direct host fetch`);
      assert.match(src, /@\/lib\/public-lookup/, `${rel} should read through the public-lookup client`);
      assert.match(src, /LookupNotice/, `${rel} should show the CC BY-SA attribution`);
    });
  }
});
