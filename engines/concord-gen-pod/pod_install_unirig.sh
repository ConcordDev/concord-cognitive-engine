#!/bin/bash
# UniRig (MIT, VAST-AI-Research/Tsinghua): predicts a skeleton + skinning
# weights for an arbitrary mesh (humans, animals, objects) — the missing
# piece that turns a static TRELLIS/Meshy GLB into an animatable one.
#
# Separate venv from TRELLIS (/root/gen/venv): UniRig pins transformers==
# 4.51.3 and its own torch, which would risk breaking the diffusers/TRELLIS
# stack if shared. UniRig runs as its own subprocess (launch/inference/*.sh),
# never in-process with the generation server, so isolation costs nothing.
set -uo pipefail
U=/root/unirig
M=/workspace/models
export TORCH_CUDA_ARCH_LIST="8.6" MAX_JOBS=48 CUDA_HOME=/usr/local/cuda
step() { echo; echo "=== $(date +%T) $*"; }

step venv
python3 -m venv $U/venv
source $U/venv/bin/activate
pip install -q --upgrade pip wheel setuptools

step clone UniRig
[ -d $U/repo ] || git clone -q https://github.com/VAST-AI-Research/UniRig.git $U/repo
cd $U/repo

step "torch (matching the pod's existing cu128 build so PyG wheels exist)"
pip install -q torch==2.8.0 torchvision --index-url https://download.pytorch.org/whl/cu128

step "requirements.txt (bpy is Blender's Python module, used for merge/export, ~400MB)"
pip install -q -r requirements.txt

step spconv
pip install -q spconv-cu120

step torch_scatter + torch_cluster
pip install -q torch_scatter torch_cluster -f https://data.pyg.org/whl/torch-2.8.0+cu128.html --no-cache-dir

step numpy pin
pip install -q "numpy==1.26.4"

step "checkpoints (MIT, ungated, skip the training-data zips, inference only)"
mkdir -p $M/VAST-AI/UniRig/skeleton/articulation-xl_quantization_256 $M/VAST-AI/UniRig/skin/articulation-xl
for f in skeleton/articulation-xl_quantization_256/model.ckpt skin/articulation-xl/model.ckpt; do
  dest="$M/VAST-AI/UniRig/$f"
  [ -s "$dest" ] && continue
  curl -sfL --retry 5 -o "$dest.part" "https://huggingface.co/VAST-AI/UniRig/resolve/main/$f" && mv "$dest.part" "$dest" && echo "ok $f $(stat -c%s "$dest")"
done
# UniRig's own inference config expects checkpoints under its repo tree;
# symlinks fail on nothing here (repo is on local /root disk, not geesefs).
mkdir -p $U/repo/experiments/skeleton/articulation-xl_quantization_256 $U/repo/experiments/skin/articulation-xl
ln -sf $M/VAST-AI/UniRig/skeleton/articulation-xl_quantization_256/model.ckpt $U/repo/experiments/skeleton/articulation-xl_quantization_256/model.ckpt
ln -sf $M/VAST-AI/UniRig/skin/articulation-xl/model.ckpt $U/repo/experiments/skin/articulation-xl/model.ckpt

step import check
python - <<'PY'
import importlib
for m in ["torch", "spconv.pytorch", "torch_scatter", "torch_cluster", "bpy", "trimesh", "pytorch_lightning"]:
    try: importlib.import_module(m); print("OK  ", m)
    except Exception as e: print("FAIL", m, type(e).__name__, str(e)[:160])
PY
step done
