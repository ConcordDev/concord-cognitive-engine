using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Motor clock. Follows agent:intent. Never waits on an LLM per swing.
    /// HP only from combat:attack:ack. Flower Law via Canon.SteelLive.
    /// </summary>
    public class AgentMotor : MonoBehaviour
    {
        AgentAvatar _body;
        LivingBody _life;
        Vector3 _goto;
        bool _hasGoto;
        Transform _engage;
        string _stance = "cautious";
        float _swingAt;
        float _moveSentAt;
        float _counterUntil;

        public void Bind(AgentAvatar body)
        {
            _body = body;
            if (!_life) _life = GetComponent<LivingBody>() ?? gameObject.AddComponent<LivingBody>();
        }

        public void ApplyIntent(string goal, Vector3? gotoPos, Transform engage, string stance)
        {
            if (!string.IsNullOrEmpty(stance)) _stance = stance;
            _engage = engage;
            if (gotoPos.HasValue)
            {
                _goto = gotoPos.Value;
                _hasGoto = true;
            }
            else if (goal == "train_arena")
            {
                _goto = Canon.Arena;
                _hasGoto = true;
            }
            else if (goal == "patrol_court")
            {
                _goto = Canon.Spawn + new Vector3(4f, 0f, 4f);
                _hasGoto = true;
            }
        }

        public void GotoGate(string shortName)
        {
            foreach (var g in Canon.Gates)
            {
                if (g.shortName == shortName || g.name == shortName)
                {
                    _goto = new Vector3(Mathf.Cos(g.angle), 0f, Mathf.Sin(g.angle)) * Canon.RingRadius;
                    _hasGoto = true;
                    return;
                }
            }
        }

        void Update()
        {
            if (!_body || !_body.Cc) return;
            if (!_life) _life = GetComponent<LivingBody>() ?? gameObject.AddComponent<LivingBody>();
            _life.Tick(Time.deltaTime, _hasGoto || _engage);
            CounterTelegraph();
            if (_engage) Hunt();
            else if (_hasGoto) WalkTo(_goto, 4.6f * _life.MoveMul);
            else Hold();
            ReportMove();
        }

        void Hunt()
        {
            if (!_engage) { Hold(); return; }
            var dest = _engage.position;
            dest.y = transform.position.y;
            var d = Vector3.Distance(new Vector3(transform.position.x, 0, transform.position.z),
                new Vector3(_engage.position.x, 0, _engage.position.z));
            if (d > 1.7f)
            {
                WalkTo(dest, 5.2f * _life.MoveMul);
                return;
            }
            Hold();
            Face(_engage.position);
            var player = ConcordiaPlayer.Live;
            var world = player ? player.world : WorldClock.World;
            if (!Canon.SteelLive(world, transform.position)) return;
            if (Time.time < _swingAt) return;
            _swingAt = Time.time + (_stance == "aggressive" ? 0.55f : 0.85f);
            _body.Person?.Slash();
            var dummy = _engage.GetComponent<TrainingDummy>() ?? _engage.GetComponentInParent<TrainingDummy>();
            if (!dummy) return;
            var client = ConcordClient.Live;
            if (client && client.Connected && dummy.KernelAuthored)
                _ = client.SendAttack(dummy.name, 14f, 2.4f, "sword", transform.position.x, transform.position.z);
            else
                dummy.Hit(14f, world);
        }

        void WalkTo(Vector3 dest, float speed)
        {
            var cc = _body.Cc;
            var to = dest - transform.position;
            to.y = 0f;
            if (to.magnitude < 0.55f)
            {
                _hasGoto = false;
                Hold();
                return;
            }
            var dir = to.normalized;
            var vel = dir * speed;
            vel.y = cc.isGrounded ? -1.5f : -22f * Time.deltaTime;
            cc.Move(vel * Time.deltaTime);
            Face(dest);
            _body.Person?.SetGait(speed, cc.isGrounded);
        }

        void Hold()
        {
            var cc = _body.Cc;
            var vel = Vector3.zero;
            vel.y = cc.isGrounded ? -1.5f : -22f * Time.deltaTime;
            cc.Move(vel * Time.deltaTime);
            _body.Person?.SetGait(0f, cc.isGrounded);
        }

        void Face(Vector3 world)
        {
            var dir = world - transform.position;
            dir.y = 0f;
            if (dir.sqrMagnitude < 0.01f) return;
            transform.rotation = Quaternion.Slerp(transform.rotation, Quaternion.LookRotation(dir), Time.deltaTime * 8f);
        }

        void CounterTelegraph()
        {
            if (string.IsNullOrEmpty(Hostile.TelegraphKind)) return;
            if (Time.time < _counterUntil) return;
            if (Hostile.TelegraphFrom && Vector3.Distance(Hostile.TelegraphFrom.position, transform.position) > 4.5f)
                return;
            var counter = Hostile.TelegraphCounter;
            if (string.IsNullOrEmpty(counter)) counter = Hostile.CounterFor(Hostile.TelegraphKind);
            _counterUntil = Time.time + 0.4f;
            var client = ConcordClient.Live;
            if (counter == "jump")
            {
                var cc = _body.Cc;
                cc.Move(Vector3.up * 0.35f);
                if (client) _ = client.SendDodge(false, "jump");
            }
            else
            {
                var away = transform.right * (Random.value > 0.5f ? 1f : -1f);
                _body.Cc.Move(away * 1.6f);
                if (client) _ = client.SendDodge(counter == "parry", counter);
            }
        }

        void ReportMove()
        {
            if (Time.time < _moveSentAt) return;
            _moveSentAt = Time.time + 0.12f;
            var client = ConcordClient.Live;
            if (client && client.Connected)
                _ = client.SendMove(transform.position.x, transform.position.y, transform.position.z, client.WorldId);
        }

        public static TrainingDummy NearestDummy(Vector3 from)
        {
            TrainingDummy best = null;
            float bestD = 14f;
            foreach (var d in Object.FindObjectsByType<TrainingDummy>(FindObjectsInactive.Exclude))
            {
                if (!d || d.hp <= 0f) continue;
                var dist = Vector3.Distance(from, d.transform.position);
                if (dist < bestD) { bestD = dist; best = d; }
            }
            return best;
        }
    }
}
