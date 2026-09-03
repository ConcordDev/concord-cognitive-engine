using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Authored idle life driven by WorldClock hours — port of npc-life.ts
    /// scheduleTarget (sleep / work / eat / gather / hide). Interruptible.
    /// LOD: REAL nearby, BULK coarse, VIRTUAL snap-to-destination.
    /// </summary>
    public class NpcLife : MonoBehaviour
    {
        public enum Job { Wander, Stall, Sit, Sweep, Watch }
        public Job job = Job.Wander;
        public bool pinned;
        public string act = "idle";
        public Vector3 home;
        public Vector3 workplace;
        ModularPerson _person;
        CharacterController _cc;
        NpcWander _wander;
        Quaternion _face;
        float _t;
        float _pause;
        float _bulkAt;
        Vector3 _vel;
        Renderer[] _rend;
        bool _hidden;

        void Start()
        {
            _person = GetComponentInChildren<ModularPerson>() ?? GetComponent<ModularPerson>();
            _cc = GetComponent<CharacterController>();
            _wander = GetComponent<NpcWander>();
            if (_wander) _wander.enabled = false;
            home = transform.position;
            _face = transform.rotation;
            workplace = WorkplaceFor(job, home);
            _rend = GetComponentsInChildren<Renderer>(true);
        }

        public void NoticePlayer(float seconds = 6f) => _pause = Mathf.Max(_pause, seconds);

        public void BindWorkplace(Vector3 pos) => workplace = pos;

        void Update()
        {
            if (pinned)
            {
                Hold();
                _person?.SetGait(0f, true);
                act = "watch";
                return;
            }

            var lod = WorldClock.LodAt(transform.position);
            Show(lod != SimLod.Virtual);
            if (lod == SimLod.Virtual)
            {
                Snap(Dest());
                return;
            }
            if (lod == SimLod.Bulk)
            {
                if (Time.time < _bulkAt) return;
                _bulkAt = Time.time + 0.35f;
            }

            _t += Time.deltaTime;
            _pause -= Time.deltaTime;
            if (Threat())
            {
                act = "flee";
                Walk(home, 3.8f);
                return;
            }
            if (_pause > 0f)
            {
                act = "talk";
                Hold();
                _person?.SetGait(0f, true);
                FacePlayer();
                return;
            }

            var hour = WorldClock.Hour;
            Vector3 dest;
            if (hour < 6f || hour >= 22f)
            {
                act = "sleep";
                dest = home;
                if (Arrived(dest)) { _person?.Sit(true); Hold(); _person?.SetGait(0f, true); return; }
            }
            else if (hour < 12f || (hour >= 14f && hour < 18f))
            {
                act = "work";
                dest = workplace;
                if (Arrived(dest)) { WorkInPlace(); return; }
            }
            else if (hour < 14f)
            {
                act = "eat";
                dest = Vector3.Lerp(home, workplace, 0.5f);
                if (Arrived(dest)) { _person?.Sit(true); Hold(); _person?.SetGait(0f, true); return; }
            }
            else
            {
                act = "gather";
                dest = home + new Vector3(2f, 0f, 2f);
                if (job == Job.Wander) dest = home + Circle(_t * 0.12f, 6f);
            }

            _person?.Sit(false);
            Walk(dest, 2.15f);
            if (lod == SimLod.Real && ConcordiaPlayer.Live)
            {
                var d = Vector3.Distance(ConcordiaPlayer.Live.transform.position, transform.position);
                if (d < 16f) WorldClock.NoteAct(Who() + " " + Phrase(act));
            }
        }

        void WorkInPlace()
        {
            switch (job)
            {
                case Job.Stall:
                    Hold();
                    _person?.SetGait(0f, true);
                    transform.rotation = Quaternion.Slerp(transform.rotation, _face, Time.deltaTime * 2f);
                    break;
                case Job.Sit:
                    Hold();
                    _person?.Sit(true);
                    _person?.SetGait(0f, true);
                    break;
                case Job.Watch:
                    Hold();
                    _person?.SetGait(0f, true);
                    transform.rotation = Quaternion.Euler(0f, Mathf.Sin(_t * 0.25f) * 40f + _face.eulerAngles.y, 0f);
                    break;
                case Job.Sweep:
                    {
                        var a = Mathf.Sin(_t * 0.35f);
                        var p = home + transform.right * (a * 2.4f);
                        Walk(p, 1.4f);
                    }
                    break;
                default:
                    Hold();
                    _person?.SetGait(0f, true);
                    break;
            }
        }

        void Walk(Vector3 dest, float speed)
        {
            var to = dest - transform.position;
            to.y = 0f;
            if (to.magnitude < 0.7f) { Hold(); _person?.SetGait(0f, true); return; }
            var dir = to.normalized;
            if (_cc)
            {
                if (_cc.isGrounded && _vel.y < 0f) _vel.y = -1.5f;
                else _vel.y += -22f * Time.deltaTime;
                _vel.x = Mathf.Lerp(_vel.x, dir.x * speed, 1f - Mathf.Exp(-8f * Time.deltaTime));
                _vel.z = Mathf.Lerp(_vel.z, dir.z * speed, 1f - Mathf.Exp(-8f * Time.deltaTime));
                _cc.Move(_vel * Time.deltaTime);
            }
            else
                transform.position += dir * speed * Time.deltaTime;
            var look = Quaternion.LookRotation(dir);
            transform.rotation = Quaternion.Slerp(transform.rotation, look, Time.deltaTime * 6f);
            _person?.SetGait(new Vector3(_vel.x, 0f, _vel.z).magnitude, true);
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

        void Snap(Vector3 dest)
        {
            dest.y = transform.position.y;
            transform.position = dest;
        }

        Vector3 Dest()
        {
            var hour = WorldClock.Hour;
            if (hour < 6f || hour >= 22f) return home;
            if (hour < 12f || (hour >= 14f && hour < 18f)) return workplace;
            if (hour < 14f) return Vector3.Lerp(home, workplace, 0.5f);
            return home + new Vector3(2f, 0f, 2f);
        }

        bool Arrived(Vector3 dest)
        {
            var d = dest - transform.position;
            d.y = 0f;
            return d.sqrMagnitude < 1.1f;
        }

        bool Threat()
        {
            if (!Canon.Get(WorldClock.World).steelLive) return false;
            var threats = WorldClock.Threats;
            if (threats == null) return false;
            var p = transform.position;
            for (int i = 0; i < threats.Length; i++)
            {
                var d = threats[i] - p;
                d.y = 0f;
                if (d.sqrMagnitude < 64f) return true;
            }
            return false;
        }

        void FacePlayer()
        {
            var p = ConcordiaPlayer.Live;
            if (!p) return;
            var to = p.transform.position - transform.position;
            to.y = 0f;
            if (to.sqrMagnitude < 0.01f) return;
            transform.rotation = Quaternion.Slerp(transform.rotation, Quaternion.LookRotation(to), Time.deltaTime * 6f);
        }

        void Show(bool on)
        {
            if (_hidden == !on) return;
            _hidden = !on;
            if (_rend == null) _rend = GetComponentsInChildren<Renderer>(true);
            foreach (var r in _rend) if (r) r.enabled = on;
            if (_cc) _cc.enabled = on;
        }

        string Who()
        {
            var n = name;
            if (string.IsNullOrEmpty(n) || n.StartsWith("Citizen") || n.StartsWith("Petitioner")
                || n.StartsWith("Merchant") || n.StartsWith("Passer"))
                return "someone";
            return n;
        }

        static string Phrase(string a) => a switch
        {
            "sleep" => "is home for the night",
            "work" => "is at work",
            "eat" => "has stopped to eat",
            "gather" => "walks the street",
            "flee" => "runs from steel",
            "talk" => "stopped to speak",
            "watch" => "holds a post",
            _ => "keeps moving"
        };

        static Vector3 Circle(float t, float r) => new Vector3(Mathf.Cos(t) * r, 0f, Mathf.Sin(t) * r);

        public static Vector3 WorkplaceFor(Job job, Vector3 home)
        {
            var place = BuildingPlace.Nearest(home, PlanFor(job));
            if (place) return place.door;
            return job switch
            {
                Job.Stall => home,
                Job.Watch => home + Vector3.forward * 1.2f,
                Job.Sit => home,
                Job.Sweep => home + Vector3.right * 2.2f,
                _ => home + new Vector3(4f, 0f, -3f)
            };
        }

        static string PlanFor(Job job) => job switch
        {
            Job.Stall => "market",
            Job.Sit => "archive",
            Job.Watch => "tower",
            _ => ""
        };
    }

    /// <summary>A building that is a place — door + plan — not scenery.</summary>
    public class BuildingPlace : MonoBehaviour
    {
        public string plan;
        public Vector3 door;

        public static BuildingPlace Nearest(Vector3 from, string plan)
        {
            BuildingPlace best = null;
            float bestD = 28f;
            foreach (var p in FindObjectsByType<BuildingPlace>(FindObjectsInactive.Exclude))
            {
                if (!p) continue;
                if (!string.IsNullOrEmpty(plan) && p.plan != plan && p.plan != "tavern") continue;
                var d = Vector3.Distance(from, p.door);
                if (d < bestD) { bestD = d; best = p; }
            }
            return best;
        }
    }
}
