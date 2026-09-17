// Concordia gameplay core — hit + defense resolution.
//
// The directive's §2 asks for ONE defense grammar (block / parry / dodge / counter) rather than a
// separate defensive button per system. This resolves all of them through a single ordered check,
// so melee, firearms, magic and creature attacks are all defended the same way.
//
// Resolution order matters and is deliberate:
//   1. i-frames  (dodge beat it outright — nothing else needs asking)
//   2. parry     (timed, highest skill expression, best reward)
//   3. block     (held, costs stamina, chip damage, can be guard-broken)
//   4. hit       (nothing stopped it)
//
// §3 of the directive: "Do not allow animation to claim a parry happened if combat resolution
// says it did not." This function IS that resolution — animation reads its result, never the
// reverse.

using System;

namespace Concordia.Core
{
    public enum DefenseOutcome
    {
        Hit,
        Blocked,
        GuardBroken,
        Parried,
        Dodged,
        OutOfRange
    }

    public struct AttackContext
    {
        public float Damage;
        public float PoiseDamage;
        public float ReachMeters;
        public float DistanceMeters;
        /// Momentum at contact. Feeds impulse/knockback; distinct from raw damage (§1).
        public float Impulse;
    }

    public struct HitResult
    {
        public DefenseOutcome Outcome;
        public float DamageDealt;
        public float PoiseDamageDealt;
        public float StaminaDrained;
        public float Impulse;
        public StaggerTier Stagger;
        /// True when the defender earned a punish window (perfect parry / guard break on attacker).
        public bool CounterOpening;
    }

    public static class HitResolver
    {
        /// Fraction of blocked damage that still gets through a held guard.
        public const float ChipDamageFactor = 0.15f;
        /// Stamina a block costs, scaled by the incoming poise damage.
        public const float BlockStaminaFactor = 0.55f;

        public static HitResult Resolve(
            in AttackContext attack,
            ActorState defender,
            ActionRunner defenderAction)
        {
            var result = new HitResult { Outcome = DefenseOutcome.Hit };

            if (defender == null || !defender.IsAlive)
                return result;

            // Reach is a real gate, not decoration — an attack that never reached cannot be
            // "blocked" or "parried", and reporting otherwise would let animation lie about it.
            if (attack.DistanceMeters > attack.ReachMeters)
            {
                result.Outcome = DefenseOutcome.OutOfRange;
                return result;
            }

            if (defenderAction != null && defenderAction.IsInvulnerable)
            {
                result.Outcome = DefenseOutcome.Dodged;
                return result;
            }

            if (defenderAction != null && defenderAction.IsParrying)
            {
                result.Outcome = DefenseOutcome.Parried;
                result.CounterOpening = true;   // the whole point of taking the timing risk
                return result;
            }

            if (defenderAction != null && defenderAction.IsGuarding)
            {
                var staminaCost = attack.PoiseDamage * BlockStaminaFactor;

                if (!defender.TrySpendStamina(staminaCost))
                {
                    // Guard broke: full damage, full poise, and the defender is the one exposed.
                    result.Outcome = DefenseOutcome.GuardBroken;
                    result.DamageDealt = attack.Damage;
                    result.PoiseDamageDealt = attack.PoiseDamage;
                    result.Impulse = attack.Impulse;
                    result.StaminaDrained = defender.Stamina;
                    defender.Stamina = 0f;
                    result.Stagger = defender.ApplyHit(result.DamageDealt, result.PoiseDamageDealt);
                    return result;
                }

                result.Outcome = DefenseOutcome.Blocked;
                result.StaminaDrained = staminaCost;
                result.DamageDealt = attack.Damage * ChipDamageFactor;
                result.Impulse = attack.Impulse * 0.35f;
                // Blocking absorbs poise pressure rather than converting it to a stagger.
                result.Stagger = defender.ApplyHit(result.DamageDealt, 0f);
                return result;
            }

            result.DamageDealt = attack.Damage;
            result.PoiseDamageDealt = attack.PoiseDamage;
            result.Impulse = attack.Impulse;
            result.Stagger = defender.ApplyHit(result.DamageDealt, result.PoiseDamageDealt);
            return result;
        }
    }
}
