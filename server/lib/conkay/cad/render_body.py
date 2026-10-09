#!/usr/bin/env python3
# server/lib/conkay/cad/render_body.py
#
# PNG renders of a cad.body result: the body (translucent) with the packaging
# envelopes inside and the tyres. Optional tool (needs matplotlib in the OCP
# venv); not used by the solver.
#   render_body.py REQUEST.json RESULT.json OUT_DIR [--occupant M95]

import sys, json, math, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import conkay_body_occ as K
from OCP.STEPControl import STEPControl_Reader
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection

COLORS = {"ENGINE": "#c0392b", "TRANSMISSION": "#8e44ad", "RADIATOR": "#2980b9", "DIFFERENTIAL": "#7f8c8d", "FUEL_CELL": "#27ae60", "STEERING_WHEEL": "#111111"}


def box_faces(b):
    c = K.box_corners(b)
    idx = [(0, 1, 3, 2), (4, 5, 7, 6), (0, 1, 5, 4), (2, 3, 7, 6), (0, 2, 6, 4), (1, 3, 7, 5)]
    return [[c[i] for i in f] for f in idx]


def tyre_faces(w, n=28):
    cx, cy, cz = w["center"]; r, hw = w["radius"], w["halfWidth"]
    rim = [[(cx + r * math.cos(2 * math.pi * k / n), cy + s * hw, cz + r * math.sin(2 * math.pi * k / n)) for k in range(n)] for s in (-1, 1)]
    faces = [rim[0], rim[1]]
    for k in range(n):
        faces.append([rim[0][k], rim[0][(k + 1) % n], rim[1][(k + 1) % n], rim[1][k]])
    return faces


def main():
    req = json.load(open(sys.argv[1])); res = json.load(open(sys.argv[2])); out = sys.argv[3]
    occ_key = sys.argv[sys.argv.index("--occupant") + 1] if "--occupant" in sys.argv else "M95"
    os.makedirs(out, exist_ok=True)
    files = res.get("files") or res.get("outputs", {}).get("files", {}).get("value")
    rd = STEPControl_Reader(); rd.ReadFile(files["step"]["path"]); rd.TransferRoots(); shape = rd.OneShape()
    verts, tris = K.triangulate(shape, 0.012, 0.35)
    light = [-0.4, -0.5, 0.75]; ln = math.sqrt(sum(v * v for v in light)); light = [v / ln for v in light]
    polys, shades = [], []
    for a, b, c in tris:
        p, q, r = verts[a], verts[b], verts[c]
        u = [q[i] - p[i] for i in range(3)]; v = [r[i] - p[i] for i in range(3)]
        nrm = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
        L = math.sqrt(sum(x * x for x in nrm)) or 1
        d = sum(nrm[i] / L * light[i] for i in range(3))
        polys.append([p, q, r]); shades.append(0.55 + 0.4 * max(d, 0))
    env = [e for e in req["envelopes"] if (":" not in e["id"]) or (f":{occ_key}:" in e["id"]) or e["id"].endswith(f"@{occ_key}")]
    bb = res.get("metrics") or res["outputs"]["dimensions"]["value"]
    bmin, bmax = bb["bbox"]["min"], bb["bbox"]["max"]
    views = {"three-quarter-front": (18, -128, "persp"), "side": (0, -90, "ortho"), "top": (90, -90, "ortho"), "front": (0, 180, "ortho")}
    paths = []
    for name, (elev, azim, proj) in views.items():
        fig = plt.figure(figsize=(12, 7.5), dpi=110)
        ax = fig.add_subplot(111, projection="3d")
        ax.set_proj_type(proj)
        for e in env:
            kind = e.get("kind", "")
            col = COLORS.get(e["id"], "#e67e22" if kind.startswith("occupant") else "#34495e" if kind == "seat" else "#95a5a6")
            ax.add_collection3d(Poly3DCollection(box_faces(e), facecolor=col, edgecolor="k", linewidths=0.2, alpha=0.85))
        for w in req.get("wheels", []):
            ax.add_collection3d(Poly3DCollection(tyre_faces(w), facecolor="#1b1b1b", edgecolor="#1b1b1b", linewidths=0.1, alpha=0.95))
        fc = [(0.55 * s, 0.75 * s, 0.95 * s, 0.16) for s in shades]
        ax.add_collection3d(Poly3DCollection(polys, facecolors=fc, edgecolor="none"))
        span = [bmax[i] - bmin[i] for i in range(3)]
        ax.set_xlim(bmin[0], bmax[0]); ax.set_ylim(-span[0] / 2 * 0 + bmin[1], bmax[1]); ax.set_zlim(0, bmax[2])
        ax.set_box_aspect((span[0], span[1], bmax[2]))
        ax.view_init(elev=elev, azim=azim)
        ax.set_xlabel("x (m, rearward)"); ax.set_ylabel("y (m)"); ax.set_zlabel("z (m)")
        ax.set_title(f"ConKay CAD body ({name}); occupants: {occ_key} in all four seats; body translucent", fontsize=11)
        p = os.path.join(out, f"body-{name}.png")
        fig.tight_layout(); fig.savefig(p); plt.close(fig)
        paths.append(p)
    print(json.dumps({"renders": paths, "triangles": len(tris)}))


if __name__ == "__main__":
    main()
