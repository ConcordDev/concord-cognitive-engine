// Concordia — Poly Haven ARM -> URP channel repack.
//
// Poly Haven ships one packed texture per set: "<stem>_arm_2k.jpg", where
//   R = Ambient Occlusion,  G = Roughness,  B = Metallic
//
// URP's Lit shader (verified against LitInput.hlsl in the installed package, not from memory)
// wants those values in different channels, across two different texture slots:
//   _MetallicGlossMap : .r = metallic, .a = smoothness   (keyword _METALLICSPECGLOSSMAP)
//   _OcclusionMap     : .g = occlusion                   (keyword _OCCLUSIONMAP)
//
// So ARM cannot be assigned directly to either slot — plugged into _OcclusionMap it would read
// roughness as occlusion; plugged into _MetallicGlossMap it would read AO as metallic and, since
// JPEG has no alpha, treat every surface as fully smooth.
//
// URP reads only .r/.a from the metallic map and only .g from the occlusion map, and those three
// channels do not overlap — so ONE output texture can serve BOTH slots:
//   out.r = arm.b        (metallic)
//   out.g = arm.r        (occlusion)
//   out.a = 1 - arm.g    (smoothness = 1 - roughness)
// out.b is unused by either sampler.

Shader "Hidden/Concordia/ArmRepack"
{
    Properties
    {
        _MainTex ("ARM (R=AO, G=Rough, B=Metal)", 2D) = "white" {}
    }
    SubShader
    {
        Cull Off
        ZWrite Off
        ZTest Always

        Pass
        {
            CGPROGRAM
            #pragma vertex vert_img
            #pragma fragment frag
            #include "UnityCG.cginc"

            sampler2D _MainTex;

            fixed4 frag(v2f_img i) : SV_Target
            {
                fixed4 arm = tex2D(_MainTex, i.uv);
                return fixed4(arm.b, arm.r, 0.0, 1.0 - arm.g);
            }
            ENDCG
        }
    }
    Fallback Off
}
