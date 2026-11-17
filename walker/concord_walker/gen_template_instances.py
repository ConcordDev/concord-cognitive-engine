"""LC-06 instance generator: turn the LC-05 census into draft template
instances in walker/recipes/.

Deterministic and idempotent: the same census CSV in gives the same files
out, byte for byte; a second run writes nothing. Every generated instance
lands as status "draft" — the IMM-13 loader refuses drafts, so NOTHING here
can verify a ticket until a Dutch / Zuko-desk review flips it to active
(the parent ticket's rule: VERIFIED needs a reviewed per-ticket instance).

Scope (per audit/reverify/RECIPE-GAPS.md): the five template-fit
walker_classes whose instances bind no W0 capture-map output. Endpoint-hit
instances are NOT generated — they bind real control ids from the capture
map and wait for it.

    python3 -m concord_walker.gen_template_instances [csv_path] [recipes_dir]
"""
import csv
import json
import os
import sys

from . import recipe_templates as _templates

CLASS_TO_TEMPLATE = {
    "escape": "escape",
    "export": "export-file",
    "overflow390": "overflow-390",
    "contrast": "contrast",
    "http": "load-5xx",
    "pageerror": "load-5xx",
}

COVERS = {
    "escape": "Template instance (escape) for the {lens} lens, generated from the LC-05 census: "
              "Escape closes the ticket's open surface. Reviewer: confirm on the live lens that the "
              "surface opens as a dialog/menu; if it needs a named opener, set params opener/surface "
              "before activating.",
    "export-file": "Template instance (export-file) for the {lens} lens, generated from the LC-05 census: "
                   "the Export control produces the export response (path containing /export, 2xx). "
                   "Reviewer: confirm this lens's export path before activating.",
    "overflow-390": "Template instance (overflow-390) for the {lens} lens, generated from the LC-05 census: "
                    "no horizontal overflow at a 390px viewport. Reviewer: confirm the ticket is a "
                    "390/overflow defect before activating.",
    "contrast": "Template instance (contrast) for the {lens} lens, generated from the LC-05 census: "
                "all visible text meets contrast 4.5. Reviewer: confirm the ticket is a contrast "
                "defect before activating.",
    "load-5xx": "Template instance (load-5xx) for the {lens} lens, generated from the LC-05 census: "
                "the lens loads with no 5xx and renders. Reviewer: confirm the ticket is a load/5xx "
                "defect before activating.",
}

AUTHORED_ON = "2026-11-17"
AUTHOR = "muse-b5"
REVIEWER = "zuko-desk"


def instance_for(row):
    template = CLASS_TO_TEMPLATE.get(row.get("walker_class") or "")
    if template is None:
        return None
    return {
        "id": row["id"],
        "kind": "template",
        "template": template,
        "params": {},
        # CB-0810: tiered at birth from the template's tier; the per-ticket
        # discriminator (pre-fix failure transcript) is recorded by the
        # reviewer at activation — an active instance without one is refused.
        "tier": _templates.TEMPLATES[template]["tier"],
        "discriminator": None,
        "covers": COVERS[template].format(lens=row.get("lens") or "?")
                  + " At activation, record the pre-fix replay failure transcript "
                    "in the discriminator field (CB-0810).",
        "author": AUTHOR,
        "reviewer": REVIEWER,
        "status": "draft",
        "authored_on": AUTHORED_ON,
        "verified_against": None,
    }


def generate(csv_path, recipes_dir):
    with open(csv_path, newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    written, unchanged, skipped = 0, 0, 0
    seen = set()
    for row in sorted(rows, key=lambda r: r["id"]):
        inst = instance_for(row)
        if inst is None or inst["id"] in seen:
            skipped += 1
            continue
        seen.add(inst["id"])
        text = json.dumps(inst, indent=2, sort_keys=True) + "\n"
        path = os.path.join(recipes_dir, inst["id"] + ".json")
        if os.path.exists(path) and open(path, encoding="utf-8").read() == text:
            unchanged += 1
            continue
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(text)
        written += 1
    return {"rows": len(rows), "written": written, "unchanged": unchanged, "skipped": skipped}


def main(argv):
    here = os.path.dirname(os.path.abspath(__file__))
    csv_path = argv[1] if len(argv) > 1 else os.path.join(
        here, "..", "analysis", "FPV-ROWS-CLASSIFIED-20261114.csv")
    recipes_dir = argv[2] if len(argv) > 2 else os.path.join(here, "..", "recipes")
    print(generate(csv_path, recipes_dir))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
