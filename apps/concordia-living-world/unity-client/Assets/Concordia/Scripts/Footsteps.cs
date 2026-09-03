using UnityEngine;
#if UNITY_EDITOR
using UnityEditor;
#endif

namespace Concordia
{
    [RequireComponent(typeof(CharacterController))]
    public class Footsteps : MonoBehaviour
    {
        CharacterController _cc;
        AudioSource _src;
        AudioClip[] _clips;
        float _accum;

        void Awake()
        {
            _cc = GetComponent<CharacterController>();
            _src = gameObject.AddComponent<AudioSource>();
            _src.playOnAwake = false;
            _src.spatialBlend = 0.35f;
            _src.volume = 0.35f;
#if UNITY_EDITOR
            var guids = AssetDatabase.FindAssets("Player_Footstep t:AudioClip", new[] { "Assets/SourceFiles/TimmyRobot" });
            _clips = new AudioClip[guids.Length];
            for (int i = 0; i < guids.Length; i++)
                _clips[i] = AssetDatabase.LoadAssetAtPath<AudioClip>(AssetDatabase.GUIDToAssetPath(guids[i]));
#endif
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
