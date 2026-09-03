using UnityEngine;

namespace Concordia
{
    [RequireComponent(typeof(CharacterController))]
    public class NpcWander : MonoBehaviour
    {
        public float walkSpeed = 2.3f;
        public float roam = 9f;
        CharacterController _cc;
        MixamoAvatar _avatar;
        ModularPerson _person;
        Vector3 _home, _dest;
        float _wait;
        Vector3 _vel;

        void Start()
        {
            _cc = GetComponent<CharacterController>();
            _avatar = GetComponentInChildren<MixamoAvatar>();
            _person = GetComponentInChildren<ModularPerson>() ?? GetComponent<ModularPerson>();
            _home = transform.position;
            Grounding.Snap(_cc);
            _home = transform.position;
            Pick();
        }

        void Update()
        {
            var dt = Time.deltaTime;
            if (_wait > 0f)
            {
                _wait -= dt;
                HoldGround(dt);
                _avatar?.SetGait(0f, _cc.isGrounded);
                _person?.SetGait(0f, _cc.isGrounded);
                if (_wait <= 0f) Pick();
                return;
            }

            var to = _dest - transform.position;
            to.y = 0f;
            if (to.magnitude < 1.1f)
            {
                _wait = Random.Range(1.8f, 5f);
                _avatar?.SetGait(0f, true);
                _person?.SetGait(0f, true);
                return;
            }

            var dir = to.normalized;
            var face = Mathf.Atan2(-dir.x, -dir.z) * Mathf.Rad2Deg;
            transform.rotation = Quaternion.Slerp(transform.rotation, Quaternion.Euler(0, face, 0), 1f - Mathf.Exp(-7f * dt));

            var grounded = _cc.isGrounded;
            if (grounded && _vel.y < 0f) _vel.y = -1.5f;
            else _vel.y += -22f * dt;
            _vel.x = Mathf.Lerp(_vel.x, dir.x * walkSpeed, 1f - Mathf.Exp(-8f * dt));
            _vel.z = Mathf.Lerp(_vel.z, dir.z * walkSpeed, 1f - Mathf.Exp(-8f * dt));
            _cc.Move(_vel * dt);
            var spd = new Vector3(_vel.x, 0f, _vel.z).magnitude;
            _avatar?.SetGait(spd, _cc.isGrounded, _vel.y);
            _person?.SetGait(spd, _cc.isGrounded, _vel.y);
        }

        void HoldGround(float dt)
        {
            if (_cc.isGrounded) _vel.y = -1.5f;
            else _vel.y += -22f * dt;
            _vel.x = 0f;
            _vel.z = 0f;
            _cc.Move(_vel * dt);
        }

        void Pick()
        {
            var homeXz = new Vector3(_home.x, 0f, _home.z);
            bool homeInCourt = homeXz.magnitude < Canon.CourtRadius;
            for (int n = 0; n < 8; n++)
            {
                var a = Random.Range(0f, Mathf.PI * 2f);
                var r = Random.Range(3f, roam);
                var dest = _home + new Vector3(Mathf.Cos(a) * r, 0f, Mathf.Sin(a) * r);
                var xz = new Vector3(dest.x, 0f, dest.z);
                if (!homeInCourt && xz.magnitude < Canon.CourtRadius)
                    continue;
                if (Canon.InArena(dest) && !Canon.InArena(_home))
                    continue;
                _dest = dest;
                return;
            }
            _dest = _home;
        }
    }
}
