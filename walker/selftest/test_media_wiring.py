#!/usr/bin/env python3
"""WALK-04f wiring self-test (seat B11): the media-probe recipe layer.

No browser: the wiring under test is the clause layer + the evidence fold,
so the pins are wiring pins —
  * media outcome clauses classify to media_canvas / media_audio (with the
    export vs live surface read from the wording), while quality wording,
    failure-state wording, and the plain export-file clause do NOT classify
    as media (quality stays NEEDS_HUMAN; export_file keeps its own clause);
  * repro._gather runs the driver's probe capabilities only when a media
    clause demands them, and folds the ProbeResult into the evidence dict;
  * expected.check maps the module's draft vocabulary onto clause states
    under the module's own rule (STILL -> fail · FIXED_CANDIDATE -> pass as
    repro-steps evidence · NEEDS_HUMAN -> unchecked), and a driver without
    the capabilities leaves the clause unchecked — never passed;
  * the exported-audio surface judges the real bytes through the module's
    probe (silent WAV fails, sounding WAV passes).

The probes' own pixel/WAV judgement is pinned by test_media_probes.py
(18/18); the live exercise on a walked lens is the walker desk's run.
"""
import io
import math
import os
import struct
import sys
import unittest
import wave

HERE = os.path.dirname(os.path.abspath(__file__))
WALKER = os.path.dirname(HERE)
sys.path.insert(0, WALKER)

from concord_walker import expected as X
from concord_walker import media_probes as mp
from concord_walker import repro


def make_wav(tone=True, seconds=0.25, rate=8000):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(rate)
        frames = b"".join(
            struct.pack("<h", int(12000 * math.sin(2 * math.pi * 440 * i / rate)) if tone else 0)
            for i in range(int(rate * seconds)))
        wf.writeframes(frames)
    return buf.getvalue()


def kinds_of(text):
    return [k for _c, k in repro.classify_expected(text)]


def specs_of(text):
    out = []
    for c in X.split_clauses(text):
        out += X.classify_clause(c, repro._check_legacy) or []
    return out


class StubDriver:
    """Duck-typed driver: canned canvas draft; the audio surface runs the
    module's real exported-audio probe over configured bytes, and a canned
    draft for the live surface."""

    def __init__(self, canvas=None, wav=None, live=None):
        self._canvas = canvas
        self._wav = wav
        self._live = live
        self.canvas_flags = []

    def media_canvas_probe(self, expect_interaction=False):
        self.canvas_flags.append(bool(expect_interaction))
        return self._canvas

    def media_audio_probe(self, surface, export=None):
        if surface == "export":
            if self._wav is None or not (export or {}).get("file"):
                return None
            return dict(mp.probe_exported_audio(self._wav, export["file"]))
        return self._live


class BareDriver:
    pass


def run_clause(driver, expected_text, seed_ev=None):
    ticket = {"id": "w04f-wiring", "expected": expected_text}
    ev = dict(seed_ev or {})
    repro._gather(driver, ev, ticket, [], None)
    snap = {"controls": [], "texts": [], "dialogs": [], "errors": 0, "evidence": ev}
    return repro.check_expected(expected_text, snap), ev


class TestClassification(unittest.TestCase):
    def test_canvas_clauses_classify(self):
        self.assertIn("media_canvas", kinds_of("The canvas renders the scene"))
        self.assertIn("media_canvas", kinds_of("The canvas is not blank"))
        self.assertIn("media_canvas", kinds_of("The WebGL canvas displays the model"))

    def test_audio_clauses_classify_with_surface(self):
        sp = specs_of("The exported track is not silent")
        self.assertEqual([s["kind"] for s in sp], ["media_audio"])
        self.assertEqual(sp[0].get("surface"), "export")
        sp = specs_of("Audio plays in the player")
        self.assertEqual([s["kind"] for s in sp], ["media_audio"])
        self.assertEqual(sp[0].get("surface"), "live")

    def test_quality_and_failstate_stay_human(self):
        self.assertEqual(kinds_of("The music sounds beautiful"), [None])
        self.assertEqual(kinds_of("The canvas is blank"), [None])
        self.assertEqual(kinds_of("The canvas does not render"), [None])

    def test_plain_export_clause_not_stolen(self):
        ks = kinds_of("Export downloads a JSON file")
        self.assertIn("export_file", ks)
        self.assertNotIn("media_audio", ks)


class TestWiring(unittest.TestCase):
    def test_blank_canvas_fails_varied_passes(self):
        blank = dict(mp.ProbeResult("canvas", "STILL", shape="uniform",
                                    stats={"unique_colours": 1, "variance": 0.0}))
        chk, _ev = run_clause(StubDriver(canvas=blank), "The canvas renders the scene")
        self.assertEqual(chk["state"], "fail")
        varied = dict(mp.ProbeResult("canvas", "FIXED_CANDIDATE", shape="varied",
                                     stats={"unique_colours": 64, "variance": 900.0}))
        chk, _ev = run_clause(StubDriver(canvas=varied), "The canvas renders the scene")
        self.assertEqual(chk["state"], "pass")

    def test_probe_unjudged_and_missing_capability_stay_unchecked(self):
        human = dict(mp.ProbeResult("canvas", "NEEDS_HUMAN", reason="no_canvas_element"))
        chk, _ev = run_clause(StubDriver(canvas=human), "The canvas renders the scene")
        self.assertEqual(chk["state"], "unchecked")
        chk, ev = run_clause(BareDriver(), "The canvas renders the scene")
        self.assertEqual(chk["state"], "unchecked")
        self.assertNotIn("media_canvas", ev)

    def test_interaction_flag_flows_from_clause(self):
        d = StubDriver(canvas=dict(mp.ProbeResult("canvas", "FIXED_CANDIDATE", shape="varied",
                                                  stats={"unique_colours": 32, "variance": 500.0})))
        chk, _ev = run_clause(d, "The canvas renders the scene on drag")
        self.assertEqual(chk["state"], "pass")
        self.assertEqual(d.canvas_flags, [True])

    def test_exported_audio_judged_from_bytes(self):
        seed = {"export": {"file": "take.wav", "verdict": "PASS", "ok": True, "bytes": 1}}
        chk, _ev = run_clause(StubDriver(wav=make_wav(tone=False)),
                              "The exported track is not silent", seed)
        self.assertEqual(chk["state"], "fail")
        chk, _ev = run_clause(StubDriver(wav=make_wav(tone=True)),
                              "The exported track is not silent", seed)
        self.assertEqual(chk["state"], "pass")

    def test_live_audio_drafts(self):
        suspended = dict(mp.ProbeResult("webaudio", "NEEDS_HUMAN", reason="context_not_running",
                                        contexts=1, any_running=False))
        chk, _ev = run_clause(StubDriver(live=suspended), "Audio plays in the player")
        self.assertEqual(chk["state"], "unchecked")
        running = dict(mp.ProbeResult("webaudio", "FIXED_CANDIDATE", contexts=1, any_running=True))
        chk, _ev = run_clause(StubDriver(live=running), "Audio plays in the player")
        self.assertEqual(chk["state"], "pass")
        silent = dict(mp.ProbeResult("webaudio", "STILL", reason="no_audio_context_created",
                                     contexts=0, any_running=False))
        chk, _ev = run_clause(StubDriver(live=silent), "Audio plays in the player")
        self.assertEqual(chk["state"], "fail")


if __name__ == "__main__":
    unittest.main()
