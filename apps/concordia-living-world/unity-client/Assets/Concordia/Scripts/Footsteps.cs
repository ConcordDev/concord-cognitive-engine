using UnityEngine;

namespace Concordia
{
    [RequireComponent(typeof(CharacterController))]
    public class Footsteps : MonoBehaviour
    {
        CharacterController _cc;
        AudioSource _src;
        AudioClip[] _clips;
        float _accum;

        // Real Kenney RPG footstep SFX (footstep00..09.ogg), copied 2026-09-16 from
        // FreePacks/Audio/RPGsounds_Kenney into Resources/Concordia/Footsteps. The prior source,
        // "Assets/SourceFiles/TimmyRobot", never existed on disk — this had no working audio in
        // the Editor either, not just in builds; the synthetic click below was the only sound
        // anyone ever actually heard. Resources.LoadAll works identically in Editor and Player, so
        // there is no #if UNITY_EDITOR branch here at all now — one code path, both contexts.
        void Awake()
        {
            _cc = GetComponent<CharacterController>();
            _src = gameObject.AddComponent<AudioSource>();
            _src.playOnAwake = false;
            _src.spatialBlend = 0.35f;
            _src.volume = 0.35f;

            _clips = Resources.LoadAll<AudioClip>("Concordia/Footsteps");

            if (_clips == null || _clips.Length == 0)
            {
                var clip = AudioClip.Create("step", 1800, 1, 44100, false);
                var data = new float[1800];
                for (int i = 0; i < data.Length; i++)
                    data[i] = Mathf.Sin(i * 0.35f) * Mathf.Exp(-i / 280f) * 0.25f;
                clip.SetData(data, 0);
                _clips = new[] { clip };
            }
        }

        void Update()
        {
            if (_cc == null || _clips == null || _clips.Length == 0) return;
            var spd = new Vector3(_cc.velocity.x, 0, _cc.velocity.z).magnitude;
            if (!_cc.isGrounded || spd < 0.5f) { _accum = 0; return; }
            _accum += Time.deltaTime * spd * 0.62f;
            if (_accum < 1f) return;
            _accum = 0;
            var clip = _clips[Random.Range(0, _clips.Length)];
            if (clip) _src.PlayOneShot(clip, 0.4f);
        }
    }
}
