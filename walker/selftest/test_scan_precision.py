#!/usr/bin/env python3
"""GB-1580 items 1-3 + 5 — dossier scoring precision, unit-level.

Fixtures: the music device-transfer non-money case; a real purchase
span (money semantics, no ledger) still flags; shuffle randomness
vetoed while textual fabrication still flags; an actorId-guarded
write passes while an unguarded one flags; a frontend-called but
walk-untriggered action is walk-hidden yet NOT uncalled; the score
split (scan-only flags cannot zero a clean-live lens; the security
gate fails on a trust finding, not on scan flags).

Run: python3 selftest/test_scan_precision.py
"""
import os, sys
from collections import OrderedDict

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
from concord_walker import dossier

FAILS = []


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name +
          ((" " + str(extra)[:300]) if extra and not cond else ""))
    if not cond:
        FAILS.append(name)


class FakeTree:
    def __init__(self, files):
        self.files = files

    def ls(self, prefix):
        return sorted(p for p in self.files if p.startswith(prefix))

    def read(self, path):
        return self.files.get(path)


def kinds(tree, slug, domains):
    scan = dossier._code_scan(tree, slug, domains, [])
    return sorted(f["kind"] for f in scan["flags"])


def main():
    # -- item 1: money semantics -------------------------------------------
    music = FakeTree({"server/domains/music.js": """
registerLensAction("music", "device-transfer", async (ctx, args) => {
  const session = getSession(args.deviceId);
  return movePlayback(session, args.targetDevice);
});
registerLensAction("music", "buyTrack", async (ctx, args) => {
  const price = args.price; const amount = price;
  return { ok: true, charged: amount };
});
"""})
    k = kinds(music, "music", ["music"])
    check("device-transfer (no money semantics) does not flag money",
          k.count("money_action_without_ledger_call") == 1, k)

    # -- item 1: fabricated_data veto extension -----------------------------
    fab = FakeTree({"server/domains/x.js": """
const order = shuffle(queue, Math.random());
const wait = baseDelay * Math.random() + jitter;
const fakeData = [{ id: 1, name: "x" }];
const seed = Math.random();
"""})
    k = kinds(fab, "x", ["x"])
    check("shuffle/jitter randomness vetoed; textual + bare data random flag",
          k == ["fabricated_data", "fabricated_data"], k)

    # -- item 1: actor-identity guard counts as an owner check --------------
    guarded = FakeTree({"server/domains/y.js": """
registerLensAction("y", "saveThing", async (ctx, args) => {
  const me = actorId(ctx);
  return store.save(me, args.payload);
});
registerLensAction("y", "updateThing", async (ctx, args) => {
  return store.update(args.payload);
});
"""})
    k = kinds(guarded, "y", ["y"])
    check("actorId-guarded write passes; unguarded write flags",
          k == ["write_without_owner_check"], k)

    # -- item 1: raw_fetch judged on host control ----------------------------
    fetch = FakeTree({"server/domains/f.js": """
const a = await fetch(`${MACROSTRAT_API}/units?lat=${lat}`);
const b = await fetch(`https://api.stripe.com/v1${path}`);
const g = await fetch(`https://api.artic.edu/api/v1/artworks/search?q=x&query[term][is_public_domain]=true&fields=id,title&limit=${limit}`);
registerLensAction("f", "readFeed", async (ctx, args) => {
  const url = args.feedUrl;
  const c = await fetch(url);
  const d = await fetch(args.direct);
  const e = await fetch(mystery);
});
"""})
    fk = [f for f in dossier._code_scan(fetch, "f", ["f"], [])["flags"]
          if f["kind"] == "raw_fetch_user_url"]
    check("fixed-host fetches pass; input-traced + untraceable flag (3)",
          len(fk) == 3, fk)

    # -- item 2: frontend-called but walk-untriggered -----------------------
    fe = FakeTree({
        "concord-frontend/app/lenses/z/page.tsx":
            'import { lensRun } from "@/lib/lensRun";\n'
            'lensRun("z.calledOnly", {});\n'})
    registry = {"actions": [
        {"domain": "z", "action": "calledOnly", "file": "server/domains/z.js",
         "line": 1, "receipt_class": None},
        {"domain": "z", "action": "noCaller", "file": "server/domains/z.js",
         "line": 9, "receipt_class": None}], "counts": {}}
    be = dossier._backend_reach({"actions": []}, None, registry, "z", tree=fe)
    hidden = {(h["domain"], h["action"]) for h in be["hidden_actions"]}
    uncalled = {(h["domain"], h["action"]) for h in be["uncalled_actions"]}
    check("walk-hidden covers both; uncalled only the no-caller action",
          hidden == {("z", "calledOnly"), ("z", "noCaller")}
          and uncalled == {("z", "noCaller")}, (hidden, uncalled))

    # -- item 5: security gate on live evidence only ------------------------
    scan = {"flags": [OrderedDict([("kind", "write_without_owner_check"),
                                   ("class", "security"), ("file", "f"),
                                   ("line", 1), ("pattern", "p")])]}
    rec = {"findings": [], "two_account": {"status": "PASS"},
           "premap_findings": [], "trust": {"findings": 0}}
    g = dossier._gates(rec, {"provenance": "clean_happy_path"}, scan, {})
    check("scan-only security flags do not fail the security gate",
          g["security_detector"]["status"] == "PASS"
          and g["security_detector"]["security_scan_flags"] == 1, g)
    rec2 = dict(rec, trust={"findings": 2})
    g2 = dossier._gates(rec2, {"provenance": "clean_happy_path"}, scan, {})
    check("a landed trust finding fails the security gate",
          g2["security_detector"]["status"] == "FAIL", g2)

    # -- item 5: smell cannot zero a clean-live lens -------------------------
    many_flags = {"flags": [
        OrderedDict([("kind", "k%d" % i), ("class", "security"),
                     ("file", "f"), ("line", i), ("pattern", "p")])
        for i in range(9)]}
    s = dossier._score(many_flags, {"orphaned": []},
                       {"hidden_actions": [], "uncalled_actions": []},
                       [], {"counts": {}}, {})
    check("max scan smell caps at 25 in the combined score",
          s["score"] == 75 and s["live_quality"] == 100
          and s["code_smell"] == 55, s)

    print("FAILURES: %d" % len(FAILS))
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
