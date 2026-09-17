using System.Text;
using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Named cinematic checkpoints. Compile is not a pass.
    /// Spec: apps/concordia-living-world/bible/CINEMATIC.md
    /// </summary>
    public static class VisualFidelity
    {
        public const string Spec = "bible/CINEMATIC.md";

        public enum Profile
        {
            LeanPlay,
            Desktop,
            WebGL
        }

        public static readonly string[] Shots =
        {
            "SHOT 01 — Court",
            "SHOT 02 — Character",
            "SHOT 03 — Combat",
            "SHOT 04 — Sprint",
            "SHOT 05 — Road",
            "SHOT 06 — Weather",
            "SHOT 07 — Interior",
            "SHOT 08 — NPC",
            "SHOT 09 — Mount",
            "SHOT 10 — Consequence"
        };

        public static Profile Active
        {
            get
            {
#if UNITY_WEBGL && !UNITY_EDITOR
                return Profile.WebGL;
#else
                return ConcordiaHost.LeanPlay ? Profile.LeanPlay : Profile.Desktop;
#endif
            }
        }

        /// <summary>
        /// Play/Editor dump: profile + live look wiring. Does not grade beauty.
        /// A missing GlobalVolume or a player with no body is a failed gate, not a style note.
        /// </summary>
        public static string Dump()
        {
            var sb = new StringBuilder();
            sb.Append("profile=").Append(Active);
            sb.Append(" spec=").Append(Spec);
            sb.Append(" playing=").Append(Application.isPlaying);
            var vol = GameObject.Find("GlobalVolume");
            sb.Append(" volume=").Append(vol ? "yes" : "NO");
            var p = ConcordiaPlayer.Live;
            if (!p)
            {
                sb.Append(" player=NO");
            }
            else
            {
                sb.Append(" pos=").Append(p.transform.position.ToString("F1"));
                sb.Append(" world=").Append(p.world);
                sb.Append(" land=").Append(p.LandLine);
                sb.Append(" hp=").Append(p.hp.ToString("F0"));
                var person = p.GetComponentInChildren<ModularPerson>();
                sb.Append(" person=").Append(person ? "yes" : "NO");
                var grip = person && person.rightHand ? person.rightHand.Find("CX_Grip_R") : null;
                sb.Append(" grip=").Append(grip ? "yes" : "no");
            }
            sb.Append(" fog=").Append(RenderSettings.fog);
            sb.Append(" fogMode=").Append(RenderSettings.fogMode);
            var sun = RenderSettings.sun;
            if (!sun || !sun.enabled)
            {
                var lights = Object.FindObjectsByType<Light>(FindObjectsInactive.Exclude, FindObjectsSortMode.None);
                for (int i = 0; i < lights.Length; i++)
                {
                    var l = lights[i];
                    if (l && l.enabled && l.type == LightType.Directional && l.name != "Fill")
                    {
                        sun = l;
                        break;
                    }
                }
            }
            sb.Append(" sun=").Append(sun && sun.enabled ? sun.intensity.ToString("F2") : "NO");
            sb.Append(" shots=").Append(Shots.Length);
            return sb.ToString();
        }
    }
}
