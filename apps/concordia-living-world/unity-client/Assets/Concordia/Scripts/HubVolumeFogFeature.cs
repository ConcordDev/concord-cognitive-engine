using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.RenderGraphModule;
using UnityEngine.Rendering.RenderGraphModule.Util;
using UnityEngine.Rendering.Universal;

namespace Concordia
{
    /// <summary>
    /// URP 17 raymarch volume: height fog + main-light shadow shafts.
    /// Not a fog-density bump. HubLook enables this on the live renderer.
    /// </summary>
    public class HubVolumeFogFeature : ScriptableRendererFeature
    {
        class Pass : ScriptableRenderPass
        {
            Material _mat;
            static readonly MaterialPropertyBlock Block = new MaterialPropertyBlock();

            public Pass()
            {
                renderPassEvent = RenderPassEvent.BeforeRenderingPostProcessing;
                profilingSampler = new ProfilingSampler("ConcordiaVolumeFog");
            }

            public void Bind(Material mat) => _mat = mat;

            public override void RecordRenderGraph(RenderGraph renderGraph, ContextContainer frameData)
            {
                if (!_mat) return;
                var resources = frameData.Get<UniversalResourceData>();
                if (!resources.cameraColor.IsValid()) return;

                var srcDesc = renderGraph.GetTextureDesc(resources.cameraColor);
                srcDesc.name = "_CxVolumeFogColor";
                srcDesc.clearBuffer = false;
                var copy = renderGraph.CreateTexture(srcDesc);
                renderGraph.AddBlitPass(resources.cameraColor, copy, Vector2.one, Vector2.zero, passName: "CxVol Copy");

                using var builder = renderGraph.AddRasterRenderPass<Data>("CxVolumeFog", out var data, profilingSampler);
                data.mat = _mat;
                data.source = copy;
                builder.UseTexture(data.source, AccessFlags.Read);
                if (resources.cameraDepthTexture.IsValid())
                    builder.UseTexture(resources.cameraDepthTexture, AccessFlags.Read);
                builder.SetRenderAttachment(resources.activeColorTexture, 0, AccessFlags.Write);
                builder.SetRenderFunc(static (Data d, RasterGraphContext ctx) =>
                {
                    Block.Clear();
                    if (d.source.IsValid())
                        Block.SetTexture("_BlitTexture", d.source);
                    Block.SetVector("_BlitScaleBias", new Vector4(1f, 1f, 0f, 0f));
                    ctx.cmd.DrawProcedural(Matrix4x4.identity, d.mat, 0, MeshTopology.Triangles, 3, 1, Block);
                });
            }

            class Data
            {
                internal Material mat;
                internal TextureHandle source;
            }
        }

        Pass _pass;
        Material _mat;

        public override void Create()
        {
            _pass = new Pass();
            BindMat();
        }

        void BindMat()
        {
            if (_mat) return;
            var sh = Shader.Find("Hidden/Concordia/VolumeFog");
            if (sh) _mat = new Material(sh) { name = "CxVolumeFog" };
        }

        public override void AddRenderPasses(ScriptableRenderer renderer, ref RenderingData renderingData)
        {
            BindMat();
            if (!_mat) return;
            var cam = renderingData.cameraData.camera;
            if (!cam || cam.cameraType == CameraType.Preview || cam.cameraType == CameraType.Reflection)
                return;
            _pass.ConfigureInput(ScriptableRenderPassInput.Depth);
            _pass.Bind(_mat);
            _pass.requiresIntermediateTexture = true;
            renderer.EnqueuePass(_pass);
        }
    }
}
