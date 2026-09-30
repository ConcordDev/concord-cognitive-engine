#!/bin/bash
# TRELLIS (v1, MIT) + DINOv2 (Apache-2.0): the ungated image-to-3D engine, used
# until DINOv3 access is approved for TRELLIS.2. Shares /root/gen/venv (and its
# flash-attn / nvdiffrast builds) with pod_install.sh — run that first.
set -uo pipefail
G=/root/gen; M=/workspace/models
export TORCH_CUDA_ARCH_LIST="8.6" MAX_JOBS=48 CUDA_HOME=/usr/local/cuda
source $G/venv/bin/activate || { echo FATAL venv; exit 1; }
step() { echo; echo "=== $(date +%T) $*"; }

step system libs
# open3d / pyvista need EGL + GL at import time; RunPod's base image lacks them.
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq && apt-get install -y -qq libegl1 libgl1 libglib2.0-0 libxrender1 libsm6 >/dev/null

step clone TRELLIS
[ -d $G/TRELLIS ] || git clone --recursive https://github.com/microsoft/TRELLIS.git $G/TRELLIS

step basic deps
pip install -q rembg onnxruntime scipy open3d xatlas pyvista pymeshfix igraph

step spconv
pip install -q spconv-cu126

step diffoctreerast
[ -d $G/ext/diffoctreerast ] || git clone --recursive https://github.com/JeffreyXiang/diffoctreerast.git $G/ext/diffoctreerast
pip install -q $G/ext/diffoctreerast --no-build-isolation

step mip-splatting rasterizer
[ -d $G/ext/mip-splatting ] || git clone https://github.com/autonomousvision/mip-splatting.git $G/ext/mip-splatting
pip install -q $G/ext/mip-splatting/submodules/diff-gaussian-rasterization/ --no-build-isolation

step kaolin shim
# TRELLIS only uses kaolin.utils.testing.check_tensor (a shape assertion) in
# flexicubes.py. A faithful stand-in avoids a kaolin build for torch 2.8.
SITE=$(python -c "import site;print(site.getsitepackages()[0])")
mkdir -p $SITE/kaolin/utils
touch $SITE/kaolin/__init__.py $SITE/kaolin/utils/__init__.py
cat > $SITE/kaolin/utils/testing.py <<'PY'
"""Concord shim: the one kaolin function TRELLIS uses (flexicubes.py)."""
def check_tensor(tensor, shape=None, dtype=None, device=None, throw=True):
    ok = True
    if shape is not None:
        if len(shape) != tensor.ndim:
            ok = False
        else:
            ok = all(s is None or s == d for s, d in zip(shape, tensor.shape))
    if ok and dtype is not None and tensor.dtype != dtype:
        ok = False
    if ok and device is not None and str(tensor.device) != str(device):
        ok = False
    if not ok and throw:
        raise ValueError(f"tensor check failed: shape={tuple(tensor.shape)} dtype={tensor.dtype} expected shape={shape} dtype={dtype}")
    return ok
PY

step weights TRELLIS-image-large
for f in $(curl -s https://huggingface.co/api/models/microsoft/TRELLIS-image-large | python3 -c "import json,sys;print('\n'.join(s['rfilename'] for s in json.load(sys.stdin)['siblings']))"); do
  d="$M/microsoft/TRELLIS-image-large/$f"; mkdir -p "$(dirname "$d")"; [ -s "$d" ] && continue
  curl -sfL --retry 5 -o "$d.part" "https://huggingface.co/microsoft/TRELLIS-image-large/resolve/main/$f" && mv "$d.part" "$d" && echo "ok $f"
done

step import check
cd $G/TRELLIS
ATTN_BACKEND=flash-attn SPARSE_BACKEND=spconv python - <<'PY'
import importlib
for m in ["trellis.utils.postprocessing_utils","spconv.pytorch","diffoctreerast","diff_gaussian_rasterization","rembg","xatlas","pymeshfix","kaolin.utils.testing","trellis.pipelines"]:
    try: importlib.import_module(m); print("OK  ", m)
    except Exception as e: print("FAIL", m, type(e).__name__, str(e)[:200])
PY
step done
