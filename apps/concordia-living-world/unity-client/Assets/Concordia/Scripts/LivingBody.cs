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
                bool hungry = Hunger >= 0.18f;
                bool tired = Fatigue >= 0.32f;
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

        string _toldNeed;

        void Update()
        {
            if (Hero != this) return;
            Tick(Time.deltaTime, false);
            var line = NeedLine;
            if (string.IsNullOrEmpty(line) || line == _toldNeed) return;
            _toldNeed = line;
            if (ConcordiaPlayer.Live) ConcordiaPlayer.Live.Notice("You are " + line + ".");
        }

        /// <summary>
        /// Morning without food is hunger, not a zero meter. Hour 7.2 → ~0.31.
        /// A plaza-to-wreck walk should already read hungry.
        /// </summary>
        public void SyncToClock(float hour)
        {
            float sinceBreakfast = hour - 5.5f;
            if (sinceBreakfast < 0f) sinceBreakfast += 24f;
            if (sinceBreakfast > 16f) sinceBreakfast = 0f;
            Hunger = Mathf.Max(Hunger, Mathf.Clamp01(sinceBreakfast * 0.18f));
            float awake = hour - 6f;
            if (awake < 0f) awake += 24f;
            if (awake > 16f) awake = 0f;
            Fatigue = Mathf.Max(Fatigue, Mathf.Clamp01(awake * 0.06f));
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
