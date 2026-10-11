#!/usr/bin/env python3
# server/lib/conkay/cad/render_zebra.py
#
# Zebra (reflection-line) renders of a cad.body STEP file: the standard
# visual check of surface fairness in class-A surfacing. The body reflects a
# field of parallel light bands; on a curvature-continuous (G2), fair surface
# the stripes run as smooth, evenly bending curves; a wobble in curvature
# shows as a kinked, pinched or wavy stripe, a tangent break as a jump.
# Normals are the exact B-spline surface normals at the mesh nodes (not the
# facet normals), interpolated per pixel, so the facets do not show.
#
# Optional tool (stdlib + OCP, the same venv as the kernel); not used by the
# solver. Deterministic: same STEP + same arguments, same PNG bytes.
#   render_zebra.py BODY.step OUT_DIR [PREFIX] [--width 1200] [--stripes 18] [--views side,top,front34,rear34] [--mesh 0.001]

import sys, os, math, zlib, struct

from OCP.STEPControl import STEPControl_Reader
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.BRep import BRep_Tool
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepLProp import BRepLProp_SLProps
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_FACE, TopAbs_REVERSED
from OCP.TopoDS import TopoDS
from OCP.TopLoc import TopLoc_Location


def _st(cls, name):
    return getattr(cls, name + "_s", None) or getattr(cls, name)


def load(path):
    rd = STEPControl_Reader()
    if rd.ReadFile(path) != 1:
        raise SystemExit(f"cannot read {path}")
    rd.TransferRoots()
    return rd.OneShape()


def mesh(shape, lin=0.003, ang=0.2):
    """Triangles with exact surface normals at their nodes."""
    BRepMesh_IncrementalMesh(shape, lin, False, ang, False)
    V, N, T = [], [], []
    ex = TopExp_Explorer(shape, TopAbs_FACE)
    while ex.More():
        face = _st(TopoDS, "Face")(ex.Current())
        ex.Next()
        loc = TopLoc_Location()
        tri = _st(BRep_Tool, "Triangulation")(face, loc)
        if tri is None:
            continue
        tr = loc.Transformation()
        rev = face.Orientation() == TopAbs_REVERSED
        ad = BRepAdaptor_Surface(face)
        props = BRepLProp_SLProps(ad, 1, 1e-9)
        base = len(V)
        for i in range(1, tri.NbNodes() + 1):
            p = tri.Node(i).Transformed(tr)
            V.append((p.X(), p.Y(), p.Z()))
            uv = tri.UVNode(i)
            props.SetParameters(uv.X(), uv.Y())
            if props.IsNormalDefined():
                n = props.Normal()
                n = (n.X(), n.Y(), n.Z())
                if rev:
                    n = (-n[0], -n[1], -n[2])
            else:
                n = None
            N.append(n)
        for i in range(1, tri.NbTriangles() + 1):
            a, b, c = tri.Triangle(i).Get()
            t = (base + a - 1, base + c - 1, base + b - 1) if rev else (base + a - 1, base + b - 1, base + c - 1)
            T.append(t)
    # nodes without a defined normal (degenerate points) take their triangles' facet normal
    for t in T:
        if any(N[i] is None for i in t):
            p, q, r = (V[i] for i in t)
            u = [q[k] - p[k] for k in range(3)]; v = [r[k] - p[k] for k in range(3)]
            fn = norm((u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]))
            for i in t:
                if N[i] is None:
                    N[i] = fn
    return V, N, T


def norm(v):
    l = math.sqrt(sum(x * x for x in v)) or 1.0
    return (v[0] / l, v[1] / l, v[2] / l)


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


# Views: (name, view direction from the camera into the scene, up vector). Coordinates: x rearward, y right, z up.
VIEWS = {
    "side": ((0.0, 1.0, 0.0), (0, 0, 1)),            # from the left (-y) side
    "top": ((0.0, 0.0, -1.0), (-1, 0, 0)),           # from above, nose up the image
    "front34": (norm((0.75, 0.62, -0.25)), (0, 0, 1)),  # from front-left, a little above
    "rear34": (norm((-0.75, 0.62, -0.25)), (0, 0, 1)),  # from rear-left, a little above
    "front": ((1.0, 0.0, 0.0), (0, 0, 1)),
}


def render(V, N, T, view, width, stripes):
    d, up = VIEWS[view]
    d = norm(d)
    r_ = norm(cross(d, up))
    u_ = cross(r_, d)
    P2 = [(dot(v, r_), dot(v, u_), dot(v, d)) for v in V]
    xs = [p[0] for p in P2]; ys = [p[1] for p in P2]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    pad = 0.04 * max(x1 - x0, y1 - y0)
    sc = (width - 1) / (x1 - x0 + 2 * pad)
    height = int((y1 - y0 + 2 * pad) * sc) + 1
    W, H = width, height
    zbuf = [1e18] * (W * H)
    img = bytearray([246, 247, 249] * (W * H))
    # the light bands: planes perpendicular to `band` in direction space, i.e. stripes of the reflected
    # vector's component along a fixed world axis tilted from vertical (so side and top views both show them)
    band = norm((0.0, 0.35, 1.0))
    sx = lambda p: (p[0] - x0 + pad) * sc
    sy = lambda p: (y1 + pad - p[1]) * sc
    for t in T:
        a, b, c = (P2[i] for i in t)
        ax, ay, bx, by, cx, cy = sx(a), sy(a), sx(b), sy(b), sx(c), sy(c)
        den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(den) < 1e-12:
            continue
        na, nb, nc = (N[i] for i in t)
        if dot(na, d) > 0.2 and dot(nb, d) > 0.2 and dot(nc, d) > 0.2:
            continue  # back-facing
        minx = max(int(math.floor(min(ax, bx, cx))), 0); maxx = min(int(math.ceil(max(ax, bx, cx))), W - 1)
        miny = max(int(math.floor(min(ay, by, cy))), 0); maxy = min(int(math.ceil(max(ay, by, cy))), H - 1)
        for py in range(miny, maxy + 1):
            fy = py + 0.5
            for px in range(minx, maxx + 1):
                fx = px + 0.5
                w0 = ((by - cy) * (fx - cx) + (cx - bx) * (fy - cy)) / den
                w1 = ((cy - ay) * (fx - cx) + (ax - cx) * (fy - cy)) / den
                w2 = 1.0 - w0 - w1
                if w0 < -1e-9 or w1 < -1e-9 or w2 < -1e-9:
                    continue
                z = w0 * a[2] + w1 * b[2] + w2 * c[2]
                k = py * W + px
                if z >= zbuf[k]:
                    continue
                zbuf[k] = z
                n = norm(tuple(w0 * na[i] + w1 * nb[i] + w2 * nc[i] for i in range(3)))
                if dot(n, d) > 0:
                    n = (-n[0], -n[1], -n[2])
                rf = tuple(d[i] - 2 * dot(d, n) * n[i] for i in range(3))
                ang = math.acos(max(-1.0, min(1.0, dot(rf, band))))
                s = (ang / math.pi) * stripes
                on = int(math.floor(s)) % 2 == 0
                lam = 0.55 + 0.45 * max(0.0, -dot(n, d))
                v = int((235 if on else 28) * lam + (0 if on else 10))
                img[3 * k:3 * k + 3] = bytes((v, v, min(255, v + 6)))
    return W, H, img


def write_png(path, W, H, rgb):
    raw = b"".join(b"\x00" + bytes(rgb[3 * W * y:3 * W * (y + 1)]) for y in range(H))
    def chunk(t, data):
        c = struct.pack(">I", len(data)) + t + data
        return c + struct.pack(">I", zlib.crc32(t + data) & 0xFFFFFFFF)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(raw, 9)))
        f.write(chunk(b"IEND", b""))


def main():
    args = [a for a in sys.argv[1:]]
    opts = {"--width": 1200, "--stripes": 18, "--views": "side,top,front34,rear34", "--mesh": 0.001}
    pos = []
    i = 0
    while i < len(args):
        if args[i] in opts:
            opts[args[i]] = type(opts[args[i]])(args[i + 1]); i += 2
        else:
            pos.append(args[i]); i += 1
    step, out = pos[0], pos[1]
    prefix = pos[2] if len(pos) > 2 else "zebra"
    os.makedirs(out, exist_ok=True)
    V, N, T = mesh(load(step), lin=opts["--mesh"])
    for view in opts["--views"].split(","):
        W, H, img = render(V, N, T, view, opts["--width"], opts["--stripes"])
        p = os.path.join(out, f"{prefix}-{view}.png")
        write_png(p, W, H, img)
        print(p)


if __name__ == "__main__":
    main()
