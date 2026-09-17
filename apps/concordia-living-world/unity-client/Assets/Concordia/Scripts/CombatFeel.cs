using UnityEngine;
using Concordia.Core;

namespace Concordia
{
    /// <summary>
    /// Camera kick + owned-pack combat VFX keyed to HitResolver, not a second clip.
    /// ChaseCamera writes pose first; we offset after. FOV/radius punch lives on ChaseCamera.
    /// </summary>
    [DefaultExecutionOrder(80)]
    public class CombatFeel : MonoBehaviour
    {
        public CharacterController body;
        public Camera cam;
        float _shake;

        public static string BeatFor(DefenseOutcome outcome)
        {
            switch (outcome)
            {
                case DefenseOutcome.Parried: return "parry";
                case DefenseOutcome.Dodged: return "dodge";
                case DefenseOutcome.Blocked: return "block";
                case DefenseOutcome.GuardBroken: return "guardbreak";
                case DefenseOutcome.OutOfRange: return "miss";
                default: return "hit";
            }
        }

        public void Strike(bool heavy, bool connected, float kickMul = 1f, string skillType = null)
        {
            var k = Mathf.Clamp(kickMul, 0.4f, 2.6f);
            var beat = connected ? (heavy ? "heavy" : "hit") : "miss";
            _shake = (connected ? (heavy ? 0.22f : 0.12f) : 0.05f) * k;
            PunchCam(beat);
            ArmTrail(heavy);
            if (connected)
            {
                Burst(skillType);
                Spark(StrikePoint(), heavy ? new Color(1f, 0.72f, 0.32f, 1f) : new Color(1f, 0.92f, 0.7f, 1f), heavy ? 18 : 10);
                Dust(StrikePoint(), 8);
            }
        }

        /// <summary>
        /// Incoming HitResolver beat: body already reacted; this is camera + VFX.
        /// Parry / dodge must punch even when no damage lands — SHOT 03.
        /// </summary>
        public void Present(HitResult result, Vector3 at)
        {
            var beat = BeatFor(result.Outcome);
            if (beat == "miss") return;
            _shake = ChaseCamera.StrengthFor(beat) * 0.55f;
            PunchCam(beat);
            if (result.Outcome == DefenseOutcome.Parried)
                Spark(at, new Color(1f, 0.88f, 0.42f, 1f), 22);
            else if (result.Outcome == DefenseOutcome.Blocked)
                Spark(at, new Color(0.72f, 0.82f, 1f, 1f), 12);
            else if (result.Outcome == DefenseOutcome.GuardBroken)
            {
                Spark(at, new Color(1f, 0.45f, 0.2f, 1f), 20);
                Dust(at, 14);
            }
            else if (result.Outcome == DefenseOutcome.Hit)
            {
                Spark(at, new Color(1f, 0.55f, 0.35f, 1f), 14);
                Dust(at, 10);
            }
        }

        public void ApplyAck(bool hit, float knockback, bool brokenArm, bool brokenLeg)
        {
            if (hit && body && knockback > 0)
                body.Move(-transform.forward * Mathf.Min(knockback, 2.4f) * 0.15f);
            _shake = hit ? 0.16f : 0.05f;
            var av = GetComponentInChildren<MixamoAvatar>();
            var person = GetComponentInChildren<ModularPerson>();
            if (hit)
            {
                av?.Hit();
                person?.Hurt();
            }
            if (knockback > 1.8f)
            {
                av?.Knockdown();
                person?.Stagger();
            }
            else if (knockback > 1.1f)
            {
                av?.Stagger();
                person?.Stagger();
            }
            if (brokenArm) Debug.Log("limb: broken arm — strikes weakened");
            if (brokenLeg) Debug.Log("limb: broken leg — dodge locked");
        }

        void PunchCam(string beat)
        {
            var chase = cam ? cam.GetComponent<ChaseCamera>() : null;
            if (!chase) chase = FindFirstObjectByType<ChaseCamera>();
            chase?.Punch(beat);
        }

        Vector3 StrikePoint()
        {
            return transform.position + transform.forward * 1.35f + Vector3.up * 1.12f;
        }

        void ArmTrail(bool heavy)
        {
            var person = GetComponentInChildren<ModularPerson>();
            if (!person || !person.sword) return;
            var blade = person.sword.transform;
            var tr = blade.GetComponent<TrailRenderer>();
            if (tr == null) tr = blade.gameObject.AddComponent<TrailRenderer>();
            tr.time = heavy ? 0.22f : 0.12f;
            tr.startWidth = heavy ? 0.055f : 0.035f;
            tr.endWidth = 0.008f;
            tr.minVertexDistance = 0.035f;
            tr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            tr.material = HubLook.ParticleMat(new Color(1f, 0.9f, 0.65f, 0.85f), true);
            tr.emitting = true;
            CancelInvoke(nameof(StopTrail));
            Invoke(nameof(StopTrail), heavy ? 0.38f : 0.22f);
        }

        void StopTrail()
        {
            var person = GetComponentInChildren<ModularPerson>();
            if (!person || !person.sword) return;
            var tr = person.sword.GetComponent<TrailRenderer>();
            if (tr) tr.emitting = false;
        }

        void Burst(string skillType)
        {
            var path = SkillLattice.VfxPath(skillType);
            var at = StrikePoint();
            var go = FreePacks.Prefab(path, transform, at, transform.eulerAngles.y);
            if (go) Object.Destroy(go, 1.25f);
        }

        static void Spark(Vector3 at, Color c, int count)
        {
            BurstParticles("HitSpark", at, c, count, 2.8f, 0.05f, true, 0.32f);
        }

        static void Dust(Vector3 at, int count)
        {
            BurstParticles("HitDust", at + Vector3.down * 0.35f, new Color(0.42f, 0.34f, 0.24f, 0.7f), count, 0.9f, 0.16f, false, 0.7f);
        }

        static void BurstParticles(string n, Vector3 at, Color c, int count, float speed, float size, bool additive, float life)
        {
            var go = new GameObject(n);
            go.transform.position = at;
            var ps = go.AddComponent<ParticleSystem>();
            var main = ps.main;
            main.loop = false;
            main.playOnAwake = false;
            main.duration = life;
            main.startLifetime = life;
            main.startSpeed = speed;
            main.startSize = size;
            main.startColor = c;
            main.maxParticles = count;
            main.simulationSpace = ParticleSystemSimulationSpace.World;
            main.gravityModifier = additive ? 0.4f : 1.1f;
            var emission = ps.emission;
            emission.rateOverTime = 0f;
            emission.SetBursts(new[] { new ParticleSystem.Burst(0f, (short)count) });
            var shape = ps.shape;
            shape.shapeType = ParticleSystemShapeType.Hemisphere;
            shape.radius = 0.12f;
            var rend = go.GetComponent<ParticleSystemRenderer>();
            rend.renderMode = ParticleSystemRenderMode.Billboard;
            rend.material = HubLook.ParticleMat(c, additive);
            rend.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            ps.Play();
            Object.Destroy(go, life + 0.4f);
        }

        void LateUpdate()
        {
            if (!cam) return;
            if (_shake > 0f)
            {
                _shake -= Time.deltaTime;
                cam.transform.position += Random.insideUnitSphere * (_shake * 0.42f);
            }
        }
    }
}
