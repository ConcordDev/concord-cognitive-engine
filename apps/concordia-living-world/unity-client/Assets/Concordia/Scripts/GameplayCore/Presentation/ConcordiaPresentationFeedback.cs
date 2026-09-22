using UnityEngine;

namespace Concordia.GameplayCore
{
    /// <summary>Authored-pack VFX/audio hook with procedural non-geometry fallback.</summary>
    public sealed class ConcordiaPresentationFeedback : MonoBehaviour
    {
        ParticleSystem _particles;
        AudioSource _audio;
        AudioClip _fallback;
        float _lastPulse;

        void Awake()
        {
            var fx = new GameObject("PresentationFeedbackFx");
            fx.transform.SetParent(transform, false);
            _particles = fx.AddComponent<ParticleSystem>();
            var main = _particles.main;
            main.loop = false;
            main.startLifetime = 0.45f;
            main.startSpeed = 2.2f;
            main.startSize = 0.06f;
            main.startColor = new Color(1f, 0.78f, 0.32f, 0.9f);
            var emission = _particles.emission;
            emission.enabled = false;
            _audio = gameObject.GetComponent<AudioSource>() ?? gameObject.AddComponent<AudioSource>();
            _audio.playOnAwake = false;
            _fallback = CreateFallbackClip();
        }

        public void Pulse(string key)
        {
            if (Time.unscaledTime - _lastPulse < 0.04f) return;
            _lastPulse = Time.unscaledTime;
            if (_particles)
            {
                _particles.transform.position = transform.position + transform.forward * 0.9f + Vector3.up * 1.05f;
                _particles.Emit(8);
            }
            if (_audio && _fallback) _audio.PlayOneShot(_fallback, 0.18f);
        }

        static AudioClip CreateFallbackClip()
        {
            const int rate = 22050;
            const int samples = 2205;
            var clip = AudioClip.Create("ConcordiaPresentationTick", samples, 1, rate, false);
            var data = new float[samples];
            for (var i = 0; i < samples; i++)
            {
                var t = i / (float)rate;
                var envelope = Mathf.Exp(-18f * t);
                data[i] = Mathf.Sin(2f * Mathf.PI * 520f * t) * envelope * 0.25f;
            }
            clip.SetData(data, 0);
            return clip;
        }
    }
}
