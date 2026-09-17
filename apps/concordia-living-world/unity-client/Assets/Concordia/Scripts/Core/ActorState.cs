// Concordia gameplay core — Body.
//
// Per the master directive §33, everything speaks one vocabulary. This is the "body" half of it:
// the resource/state substrate that movement, combat, magic, firearms and vehicles all read and
// write, rather than each system inventing its own health/stamina notion.
//
// Deliberately pure C# — no MonoBehaviour, no UnityEngine types in the logic path — so it is
// deterministic and unit-testable (§30 requires contract tests; the Unity client had zero).
//
// AUTHORITY NOTE: this is the CLIENT-SIDE predictive body. It exists so combat feel can resolve
// at frame rate instead of waiting on a websocket round trip. It is NOT the ledger of record for
// anything that persists or has value — inventory, currency, ownership and royalties reconcile
// server-side. Feel is local; truth is reconciled.

using System;

namespace Concordia.Core
{
    public enum Stance
    {
        Neutral,
        Guarding,
        Sprinting,
        Crouched,
        Airborne,
        Downed
    }

    /// Graded stagger. Mirrors the project's existing poise-vs-momentum model rather than a
    /// separate dice roll, so client prediction and the server kernel describe the same outcomes.
    public enum StaggerTier
    {
        None = 0,
        Flinch = 1,
        Rocked = 2,
        Knockdown = 3
    }

    public sealed class ActorState
    {
        public float MaxHealth = 100f;
        public float MaxStamina = 100f;
        public float MaxPoise = 100f;

        public float Health = 100f;
        public float Stamina = 100f;
        public float Poise = 100f;

        public Stance Stance = Stance.Neutral;

        /// Poise regenerates only after this cooldown, so chained pressure actually breaks guard
        /// instead of every hit landing against a full poise bar.
        public float PoiseRegenDelaySeconds = 1.5f;
        public float PoiseRegenPerSecond = 22f;
        public float StaminaRegenPerSecond = 18f;

        float _poiseQuietFor;
        float _staminaQuietFor;

        public bool IsAlive => Health > 0f;
        public bool IsDowned => Stance == Stance.Downed;

        public bool CanSpend(float stamina) => Stamina >= stamina;

        public bool TrySpendStamina(float amount)
        {
            if (amount <= 0f) return true;
            if (Stamina < amount) return false;
            Stamina -= amount;
            _staminaQuietFor = 0f;
            return true;
        }

        /// Applies health + poise damage and reports the resulting stagger tier. Poise breaking is
        /// what escalates a hit from a flinch to a knockdown — damage alone never does.
        public StaggerTier ApplyHit(float damage, float poiseDamage)
        {
            if (damage > 0f)
            {
                Health = Math.Max(0f, Health - damage);
                _poiseQuietFor = 0f;
            }

            if (poiseDamage <= 0f) return StaggerTier.None;

            Poise = Math.Max(0f, Poise - poiseDamage);
            _poiseQuietFor = 0f;

            if (Poise > 0f)
                return StaggerTier.Flinch;

            // Poise broke. How far past the break the blow carried decides how hard it lands.
            var overkill = poiseDamage - (Poise + poiseDamage);
            var tier = overkill >= MaxPoise * 0.5f ? StaggerTier.Knockdown : StaggerTier.Rocked;
            Poise = MaxPoise;              // break consumes the bar, then it resets
            if (tier == StaggerTier.Knockdown) Stance = Stance.Downed;
            return tier;
        }

        public void Tick(float deltaSeconds)
        {
            if (deltaSeconds <= 0f) return;

            _staminaQuietFor += deltaSeconds;
            _poiseQuietFor += deltaSeconds;

            if (Stance != Stance.Sprinting && _staminaQuietFor > 0.4f && Stamina < MaxStamina)
                Stamina = Math.Min(MaxStamina, Stamina + StaminaRegenPerSecond * deltaSeconds);

            if (_poiseQuietFor > PoiseRegenDelaySeconds && Poise < MaxPoise)
                Poise = Math.Min(MaxPoise, Poise + PoiseRegenPerSecond * deltaSeconds);
        }

        public void Reset()
        {
            Health = MaxHealth;
            Stamina = MaxStamina;
            Poise = MaxPoise;
            Stance = Stance.Neutral;
            _poiseQuietFor = 0f;
            _staminaQuietFor = 0f;
        }
    }
}
