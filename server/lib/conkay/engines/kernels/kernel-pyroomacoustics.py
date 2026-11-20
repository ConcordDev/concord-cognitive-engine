#!/usr/bin/env python3
"""pyroomacoustics kernel - SXE-34.

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on
stdin, one result JSON on stdout. Health case: in a shoebox
room with near-anechoic walls, the room impulse response's
first significant arrival is the direct path - its sample index
must equal distance / c * fs computed in-kernel (band 2 samples,
covering fractional-delay rounding in the image-source model).

Ops:
  health - request {} (the 2.0 m case)
  rir - request {distanceM} in [0.5, 6]
    -> {arrivalSamples, expectedSamples, absErrorSamples,
        converged}.

No pyroomacoustics in the driver env is a provisioning defect:
exit 3.
"""
import json
import math
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


C_SOUND = 343.0
FS = 16000


def run_rir(distance_m):
    try:
        import numpy as np
        import pyroomacoustics as pra
    except Exception as e:
        fail(3, "pyroomacoustics import failed (%s) - the "
                "pyroomacoustics driver env is not provisioned" % e)
    room = pra.ShoeBox([8, 4, 3], fs=FS,
                       materials=pra.Material(0.99), max_order=3)
    room.add_source([1.0, 2.0, 1.5])
    room.add_microphone([1.0 + distance_m, 2.0, 1.5])
    room.compute_rir()
    rir = np.asarray(room.rir[0][0], dtype=float)
    if rir.size == 0 or float(np.max(np.abs(rir))) == 0.0:
        fail(6, "pyroomacoustics served an empty RIR")
    thresh = 0.1 * float(np.max(np.abs(rir)))
    idx = int(np.argmax(np.abs(rir) > thresh))
    expected = distance_m / C_SOUND * FS
    err = abs(idx - expected)
    return {"arrivalSamples": idx, "expectedSamples": expected,
            "absErrorSamples": err, "converged": bool(err <= 2.0)}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op in ("health", "rir"):
        dist = request.get("distanceM", 2.0)
        if not isinstance(dist, (int, float)) or not (0.5 <= dist <= 6):
            fail(2, "distanceM must be a number in [0.5, 6], "
                    "got %r" % (dist,))
        result = run_rir(float(dist))
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
