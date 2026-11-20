"""Media probes — WALK-04f (GB-1544): canvas / WebGL pixel probes + audio probes.

No page JavaScript anywhere in this module: canvases are located through the
CDP DOM domain, pixels come from screenshots, interaction is native mouse,
audio state comes from the CDP WebAudio domain, and exported audio is judged
from the downloaded bytes. The only dependency is the standard library
(playwright is used by the caller, not imported here).

Verdict vocabulary: a probe returns a ProbeResult with a DRAFT verdict —
"FIXED_CANDIDATE", "STILL", or "NEEDS_HUMAN" — plus an evidence dict. A probe
never mints VERIFIED; the recipe layer (reverify) consumes the draft. The
acceptance rules from GB-1544 WALK-04f are encoded here:

- a blank or uniform canvas is never a FIXED_CANDIDATE;
- WebGL context lost is STILL (REOPENED in the walker's vocabulary);
- silent or empty exported audio is STILL;
- musical / picture quality is NEEDS_HUMAN — these probes judge presence,
  variance, and silence, never quality.

Thresholds are module constants; the config keys proposed for config.json
(WALK-02 owns that file; this module does not edit it) are:

    thresholds.canvas_min_unique_colours  -> MIN_UNIQUE_COLOURS
    thresholds.canvas_min_variance        -> MIN_VARIANCE
    thresholds.canvas_max_dominant        -> MAX_DOMINANT_FRACTION
    thresholds.canvas_diff_epsilon        -> DIFF_EPSILON
    thresholds.audio_silence_fraction     -> SILENCE_FRACTION

Driver protocol (duck-typed so selftests can stub it): the canvas probe
takes `cdp` — an object with `.s` (a Playwright CDP session: .send(method,
params)) and `.box(backend_id) -> (x, y, w, h) | None`, exactly the shape of
concord_walker.cdp.Cdp — plus `page` with `.screenshot(...)` and `.mouse`
(the LensWalk.shot / page.mouse surfaces). Wiring into LensWalk phases is a
follow-on once the private walker repo (WALK-00) settles; the functions
below are the interface that wiring will call.
"""
import io
import math
import re
import shutil
import struct
import subprocess
import wave
import zlib

# ------------------------------------------------------------------ tuning
MIN_UNIQUE_COLOURS = 8        # fewer distinct colours than this reads as flat
MIN_VARIANCE = 25.0           # mean per-channel variance below this reads as flat
MAX_DOMINANT_FRACTION = 0.995  # one colour covering >= this share reads as uniform
DIFF_EPSILON = 0.001          # pixel-diff fraction at/below this = "no change"
SILENCE_FRACTION = 0.001      # RMS / full-scale below this = silent
_SAMPLE_CAP = 200_000         # deterministic stride sampling above this many pixels

CONTEXT_LOST_RE = re.compile(r"(?i)context[ _-]?lost|CONTEXT_LOST_WEBGL|webglcontextlost")


class ProbeResult(dict):
    """{probe, draft, evidence} — a dict so it serialises into run journals."""

    def __init__(self, probe, draft, **evidence):
        super().__init__(probe=probe, draft=draft, evidence=evidence)


# ------------------------------------------------------------------ PNG core
class PngError(Exception):
    pass


def _paeth(a, b, c):
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def decode_png(data):
    """Decode an 8-bit non-interlaced PNG to (width, height, [(r, g, b, a), ...]).

    Pure stdlib (zlib). Colour types 0 (grey), 2 (RGB), 3 (palette), 4
    (grey+alpha), 6 (RGBA) — the set Chrome/Playwright screenshots use.
    Anything else raises PngError; callers treat that as "cannot judge",
    never as a pass.
    """
    if not data or data[:8] != b"\x89PNG\r\n\x1a\n":
        raise PngError("not a PNG")
    pos = 8
    idat = bytearray()
    plte = []
    width = height = bit_depth = colour_type = interlace = None
    while pos + 8 <= len(data):
        (length,) = struct.unpack(">I", data[pos:pos + 4])
        ctype = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if ctype == b"IHDR":
            width, height, bit_depth, colour_type, _comp, _filt, interlace = struct.unpack(">IIBBBBB", chunk)
        elif ctype == b"PLTE":
            plte = [tuple(chunk[i:i + 3]) for i in range(0, len(chunk) - 2, 3)]
        elif ctype == b"IDAT":
            idat.extend(chunk)
        elif ctype == b"IEND":
            break
    if width is None:
        raise PngError("no IHDR")
    if bit_depth != 8:
        raise PngError(f"bit depth {bit_depth} not supported (8 only)")
    if interlace != 0:
        raise PngError("interlaced PNG not supported")
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}.get(colour_type)
    if channels is None:
        raise PngError(f"colour type {colour_type} not supported")
    raw = zlib.decompress(bytes(idat))
    stride = width * channels
    out = bytearray(width * height * channels)
    prev = bytearray(stride)
    src = 0
    for y in range(height):
        filt = raw[src]
        src += 1
        line = bytearray(raw[src:src + stride])
        src += stride
        if filt == 1:  # Sub
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 0xFF
        elif filt == 2:  # Up
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif filt == 3:  # Average
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif filt == 4:  # Paeth
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                b = prev[i]
                c = prev[i - channels] if i >= channels else 0
                line[i] = (line[i] + _paeth(a, b, c)) & 0xFF
        elif filt != 0:
            raise PngError(f"unknown filter {filt}")
        out[y * stride:(y + 1) * stride] = line
        prev = line
    pixels = []
    if colour_type == 6:
        for i in range(0, len(out), 4):
            pixels.append((out[i], out[i + 1], out[i + 2], out[i + 3]))
    elif colour_type == 2:
        for i in range(0, len(out), 3):
            pixels.append((out[i], out[i + 1], out[i + 2], 255))
    elif colour_type == 0:
        for v in out:
            pixels.append((v, v, v, 255))
    elif colour_type == 4:
        for i in range(0, len(out), 2):
            pixels.append((out[i], out[i], out[i], out[i + 1]))
    else:  # palette
        for idx in out:
            if idx >= len(plte):
                raise PngError("palette index out of range")
            r, g, b = plte[idx]
            pixels.append((r, g, b, 255))
    return width, height, pixels


def _sample(pixels):
    if len(pixels) <= _SAMPLE_CAP:
        return pixels
    step = math.ceil(len(pixels) / _SAMPLE_CAP)
    return pixels[::step]


def pixel_stats(pixels):
    """Colour statistics over a (possibly sampled) pixel list."""
    px = _sample(pixels)
    n = len(px)
    if n == 0:
        return {"count": 0, "unique_colours": 0, "variance": 0.0, "dominant_fraction": 1.0}
    counts = {}
    sums = [0.0, 0.0, 0.0]
    for r, g, b, _a in px:
        counts[(r, g, b)] = counts.get((r, g, b), 0) + 1
        sums[0] += r
        sums[1] += g
        sums[2] += b
    means = [s / n for s in sums]
    var = 0.0
    for r, g, b, _a in px:
        var += (r - means[0]) ** 2 + (g - means[1]) ** 2 + (b - means[2]) ** 2
    var /= (3 * n)
    return {
        "count": n,
        "unique_colours": len(counts),
        "variance": round(var, 3),
        "dominant_fraction": round(max(counts.values()) / n, 4),
    }


def classify_pixels(stats):
    """'blank' | 'uniform' | 'varied' from pixel_stats output."""
    if stats["count"] == 0:
        return "blank"
    if stats["unique_colours"] <= 1:
        return "uniform"
    if stats["dominant_fraction"] >= MAX_DOMINANT_FRACTION and stats["variance"] < MIN_VARIANCE:
        return "uniform"
    if stats["unique_colours"] < MIN_UNIQUE_COLOURS and stats["variance"] < MIN_VARIANCE:
        return "uniform"
    return "varied"


def pixel_diff_fraction(pixels_a, pixels_b, channel_tolerance=8):
    """Fraction of sampled pixels whose RGB differs beyond tolerance."""
    if len(pixels_a) != len(pixels_b):
        raise PngError("diff needs same-size images")
    a, b = _sample(pixels_a), _sample(pixels_b)
    # Re-sample both with the same stride so indices line up.
    if len(pixels_a) > _SAMPLE_CAP:
        step = math.ceil(len(pixels_a) / _SAMPLE_CAP)
        a, b = pixels_a[::step], pixels_b[::step]
    if not a:
        return 0.0
    diff = 0
    for pa, pb in zip(a, b):
        if (abs(pa[0] - pb[0]) > channel_tolerance or abs(pa[1] - pb[1]) > channel_tolerance
                or abs(pa[2] - pb[2]) > channel_tolerance):
            diff += 1
    return round(diff / len(a), 5)


# ------------------------------------------------------------------ console
def scan_context_lost(console_errors, page_errors=()):
    """True when the walk's captured console/page errors report a lost WebGL context."""
    for text in list(console_errors or []) + list(page_errors or []):
        if CONTEXT_LOST_RE.search(str(text)):
            return True
    return False


# ------------------------------------------------------------------ canvas probe
def find_canvas_backends(cdp):
    """Backend DOM ids of every <canvas> in the document (CDP DOM domain, no page JS)."""
    try:
        doc = cdp.s.send("DOM.getDocument", {"depth": 0})
        root = doc["root"]["nodeId"]
        res = cdp.s.send("DOM.querySelectorAll", {"nodeId": root, "selector": "canvas"})
        return list(res.get("nodeIds") or [])
    except Exception:
        return []


def _clip_shot(page, box):
    x, y, w, h = box
    return page.screenshot(clip={"x": x, "y": y, "width": w, "height": h})


def probe_canvas(cdp, page, console_errors=(), page_errors=(), expect_interaction=False, drag=True):
    """Pixel-probe the largest canvas on the page.

    Draft rules: context lost -> STILL. No canvas -> NEEDS_HUMAN. Undecodable
    screenshot -> NEEDS_HUMAN. Blank/uniform -> STILL. Varied -> FIXED_CANDIDATE,
    except when expect_interaction is set and an orbit/drag leaves the pixels
    unchanged (diff <= DIFF_EPSILON) -> STILL with the diff as evidence.
    """
    if scan_context_lost(console_errors, page_errors):
        return ProbeResult("canvas", "STILL", reason="webgl_context_lost")
    node_ids = find_canvas_backends(cdp)
    if not node_ids:
        return ProbeResult("canvas", "NEEDS_HUMAN", reason="no_canvas_element")
    # DOM.querySelectorAll returns nodeIds; resolve backend ids via the AX/DOM
    # path the walker already uses: describe each node.
    best = None
    for nid in node_ids:
        try:
            desc = cdp.s.send("DOM.describeNode", {"nodeId": nid})
            backend = desc["node"]["backendNodeId"]
        except Exception:
            continue
        box = cdp.box(backend)
        if box and (best is None or box[2] * box[3] > best[1][2] * best[1][3]):
            best = (backend, box)
    if best is None:
        return ProbeResult("canvas", "NEEDS_HUMAN", reason="canvas_not_rendered")
    _backend, box = best
    try:
        shot_a = _clip_shot(page, box)
        w, h, pixels_a = decode_png(shot_a)
    except Exception as e:
        return ProbeResult("canvas", "NEEDS_HUMAN", reason=f"screenshot_undecodable:{e}")
    stats = pixel_stats(pixels_a)
    shape = classify_pixels(stats)
    ev = {"box": box, "image": [w, h], "stats": stats, "shape": shape}
    if shape != "varied":
        return ProbeResult("canvas", "STILL", **ev)
    if drag:
        cx, cy = box[0] + box[2] / 2, box[1] + box[3] / 2
        try:
            page.mouse.move(cx, cy)
            page.mouse.down()
            page.mouse.move(cx + box[2] / 4, cy + box[3] / 6, steps=8)
            page.mouse.up()
            shot_b = _clip_shot(page, box)
            _w2, _h2, pixels_b = decode_png(shot_b)
            ev["interaction_diff"] = pixel_diff_fraction(pixels_a, pixels_b)
        except Exception as e:
            ev["interaction_error"] = str(e)
    if expect_interaction and ev.get("interaction_diff") is not None and ev["interaction_diff"] <= DIFF_EPSILON:
        return ProbeResult("canvas", "STILL", reason="no_change_after_drag", **ev)
    return ProbeResult("canvas", "FIXED_CANDIDATE", **ev)


# ------------------------------------------------------------------ WebAudio probe
class WebAudioProbe:
    """Collects CDP WebAudio domain events from a CDP session (no page JS).

    Attach before navigating: probe = WebAudioProbe(cdp.s); probe.enable().
    The Playwright CDP session emits 'WebAudio.contextCreated' /
    'WebAudio.contextStateChanged' events; the shapes below follow the CDP
    WebAudio domain (BaseAudioContext carries contextId, contextType,
    sampleRate; state changes carry the new state).
    """

    def __init__(self, session):
        self.session = session
        self.contexts = {}  # contextId -> {context_type, sample_rate, state}
        session.on("WebAudio.contextCreated", self._on_created)
        session.on("WebAudio.contextStateChanged", self._on_state)

    def enable(self):
        self.session.send("WebAudio.enable")

    def _on_created(self, payload):
        ctx = (payload or {}).get("context") or {}
        cid = ctx.get("contextId")
        if cid:
            self.contexts[cid] = {
                "context_type": ctx.get("contextType"),
                "sample_rate": ctx.get("sampleRate"),
                "state": ctx.get("state") or "unknown",
            }

    def _on_state(self, payload):
        cid = (payload or {}).get("contextId")
        if cid in self.contexts:
            self.contexts[cid]["state"] = payload.get("state") or self.contexts[cid]["state"]

    def summary(self):
        states = [c["state"] for c in self.contexts.values()]
        return {
            "contexts": len(self.contexts),
            "states": states,
            "sample_rates": [c["sample_rate"] for c in self.contexts.values()],
            "any_running": any(s == "running" for s in states),
        }


def audio_draft(summary, expect_audio=True):
    """Draft verdict from a WebAudioProbe.summary().

    No context where audio is expected -> STILL. Contexts exist but none is
    running -> NEEDS_HUMAN (autoplay policy makes 'suspended' ambiguous from
    the probe alone; the states ride as evidence). Any running context ->
    FIXED_CANDIDATE. Musical quality is always a human call, never judged here.
    """
    if not expect_audio:
        return ProbeResult("webaudio", "NEEDS_HUMAN", reason="audio_not_expected", **summary)
    if summary["contexts"] == 0:
        return ProbeResult("webaudio", "STILL", reason="no_audio_context_created", **summary)
    if not summary["any_running"]:
        return ProbeResult("webaudio", "NEEDS_HUMAN", reason="context_not_running", **summary)
    return ProbeResult("webaudio", "FIXED_CANDIDATE", **summary)


# ------------------------------------------------------------------ exported audio
def _wav_stats(data):
    with wave.open(io.BytesIO(data), "rb") as wf:
        frames = wf.getnframes()
        width = wf.getsampwidth()
        rate = wf.getframerate()
        raw = wf.readframes(frames)
    if frames == 0 or rate == 0:
        return {"duration_s": 0.0, "rms_fraction": 0.0, "peak_fraction": 0.0}
    if width == 2:
        samples = struct.unpack(f"<{len(raw) // 2}h", raw[:len(raw) // 2 * 2])
        full = 32768.0
    elif width == 1:
        samples = [b - 128 for b in raw]
        full = 128.0
    elif width == 4:
        samples = struct.unpack(f"<{len(raw) // 4}i", raw[:len(raw) // 4 * 4])
        full = 2147483648.0
    else:
        raise PngError(f"wav sample width {width} unsupported")
    if not samples:
        return {"duration_s": 0.0, "rms_fraction": 0.0, "peak_fraction": 0.0}
    rms = math.sqrt(sum(s * s for s in samples) / len(samples)) / full
    peak = max(abs(s) for s in samples) / full
    return {"duration_s": round(frames / rate, 3), "rms_fraction": round(rms, 6),
            "peak_fraction": round(peak, 6)}


def _ffprobe_stats(data):
    """Duration via ffprobe when present; None when the tool is unavailable."""
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return None
    try:
        out = subprocess.run(
            [ffprobe, "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", "-"],
            input=data, capture_output=True, timeout=20)
        dur = float(out.stdout.decode().strip())
        return {"duration_s": round(dur, 3)}
    except Exception:
        return None


def probe_exported_audio(data, filename=""):
    """Judge a downloaded audio export from its bytes.

    Empty -> STILL. WAV is judged fully (duration + RMS + peak): silent or
    zero-length -> STILL, audible -> FIXED_CANDIDATE. Other formats get a
    duration via ffprobe when the tool exists, but RMS judgement stays
    NEEDS_HUMAN (never guess loudness from a container header).
    """
    if not data:
        return ProbeResult("exported_audio", "STILL", reason="empty_export")
    if data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        try:
            stats = _wav_stats(data)
        except Exception as e:
            return ProbeResult("exported_audio", "NEEDS_HUMAN", reason=f"wav_undecodable:{e}")
        if stats["duration_s"] <= 0 or stats["rms_fraction"] < SILENCE_FRACTION:
            return ProbeResult("exported_audio", "STILL", reason="silent_export", **stats)
        return ProbeResult("exported_audio", "FIXED_CANDIDATE", **stats)
    stats = _ffprobe_stats(data)
    if stats is None:
        return ProbeResult("exported_audio", "NEEDS_HUMAN",
                           reason="format_needs_ffprobe_or_human", filename=filename)
    if stats["duration_s"] <= 0:
        return ProbeResult("exported_audio", "STILL", reason="empty_export", **stats)
    return ProbeResult("exported_audio", "NEEDS_HUMAN",
                       reason="duration_only_rms_unjudged", **stats)


# ------------------------------------------------------------------ live RMS hook
def capture_live_rms_hook(**_kwargs):
    """'Sound actually plays' capture — BOX RUN HOST ONLY, not run by builders.

    The live leg (UPGRADE-PLAN U14) runs on the box after deploy: a headed
    browser on the run host, PulseAudio monitor source captured with ffmpeg,
    RMS computed over the capture window while the lens plays. This function
    is the interface the run host implements; in builder seats and in the
    Mac source copy it returns the structured unavailable result below so a
    missing live leg can never be mistaken for a pass.
    """
    return ProbeResult(
        "live_rms", "NEEDS_HUMAN",
        reason="box_run_host_only",
        plan="PulseAudio monitor + ffmpeg RMS on the box run host (U14); "
             "ship the hook, do not run live from a builder seat.")
