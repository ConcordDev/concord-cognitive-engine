#!/bin/bash
# Concord generation pod: TRELLIS.2 (+ FLUX.1-schnell via diffusers) on an A40.
# Code + venv live on /root/gen (local disk). /workspace is geesefs (S3 FUSE):
# it rejects chmod, so git clones and venvs fail there, but it persists across
# pod restarts, so model weights go to /workspace/models as plain files.
# After a pod restart: re-run this script (weights are kept, builds redo).
set -uo pipefail
G=/root/gen
M=/workspace/models
mkdir -p $G/ext $M
export HF_HOME=$G/hf-cache
export TORCH_CUDA_ARCH_LIST="8.6"          # A40 = Ampere sm_86
export MAX_JOBS=48
export CUDA_HOME=/usr/local/cuda
step() { echo; echo "=== $(date +%T) $*"; }

step venv
[ -x $G/venv/bin/python ] || python3 -m venv --system-site-packages $G/venv
source $G/venv/bin/activate || { echo "FATAL: venv"; exit 1; }
python -c "import torch,sys;print('python',sys.executable,'torch',torch.__version__,torch.cuda.get_device_name(0))"
pip install -q --upgrade pip wheel setuptools

step clone TRELLIS.2
[ -d $G/TRELLIS.2 ] || git clone -b main --recursive https://github.com/microsoft/TRELLIS.2.git $G/TRELLIS.2
cd $G/TRELLIS.2 && git log -1 --format='%h %cd'

step basic deps
pip install -q imageio imageio-ffmpeg tqdm easydict opencv-python-headless ninja trimesh transformers "gradio==6.0.1" tensorboard pandas lpips zstandard kornia timm
pip install -q git+https://github.com/EasternJournalist/utils3d.git@9a4eb15e4021b67b12c460c7057d642626897ec8

step flash-attn
pip install -q flash-attn==2.8.3 --no-build-isolation

for spec in "nvdiffrast|https://github.com/NVlabs/nvdiffrast.git|v0.4.0" \
            "nvdiffrec|https://github.com/JeffreyXiang/nvdiffrec.git|renderutils" \
            "CuMesh|https://github.com/JeffreyXiang/CuMesh.git|" \
            "FlexGEMM|https://github.com/JeffreyXiang/FlexGEMM.git|"; do
  IFS='|' read -r name url branch <<< "$spec"
  step "$name"
  [ -d $G/ext/$name ] || git clone ${branch:+-b $branch} --recursive "$url" $G/ext/$name
  pip install -q $G/ext/$name --no-build-isolation
done

step o-voxel
pip install -q $G/TRELLIS.2/o-voxel --no-build-isolation

step diffusers for FLUX.1-schnell
pip install -q diffusers accelerate sentencepiece protobuf

step import check
python - <<'PY'
import importlib
for m in ["flash_attn","nvdiffrast.torch","cumesh","flex_gemm","o_voxel","diffusers","trimesh"]:
    try: importlib.import_module(m); print("OK  ", m)
    except Exception as e: print("FAIL", m, type(e).__name__, str(e)[:160])
PY
step done
