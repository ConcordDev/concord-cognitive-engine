using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Camera kick + FOV punch. ChaseCamera writes pose first; we offset after.
    /// </summary>
    [DefaultExecutionOrder(80)]
    public class CombatFeel : MonoBehaviour
    {
        public CharacterController body;
        public Camera cam;
        float _shake;
        float _fovKick;

        public void Strike(bool heavy, bool connected)
        {
            _shake = connected ? (heavy ? 0.22f : 0.12f) : 0.05f;
            _fovKick = connected ? (heavy ? 7f : 3.5f) : 1.2f;
        }

        public void ApplyAck(bool hit, float knockback, bool brokenArm, bool brokenLeg)
        {
            if (hit && body && knockback > 0)
                body.Move(-transform.forward * Mathf.Min(knockback, 2.4f) * 0.15f);
            _shake = hit ? 0.16f : 0.05f;
            if (brokenArm) Debug.Log("limb: broken arm — strikes weakened");
            if (brokenLeg) Debug.Log("limb: broken leg — dodge locked");
        }

        void LateUpdate()
        {
            if (!cam) return;
            if (_shake > 0f)
            {
                _shake -= Time.deltaTime;
                cam.transform.position += Random.insideUnitSphere * (_shake * 0.42f);
            }
            if (_fovKick > 0.05f)
            {
                cam.fieldOfView += _fovKick;
                _fovKick = Mathf.Lerp(_fovKick, 0f, 1f - Mathf.Exp(-14f * Time.deltaTime));
            }
        }
    }
}
