using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Live-steel hunter. Perception → close → strafe → hit → recover.
    /// Does not wound inside the Unburned Court. Composes with FaunaLife.
    /// </summary>
    public class Hostile : MonoBehaviour
    {
        public float damage = 9f;
        public float range = 1.9f;
        public float aggro = 16f;
        public float speed = 3.4f;
        TrainingDummy _body;
        CharacterController _cc;
        FaunaLife _fauna;
        Vector3 _home;
        float _cd;
        float _seen;
        Vector3 _lastSeen;
        Vector3 _vel;
        float _strafe;
        float _style;

        void Start()
        {
            _body = GetComponent<TrainingDummy>() ?? GetComponentInParent<TrainingDummy>();
            _cc = GetComponent<CharacterController>();
            _fauna = GetComponent<FaunaLife>();
            _home = transform.position;
            _style = 0.85f + Mathf.Abs(name.GetHashCode() % 40) / 100f;
            speed *= _style;
            var drift = GetComponent<EvoDrift>();
            if (drift) drift.enabled = false;
        }

        void Update()
        {
            if (_body && _body.hp <= 0) { if (_fauna) _fauna.hunting = false; return; }
            var player = ConcordiaPlayer.Live;
            if (!player) return;
            if (!Canon.SteelLive(player.world, player.transform.position))
            {
                if (_fauna) _fauna.hunting = false;
                Hold();
                return;
            }
            var to = player.transform.position - transform.position;
            to.y = 0f;
            var dist = to.magnitude;
            _cd -= Time.deltaTime;

            var see = dist < aggro * 1.15f && Vector3.Dot(transform.forward, to.normalized) > -0.15f;
            if (see)
            {
                _seen = 2.4f;
                _lastSeen = player.transform.position;
            }
            else
                _seen -= Time.deltaTime;

            if (_seen <= 0f && dist > aggro)
            {
                if (_fauna) _fauna.hunting = false;
                var home = _home - transform.position;
                home.y = 0f;
                if (home.magnitude > 0.6f) Step(home.normalized);
                else Hold();
                return;
            }

            if (_fauna) _fauna.hunting = true;
            var aim = see ? to : _lastSeen - transform.position;
            aim.y = 0f;
            var aimDist = aim.magnitude;

            if (aimDist > range)
            {
                Step(aim.normalized);
                Face(aim);
                return;
            }

            _strafe += Time.deltaTime * (0.7f + _style);
            var side = Vector3.Cross(Vector3.up, aim.normalized);
            Step((side * Mathf.Sin(_strafe * 2.2f) * 0.55f).normalized);
            Face(aim);
            if (_cd > 0f) return;
            _cd = 0.85f + (1.4f - _style);
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
