#!/usr/bin/env python3
"""OpenRadioss explicit dynamics kernel — SXE-13.

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. The kernel is a driver for the
distribution's OWN shipped QA deck (bar impact — the plan's health
case): it locates the deck under the provisioned OpenRadioss home
(env CONKAY_OPENRADIOSS_HOME, QA dir env CONKAY_OPENRADIOSS_QA),
runs the distribution's starter + engine binaries (AGPL-3,
UNMODIFIED, separate processes — the manifest's F7 rule), and
checks the energy balance: the final TOTAL ENERGY in the engine
output against the initial TOTAL ENERGY from the starter output
(drift band 10% for an explicit impact run with contact/eroding
output effects — the QA deck's own acceptance shape).

Ops:
  health / bar-impact — request {deckName}; default: the first
    deck under the QA dir whose name matches *impact* (fallback:
    the first *_0000.rad deck).

Any missing piece (home, starter/engine binary, QA deck) is a
provisioning defect: exit 3 naming it. Output with no parseable
TOTAL ENERGY lines is rejected (exit 5), never guessed.
"""
import glob
import json
import os
import re
import subprocess
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


ENERGY_RE = re.compile(r"TOTAL ENERGY\s*[:=]?\s*"
                       r"(-?\d+(?:\.\d+)?(?:[Ee][-+]?\d+)?)")


def find_binary(home, names):
    for base in (os.path.join(home, "exec"), os.path.join(home, "bin"), home):
        for name in names:
            hits = sorted(glob.glob(os.path.join(base, name)))
            if hits:
                return hits[0]
    return None


def last_energy(path):
    value = None
    with open(path, errors="replace") as fh:
        for line in fh:
            m = ENERGY_RE.search(line)
            if m:
                value = float(m.group(1))
    return value


def run_impact(deck_name):
    home = os.environ.get("CONKAY_OPENRADIOSS_HOME")
    if not home or not os.path.isdir(home):
        fail(3, "OpenRadioss home not provisioned "
                "(CONKAY_OPENRADIOSS_HOME=%r)" % (home,))
    starter = find_binary(home, ["starter_linux64*", "starter_*"])
    engine = find_binary(home, ["engine_linux64*", "engine_*"])
    if not starter or not engine:
        fail(3, "OpenRadioss starter/engine binaries not found under "
                "%s (starter=%r, engine=%r)" % (home, starter, engine))
    qa_dir = os.environ.get("CONKAY_OPENRADIOSS_QA") or os.path.join(home, "qa")
    if deck_name:
        decks = glob.glob(os.path.join(qa_dir, "**", deck_name), recursive=True)
    else:
        decks = sorted(glob.glob(os.path.join(qa_dir, "**", "*impact*_0000.rad"),
                                 recursive=True)) or \
            sorted(glob.glob(os.path.join(qa_dir, "**", "*_0000.rad"),
                             recursive=True))
    if not decks:
        fail(3, "no OpenRadioss QA deck (*_0000.rad) found under %s — "
                "the distribution's QA set is not provisioned" % qa_dir)
    deck = decks[0]
    root = os.path.basename(deck)[:-len("_0000.rad")]
    work = os.path.dirname(deck)
    proc = subprocess.run([starter, "-i", os.path.basename(deck)],
                          cwd=work, capture_output=True, text=True, timeout=900)
    starter_out = os.path.join(work, root + "_0000.out")
    if proc.returncode != 0 or not os.path.exists(starter_out):
        fail(6, "OpenRadioss starter failed on %s (exit %d)"
                % (os.path.basename(deck), proc.returncode))
    initial = last_energy(starter_out)
    proc = subprocess.run([engine, "-i", root + "_0001.rad"]
                          if os.path.exists(os.path.join(work, root + "_0001.rad"))
                          else [engine, "-i", os.path.basename(deck)],
                          cwd=work, capture_output=True, text=True, timeout=3600)
    engine_outs = sorted(glob.glob(os.path.join(work, root + "_*.out")))
    final = None
    for path in engine_outs:
        v = last_energy(path)
        if v is not None:
            final = v
    if initial is None or final is None:
        fail(5, "OpenRadioss output carried no parseable TOTAL ENERGY "
                "(initial=%r, final=%r; garbled output rejected)"
                % (initial, final))
    drift = abs(final - initial) / abs(initial) if initial else abs(final)
    return {"deck": os.path.basename(deck), "initialEnergy": initial,
            "finalEnergy": final, "relDrift": drift,
            "converged": drift <= 0.10}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op in ("health", "bar-impact"):
        deck_name = request.get("deckName")
        if deck_name is not None and not isinstance(deck_name, str):
            fail(2, "deckName must be a string, got %r" % (deck_name,))
        result = run_impact(deck_name)
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
