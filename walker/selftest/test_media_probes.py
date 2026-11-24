"""WALK-04f self-tests for concord_walker/media_probes.py.

Run anywhere (stdlib only):  python3 -m unittest selftest.test_media_probes
On the pristine walker this file fails at import (the module does not
exist) — that is the fail-on-pristine leg. The PNG / stats / WAV legs are
pure; the CDP-facing legs run against stub sessions/pages, so no browser
is needed. The live-browser exercise against fixture_media.py's pages is
the run host's (the walker selftest harness), not this file's.
"""
import io
import math
import struct
import unittest
import wave
import zlib

from concord_walker import media_probes as mp


# --------------------------------------------------------------- PNG factory
def _chunk(ctype, payload):
    c = struct.pack(">I", len(payload)) + ctype + payload
    return c + struct.pack(">I", zlib.crc32(ctype + payload) & 0xFFFFFFFF)


def make_png(width, height, pixel_fn, colour_type=6, filter_type=0):
    """pixel_fn(x, y) -> tuple matching colour_type (6 RGBA, 2 RGB, 0 grey)."""
    channels = {6: 4, 2: 3, 0: 1}[colour_type]
    rows = bytearray()
    prev = [0] * (width * channels)
    for y in range(height):
        line = bytearray()
        for x in range(width):
            line.extend(pixel_fn(x, y))
        if filter_type == 1:  # Sub: store deltas from the left neighbour
            enc = bytearray(line)
            for i in range(len(line) - 1, channels - 1, -1):
                enc[i] = (line[i] - line[i - channels]) & 0xFF
            rows.append(1)
            rows.extend(enc)
        else:
            rows.append(0)
            rows.extend(line)
        prev = line
    ihdr = struct.pack(">IIBBBBB", width, height, 8, colour_type, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", ihdr)
            + _chunk(b"IDAT", zlib.compress(bytes(rows))) + _chunk(b"IEND", b""))


def gradient_png(w=40, h=30):
    return make_png(w, h, lambda x, y: (x * 6 % 256, y * 8 % 256, (x + y) * 3 % 256, 255))


def uniform_png(w=40, h=30, rgba=(16, 24, 40, 255)):
    return make_png(w, h, lambda x, y: rgba)


# --------------------------------------------------------------- stub driver
class FakeSession:
    def __init__(self, canvas_node_ids=(7,)):
        self.handlers = {}
        self.sent = []
        self.canvas_node_ids = list(canvas_node_ids)

    def on(self, event, fn):
        self.handlers[event] = fn

    def emit(self, event, payload):
        self.handlers[event](payload)

    def send(self, method, params=None):
        self.sent.append(method)
        if method == "DOM.getDocument":
            return {"root": {"nodeId": 1}}
        if method == "DOM.querySelectorAll":
            return {"nodeIds": self.canvas_node_ids}
        if method == "DOM.describeNode":
            return {"node": {"backendNodeId": 42}}
        if method == "WebAudio.enable":
            return {}
        raise AssertionError(f"unexpected CDP call {method}")


class FakeCdp:
    def __init__(self, session, box=(0, 0, 100, 60)):
        self.s = session
        self._box = box

    def box(self, _backend):
        return self._box


class FakeMouse:
    def __init__(self):
        self.moves = []

    def move(self, x, y, steps=None):
        self.moves.append((x, y))

    def down(self):
        pass

    def up(self):
        pass


class FakePage:
    def __init__(self, shots):
        self._shots = list(shots)
        self.mouse = FakeMouse()

    def screenshot(self, clip=None, **_kw):
        return self._shots.pop(0)


# --------------------------------------------------------------- WAV factory
def make_wav(tone=True, seconds=0.5, rate=8000):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(rate)
        frames = bytearray()
        for i in range(int(rate * seconds)):
            v = int(12000 * math.sin(2 * math.pi * 440 * i / rate)) if tone else 0
            frames += struct.pack("<h", v)
        wf.writeframes(bytes(frames))
    return buf.getvalue()


class TestPngCore(unittest.TestCase):
    def test_decode_rgba_gradient(self):
        w, h, px = mp.decode_png(gradient_png())
        self.assertEqual((w, h), (40, 30))
        self.assertEqual(len(px), 40 * 30)
        self.assertEqual(px[0], (0, 0, 0, 255))

    def test_decode_rgb_and_grey(self):
        rgb = make_png(4, 3, lambda x, y: (10, 20, 30), colour_type=2)
        self.assertEqual(mp.decode_png(rgb)[2][0], (10, 20, 30, 255))
        grey = make_png(4, 3, lambda x, y: (77,), colour_type=0)
        self.assertEqual(mp.decode_png(grey)[2][0], (77, 77, 77, 255))

    def test_decode_sub_filtered_rows(self):
        png = make_png(10, 4, lambda x, y: (x * 20 % 256, 5, 9, 255), filter_type=1)
        _w, _h, px = mp.decode_png(png)
        self.assertEqual(px[3], (60, 5, 9, 255))

    def test_not_a_png_raises(self):
        with self.assertRaises(mp.PngError):
            mp.decode_png(b"definitely not a png")

    def test_uniform_classifies_uniform_varied_classifies_varied(self):
        _w, _h, upx = mp.decode_png(uniform_png())
        self.assertEqual(mp.classify_pixels(mp.pixel_stats(upx)), "uniform")
        _w, _h, gpx = mp.decode_png(gradient_png())
        self.assertEqual(mp.classify_pixels(mp.pixel_stats(gpx)), "varied")

    def test_diff_fraction(self):
        _w, _h, a = mp.decode_png(gradient_png())
        _w, _h, same = mp.decode_png(gradient_png())
        self.assertEqual(mp.pixel_diff_fraction(a, same), 0.0)
        _w, _h, other = mp.decode_png(uniform_png())
        self.assertGreater(mp.pixel_diff_fraction(a, other), 0.5)


class TestContextLost(unittest.TestCase):
    def test_scan(self):
        self.assertTrue(mp.scan_context_lost(["WebGL: CONTEXT_LOST_WEBGL: loseContext"]))
        self.assertTrue(mp.scan_context_lost([], ["Error: webglcontextlost event"]))
        self.assertFalse(mp.scan_context_lost(["some other error"], []))


class TestCanvasProbe(unittest.TestCase):
    def _run(self, shots, **kw):
        cdp = FakeCdp(FakeSession())
        return mp.probe_canvas(cdp, FakePage(shots), **kw)

    def test_drawn_canvas_is_fixed_candidate(self):
        r = self._run([gradient_png(100, 60), gradient_png(100, 60)])
        self.assertEqual(r["draft"], "FIXED_CANDIDATE")
        self.assertEqual(r["evidence"]["shape"], "varied")

    def test_blank_canvas_is_still_never_a_candidate(self):
        r = self._run([uniform_png(100, 60)])
        self.assertEqual(r["draft"], "STILL")
        self.assertEqual(r["evidence"]["shape"], "uniform")

    def test_context_lost_is_still(self):
        r = self._run([gradient_png(100, 60)], console_errors=["CONTEXT_LOST_WEBGL"])
        self.assertEqual(r["draft"], "STILL")
        self.assertEqual(r["evidence"]["reason"], "webgl_context_lost")

    def test_no_canvas_is_needs_human(self):
        cdp = FakeCdp(FakeSession(canvas_node_ids=()))
        r = mp.probe_canvas(cdp, FakePage([]))
        self.assertEqual(r["draft"], "NEEDS_HUMAN")

    def test_drag_with_no_change_is_still_when_interaction_expected(self):
        shot = gradient_png(100, 60)
        r = self._run([shot, shot], expect_interaction=True)
        self.assertEqual(r["draft"], "STILL")
        self.assertEqual(r["evidence"]["reason"], "no_change_after_drag")

    def test_drag_with_change_stays_candidate(self):
        r = self._run([gradient_png(100, 60), uniform_png(100, 60, (200, 30, 30, 255))],
                      expect_interaction=True)
        # The second shot differs everywhere from the gradient.
        self.assertEqual(r["draft"], "FIXED_CANDIDATE")
        self.assertGreater(r["evidence"]["interaction_diff"], 0.5)


class TestWebAudioProbe(unittest.TestCase):
    def test_no_context_is_still(self):
        s = FakeSession()
        p = mp.WebAudioProbe(s)
        p.enable()
        self.assertEqual(mp.audio_draft(p.summary())["draft"], "STILL")

    def test_running_context_is_candidate(self):
        s = FakeSession()
        p = mp.WebAudioProbe(s)
        p.enable()
        s.emit("WebAudio.contextCreated",
               {"context": {"contextId": "c1", "contextType": "destination", "sampleRate": 48000}})
        s.emit("WebAudio.contextStateChanged", {"contextId": "c1", "state": "running"})
        d = mp.audio_draft(p.summary())
        self.assertEqual(d["draft"], "FIXED_CANDIDATE")
        self.assertEqual(d["evidence"]["sample_rates"], [48000])

    def test_suspended_context_is_needs_human(self):
        s = FakeSession()
        p = mp.WebAudioProbe(s)
        p.enable()
        s.emit("WebAudio.contextCreated",
               {"context": {"contextId": "c1", "contextType": "destination", "sampleRate": 44100}})
        s.emit("WebAudio.contextStateChanged", {"contextId": "c1", "state": "suspended"})
        self.assertEqual(mp.audio_draft(p.summary())["draft"], "NEEDS_HUMAN")


class TestExportedAudio(unittest.TestCase):
    def test_tone_is_candidate_silence_and_empty_are_still(self):
        self.assertEqual(mp.probe_exported_audio(make_wav(tone=True))["draft"], "FIXED_CANDIDATE")
        r = mp.probe_exported_audio(make_wav(tone=False))
        self.assertEqual(r["draft"], "STILL")
        self.assertEqual(r["evidence"]["reason"], "silent_export")
        self.assertEqual(mp.probe_exported_audio(b"")["draft"], "STILL")

    def test_live_hook_is_structured_unavailable(self):
        r = mp.capture_live_rms_hook()
        self.assertEqual(r["draft"], "NEEDS_HUMAN")
        self.assertEqual(r["evidence"]["reason"], "box_run_host_only")


if __name__ == "__main__":
    unittest.main()
