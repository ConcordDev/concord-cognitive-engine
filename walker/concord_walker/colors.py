"""CSS computed-colour parsing (rgb/rgba/hsl/color(srgb)/oklch/oklab/lab/lch) and WCAG contrast."""
import math, re

NUM = r"[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?%?"


def _n(v, scale=1.0):
    v = v.strip()
    if v == "none":
        return 0.0
    if v.endswith("%"):
        return float(v[:-1]) / 100.0 * scale
    return float(v)


def _args(s):
    inner = s[s.index("(") + 1:s.rindex(")")]
    inner = inner.replace(",", " ")
    alpha = 1.0
    if "/" in inner:
        inner, a = inner.split("/", 1)
        alpha = _n(a, 1.0)
    return inner.split(), alpha


def _lin2srgb(c):
    c = max(0.0, min(1.0, c))
    return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def _oklab_to_srgb(L, a, b):
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
    r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    bb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    return tuple(_lin2srgb(x) * 255 for x in (r, g, bb))


def _lab_to_srgb(L, a, b):
    fy = (L + 16) / 116
    fx, fz = fy + a / 500, fy - b / 200
    d = 6 / 29
    f = lambda t: t ** 3 if t > d else 3 * d * d * (t - 4 / 29)
    X, Y, Z = 0.96422 * f(fx), 1.0 * f(fy), 0.82521 * f(fz)  # D50
    # Bradford D50->D65 then XYZ->linear sRGB
    X2 = 0.9555766 * X - 0.0230393 * Y + 0.0631636 * Z
    Y2 = -0.0282895 * X + 1.0099416 * Y + 0.0210077 * Z
    Z2 = 0.0122982 * X - 0.0204830 * Y + 1.3299098 * Z
    r = 3.2404542 * X2 - 1.5371385 * Y2 - 0.4985314 * Z2
    g = -0.9692660 * X2 + 1.8760108 * Y2 + 0.0415560 * Z2
    bb = 0.0556434 * X2 - 0.2040259 * Y2 + 1.0572252 * Z2
    return tuple(_lin2srgb(x) * 255 for x in (r, g, bb))


def parse(s):
    """Return (r, g, b, a) with r,g,b in 0..255, or None if unparseable (gradients etc.)."""
    if not s:
        return None
    s = s.strip().lower()
    if s == "transparent":
        return (0, 0, 0, 0.0)
    try:
        if s.startswith("rgb"):
            p, a = _args(s)
            r, g, b = (_n(x, 255) for x in p[:3])
            if len(p) > 3:
                a = _n(p[3], 1.0)
            return (r, g, b, a)
        if s.startswith("hsl"):
            p, a = _args(s)
            h = float(p[0].replace("deg", "")); sat = _n(p[1], 1); l = _n(p[2], 1)
            if len(p) > 3:
                a = _n(p[3], 1.0)
            c = (1 - abs(2 * l - 1)) * sat; x = c * (1 - abs((h / 60) % 2 - 1)); m = l - c / 2
            seg = int(h // 60) % 6
            r, g, b = [(c, x, 0), (x, c, 0), (0, c, x), (0, x, c), (x, 0, c), (c, 0, x)][seg]
            return ((r + m) * 255, (g + m) * 255, (b + m) * 255, a)
        if s.startswith("color("):
            p, a = _args(s)
            space, vals = p[0], [_n(x, 1) for x in p[1:4]]
            if space in ("srgb", "display-p3", "srgb-linear"):
                if space == "srgb-linear":
                    vals = [_lin2srgb(v) for v in vals]
                return (vals[0] * 255, vals[1] * 255, vals[2] * 255, a)
            return None
        if s.startswith("oklch"):
            p, a = _args(s)
            L = _n(p[0], 1.0); C = _n(p[1], 0.4); H = float(p[2].replace("deg", "")) if p[2] != "none" else 0.0
            r, g, b = _oklab_to_srgb(L, C * math.cos(math.radians(H)), C * math.sin(math.radians(H)))
            return (r, g, b, a)
        if s.startswith("oklab"):
            p, a = _args(s)
            r, g, b = _oklab_to_srgb(_n(p[0], 1.0), _n(p[1], 0.4), _n(p[2], 0.4))
            return (r, g, b, a)
        if s.startswith("lch"):
            p, a = _args(s)
            L = _n(p[0], 100); C = _n(p[1], 150); H = float(p[2].replace("deg", "")) if p[2] != "none" else 0.0
            r, g, b = _lab_to_srgb(L, C * math.cos(math.radians(H)), C * math.sin(math.radians(H)))
            return (r, g, b, a)
        if s.startswith("lab"):
            p, a = _args(s)
            r, g, b = _lab_to_srgb(_n(p[0], 100), _n(p[1], 125), _n(p[2], 125))
            return (r, g, b, a)
        if s.startswith("#"):
            h = s[1:]
            if len(h) in (3, 4):
                h = "".join(c * 2 for c in h)
            r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
            a = int(h[6:8], 16) / 255 if len(h) == 8 else 1.0
            return (r, g, b, a)
    except (ValueError, IndexError, ZeroDivisionError):
        return None
    return None


def blend(top, bottom):
    a = top[3]
    return (top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a), 1.0)


def luminance(c):
    def ch(v):
        v = max(0.0, min(255.0, v)) / 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2])


def ratio(fg, bg):
    l1, l2 = luminance(fg), luminance(bg)
    hi, lo = max(l1, l2), min(l1, l2)
    return (hi + 0.05) / (lo + 0.05)


def hexify(c):
    return "#%02x%02x%02x" % tuple(int(round(max(0, min(255, v)))) for v in c[:3])
