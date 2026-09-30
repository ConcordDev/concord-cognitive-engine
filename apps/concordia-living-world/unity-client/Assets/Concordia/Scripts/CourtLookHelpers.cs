using UnityEngine;

namespace Concordia
{
    /// <summary>Cheap cloth sway for accent banners — no cloth sim.</summary>
    public sealed class CourtBannerSway : MonoBehaviour
    {
        public float phase;
        Vector3 _base;

        void Awake() => _base = transform.localEulerAngles;

        void LateUpdate()
        {
            var t = Time.time * 0.7f + phase;
            transform.localEulerAngles = _base + new Vector3(0f, Mathf.Sin(t) * 4.5f, Mathf.Sin(t * 1.3f) * 3.2f);
        }
    }

    /// <summary>Keeps a soft rim spotlight behind the live player.</summary>
    public sealed class CourtHeroRimFollow : MonoBehaviour
    {
        void LateUpdate()
        {
            var p = ConcordiaPlayer.Live;
            if (!p) return;
            var back = -p.transform.forward;
            transform.position = p.transform.position + Vector3.up * 2.2f + back * 3.4f;
            transform.rotation = Quaternion.LookRotation(p.transform.position + Vector3.up * 1.2f - transform.position);
        }
    }
}
