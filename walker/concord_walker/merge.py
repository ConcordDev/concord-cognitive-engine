"""ULW C14 (machinery only): ticket-ID merge for parallel walker instances.

Two instances may run on DISJOINT lens sets; at merge time their record
rows (the records/ union schema: walker.jsonl verdicts + human.jsonl
decisions) combine strictly by ticket ID:

  * an ID seen once passes through;
  * an ID seen twice with identical deciding fields is a duplicate —
    one copy is kept, the other counted as deduped;
  * an ID whose rows DISAGREE on a deciding field (status, recipe,
    live_sha, evidence_path, account) is a CONFLICT: the ID is excluded
    from the merged output entirely and listed in the conflict report
    with both rows and the differing fields. Nothing is silently
    overwritten and no contested verdict can ride the merge.

disjoint_lenses() is the activation precondition check (Gate section 6):
the two instances' lens sets must not overlap. This module is the
machinery only — actually running a second instance is not its act.
"""
import json, os

DECIDING_FIELDS = ("status", "recipe", "live_sha", "evidence_path", "account")


def read_jsonl(path):
    rows = []
    if not os.path.exists(path):
        return rows
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def disjoint_lenses(lenses_a, lenses_b):
    """Sorted overlap of two lens sets; empty means the sets are disjoint."""
    return sorted(set(lenses_a) & set(lenses_b))


def merge_rows(rows_a, rows_b):
    """Returns (merged, conflicts, stats). Conflicts exclude their ID from
    merged entirely; stats counts input rows, kept rows, and deduped rows."""
    merged, conflicts = [], []
    seen, contested = {}, set()
    stats = {"input": 0, "kept": 0, "deduped": 0, "conflicts": 0}
    for src, rows in (("a", rows_a), ("b", rows_b)):
        for row in rows:
            stats["input"] += 1
            rid = row.get("id")
            if rid is None:
                conflicts.append({"id": None, "reason": "row without an id", "source": src, "row": row})
                continue
            if rid in contested:
                conflicts.append({"id": rid, "reason": "further row for a contested id", "source": src, "row": row})
                continue
            if rid not in seen:
                seen[rid] = row
                merged.append(row)
                continue
            prev = seen[rid]
            differing = [f for f in DECIDING_FIELDS if prev.get(f) != row.get(f)]
            if not differing:
                stats["deduped"] += 1
                continue
            contested.add(rid)
            merged = [r for r in merged if r.get("id") != rid]
            conflicts.append({"id": rid, "reason": "rows disagree", "fields": differing,
                              "a": prev, "b": row})
    stats["kept"] = len(merged)
    stats["conflicts"] = len(conflicts)
    return merged, conflicts, stats


def merge_files(path_a, path_b, out_path, report_path, lenses_a=(), lenses_b=()):
    """Merge two record files by ticket ID; write the merged rows and the
    conflict report. Returns the report dict. A non-empty lens overlap is
    reported as activation_blocked (the merge still runs: disjointness is
    the second instance's precondition, and the report must name it)."""
    merged, conflicts, stats = merge_rows(read_jsonl(path_a), read_jsonl(path_b))
    overlap = disjoint_lenses(lenses_a, lenses_b)
    with open(out_path, "w") as f:
        for row in merged:
            f.write(json.dumps(row) + "\n")
    report = {"stats": stats, "conflicts": conflicts, "lens_overlap": overlap,
              "activation_blocked": bool(overlap)}
    with open(report_path, "w") as f:
        json.dump(report, f, indent=1)
    return report
