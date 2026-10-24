using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Aura: machine-local client settings (roadmap B-05).
    /// Accessibility lives here so no shake, flash, pulse, tween or damage number has to
    /// hard-code its own amplitude — read these values instead. Writes persist immediately,
    /// so a choice survives a Play restart; the boot log line makes both reads verifiable.
    /// </summary>
    public static class ConcordiaSettings
    {
        const string P = "concordia.settings.";

        public const float CameraShakeMin = 0f;
        public const float CameraShakeMax = 1f;
        public const float SubtitleScaleMin = 0.75f;
        public const float SubtitleScaleMax = 2f;
        public const float MouseSensitivityMin = 0.2f;
        public const float MouseSensitivityMax = 3f;

        static bool _loaded;
        static bool _reducedMotion;
        static bool _damageNumbers;
        static bool _connectInLeanPlay;
        static float _cameraShake;
        static float _subtitleScale;
        static float _mouseSensitivity;

        static void Load()
        {
            if (_loaded) return;
            _loaded = true;
            _reducedMotion = PlayerPrefs.GetInt(P + "reducedMotion", 0) == 1;
            _damageNumbers = PlayerPrefs.GetInt(P + "damageNumbers", 1) == 1;
            _connectInLeanPlay = PlayerPrefs.GetInt(P + "connectInLeanPlay", Application.isEditor ? 1 : 0) == 1;
            _cameraShake = Mathf.Clamp(PlayerPrefs.GetFloat(P + "cameraShake", 1f), CameraShakeMin, CameraShakeMax);
            _subtitleScale = Mathf.Clamp(PlayerPrefs.GetFloat(P + "subtitleScale", 1f), SubtitleScaleMin, SubtitleScaleMax);
            _mouseSensitivity = Mathf.Clamp(PlayerPrefs.GetFloat(P + "mouseSensitivity", 1f), MouseSensitivityMin, MouseSensitivityMax);
        }

        /// <summary>Damp or drop shakes, flashes, pulses and tweens when true.</summary>
        public static bool ReducedMotion
        {
            get { Load(); return _reducedMotion; }
            set { Load(); if (_reducedMotion == value) return; _reducedMotion = value; PlayerPrefs.SetInt(P + "reducedMotion", value ? 1 : 0); PlayerPrefs.Save(); }
        }

        /// <summary>Camera shake amplitude, 0–1. Multiplied by <see cref="ReducedMotion"/> damping.</summary>
        public static float CameraShake
        {
            get { Load(); return _cameraShake; }
            set { Load(); var v = Mathf.Clamp(value, CameraShakeMin, CameraShakeMax); if (Mathf.Approximately(_cameraShake, v)) return; _cameraShake = v; PlayerPrefs.SetFloat(P + "cameraShake", v); PlayerPrefs.Save(); }
        }

        /// <summary>Floating damage and heal numbers.</summary>
        public static bool DamageNumbers
        {
            get { Load(); return _damageNumbers; }
            set { Load(); if (_damageNumbers == value) return; _damageNumbers = value; PlayerPrefs.SetInt(P + "damageNumbers", value ? 1 : 0); PlayerPrefs.Save(); }
        }

        /// <summary>Subtitle and card text scale, 0.75–2.</summary>
        public static float SubtitleScale
        {
            get { Load(); return _subtitleScale; }
            set { Load(); var v = Mathf.Clamp(value, SubtitleScaleMin, SubtitleScaleMax); if (Mathf.Approximately(_subtitleScale, v)) return; _subtitleScale = v; PlayerPrefs.SetFloat(P + "subtitleScale", v); PlayerPrefs.Save(); }
        }

        /// <summary>Open the gateway after the LeanPlay boot settles. Default on in the editor.</summary>
        public static bool ConnectInLeanPlay
        {
            get { Load(); return _connectInLeanPlay; }
            set { Load(); if (_connectInLeanPlay == value) return; _connectInLeanPlay = value; PlayerPrefs.SetInt(P + "connectInLeanPlay", value ? 1 : 0); PlayerPrefs.Save(); }
        }

        /// <summary>Look sensitivity multiplier, 0.2–3.</summary>
        public static float MouseSensitivity
        {
            get { Load(); return _mouseSensitivity; }
            set { Load(); var v = Mathf.Clamp(value, MouseSensitivityMin, MouseSensitivityMax); if (Mathf.Approximately(_mouseSensitivity, v)) return; _mouseSensitivity = v; PlayerPrefs.SetFloat(P + "mouseSensitivity", v); PlayerPrefs.Save(); }
        }

        /// <summary>One-line read-out of every setting, for HUD and verification.</summary>
        public static string Line()
        {
            return "reducedMotion=" + ReducedMotion +
                   " cameraShake=" + CameraShake.ToString("F2") +
                   " damageNumbers=" + DamageNumbers +
                   " subtitleScale=" + SubtitleScale.ToString("F2") +
                   " connectInLeanPlay=" + ConnectInLeanPlay +
                   " mouseSensitivity=" + MouseSensitivity.ToString("F2");
        }

        // Proves what each Play session actually read from PlayerPrefs (B-05 persistence check).
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void LogOnBoot()
        {
            if (!Application.isEditor && !Debug.isDebugBuild) return;
            Debug.Log("[ConcordiaSettings] loaded " + Line());
        }
    }
}
