using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Needs a body can feel. Same component type for the hero and AgentMotor —
    /// separate instances, never shared meters. Clock rate matches
    /// WorldClock (dt * 0.08 game-hours per real second). Words, not
    /// fabricated HUD stats. Kernel ATS ticks remain P1.
    /// </summary>
    public class LivingBody : MonoBehaviour
    {
        public static LivingBody Hero { get; private set; }

        public float Hunger;
        public float Fatigue;

        public float MoveMul =>
            Mathf.Lerp(1f, 0.55f, Mathf.Clamp01(Hunger * 0.55f + Fatigue * 0.7f));

        public bool CanClimb => Fatigue < 0.92f && Hunger < 0.97f;

        public string NeedLine
        {
            get
            {
                bool hungry = Hunger >= 0.28f;
                bool tired = Fatigue >= 0.42f;
                if (hungry && tired) return "hungry · tired";
                if (hungry) return "hungry";
                if (tired) return "tired";
                return null;
            }
        }

        public static void BindHero(LivingBody body)
        {
            if (body) Hero = body;
        }

        void OnEnable()
        {
            if (GetComponent<ConcordiaPlayer>()) Hero = this;
        }

        void OnDisable()
        {
            if (Hero == this) Hero = null;
        }

        void Start()
        {
            SyncToClock(WorldClock.Hour);
        }

        void Update()
        {
            if (Hero == this) Tick(Time.deltaTime, false);
        }

        /// <summary>
        /// Morning without food is hunger, not a zero meter. Hour 8.5 → ~0.28.
        /// </summary>
        public void SyncToClock(float hour)
        {
            float awake = hour - 6f;
            if (awake < 0f) awake += 24f;
            if (awake > 16f) awake = 0f;
            Hunger = Mathf.Max(Hunger, Mathf.Clamp01(awake * 0.12f));
            Fatigue = Mathf.Max(Fatigue, Mathf.Clamp01(awake * 0.04f));
        }

        public void Tick(float dt, bool sprinting)
        {
            float gh = dt * 0.08f;
            if (gh > 0f)
            {
                Hunger = Mathf.Clamp01(Hunger + gh * 0.05f);
                Fatigue = Mathf.Clamp01(Fatigue + gh * 0.035f);
            }
            if (sprinting)
                Fatigue = Mathf.Clamp01(Fatigue + Mathf.Max(dt, Time.deltaTime) * 0.04f);
            else if (dt > 0f)
                Fatigue = Mathf.Max(0f, Fatigue - dt * 0.008f);
        }

        public void Eat()
        {
            Hunger = Mathf.Max(0f, Hunger - 0.55f);
            Fatigue = Mathf.Max(0f, Fatigue - 0.12f);
        }

        public void Climb(float dt)
        {
            Fatigue = Mathf.Clamp01(Fatigue + dt * 0.12f);
        }
    }
}
