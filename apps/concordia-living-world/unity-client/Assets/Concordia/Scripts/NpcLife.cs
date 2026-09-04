using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Authored idle life — not a checklist and not a behaviour tree.
    /// Stall keepers keep stalls. Sitters sit. Sweepers drift a short path.
    /// </summary>
    public class NpcLife : MonoBehaviour
    {
        public enum Job { Wander, Stall, Sit, Sweep, Watch }
        public Job job = Job.Wander;
        ModularPerson _person;
        Vector3 _home;
        Quaternion _face;
        float _t;

        void Start()
        {
            _person = GetComponentInChildren<ModularPerson>() ?? GetComponent<ModularPerson>();
            _home = transform.position;
            _face = transform.rotation;
            if (job == Job.Wander && !GetComponent<NpcWander>())
                gameObject.AddComponent<NpcWander>().roam = 9f;
        }

        void Update()
        {
            if (!_person) return;
            _t += Time.deltaTime;
            switch (job)
            {
                case Job.Stall:
                    Hold();
                    _person.SetGait(0f, true);
                    transform.rotation = Quaternion.Slerp(transform.rotation, _face, Time.deltaTime * 2f);
                    break;
                case Job.Sit:
                    Hold();
                    _person.Sit(true);
                    _person.SetGait(0f, true);
                    break;
                case Job.Watch:
                    Hold();
                    _person.SetGait(0f, true);
                    transform.rotation = Quaternion.Euler(0f, Mathf.Sin(_t * 0.25f) * 40f + _face.eulerAngles.y, 0f);
                    break;
                case Job.Sweep:
                    {
                        var a = Mathf.Sin(_t * 0.35f);
                        var p = _home + transform.right * (a * 2.4f);
                        p.y = transform.position.y;
                        var cc = GetComponent<CharacterController>();
                        if (cc)
                        {
                            var d = p - transform.position;
                            d.y = 0f;
                            cc.Move(d + Vector3.down * 1.5f * Time.deltaTime);
                            _person.SetGait(d.magnitude / Time.deltaTime, true);
                        }
                    }
                    break;
            }
        }

        void Hold()
        {
            var cc = GetComponent<CharacterController>();
            if (!cc) return;
            cc.Move(Vector3.down * 1.6f * Time.deltaTime);
        }
    }
}
