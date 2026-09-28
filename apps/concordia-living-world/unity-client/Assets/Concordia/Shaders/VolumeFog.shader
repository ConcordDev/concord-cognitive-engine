Shader "Hidden/Concordia/VolumeFog"
{
    SubShader
    {
        Tags { "RenderPipeline" = "UniversalPipeline" }
        Cull Off ZWrite Off ZTest Always

        Pass
        {
            Name "VolumeFog"
            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #pragma target 4.5
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE
            #pragma multi_compile_fragment _ _SHADOWS_SOFT

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.core/Runtime/Utilities/Blit.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DeclareDepthTexture.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Shadows.hlsl"

            float _CxVolDensity;
            float _CxVolHeight;
            float _CxVolFalloff;
            float _CxVolMaxM;
            float _CxVolSun;
            float4 _CxVolColor;
            float4 _CxVolSunColor;

            static const int STEPS = 28;

            half4 Frag(Varyings input) : SV_Target
            {
                float2 uv = input.texcoord;
                half4 col = SAMPLE_TEXTURE2D_X(_BlitTexture, sampler_LinearClamp, uv);

                float raw = SampleSceneDepth(uv);
                float3 worldEnd = ComputeWorldSpacePosition(uv, raw, UNITY_MATRIX_I_VP);
                float3 origin = _WorldSpaceCameraPos;
                float3 delta = worldEnd - origin;
                float dist = length(delta);
                if (dist < 0.05) return col;
                dist = min(dist, max(8.0, _CxVolMaxM));
                float3 dir = delta / max(length(delta), 1e-4);
                float dt = dist / STEPS;

                Light main = GetMainLight();
                float3 sunDir = main.direction;
                float3 fogCol = _CxVolColor.rgb;
                float3 sunCol = _CxVolSunColor.rgb * main.color.rgb;
                float dens = max(0.0, _CxVolDensity);
                float h0 = _CxVolHeight;
                float fall = max(0.15, _CxVolFalloff);
                float sunPow = max(0.0, _CxVolSun);

                float trans = 1.0;
                float3 scatter = 0;
                float3 p = origin + dir * (dt * 0.5);
                [loop]
                for (int i = 0; i < STEPS; i++)
                {
                    float height = saturate(exp(-(p.y - h0) / fall));
                    float fog = dens * (0.28 + 0.72 * height);
                    float4 sc = TransformWorldToShadowCoord(p);
                    float shadow = MainLightRealtimeShadow(sc);
                    float mie = pow(saturate(dot(dir, sunDir)), 8.0);
                    float inSc = fog * (0.55 + sunPow * mie * shadow);
                    scatter += (fogCol * fog + sunCol * inSc) * trans * dt;
                    trans *= exp(-fog * dt * 1.15);
                    p += dir * dt;
                    if (trans < 0.02) break;
                }

                return half4(col.rgb * trans + scatter, col.a);
            }
            ENDHLSL
        }
    }
    Fallback Off
}
