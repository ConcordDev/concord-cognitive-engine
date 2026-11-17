#!/usr/bin/env python3
# server/lib/conkay/cfd/lbm/lbm_case.py
#
# Writes an OpenLB 1.9r0 external-aero case for one CUDA GPU (aero.lbm): the C++ case program
# (aero_lbm.cpp, copied byte-for-byte), the OpenLB Makefile and config.mk, a run script and
# case.json. Stdlib only, deterministic: the reply carries the sha256 of every file written and
# caseSha256 over all of them, so a recorded run can be matched to the exact case it was made from.
#
# Request (JSON on stdin):
#   { "preset": "ahmed" | "car", "outDir": "...", "res": int (cells along lref), "tend": s,
#     "sample": int (steps between force samples),
#     car only: "aref": m2, "lref": m, "bbox": { "min": [x,y,z], "max": [x,y,z] } (cad.body frame, ground z = 0),
#               "stl": file name of the body surface }
# Reply (JSON on stdout): { ok, preset, files: { path: sha256 }, caseSha256, args } or { ok: false, error }.
#
# Flow (both presets): 40 m/s, nu 1.5e-5 m2/s, rho 1.225 kg/m3 (the OpenFOAM case's speed and
# viscosity), lattice velocity 0.05 (Mach 0.087), moving ground at the free-stream speed, free-slip
# top and sides, pressure outlet. The Ahmed preset reproduces cfd/ahmed.geo; the car preset sizes the
# domain from the body box by the same proportions as the Ahmed domain (see docs/CONKAY-AERO-LBM.md).
import hashlib, json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
U = 40.0; NU = 1.5e-5; RHO = 1.225; ULAT = 0.05; SMAGO = 0.15

AHMED = {"lref": 1.044, "aref": round(0.389 * 0.288, 9), "stl": "ahmed.stl",
         # inlet 0.7 m (0.67 L) upstream of the nose, outlet 1.6 m (1.54 L) behind the base, +/-0.95 m wide, 1.0 m high (blockage 5.9 %)
         "xmin": -0.7, "xmax": 2.65, "ymax": 0.95, "zmax": 1.0, "regions": "ahmed"}
# GPU memory of OpenLB 1.9r0 D3Q19 float on CUDA, measured on the A40 (nvidia-smi, 7.1 M and 23.7 M nodes):
# 385 MiB CUDA context + 174 MiB per million nodes (two population copies plus fields). The pod is shared; the
# default node cap keeps the run under 7 GB so at least 12 GB stay free for the other tenants.
MIB_BASE = 385.0; MIB_PER_MNODE = 174.0; DEFAULT_MAX_MNODES = 36.0

OPENLB_RELEASE = "olb-1.9r0"
CONFIG_MK = """# OpenLB single-GPU build for the A40 (sm_86), float. Copy to the OpenLB root, then `make` there.
CXX             := nvcc
CC              := nvcc
CXXFLAGS        := -O3
CXXFLAGS        += -std=c++20 --forward-unknown-to-host-compiler
PARALLEL_MODE   := NONE
PLATFORMS       := CPU_SISD GPU_CUDA
CUDA_ARCH       := 86
FLOATING_POINT_TYPE := float
USE_EMBEDDED_DEPENDENCIES := ON
"""
MAKEFILE = "EXAMPLE = aero_lbm\nOLB_ROOT := ../..\ninclude $(OLB_ROOT)/default.mk\n"


# gmsh writes one "solid" per physical group; OpenLB's STL reader stops after the first, so the solids are merged into one.
MERGE_STL = """python3 - <<'PY'
import hashlib, json, subprocess
lines = open("RAW").read().split("\\n")
solid = [i for i, l in enumerate(lines) if l.startswith("solid")]
endsolid = [i for i, l in enumerate(lines) if l.startswith("endsolid")]
drop = set(solid[1:]) | set(endsolid[:-1])
open("OUT", "w").write("\\n".join(l for i, l in enumerate(lines) if i not in drop))
tris = sum(1 for l in open("OUT") if l.lstrip().startswith("facet"))
ver = subprocess.run(["gmsh", "--version"], capture_output=True, text=True)
json.dump({"tool": "gmsh", "gmshVersion": (ver.stdout or ver.stderr).strip(), "solidsMerged": len(solid), "triangles": tris,
           "stlSha256": hashlib.sha256(open("OUT", "rb").read()).hexdigest()}, open("surface.json", "w"), indent=2)
PY
"""
TESSELLATION = {"clmax": 0.015, "clmin": 0.003, "curvaturePoints": 24}


def stl_script(preset, stl):
    head = "#!/bin/bash\n# Make the body surface the case voxelises (needs gmsh), and record it in surface.json.\nset -e\ncd \"${0%/*}\"\n"
    if preset == "ahmed":
        gen = "gmsh ahmed.geo -2 -setnumber Mesh.StlOneSolidPerSurface 0 -format stl -o surface_raw.stl > log.gmsh 2>&1\n"
    else:
        gen = (f"gmsh body.step -2 -format stl -clmax {TESSELLATION['clmax']} -clmin {TESSELLATION['clmin']} "
               f"-setnumber Mesh.MeshSizeFromCurvature {TESSELLATION['curvaturePoints']} -o surface_raw.stl > log.gmsh 2>&1\n")
    return head + gen + MERGE_STL.replace("RAW", "surface_raw.stl").replace("OUT", stl) + "rm -f surface_raw.stl\n"


def fmt(x):
    x = round(float(x), 9)
    return str(int(x)) if x.is_integer() else repr(x)


def build(req):
    preset = req.get("preset")
    if preset not in ("ahmed", "car"):
        raise ValueError(f"unknown preset {preset!r}")
    res = req.get("res")
    if not (isinstance(res, int) and not isinstance(res, bool) and 20 <= res <= 2000):
        raise ValueError("res must be an integer in 20..2000 (cells along the reference length)")
    tend = req.get("tend")
    if not (isinstance(tend, (int, float)) and not isinstance(tend, bool) and 0 < tend <= 10):
        raise ValueError("tend must be a number of seconds in (0, 10]")
    sample = req.get("sample", 200)
    if not (isinstance(sample, int) and not isinstance(sample, bool) and 1 <= sample <= 100000):
        raise ValueError("sample must be an integer in 1..100000")

    if preset == "ahmed":
        g = dict(AHMED)
    else:
        lref, aref, bbox, stl = req.get("lref"), req.get("aref"), req.get("bbox"), req.get("stl")
        for k, v in (("lref", lref), ("aref", aref)):
            if not (isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and v > 0):
                raise ValueError(f"car preset needs {k} > 0")
        if not (isinstance(stl, str) and stl and "/" not in stl and " " not in stl and stl.endswith(".stl")):
            raise ValueError("car preset needs stl: a plain file name ending .stl")
        try:
            mn, mx = [float(v) for v in bbox["min"]], [float(v) for v in bbox["max"]]
        except Exception:
            raise ValueError("car preset needs bbox { min:[x,y,z], max:[x,y,z] }")
        if len(mn) != 3 or len(mx) != 3 or not all(math.isfinite(v) for v in mn + mx) or any(mx[i] <= mn[i] for i in range(3)):
            raise ValueError("bbox must be finite with max > min on every axis")
        if mn[2] < -1e-6:
            raise ValueError("bbox.min z is below the ground (z = 0)")
        L, W, H = mx[0] - mn[0], mx[1] - mn[1], mx[2]
        half = max(abs(mn[1]), abs(mx[1]))
        # Ahmed proportions: inlet 0.67 L upstream, outlet 1.54 L behind the base, half-width 2.44 W, height 3.47 H (blockage 5.9 %)
        g = {"lref": float(lref), "aref": float(aref), "stl": stl, "regions": "none",
             "xmin": round(mn[0] - 0.67 * L, 3), "xmax": round(mx[0] + 1.54 * L, 3),
             "ymax": round(max(2.44 * W, half + 1.0 * W), 3), "zmax": round(3.47 * H, 3)}

    dx = g["lref"] / res
    mnodes = (g["xmax"] - g["xmin"]) * 2 * g["ymax"] * g["zmax"] / dx ** 3 / 1e6
    cap = req.get("maxMnodes", DEFAULT_MAX_MNODES)
    if not (isinstance(cap, (int, float)) and not isinstance(cap, bool) and 0 < cap <= 200):
        raise ValueError("maxMnodes must be a number in (0, 200]")
    if mnodes > cap:
        raise ValueError(f"res {res} gives about {mnodes:.1f} M nodes (~{(MIB_BASE + MIB_PER_MNODE * mnodes) / 1024:.1f} GiB of GPU memory), over the {cap} M cap; lower res or raise maxMnodes after checking nvidia-smi")
    args = [f"--res={res}", f"--lref={fmt(g['lref'])}", f"--aref={fmt(g['aref'])}", f"--u={fmt(U)}", f"--nu={NU:g}", f"--rho={fmt(RHO)}",
            f"--ulat={fmt(ULAT)}", f"--smago={fmt(SMAGO)}", f"--tend={fmt(tend)}", f"--sample={sample}",
            f"--xmin={fmt(g['xmin'])}", f"--xmax={fmt(g['xmax'])}", f"--ymax={fmt(g['ymax'])}", f"--zmax={fmt(g['zmax'])}",
            f"--stl={g['stl']}", f"--regions={g['regions']}", "--out=forces.dat"]
    with open(os.path.join(HERE, "aero_lbm.cpp"), "rb") as f:
        cpp = f.read().decode()
    run_sh = ("#!/bin/bash\n# Run the case on the GPU. Check `nvidia-smi` first and leave the other tenants' memory alone.\n"
              "set -e\ncd \"${0%/*}\"\n./aero_lbm " + " ".join(args) + " > log.run 2>&1\ntouch DONE\n")
    case = {"preset": preset, "openlb": OPENLB_RELEASE, "args": args, "res": res, "tend": tend, "sample": sample,
            "lref": g["lref"], "aref": g["aref"], "domain": {k: g[k] for k in ("xmin", "xmax", "ymax", "zmax")},
            "flow": {"u": U, "nu": NU, "rho": RHO, "ulat": ULAT, "smagorinsky": SMAGO},
            "dx": dx, "estimate": {"mnodes": round(mnodes, 2), "gpuGiB": round((MIB_BASE + MIB_PER_MNODE * mnodes) / 1024, 2)}}
    files = {"aero_lbm.cpp": cpp, "Makefile": MAKEFILE, "config.mk": CONFIG_MK, "run.sh": run_sh,
             "stl.sh": stl_script(preset, g["stl"]),
             "case.json": json.dumps(case, indent=2, sort_keys=True) + "\n"}
    if preset == "ahmed":
        with open(os.path.join(HERE, "..", "ahmed.geo"), "rb") as f:
            files["ahmed.geo"] = f.read().decode()
    return preset, args, files


def main():
    try:
        req = json.load(sys.stdin)
        preset, args, files = build(req)
        out = req.get("outDir")
        if out:
            os.makedirs(out, exist_ok=True)
            for p, t in files.items():
                with open(os.path.join(out, p), "w") as f:
                    f.write(t)
                if p in ("run.sh", "stl.sh"):
                    os.chmod(os.path.join(out, p), 0o755)
        h = hashlib.sha256()
        for p, t in sorted(files.items()):
            h.update(p.encode()); h.update(b"\0"); h.update(t.encode()); h.update(b"\0")
        print(json.dumps({"ok": True, "preset": preset, "args": args,
                          "files": {p: hashlib.sha256(t.encode()).hexdigest() for p, t in sorted(files.items())},
                          "caseSha256": h.hexdigest()}))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))


if __name__ == "__main__":
    main()
