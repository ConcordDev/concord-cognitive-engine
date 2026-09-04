using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Authored idle life driven by WorldClock hours — port of npc-life.ts
    /// scheduleTarget (sleep / work / eat / gather / hide). Interruptible.
    /// LOD: REAL nearby, BULK coarse, VIRTUAL snap-to-destination.
    /// Activities are visible: open shop, patrol, deliver, talk, enter a building.
    /// </summary>
    public class NpcLife : MonoBehaviour
    {
        public enum Job { Wander, Stall, Sit, Sweep, Watch }
        public Job job = Job.Wander;
        public bool pinned;
        public string act = "idle";
        public Vector3 home;
        public Vector3 workplace;
        public Vector3 post;
        ModularPerson _person;
        CharacterController _cc;
        NpcWander _wander;
        Quaternion _face;
        Transform _regard;
        float _t;
        float _pause;
        float _bulkAt;
        float _socialAt;
        float _insideT;
        bool _indoors;
        Vector3 _vel;
        Renderer[] _rend;
        bool _hidden;
        GameObject _carry;

        void Start()
        {
            _person = GetComponentInChildren<ModularPerson>() ?? GetComponent<ModularPerson>();
            _cc = GetComponent<CharacterController>();
            _wander = GetComponent<NpcWander>();
            if (_wander) _wander.enabled = false;
            home = transform.position;
            _face = transform.rotation;
            workplace = WorkplaceFor(job, home);
            post = PostFor(job, home, workplace);
            _rend = GetComponentsInChildren<Renderer>(true);
            if (_cc) Grounding.Snap(_cc);
        }

        public void NoticePlayer(float seconds = 6f)
        {
            _regard = ConcordiaPlayer.Live ? ConcordiaPlayer.Live.transform : null;
            _pause = Mathf.Max(_pause, seconds);
        }

        public void Notice(Transform whom, float seconds)
        {
            _regard = whom;
            _pause = Mathf.Max(_pause, seconds);
        }

        public void BindWorkplace(Vector3 pos) => workplace = pos;
        public bool IsTalking => act == "talk";
        public bool IsWalkingJob => job == Job.Wander || job == Job.Sweep || job == Job.Watch;

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
            if (lod == SimLod.Virtual)
            {
                _indoors = false;
                DropCarry();
                Show(false);
                Snap(Dest());
                return;
            }
            Show(!_indoors);
            if (lod == SimLod.Bulk)
            {
                if (Time.time < _bulkAt) return;
                _bulkAt = Time.time + 0.35f;
            }

            _t += Time.deltaTime;
            _pause -= Time.deltaTime;

            if (_indoors)
            {
                _insideT -= Time.deltaTime;
                act = "inside";
                Hold();
                if (_insideT > 0f) return;
                _indoors = false;
                Show(true);
            }

            if (Threat())
            {
                act = "flee";
                DropCarry();
                Walk(home, 3.8f);
                return;
            }
            if (_pause > 0f)
            {
                act = "talk";
                Hold();
                _person?.SetGait(0f, true);
                FaceRegard();
                if (lod == SimLod.Real) WorldClock.NoteAct(Who() + " " + Phrase(act));
                return;
            }
            if (TrySocial(lod)) return;

            var hour = WorldClock.Hour;
            Vector3 dest;
            if (hour < 6f || hour >= 22f)
            {
                if (job == Job.Watch || job == Job.Sweep)
                {
                    act = job == Job.Watch ? "patrol" : "work";
                    DropCarry();
                    WorkInPlace();
                    if (lod == SimLod.Real && ConcordiaPlayer.Live
                        && Vector3.Distance(ConcordiaPlayer.Live.transform.position, transform.position) < 16f)
                        WorldClock.NoteAct(Who() + " " + Phrase(act));
                    return;
                }
                act = "sleep";
                dest = home;
                DropCarry();
                if (Arrived(dest))
                {
                    if (TryEnter("sleep")) return;
                    _person?.Sit(true);
                    Hold();
                    _person?.SetGait(0f, true);
                    return;
                }
            }
            else if (hour < 12f || (hour >= 14f && hour < 18f))
            {
                dest = WorkDest(hour);
                act = job == Job.Stall ? "open" : job == Job.Watch ? "patrol" : "work";
                DropCarry();
                if (IsWalkingJob)
                {
                    WorkInPlace();
                    if (lod == SimLod.Real && ConcordiaPlayer.Live
                        && Vector3.Distance(ConcordiaPlayer.Live.transform.position, transform.position) < 16f)
                        WorldClock.NoteAct(Who() + " " + Phrase(act));
                    return;
                }
                if (Arrived(dest))
                {
                    WorkInPlace();
                    if (job == Job.Stall || job == Job.Sit) TryEnter(act);
                    if (lod == SimLod.Real && ConcordiaPlayer.Live
                        && Vector3.Distance(ConcordiaPlayer.Live.transform.position, transform.position) < 16f)
                        WorldClock.NoteAct(Who() + " " + Phrase(act));
                    return;
                }
            }
            else if (hour < 14f)
            {
                act = "eat";
                dest = Vector3.Lerp(home, workplace, 0.5f);
                DropCarry();
                if (Arrived(dest)) { _person?.Sit(true); Hold(); _person?.SetGait(0f, true); return; }
            }
            else
            {
                dest = EveningDest();
                if (job == Job.Watch) act = "patrol";
                else if (job == Job.Wander || job == Job.Sweep) act = "deliver";
                else act = "gather";
                if (act == "deliver" || act == "gather") Carry();
                else DropCarry();
                if (Arrived(dest))
                {
                    DropCarry();
                    if (job == Job.Sit && TryEnter("gather")) return;
                    WorkInPlace();
                    return;
                }
            }

            _person?.Sit(false);
            Walk(dest, act == "patrol" ? 2.6f : 2.15f);
            if (lod == SimLod.Real && ConcordiaPlayer.Live)
            {
                var d = Vector3.Distance(ConcordiaPlayer.Live.transform.position, transform.position);
                if (d < 16f) WorldClock.NoteAct(Who() + " " + Phrase(act));
            }
        }

        bool TrySocial(SimLod lod)
        {
            if (lod != SimLod.Real) return false;
            if (IsWalkingJob) return false;
            if (Time.time < _socialAt) return false;
            _socialAt = Time.time + 8f;
            var p = transform.position;
            foreach (var other in FindObjectsByType<NpcLife>(FindObjectsInactive.Exclude))
            {
                if (!other || other == this || other.pinned) continue;
                if (other.IsWalkingJob) continue;
                if (other.act == "flee" || other.act == "sleep" || other.act == "inside") continue;
                var d = other.transform.position - p;
                d.y = 0f;
                if (d.sqrMagnitude > 3.2f) continue;
                Notice(other.transform, 1.8f);
                other.Notice(transform, 1.8f);
                act = "talk";
                WorldClock.NoteAct(Who() + " stopped to speak");
                return true;
            }
            return false;
        }

        bool TryEnter(string reason)
        {
            var place = BuildingPlace.Nearest(transform.position, PlanFor(job));
            if (!place) return false;
            var to = place.door - transform.position;
            to.y = 0f;
            if (to.sqrMagnitude > 4.8f) return false;
            _indoors = true;
            _insideT = 6.5f + (reason == "sleep" ? 4f : 0f);
            act = "inside";
            Show(false);
            WorldClock.NoteAct(Who() + " " + Phrase("inside"));
            return true;
        }

        void WorkInPlace()
        {
            switch (job)
            {
                case Job.Stall:
                    Hold();
                    _person?.SetGait(0f, true);
                    transform.rotation = Quaternion.Slerp(transform.rotation, _face, Time.deltaTime * 2f);
                    act = WorldClock.Hour >= 6f && WorldClock.Hour < 18f ? "open" : "work";
                    break;
                case Job.Sit:
                    Hold();
                    _person?.Sit(true);
                    _person?.SetGait(0f, true);
                    break;
                case Job.Watch:
                    PaceRing(5.5f, 1.65f);
                    act = "patrol";
                    break;
                case Job.Sweep:
                    {
                        var a = Mathf.Sin(_t * 0.35f);
                        var p = home + transform.right * (a * 2.4f);
                        Walk(p, 1.4f);
                    }
                    break;
                default:
                    WanderRing();
                    break;
            }
        }

        void WanderRing()
        {
            var dest = home + Circle(_t * 0.22f, 7.5f);
            Walk(dest, 1.85f);
            act = "work";
        }

        void PaceRing(float radius, float speed)
        {
            var dest = home + Circle(_t * 0.18f, radius);
            Walk(dest, speed);
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
            if (hour < 12f || (hour >= 14f && hour < 18f)) return WorkDest(hour);
            if (hour < 14f) return Vector3.Lerp(home, workplace, 0.5f);
            return EveningDest();
        }

        Vector3 WorkDest(float hour)
        {
            if (job == Job.Watch && hour >= 15f) return post;
            return workplace;
        }

        Vector3 EveningDest()
        {
            if (job == Job.Watch) return post;
            if (job == Job.Sit)
            {
                var tavern = BuildingPlace.Nearest(home, "tavern");
                if (tavern) return tavern.door;
            }
            if (job == Job.Wander) return home + Circle(_t * 0.12f, 6f);
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

        void FaceRegard()
        {
            var t = _regard;
            if (!t && ConcordiaPlayer.Live) t = ConcordiaPlayer.Live.transform;
            if (!t) return;
            var to = t.position - transform.position;
            to.y = 0f;
            if (to.sqrMagnitude < 0.01f) return;
            transform.rotation = Quaternion.Slerp(transform.rotation, Quaternion.LookRotation(to), Time.deltaTime * 6f);
        }

        void Carry()
        {
            if (_carry) return;
            _carry = CharacterGear.Attach(gameObject, "crate", false, 0.45f);
        }

        void DropCarry()
        {
            if (!_carry) return;
            Destroy(_carry);
            _carry = null;
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
                || n.StartsWith("Merchant") || n.StartsWith("Passer") || n.StartsWith("a "))
                return "someone";
            return n;
        }

        static string Phrase(string a) => a switch
        {
            "sleep" => "is home for the night",
            "work" => "is at work",
            "open" => "opens a shop",
            "eat" => "has stopped to eat",
            "gather" => "walks the street",
            "deliver" => "is carrying something",
            "flee" => "runs from steel",
            "talk" => "stopped to speak",
            "watch" => "holds a post",
            "patrol" => "changes post",
            "inside" => "enters a building",
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

        public static Vector3 PostFor(Job job, Vector3 home, Vector3 workplace)
        {
            if (job != Job.Watch) return workplace;
            var outw = home;
            outw.y = 0f;
            if (outw.sqrMagnitude < 1f) outw = Vector3.forward;
            return home + outw.normalized * 16f;
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
    public class UsePlace : MonoBehaviour
    {
        public string verb = "Use";
        public string line;
        public bool sit;

        public string Prompt => "E  ·  " + (string.IsNullOrEmpty(verb) ? "Use" : verb);

        public static UsePlace Stamp(GameObject go, string verb, string line, bool sit = false)
        {
            if (!go) return null;
            var u = go.GetComponent<UsePlace>() ?? go.AddComponent<UsePlace>();
            u.verb = verb;
            u.line = line;
            u.sit = sit;
            return u;
        }

        public static UsePlace Nearest(Vector3 from, float max = 2.4f)
        {
            UsePlace best = null;
            float bestD = max;
            foreach (var u in FindObjectsByType<UsePlace>(FindObjectsInactive.Exclude))
            {
                if (!u) continue;
                var d = Vector3.Distance(from, u.transform.position);
                if (d < bestD) { bestD = d; best = u; }
            }
            return best;
        }
    }

    public class BuildingPlace : MonoBehaviour
    {
        public string plan;
        public Vector3 door;
        public string Prompt => "E  ·  Enter";

        public static BuildingPlace NearestDoor(Vector3 from, float max = 3.4f)
        {
            BuildingPlace best = null;
            float bestD = max;
            foreach (var p in FindObjectsByType<BuildingPlace>(FindObjectsInactive.Exclude))
            {
                if (!p) continue;
                var d = Vector3.Distance(from, p.door);
                if (d < bestD) { bestD = d; best = p; }
            }
            return best;
        }

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
