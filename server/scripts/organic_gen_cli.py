#!/usr/bin/env python3
"""organic_gen_cli.py — Concord's bridge to hosted open-weight generators.

Called by server/lib/asset-gen/organic/providers.js the same way
lib/conkay/occ-bridge.js calls conkay_occ_cli.py:

    <venv python> organic_gen_cli.py <command> '<json payload>'

prints ONE JSON object on stdout. Never raises to the caller; failures come
back as {"ok": false, "reason": ...} so Node can report them honestly.

Commands
  concept  {prompt, out, seed?, width?, height?}
           FLUX.1-schnell (Apache-2.0) text -> concept image, raw bytes as
           served (WebP today) plus the sniffed `format`.
  mesh     {image, out, seed?, resolution?, space?}
           image -> textured GLB via TRELLIS.2 (MIT), falling back to
           trellis-community/TRELLIS when TRELLIS.2 is unavailable.

Environment
  HF_TOKEN  Hugging Face token (ZeroGPU quota is per account; anonymous
            quota is ~2 GPU-min/day). Read from the environment only.

Venv: ~/.zuko/venvs/concord-gen (Python 3.12 + gradio_client 2.7.1).
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import time

FLUX_SPACE = "black-forest-labs/FLUX.1-schnell"
TRELLIS2_SPACE = "microsoft/TRELLIS.2"
TRELLIS1_SPACE = "trellis-community/TRELLIS"
# TRELLIS.2's extract_glb rejects decimation targets below 100k faces;
# Concord's game-lod pass brings the result to the bible budget afterwards.
TRELLIS2_MIN_FACES = 100000


def classify(exc: Exception) -> str:
    msg = str(exc)
    low = msg.lower()
    if "zerogpu quota" in low or "exceeded your" in low and "quota" in low:
        return "quota_exhausted"
    if "invalid state" in low or "runtime_error" in low or "config_error" in low or "sleeping" in low:
        return "provider_down"
    if "401" in msg or "unauthorized" in low or "invalid token" in low:
        return "bad_token"
    return "provider_error"


def fail(exc: Exception, **extra) -> dict:
    return {"ok": False, "reason": classify(exc), "error": f"{type(exc).__name__}: {str(exc)[:400]}", **extra}


def sniff(path: str) -> str:
    with open(path, "rb") as f:
        head = f.read(12)
    if head.startswith(b"\x89PNG"):
        return "png"
    if head[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    return "unknown"


def _path(result) -> str | None:
    if isinstance(result, dict):
        return result.get("path") or result.get("video")
    return result if isinstance(result, str) else None


def client(space: str):
    from gradio_client import Client
    return Client(space, token=os.environ.get("HF_TOKEN") or None, verbose=False)


def cmd_concept(p: dict) -> dict:
    prompt, out = p.get("prompt"), p.get("out")
    if not prompt or not out:
        return {"ok": False, "reason": "missing_prompt_or_out"}
    t = time.time()
    try:
        res = client(FLUX_SPACE).predict(
            prompt=prompt, seed=int(p.get("seed", 0)), randomize_seed=False,
            width=int(p.get("width", 1024)), height=int(p.get("height", 1024)),
            num_inference_steps=4, api_name="/infer",
        )
        src = _path(res[0] if isinstance(res, (list, tuple)) else res)
        if not src or not os.path.exists(src):
            return {"ok": False, "reason": "no_image_returned"}
        # Raw bytes as the Space returned them (FLUX.1-schnell serves WebP).
        # `format` is sniffed from magic bytes so Node never trusts a name.
        shutil.copy(src, out)
        return {"ok": True, "provider": FLUX_SPACE, "path": out, "format": sniff(out),
                "seconds": round(time.time() - t, 1)}
    except Exception as exc:  # noqa: BLE001 — every failure is reported, never raised
        return fail(exc, provider=FLUX_SPACE)


def _trellis2(image: str, out: str, seed: int, resolution: str) -> dict:
    from gradio_client import handle_file
    c = client(TRELLIS2_SPACE)
    c.predict(api_name="/start_session")
    pre = c.predict(input=handle_file(image), api_name="/preprocess_image")
    params = c.view_api(return_format="dict", print_info=False)["named_endpoints"]["/image_to_3d"]["parameters"]
    kwargs = {x["parameter_name"]: x.get("parameter_default") for x in params}
    kwargs.update(image=handle_file(_path(pre)), seed=seed, resolution=resolution)
    c.predict(**kwargs, api_name="/image_to_3d")
    res = c.predict(decimation_target=TRELLIS2_MIN_FACES, texture_size=2048, api_name="/extract_glb")
    for item in (res if isinstance(res, (list, tuple)) else [res]):
        src = _path(item)
        if src and src.lower().endswith(".glb") and os.path.exists(src):
            shutil.copy(src, out)
            return {"ok": True, "provider": TRELLIS2_SPACE, "path": out}
    return {"ok": False, "reason": "no_glb_returned", "provider": TRELLIS2_SPACE}


def _trellis1(image: str, out: str, seed: int) -> dict:
    from gradio_client import handle_file
    c = client(TRELLIS1_SPACE)
    c.predict(api_name="/start_session")
    res = c.predict(image=handle_file(image), multiimages=[], seed=seed, ss_guidance_strength=7.5,
                    ss_sampling_steps=12, slat_guidance_strength=3, slat_sampling_steps=12,
                    multiimage_algo="stochastic", api_name="/generate_and_extract_glb")
    src = _path(res[1]) if isinstance(res, (list, tuple)) and len(res) > 1 else None
    if src and os.path.exists(src):
        shutil.copy(src, out)
        return {"ok": True, "provider": TRELLIS1_SPACE, "path": out}
    return {"ok": False, "reason": "no_glb_returned", "provider": TRELLIS1_SPACE}


def cmd_mesh(p: dict) -> dict:
    image, out = p.get("image"), p.get("out")
    if not image or not out or not os.path.exists(image):
        return {"ok": False, "reason": "missing_image_or_out"}
    seed = int(p.get("seed", 0))
    order = [p["space"]] if p.get("space") else [TRELLIS2_SPACE, TRELLIS1_SPACE]
    attempts = []
    for space in order:
        t = time.time()
        try:
            r = _trellis2(image, out, seed, str(p.get("resolution", "1024"))) if space == TRELLIS2_SPACE \
                else _trellis1(image, out, seed)
        except Exception as exc:  # noqa: BLE001
            r = fail(exc, provider=space)
        r["seconds"] = round(time.time() - t, 1)
        if r.get("ok"):
            r["attempts"] = attempts
            return r
        attempts.append(r)
        # Quota is per account, not per Space: falling back would fail the same way.
        if r.get("reason") in ("quota_exhausted", "bad_token"):
            break
    last = attempts[-1] if attempts else {"reason": "no_provider"}
    return {"ok": False, "reason": last.get("reason"), "attempts": attempts}


COMMANDS = {"concept": cmd_concept, "mesh": cmd_mesh}


def main() -> int:
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        print(json.dumps({"ok": False, "reason": "unknown_command", "commands": sorted(COMMANDS)}))
        return 0
    try:
        payload = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
    except json.JSONDecodeError as exc:
        print(json.dumps({"ok": False, "reason": "bad_json", "error": str(exc)}))
        return 0
    print(json.dumps(COMMANDS[sys.argv[1]](payload)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
