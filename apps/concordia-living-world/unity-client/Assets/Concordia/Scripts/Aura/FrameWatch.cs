using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Aura: worst frame time since the last <see cref="Reset"/> — the evidence behind B-09's
    /// "no frame over 100 ms in the 10 s after connecting" gate, reusable for the P-* perf tasks.
    /// Dev builds and the editor only.
    /// </summary>
    public static class FrameWatch
    {
        /// <summary>Worst single-frame time since the last Reset, in milliseconds.</summary>
        public static float MaxMs { get; private set; }

        /// <summary>Frames sampled since the last Reset.</summary>
        public static int Samples { get; private set; }

        /// <summary>Frames slower than 100 ms since the last Reset.</summary>
        public static int Over100 { get; private set; }

        public static void Reset()
        {
            MaxMs = 0f;
            Samples = 0;
            Over100 = 0;
        }

        /// <summary>One line for a verification log.</summary>
        public static string Line() =>
            "frames=" + Samples + " maxMs=" + MaxMs.ToString("F1") + " over100ms=" + Over100;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Install()
        {
            if (!Application.isEditor && !Debug.isDebugBuild) return;

            var go = new GameObject("~AuraFrameWatch");
            go.hideFlags = HideFlags.HideAndDontSave;
            Object.DontDestroyOnLoad(go);
            go.AddComponent<Ticker>();
        }

        public sealed class Ticker : MonoBehaviour
        {
            void Update()
            {
                float ms = Time.unscaledDeltaTime * 1000f;
                Samples++;
                if (ms > MaxMs) MaxMs = ms;
                if (ms > 100f) Over100++;
            }
        }
    }
}
