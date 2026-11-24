"""Local fake media lenses used only by the WALK-04f self-test.

Mirrors selftest/fixture_app.py's shape (a local HTTP server; the fixture's
own inline scripts are the FAKE LENS's code — the walker's no-page-JS rule
binds the walker, never the fixture). Contains one healthy and one broken
surface per probe family:

- /lenses/mediadrawn   a 2D canvas painted with a gradient + shapes (varied)
- /lenses/mediablank   a canvas element left unpainted (uniform) — the bug shape
- /lenses/mediawebgl   a WebGL canvas drawing a coloured triangle
- /lenses/mediaaudio   a page with a Play button that starts an AudioContext
- /export/tone.wav     a 0.5 s 440 Hz tone export (audible)
- /export/silence.wav  a 0.5 s silent export — the bug shape
"""
import io
import json
import math
import struct
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DRAWN = r"""<!doctype html><html><head><meta name=viewport content="width=device-width,initial-scale=1">
<style>body{background:#101828;color:#eee;font:16px sans-serif;margin:0;padding:8px}</style></head><body>
<h1>Drawn canvas lens</h1>
<canvas id="stage" width="320" height="200" aria-label="Stage"></canvas>
<script>
const c = document.getElementById('stage'), x = c.getContext('2d');
const g = x.createLinearGradient(0, 0, 320, 200);
g.addColorStop(0, '#26418f'); g.addColorStop(1, '#f2a541');
x.fillStyle = g; x.fillRect(0, 0, 320, 200);
x.fillStyle = '#d64550'; x.beginPath(); x.arc(90, 90, 42, 0, 7); x.fill();
x.fillStyle = '#2a9d8f'; x.fillRect(180, 60, 90, 90);
</script></body></html>"""

BLANK = r"""<!doctype html><html><head><meta name=viewport content="width=device-width,initial-scale=1">
<style>body{background:#101828;color:#eee;font:16px sans-serif;margin:0;padding:8px}canvas{background:#101828}</style></head><body>
<h1>Blank canvas lens</h1>
<canvas id="stage" width="320" height="200" aria-label="Stage"></canvas>
</body></html>"""

WEBGL = r"""<!doctype html><html><head><meta name=viewport content="width=device-width,initial-scale=1">
<style>body{background:#0b0f14;color:#eee;font:16px sans-serif;margin:0;padding:8px}</style></head><body>
<h1>WebGL lens</h1>
<canvas id="gl" width="320" height="200" aria-label="Viewport"></canvas>
<script>
const gl = document.getElementById('gl').getContext('webgl');
gl.clearColor(0.08, 0.25, 0.45, 1); gl.clear(gl.COLOR_BUFFER_BIT);
</script></body></html>"""

AUDIO = r"""<!doctype html><html><head><meta name=viewport content="width=device-width,initial-scale=1">
<style>body{background:#111;color:#eee;font:16px sans-serif;margin:0;padding:8px}</style></head><body>
<h1>Audio lens</h1>
<button id="play">Play</button>
<a href="/export/tone.wav" download>Export tone</a>
<a href="/export/silence.wav" download>Export silence</a>
<script>
document.getElementById('play').onclick = () => {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const o = ctx.createOscillator(); o.frequency.value = 440; o.connect(ctx.destination); o.start();
};
</script></body></html>"""


def _wav_bytes(tone=True, seconds=0.5, rate=8000):
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


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="text/html", extra=None):
        b = body.encode() if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if self.path.startswith("/api/auth/me"):
            return self._send(200, json.dumps({"ok": True, "user": {"username": "zuko_qa_t1", "role": "member"}}), "application/json")
        if self.path.startswith("/lenses/mediadrawn"):
            return self._send(200, DRAWN)
        if self.path.startswith("/lenses/mediablank"):
            return self._send(200, BLANK)
        if self.path.startswith("/lenses/mediawebgl"):
            return self._send(200, WEBGL)
        if self.path.startswith("/lenses/mediaaudio"):
            return self._send(200, AUDIO)
        if self.path.startswith("/export/tone.wav"):
            return self._send(200, _wav_bytes(tone=True), "audio/wav",
                              {"Content-Disposition": "attachment; filename=tone.wav"})
        if self.path.startswith("/export/silence.wav"):
            return self._send(200, _wav_bytes(tone=False), "audio/wav",
                              {"Content-Disposition": "attachment; filename=silence.wav"})
        self._send(404, "not found")


def serve(port=0):
    srv = ThreadingHTTPServer(("127.0.0.1", port), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv
