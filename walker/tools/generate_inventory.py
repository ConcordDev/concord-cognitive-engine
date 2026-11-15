#!/usr/bin/env python3
"""Regenerate the walker's inventory.json from the canonical lens registry
(concord-frontend/lib/lens-registry.ts) — WALK-02.

The registry is the count of record: one inventory entry per LENS_REGISTRY
entry, slug = registry id, url = base_url + registry path, category and name
carried through. Sub-path lenses (reasoning/traces, world-creator/anomalies)
and the global lens are ordinary registry entries and ride along.

Usage:
  generate_inventory.py --registry lens-registry.ts [--out inventory.json]
                        [--base-url https://concord-os.org]
  generate_inventory.py --repo /path/to/repo --sha <deploy-sha> [--out ...]
"""
import argparse, json, os, re, subprocess, sys

ENTRY = re.compile(
    r"id: '(?P<id>[^']+)'.*?name: '(?P<name>[^']+)'.*?category: '(?P<category>[^']+)'"
    r".*?path: '(?P<path>[^']+)'", re.S)


def parse_registry(text):
    start = text.index("export const LENS_REGISTRY")
    end = text.index("export const LENS_CATEGORIES", start)
    span = text[start:end]
    entries, seen = [], set()
    for m in ENTRY.finditer(span):
        d = m.groupdict()
        if d["id"] in seen:
            raise SystemExit("duplicate registry id: %s" % d["id"])
        seen.add(d["id"])
        entries.append(d)
    if not entries:
        raise SystemExit("no LENS_REGISTRY entries parsed — registry shape changed?")
    return entries


def build_inventory(registry_text, base_url):
    base = base_url.rstrip("/")
    return [{"slug": e["id"], "url": base + e["path"], "category": e["category"], "name": e["name"]}
            for e in parse_registry(registry_text)]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--registry", help="path to lens-registry.ts")
    ap.add_argument("--repo", help="repo to read the registry from at --sha (git show)")
    ap.add_argument("--sha", help="deploy sha (with --repo)")
    ap.add_argument("--base-url", default="https://concord-os.org")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "inventory.json"))
    args = ap.parse_args()
    if args.registry:
        with open(args.registry) as f:
            text = f.read()
    elif args.repo and args.sha:
        text = subprocess.run(["git", "-C", args.repo, "show", "%s:concord-frontend/lib/lens-registry.ts" % args.sha],
                              capture_output=True, text=True, check=True).stdout
    else:
        raise SystemExit("give --registry PATH, or --repo DIR --sha SHA")
    inv = build_inventory(text, args.base_url)
    with open(args.out, "w") as f:
        json.dump(inv, f, indent=1)
        f.write("\n")
    print("inventory: %d entries -> %s" % (len(inv), args.out))


if __name__ == "__main__":
    main()
