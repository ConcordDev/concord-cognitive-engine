#!/usr/bin/env python3
"""concord_gen_server.py — Concord's organic-asset generation service (GPU pod).

Runs on the A40 generation pod, bound to 127.0.0.1 only; Concord reaches it
through an SSH tunnel (see README.md). JSON over HTTP, one request at a time.

  GET  /health   -> {ok, gpu, vram_used_gb, weights:{...present?}, loaded}
  POST /concept  {prompt, seed?, width?, height?, steps?}
                 -> {ok, png_b64, seconds}           FLUX.1-schnell (Apache-2.0)
  POST /mesh     {image_b64, seed?, engine?, pipeline_type?, decimation_target?, texture_size?}
                 -> {ok, glb_b64, seconds, faces, engine}
                 engine "trellis2" (TRELLIS.2-4B, MIT; needs DINOv3) or "trellis1"
                 (TRELLIS-image-large, MIT, + DINOv2 Apache-2.0, ungated). Default:
                 trellis2 when its DINOv3 weights are present, else trellis1.

Licensing is deliberate, not incidental:
  * Background removal uses ZhengPeng7/BiRefNet (MIT). TRELLIS.2's stock
    pipeline.json names briaai/RMBG-2.0, which is licensed for non-commercial
    use only; Concord is commercial, so that model is never loaded here.
  * The image encoder is facebook/dinov3-vitl16-pretrain-lvd1689m (Meta's
    DINOv3 license, gated with manual approval). TRELLIS.2 is trained on its
    features, so there is no drop-in substitute.
  * FLUX.1-schnell is Apache-2.0 but gated (click-through) on Hugging Face.

VRAM: the A40 has 46 GB. FLUX.1-schnell in bf16 needs ~34 GB and TRELLIS.2
~24 GB at 1024 resolution, so only one lives on the GPU at a time; the other
is parked in system RAM (the pod has 503 GB). Run all concepts, then all
meshes, to avoid swapping per request.

Every failure is a JSON {ok:false, reason} — never a placeholder asset.
"""
from __future__ import annotations

import base64
import gc
import io
import json
import os
import re
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODELS = os.environ.get("CONCORD_GEN_MODELS", "/workspace/models")
TRELLIS_REPO = os.environ.get("CONCORD_TRELLIS_REPO", "/root/gen/TRELLIS.2")
TRELLIS1_REPO = os.environ.get("CONCORD_TRELLIS1_REPO", "/root/gen/TRELLIS")
# 7870, not 7860/7861: on RunPod, nginx owns 0.0.0.0:7861 and publicly proxies
# it (to :7860). This service binds 127.0.0.1 only and is reached by SSH tunnel.
PORT = int(os.environ.get("CONCORD_GEN_PORT", "7870"))

# A repo counts as present only when its download finished with zero
# failures: the weight scripts write <repo>/.concord_complete last. Checking a
# single small file reported FLUX "present" while its 23 GB were still arriving.
MARK = ".concord_complete"
WEIGHTS = {
    "trellis2": f"{MODELS}/microsoft/TRELLIS.2-4B/{MARK}",
    "ss_decoder": f"{MODELS}/microsoft/TRELLIS-image-large/{MARK}",
    "birefnet_mit": f"{MODELS}/ZhengPeng7/BiRefNet/{MARK}",
    "dinov3": f"{MODELS}/facebook/dinov3-vitl16-pretrain-lvd1689m/{MARK}",
    "flux_schnell": f"{MODELS}/black-forest-labs/FLUX.1-schnell/{MARK}",
    "trellis1": f"{MODELS}/microsoft/TRELLIS-image-large/{MARK}",
}

sys.path.insert(0, TRELLIS_REPO)
sys.path.insert(0, TRELLIS1_REPO)
# Both engines use flash-attn for attention. v1 reads SPARSE_BACKEND, v2 reads
# SPARSE_CONV_BACKEND, so one environment serves both without conflict.
os.environ.setdefault("ATTN_BACKEND", "flash-attn")
os.environ.setdefault("SPARSE_BACKEND", "spconv")
os.environ.setdefault("SPCONV_ALGO", "native")

_lock = threading.Lock()
_state = {"trellis": None, "trellis1": None, "flux": None, "on_gpu": None, "served": 0, "errors": 0}
HEAVY = ("trellis", "trellis1", "flux")


def weights_status():
    return {k: os.path.exists(p) for k, p in WEIGHTS.items()}


def missing(*keys):
    st = weights_status()
    return [k for k in keys if not st[k]]


def concord_pipeline_config():
    """Write pipeline.concord.json: stock TRELLIS.2 args with every model local
    and the MIT background remover instead of RMBG-2.0."""
    base = f"{MODELS}/microsoft/TRELLIS.2-4B"
    with open(f"{base}/pipeline.json") as f:
        cfg = json.load(f)
    args = cfg["args"]
    for k, v in args["models"].items():
        if v.startswith("microsoft/TRELLIS-image-large/"):
            args["models"][k] = f"{MODELS}/{v}"  # absolute: base.py falls back to the raw path
    args["rembg_model"] = {"name": "BiRefNet", "args": {"model_name": f"{MODELS}/ZhengPeng7/BiRefNet"}}
    args["image_cond_model"]["args"]["model_name"] = f"{MODELS}/facebook/dinov3-vitl16-pretrain-lvd1689m"
    with open(f"{base}/pipeline.concord.json", "w") as f:
        json.dump(cfg, f, indent=1)
    return base


def to_gpu(name):
    import torch
    if _state["on_gpu"] == name:
        return
    for other in HEAVY:
        if other != name and _state[other] is not None:
            _state[other].to("cpu")
    torch.cuda.empty_cache()
    _state[name].to("cuda")
    _state["on_gpu"] = name


def load_trellis():
    if _state["trellis"] is None:
        from trellis2.pipelines import Trellis2ImageTo3DPipeline
        base = concord_pipeline_config()
        _state["trellis"] = Trellis2ImageTo3DPipeline.from_pretrained(base, config_file="pipeline.concord.json")
    to_gpu("trellis")
    return _state["trellis"]


def load_trellis1():
    if _state["trellis1"] is None:
        from trellis.pipelines import TrellisImageTo3DPipeline
        _state["trellis1"] = TrellisImageTo3DPipeline.from_pretrained(f"{MODELS}/microsoft/TRELLIS-image-large")
    to_gpu("trellis1")
    return _state["trellis1"]


def default_engine():
    return "trellis2" if not missing("trellis2", "ss_decoder", "birefnet_mit", "dinov3") else "trellis1"


def load_flux():
    if _state["flux"] is None:
        import torch
        from diffusers import FluxPipeline
        _state["flux"] = FluxPipeline.from_pretrained(
            f"{MODELS}/black-forest-labs/FLUX.1-schnell", torch_dtype=torch.bfloat16)
    to_gpu("flux")
    return _state["flux"]


def _token_count(tokenizer, text):
    return len(tokenizer(text, add_special_tokens=True)["input_ids"])


def _clip_safe_prompt(pipe, full_text):
    """FLUX's CLIP-L tower has a hard 77-token positional-embedding limit — not
    a config value, baked into the model — so it can never be raised. When
    diffusers.FluxPipeline.encode_prompt() isn't given a separate prompt_2, it
    silently reuses `prompt` for BOTH encoders (`prompt_2 = prompt_2 or
    prompt`), so CLIP truncates at an arbitrary word boundary and drops
    whatever came after, with only a log warning to show for it.

    T5-XXL (the encoder that actually drives FLUX's detailed/spatial
    conditioning; CLIP only contributes a single pooled "global style" vector)
    has no such limit — up to 512 tokens — so the real fix is to ALWAYS pass
    the full prompt via `prompt_2` and let CLIP's shorter `prompt` argument be
    a deliberately-chosen prefix instead of an accidental one.

    This greedily accumulates whole sentences (never mid-sentence) until one
    more would cross CLIP's own limit, so CLIP's input is always coherent
    text, front-loaded with content by construction — the exact fix that had
    to be done by hand per-prompt before (domebreaker/wraith reordering) now
    happens automatically for every prompt.
    """
    tok = pipe.tokenizer
    limit = pipe.tokenizer_max_length  # 77 for FLUX's CLIP-L tower
    sentences = re.split(r"(?<=[.!?])\s+", full_text.strip())
    out = ""
    for s in sentences:
        candidate = f"{out} {s}".strip() if out else s
        if _token_count(tok, candidate) > limit:
            break
        out = candidate
    return out or full_text


def do_concept(req):
    miss = missing("flux_schnell")
    if miss:
        return {"ok": False, "reason": "weights_missing", "missing": miss}
    import torch
    t = time.time()
    pipe = load_flux()
    full_prompt = req["prompt"]
    clip_prompt = _clip_safe_prompt(pipe, full_prompt)
    # T5's own true ceiling (diffusers raises above 512); our longest bible
    # prompts run ~1400 chars / ~300-350 tokens, comfortably inside it, but
    # report the real count rather than assume — a future prompt that DOES
    # cross 512 deserves an honest flag, not a silent drop.
    t5_max = 512
    t5_tokens = _token_count(pipe.tokenizer_2, full_prompt)
    img = pipe(
        clip_prompt, prompt_2=full_prompt,
        guidance_scale=0.0, num_inference_steps=int(req.get("steps", 4)),
        width=int(req.get("width", 1024)), height=int(req.get("height", 1024)),
        max_sequence_length=t5_max,
        generator=torch.Generator("cpu").manual_seed(int(req.get("seed", 0))),
    ).images[0]
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return {
        "ok": True, "provider": "local-gpu:FLUX.1-schnell",
        "png_b64": base64.b64encode(buf.getvalue()).decode(),
        "seconds": round(time.time() - t, 1),
        "clip_prompt_used": clip_prompt,
        "clip_tokens": _token_count(pipe.tokenizer, clip_prompt),
        "t5_tokens": t5_tokens,
        "t5_truncated": t5_tokens > t5_max,
    }


def do_mesh_trellis1(req):
    miss = missing("trellis1")
    if miss:
        return {"ok": False, "reason": "weights_missing", "missing": miss}
    from PIL import Image
    from trellis.utils import postprocessing_utils
    t = time.time()
    pipe = load_trellis1()
    image = Image.open(io.BytesIO(base64.b64decode(req["image_b64"])))
    out = pipe.run(image, seed=int(req.get("seed", 0)), formats=["gaussian", "mesh"],
                   sparse_structure_sampler_params={"steps": 12, "cfg_strength": 7.5},
                   slat_sampler_params={"steps": 12, "cfg_strength": 3})
    # to_glb bakes the Gaussian appearance onto the extracted mesh (trimesh).
    # simplify is the fraction of faces REMOVED; Concord's game-lod pass does
    # the real budget decimation afterwards, so keep plenty of detail here.
    textured = postprocessing_utils.to_glb(out["gaussian"][0], out["mesh"][0],
                                           simplify=float(req.get("simplify", 0.9)),
                                           texture_size=int(req.get("texture_size", 2048)), verbose=False)
    data = textured.export(file_type="glb")
    return {"ok": True, "provider": "local-gpu:TRELLIS-image-large", "engine": "trellis1",
            "glb_b64": base64.b64encode(data).decode(), "faces": int(len(textured.faces)),
            "seconds": round(time.time() - t, 1)}


def do_mesh(req):
    engine = req.get("engine") or default_engine()
    if engine == "trellis1":
        return do_mesh_trellis1(req)
    if engine != "trellis2":
        return {"ok": False, "reason": "unknown_engine", "engine": engine}
    miss = missing("trellis2", "ss_decoder", "birefnet_mit", "dinov3")
    if miss:
        return {"ok": False, "reason": "weights_missing", "missing": miss}
    from PIL import Image
    import o_voxel
    t = time.time()
    pipe = load_trellis()
    image = Image.open(io.BytesIO(base64.b64decode(req["image_b64"])))
    # pipeline_type: '512' | '1024' | '1024_cascade' | '1536_cascade'; None = the
    # checkpoint's default ('1024_cascade', what the official demo runs).
    mesh = pipe.run(image, seed=int(req.get("seed", 0)), pipeline_type=req.get("pipeline_type") or None)[0]
    textured = o_voxel.postprocess.to_glb(  # returns a trimesh.Trimesh
        vertices=mesh.vertices, faces=mesh.faces, attr_volume=mesh.attrs, coords=mesh.coords,
        attr_layout=mesh.layout, voxel_size=mesh.voxel_size, aabb=[[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]],
        decimation_target=int(req.get("decimation_target", 100000)), texture_size=int(req.get("texture_size", 2048)),
    )
    data = textured.export(file_type="glb", extension_webp=False)
    return {"ok": True, "provider": "local-gpu:TRELLIS.2-4B", "engine": "trellis2", "glb_b64": base64.b64encode(data).decode(),
            "faces": int(len(textured.faces)), "seconds": round(time.time() - t, 1)}


def rss_mb():
    """Current resident set size in MB, read from /proc — the container's
    cgroup memory cap (found 2026-09-24 via /sys/fs/cgroup/memory.events'
    oom_kill counter, ~46.6GB here, separate from and far below the host's
    own free memory) is what actually kills this process under a long
    sustained batch, with no Python-level exception or traceback since the
    kill comes from outside the interpreter. Surfacing RSS in /health makes
    that trend visible instead of a mystery next time.
    """
    try:
        with open("/proc/self/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return round(int(line.split()[1]) / 1024, 1)
    except Exception:  # noqa: BLE001
        return None
    return None


def release_memory():
    """Called after every request. gc.collect() plus torch's CUDA cache
    release are cheap (milliseconds) next to a 6-200s generation call, and
    are standard practice for a long-running inference server — they don't
    fix a genuine reference leak, but they do return freed-but-cached
    allocations (GPU cache, cyclic-garbage Python objects from PIL/trimesh/
    numpy intermediates) promptly instead of letting them sit until the next
    GC cycle, which is exactly the kind of slow accumulation that crosses a
    fixed cgroup cap over many requests.
    """
    gc.collect()
    try:
        import torch
        torch.cuda.empty_cache()
    except Exception:  # noqa: BLE001
        pass


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # quiet access log; errors go to stderr below
        pass

    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path != "/health":
            return self._send(404, {"ok": False, "reason": "not_found"})
        info = {"ok": True, "weights": weights_status(), "default_engine": default_engine(), "on_gpu": _state["on_gpu"],
                "served": _state["served"], "errors": _state["errors"], "busy": _lock.locked(), "rss_mb": rss_mb()}
        try:
            import torch
            info["gpu"] = torch.cuda.get_device_name(0)
            info["vram_used_gb"] = round(torch.cuda.memory_allocated() / 1e9, 1)
        except Exception as exc:  # noqa: BLE001
            info["gpu_error"] = str(exc)
        self._send(200, info)

    def do_POST(self):
        handlers = {"/concept": do_concept, "/mesh": do_mesh}
        if self.path not in handlers:
            return self._send(404, {"ok": False, "reason": "not_found"})
        try:
            req = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        except Exception as exc:  # noqa: BLE001
            return self._send(400, {"ok": False, "reason": "bad_json", "error": str(exc)})
        with _lock:
            try:
                res = handlers[self.path](req)
            except Exception as exc:  # noqa: BLE001
                traceback.print_exc()
                res = {"ok": False, "reason": "generation_error", "error": f"{type(exc).__name__}: {str(exc)[:400]}"}
            finally:
                release_memory()
            _state["served"] += 1
            if not res.get("ok"):
                _state["errors"] += 1
        self._send(200, res)


if __name__ == "__main__":
    print(f"concord-gen-server on 127.0.0.1:{PORT} weights={weights_status()}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
