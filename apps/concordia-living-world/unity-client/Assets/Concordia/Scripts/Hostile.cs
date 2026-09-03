using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Live-steel hunter. Does not wound inside the Unburned Court.
    /// </summary>
    public class Hostile : MonoBehaviour
    {
        public float damage = 9f;
        public float range = 1.9f;
        public float aggro = 16f;
        public float speed = 3.4f;
        TrainingDummy _body;
        CharacterController _cc;
        Vector3 _home;
        float _cd;
        Vector3 _vel;

        void Start()
        {
            _body = GetComponent<TrainingDummy>() ?? GetComponentInParent<TrainingDummy>();
            _cc = GetComponent<CharacterController>();
            _home = transform.position;
            var drift = GetComponent<EvoDrift>();
            if (drift) drift.enabled = false;
        }

        void Update()
        {
            if (_body && _body.hp <= 0) return;
            var player = ConcordiaPlayer.Live;
            if (!player) return;
            if (!Canon.SteelLive(player.world, player.transform.position))
            {
                Hold();
                return;
            }
            var to = player.transform.position - transform.position;
            to.y = 0f;
            var dist = to.magnitude;
            _cd -= Time.deltaTime;

            if (dist > aggro)
            {
                var home = _home - transform.position;
                home.y = 0f;
                if (home.magnitude > 0.6f) Step(home.normalized);
                else Hold();
                return;
            }

            if (dist > range)
            {
                Step(to.normalized);
                Face(to);
                return;
            }

            Hold();
            Face(to);
            if (_cd > 0f) return;
            _cd = 1.15f;
            player.TakeHit(damage, name);
        }

        void Step(Vector3 dir)
        {
            dir.y = 0f;
            if (dir.sqrMagnitude < 0.01f) { Hold(); return; }
            dir.Normalize();
            if (_cc)
            {
                if (_cc.isGrounded && _vel.y < 0f) _vel.y = -1.5f;
                else _vel.y += -22f * Time.deltaTime;
                _vel.x = Mathf.Lerp(_vel.x, dir.x * speed, 1f - Mathf.Exp(-7f * Time.deltaTime));
                _vel.z = Mathf.Lerp(_vel.z, dir.z * speed, 1f - Mathf.Exp(-7f * Time.deltaTime));
                _cc.Move(_vel * Time.deltaTime);
            }
            else
                transform.position += dir * speed * Time.deltaTime;
            Face(dir);
        }

        void Hold()
        {
            if (!_cc) return;
            if (_cc.isGrounded) _vel.y = -1.5f;
            else _vel.y += -22f * Time.deltaTime;
            _vel.x = 0f;
            _vel.z = 0f;
            _cc.Move(_vel * Time.deltaTime);
        }

        void Face(Vector3 dir)
        {
            if (dir.sqrMagnitude < 0.01f) return;
            var look = Quaternion.LookRotation(new Vector3(dir.x, 0f, dir.z));
            transform.rotation = Quaternion.Slerp(transform.rotation, look, Time.deltaTime * 8f);
        }
    }
}
