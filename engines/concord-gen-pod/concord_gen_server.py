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

# 2026-10-19 (pod-warm-1019): the container gets a 7.65-CPU CFS quota but sees 96 cores, so torch
# (48 threads) and OpenMP/BLAS (96) oversubscribe and get throttled (42% of CFS periods). Cap them.
GEN_THREADS = int(os.environ.get("CONCORD_GEN_THREADS", "6"))
for _v in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
    os.environ.setdefault(_v, str(GEN_THREADS))

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

# 2026-10-19 leak fix: prefer a complete local copy of the weights on the container disk (made by
# /workspace/gen/sync-local-weights.sh; marker copied last) so a restart does not re-read 35 GB from geesefs.
LOCAL_MODELS = os.environ.get("CONCORD_GEN_LOCAL_MODELS", "/root/gen/models-local")


def repo_path(rel):
    local = f"{LOCAL_MODELS}/{rel}"
    return local if os.path.exists(f"{local}/{MARK}") else f"{MODELS}/{rel}"


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
_abort = threading.Event()
_job = {"id": None, "handler": None}


class GenerationAborted(Exception):
    """The client timed out, closed the socket, or posted /abort."""


def _interrupt_loaded():
    pipe = _state.get("flux")
    if pipe is None:
        return
    try:
        pipe._interrupt = True
    except Exception:  # noqa: BLE001
        pass


def _client_gone(handler):
    """True when the request socket has been closed (Node abort, proxy drop)."""
    if handler is None:
        return False
    import select
    import socket
    conn = getattr(handler, "connection", None)
    if conn is None:
        return False
    try:
        readable, _, _ = select.select([conn], [], [], 0)
        if not readable:
            return False
        peeked = conn.recv(1, socket.MSG_PEEK)
        return peeked == b""
    except (OSError, ConnectionError, ValueError):
        return True


def _raise_if_aborted():
    if _abort.is_set() or _client_gone(_job.get("handler")):
        _abort.set()
        _interrupt_loaded()
        raise GenerationAborted()


def abort_job(job_id=None):
    """Stop the in-flight generation. Does not take the generation lock."""
    current = _job.get("id")
    if job_id not in (None, "") and str(job_id) != str(current):
        return {"ok": False, "reason": "no_such_job", "job_id": current}
    _abort.set()
    _interrupt_loaded()
    return {"ok": True, "aborted": True, "job_id": current}


def _flux_step(_pipe, _step_index, _timestep, callback_kwargs):
    _raise_if_aborted()
    return callback_kwargs


def _test_hold(req):
    """Test-only pause so a client can prove /abort stops an in-flight job.
    Ignored unless CONCORD_GEN_ALLOW_TEST_HOLD=1, so a production request
    cannot ask the pod to sleep."""
    if os.environ.get("CONCORD_GEN_ALLOW_TEST_HOLD") != "1":
        return None
    try:
        hold = float(req.get("test_hold_s") or 0)
    except (TypeError, ValueError):
        return None
    if hold <= 0:
        return None
    deadline = time.time() + hold
    while time.time() < deadline:
        try:
            _raise_if_aborted()
        except GenerationAborted:
            return {"ok": False, "reason": "aborted", "error": "generation aborted"}
        time.sleep(0.05)
    return {"ok": True, "reason": "held", "held_s": hold}


_TQDM_PATCHED = False
_CUR_PH = None


def _install_trellis_abort_hooks():
    """Pod addition (2026-10-19): TRELLIS v1 sampling, rasterizing and texture baking all loop through
    tqdm. Swap in an abort-aware tqdm so /abort or a dropped client stops a running mesh within one
    step instead of after the whole ~60 s mesh."""
    global _TQDM_PATCHED
    if _TQDM_PATCHED:
        return
    import importlib
    from tqdm import tqdm as _tqdm

    class _AbortTqdm(_tqdm):
        def __iter__(self):
            for item in super().__iter__():
                _raise_if_aborted()
                yield item

        def update(self, n=1):
            _raise_if_aborted()
            return super().update(n)

    for name in ("trellis.pipelines.samplers.flow_euler", "trellis.utils.postprocessing_utils", "trellis.utils.render_utils"):
        try:
            importlib.import_module(name).tqdm = _AbortTqdm
        except Exception:  # noqa: BLE001
            traceback.print_exc()
    try:
        pu = importlib.import_module("trellis.utils.postprocessing_utils")
        for fname in ("postprocess_mesh", "parametrize_mesh", "render_multiview", "bake_texture"):
            orig = getattr(pu, fname, None)
            if orig is None or getattr(orig, "_concord_timed", False):
                continue

            def timed(*a, _orig=orig, _name=fname, **k):
                t0 = time.time()
                try:
                    return _orig(*a, **k)
                finally:
                    if _CUR_PH is not None:
                        _CUR_PH.sub[_name] = round(time.time() - t0, 1)
            timed._concord_timed = True
            setattr(pu, fname, timed)
    except Exception:  # noqa: BLE001
        traceback.print_exc()
    _TQDM_PATCHED = True




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


# INC-127 (2026-10-17): the A40 is shared with the Ollama chat brain (~27 GB).
# FLUX bf16 (~33 GB) no longer fits beside it, so by default FLUX runs with its
# transformer and T5 text encoder quantized to NF4, fully GPU-resident (~11-13 GB).
# CONCORD_FLUX_MODE=full keeps
# the old whole-pipeline-on-GPU behaviour for a dedicated GPU.
FLUX_MODE = os.environ.get("CONCORD_FLUX_MODE", "nf4")
_OFFLOADED = set()


# 2026-10-19 (pod-restore-1019, Dutch option 1): nothing stays parked on the GPU between requests.
# The A40 also holds qwen3-30b (~21.6 GB) + two concord-core-v6 copies (~2.3 GB each); FLUX nf4
# (~11.4 GB) resident beside TRELLIS v1 (~11 GB peak) OOM'd. FLUX (nf4 included; bitsandbytes>=0.43.2
# can move 4-bit params) is moved to CPU RAM after each image and before any mesh, and every model is
# parked on CPU after each request (CONCORD_GEN_PARK=0 keeps the last-used model on the GPU).
PARK_AFTER = os.environ.get("CONCORD_GEN_PARK", "1") != "0"
FLUX_PARTS = ("transformer", "text_encoder", "text_encoder_2", "vae")


def _move(name, device):
    obj = _state[name]
    if obj is None:
        return
    if name == "flux":
        for part in FLUX_PARTS:
            mod = getattr(obj, part, None)
            if mod is not None:
                mod.to(device)
    else:
        obj.to(device)


def _evict_except(name):
    import torch
    for other in HEAVY:
        if other != name and _state[other] is not None:
            _move(other, "cpu")
    if _state["on_gpu"] != name:
        _state["on_gpu"] = None
    gc.collect()
    torch.cuda.empty_cache()


def to_gpu(name):
    if _state["on_gpu"] == name:
        return
    _evict_except(name)
    _move(name, "cuda")
    _state["on_gpu"] = name


def park_all():
    """Move every loaded model to CPU RAM and return the CUDA cache."""
    if _state["on_gpu"] is None:
        return
    t = time.time()
    _evict_except(None)
    print(f"parked models on cpu in {time.time() - t:.1f}s rss_mb={rss_mb()}", flush=True)


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
        t_l = time.time()
        _state["trellis1"] = TrellisImageTo3DPipeline.from_pretrained(repo_path("microsoft/TRELLIS-image-large"))
        print(f"loaded TRELLIS v1 from {repo_path('microsoft/TRELLIS-image-large')} in {time.time() - t_l:.1f}s", flush=True)
    t_g = time.time()
    to_gpu("trellis1")
    if time.time() - t_g > 5:
        print(f"trellis1 to_gpu {time.time() - t_g:.1f}s", flush=True)
    return _state["trellis1"]


def default_engine():
    return "trellis2" if not missing("trellis2", "ss_decoder", "birefnet_mit", "dinov3") else "trellis1"


def load_flux():
    if _state["flux"] is None:
        import torch
        from diffusers import FluxPipeline
        _evict_except("flux")  # nf4 modules load straight onto the GPU: make room first
        base = repo_path("black-forest-labs/FLUX.1-schnell")
        print(f"loading FLUX from {base}", flush=True)
        if FLUX_MODE == "full":
            _state["flux"] = FluxPipeline.from_pretrained(base, torch_dtype=torch.bfloat16)
        else:
            from diffusers import BitsAndBytesConfig, FluxTransformer2DModel
            from transformers import BitsAndBytesConfig as TBnbConfig, T5EncoderModel
            transformer = FluxTransformer2DModel.from_pretrained(
                base, subfolder="transformer", torch_dtype=torch.bfloat16,
                quantization_config=BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4",
                                                       bnb_4bit_compute_dtype=torch.bfloat16))
            text_encoder_2 = T5EncoderModel.from_pretrained(
                base, subfolder="text_encoder_2", torch_dtype=torch.bfloat16,
                quantization_config=TBnbConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4",
                                               bnb_4bit_compute_dtype=torch.bfloat16))
            pipe = FluxPipeline.from_pretrained(base, transformer=transformer, text_encoder_2=text_encoder_2,
                                                torch_dtype=torch.bfloat16)
            # Quantized modules already sit on the GPU; move the small rest (CLIP, VAE).
            # Whole pipeline stays resident on the GPU (~11-13 GB), so the container's
            # 50 GB RAM cgroup is not consumed by CPU-offloaded weights (that OOM-killed
            # the model-CPU-offload variant on 2026-10-17).
            pipe.text_encoder.to("cuda")
            pipe.vae.to("cuda")
            _state["flux"] = pipe
            _state["on_gpu"] = "flux"
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
    held = _test_hold(req)
    if held is not None:
        return held
    _raise_if_aborted()
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
    gen_kwargs = dict(
        guidance_scale=0.0, num_inference_steps=int(req.get("steps", 4)),
        width=int(req.get("width", 1024)), height=int(req.get("height", 1024)),
        max_sequence_length=t5_max,
        generator=torch.Generator("cpu").manual_seed(int(req.get("seed", 0))),
        callback_on_step_end=_flux_step,
    )
    try:
        img = pipe(clip_prompt, prompt_2=full_prompt, **gen_kwargs).images[0]
    except TypeError:
        gen_kwargs.pop("callback_on_step_end", None)
        _raise_if_aborted()
        img = pipe(clip_prompt, prompt_2=full_prompt, **gen_kwargs).images[0]
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


BG_OLLAMA_HOST = os.environ.get("CONCORD_GEN_BG_OLLAMA_HOST", "127.0.0.1:11436")
BG_CPUS = os.environ.get("CONCORD_GEN_BG_CPUS", "0-2")          # normal pin (start-ollama-bg.sh)
BG_YIELD_CPUS = os.environ.get("CONCORD_GEN_BG_YIELD_CPUS", "0")  # pin while a /mesh runs ("" disables)


def _cpuset(spec):
    out = set()
    for part in str(spec).split(","):
        part = part.strip()
        if not part:
            continue
        lo, _, hi = part.partition("-")
        out.update(range(int(lo), int(hi or lo) + 1))
    return out


def _bg_ollama_tids():
    """Thread ids of the background Ollama (serve + its llama-server runners, which inherit OLLAMA_HOST)."""
    tids = []
    for pid in os.listdir("/proc"):
        if not pid.isdigit():
            continue
        try:
            with open(f"/proc/{pid}/environ", "rb") as f:
                if f"OLLAMA_HOST={BG_OLLAMA_HOST}".encode() not in f.read().split(b"\0"):
                    continue
            tids += [int(t) for t in os.listdir(f"/proc/{pid}/task")]
        except Exception:  # noqa: BLE001
            continue
    return tids


def _bg_pin(spec):
    """Re-pin the background Ollama. Shrinks it to one CPU while TRELLIS meshes so the mesh CPU
    phases (hole fill, xatlas UV unwrap) are not starved by background agents on the shared quota."""
    if not spec:
        return 0
    cpus, n = _cpuset(spec), 0
    for tid in _bg_ollama_tids():
        try:
            os.sched_setaffinity(tid, cpus)
            n += 1
        except Exception:  # noqa: BLE001
            pass
    return n


class _Phases:
    """Per-phase wall time plus container CPU throttling (cgroup cpu.stat), for diagnosing slow meshes."""

    def __init__(self):
        self.t = time.time()
        self.thr = self._throttled()
        self.out = {}
        self.sub = {}
        self.majflt0 = self._majflt()

    @staticmethod
    def _majflt():
        try:
            return int(open("/proc/self/stat").read().rsplit(")", 1)[1].split()[9])
        except Exception:  # noqa: BLE001
            return 0

    @staticmethod
    def _throttled():
        try:
            for line in open("/sys/fs/cgroup/cpu.stat"):
                if line.startswith("throttled_usec"):
                    return int(line.split()[1])
        except Exception:  # noqa: BLE001
            pass
        return 0

    def mark(self, name):
        now, thr = time.time(), self._throttled()
        self.out[name] = {"s": round(now - self.t, 1), "throttled_s": round((thr - self.thr) / 1e6, 1)}
        self.t, self.thr = now, thr

    def summary(self):
        return {**self.out, "to_glb_parts": self.sub, "major_faults": self._majflt() - self.majflt0}


def do_mesh_trellis1(req):
    held = _test_hold(req)
    if held is not None:
        return held
    _raise_if_aborted()
    miss = missing("trellis1")
    if miss:
        return {"ok": False, "reason": "weights_missing", "missing": miss}
    from PIL import Image
    from trellis.utils import postprocessing_utils
    t = time.time()
    global _CUR_PH
    ph = _CUR_PH = _Phases()
    pipe = load_trellis1()
    _install_trellis_abort_hooks()
    ph.mark("to_gpu")
    _raise_if_aborted()
    image = Image.open(io.BytesIO(base64.b64decode(req["image_b64"])))
    out = pipe.run(image, seed=int(req.get("seed", 0)), formats=["gaussian", "mesh"],
                   sparse_structure_sampler_params={"steps": 12, "cfg_strength": 7.5},
                   slat_sampler_params={"steps": 12, "cfg_strength": 3})
    ph.mark("sample")
    # to_glb bakes the Gaussian appearance onto the extracted mesh (trimesh).
    # simplify is the fraction of faces REMOVED; Concord's game-lod pass does
    # the real budget decimation afterwards, so keep plenty of detail here.
    _raise_if_aborted()
    textured = postprocessing_utils.to_glb(out["gaussian"][0], out["mesh"][0],
                                           simplify=float(req.get("simplify", 0.9)),
                                           texture_size=int(req.get("texture_size", 2048)), verbose=False)
    ph.mark("to_glb")
    data = textured.export(file_type="glb")
    ph.mark("export")
    print(f"mesh phases {ph.summary()}", flush=True)
    return {"ok": True, "provider": "local-gpu:TRELLIS-image-large", "engine": "trellis1",
            "glb_b64": base64.b64encode(data).decode(), "faces": int(len(textured.faces)), "phases": ph.summary(),
            "seconds": round(time.time() - t, 1)}


def do_mesh(req):
    held = _test_hold(req)
    if held is not None:
        return held
    _raise_if_aborted()
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
    # 2026-10-19: GPU<->CPU parking reallocates ~15 GB of CPU tensors per request; hand freed
    # glibc arenas back to the OS so RSS does not creep into the 47.7 GB container cgroup cap
    # (gen-server was cgroup-OOM-killed at 20:07Z with RSS creeping 12.9 -> 22.7 GB).
    try:
        import ctypes
        ctypes.CDLL("libc.so.6").malloc_trim(0)
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
                "served": _state["served"], "errors": _state["errors"], "busy": _lock.locked(), "rss_mb": rss_mb(), "rss_restart_mb": RSS_RESTART_MB,
                "job_id": _job.get("id"), "aborting": _abort.is_set(),
                "local_weights": {k: repo_path(k).startswith(LOCAL_MODELS) for k in ("black-forest-labs/FLUX.1-schnell", "microsoft/TRELLIS-image-large")}}
        try:
            import torch
            info["gpu"] = torch.cuda.get_device_name(0)
            info["vram_used_gb"] = round(torch.cuda.memory_allocated() / 1e9, 1)
        except Exception as exc:  # noqa: BLE001
            info["gpu_error"] = str(exc)
        self._send(200, info)

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        try:
            req = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        except Exception as exc:  # noqa: BLE001
            return self._send(400, {"ok": False, "reason": "bad_json", "error": str(exc)})
        # /abort must not wait on the generation lock: that lock is what the
        # in-flight job is holding.
        if path == "/abort":
            job_id = req.get("job_id") or self.headers.get("X-Concord-Job-Id")
            res = abort_job(job_id)
            print(f"{time.strftime('%H:%M:%SZ', time.gmtime())} /abort job_id={job_id} -> {res}", flush=True)
            return self._send(200, res)
        handlers = {"/concept": do_concept, "/mesh": do_mesh}
        if path not in handlers:
            return self._send(404, {"ok": False, "reason": "not_found"})
        # Chat sets this so a busy card answers immediately. Organic batch
        # posts omit it and keep queueing on the lock (those jobs are minutes).
        fail_if_busy = str(self.headers.get("X-Concord-Fail-If-Busy") or "").strip().lower() in ("1", "true", "yes")
        if fail_if_busy:
            if not _lock.acquire(blocking=False):
                return self._send(200, {
                    "ok": False,
                    "reason": "gpu_busy",
                    "error": "The GPU is busy with another job. Try again in a moment.",
                })
        else:
            _lock.acquire()
        job_id = self.headers.get("X-Concord-Job-Id") or req.get("job_id") or str(time.time())
        try:
            _abort.clear()
            _job["id"] = str(job_id)
            _job["handler"] = self
            yielded = _bg_pin(BG_YIELD_CPUS) if path == "/mesh" else 0
            try:
                try:
                    res = handlers[path](req)
                except GenerationAborted:
                    res = {"ok": False, "reason": "aborted", "error": "generation aborted"}
                except Exception as exc:  # noqa: BLE001
                    traceback.print_exc()
                    res = {"ok": False, "reason": "generation_error", "error": f"{type(exc).__name__}: {str(exc)[:400]}"}
                finally:
                    if yielded:
                        _bg_pin(BG_CPUS)
                    if PARK_AFTER:
                        try:
                            park_all()
                        except Exception:  # noqa: BLE001
                            traceback.print_exc()
                    release_memory()
                _state["served"] += 1
                if not res.get("ok"):
                    _state["errors"] += 1
                _state["last_done"] = time.time()
                print(f"{time.strftime('%H:%M:%SZ', time.gmtime())} {path} job={job_id} ok={res.get('ok')} reason={res.get('reason')} rss_mb={rss_mb()}", flush=True)
            finally:
                _job["handler"] = None
                _job["id"] = None
        finally:
            _lock.release()
        try:
            self._send(200, res)
        except (BrokenPipeError, ConnectionResetError):
            pass  # client already gone (aborted / timed out)


# 2026-10-19 belt-and-braces: if RSS ever creeps past CONCORD_GEN_RSS_RESTART_MB while idle, exit cleanly
# (gen-server-loop.sh respawns in 5 s; with local weights the next request reloads in about a minute).
# Steady state with FLUX nf4 + TRELLIS v1 parked on CPU is ~19.4 GB, so the default sits above that.
RSS_RESTART_MB = float(os.environ.get("CONCORD_GEN_RSS_RESTART_MB", "24000"))
RSS_IDLE_S = float(os.environ.get("CONCORD_GEN_RSS_IDLE_S", "60"))


def _rss_watchdog():
    while True:
        time.sleep(30)
        r = rss_mb() or 0
        if r < RSS_RESTART_MB or time.time() - _state.get("last_done", time.time()) < RSS_IDLE_S:
            continue
        if not _lock.acquire(blocking=False):
            continue  # busy: never interrupt a generation
        print(f"{time.strftime('%H:%M:%SZ', time.gmtime())} rss watchdog: idle rss {r} MB > {RSS_RESTART_MB:.0f} MB, exiting for a clean respawn", flush=True)
        os._exit(0)


# Order matters: TRELLIS v1 builds its modules on CPU (random init, convert_to_fp16, load_state_dict) and
# that took ~250 s when FLUX nf4 was already loaded vs ~28 s before it (measured 2026-10-19), so TRELLIS goes first.
PRELOAD = [m.strip() for m in os.environ.get("CONCORD_GEN_PRELOAD", "trellis1,flux").split(",") if m.strip()]


def _preload():
    """Load models into CPU RAM right after (re)spawn so the first request does not pay the 30-40 s
    cold load (that is what pushed the first post-respawn mesh past the 120 s chat budget)."""
    loaders = {"flux": load_flux, "trellis1": load_trellis1}
    with _lock:
        t = time.time()
        for m in PRELOAD:
            try:
                if m in loaders:
                    t_m = time.time()
                    loaders[m]()
                    print(f"preload {m} {time.time() - t_m:.1f}s", flush=True)
            except Exception:  # noqa: BLE001
                traceback.print_exc()
        try:
            park_all()
            release_memory()
        except Exception:  # noqa: BLE001
            traceback.print_exc()
        _state["last_done"] = time.time()
        print(f"{time.strftime('%H:%M:%SZ', time.gmtime())} preload {PRELOAD} done in {time.time() - t:.1f}s rss_mb={rss_mb()}", flush=True)


if __name__ == "__main__":
    print(f"concord-gen-server on 127.0.0.1:{PORT} weights={weights_status()}", flush=True)
    _state["last_done"] = time.time()
    if RSS_RESTART_MB > 0:
        threading.Thread(target=_rss_watchdog, daemon=True).start()
    if PRELOAD:
        threading.Thread(target=_preload, daemon=True).start()
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
