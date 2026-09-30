using System;
using Concordia.WorldSimulation;
using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Read-only consumer policy over FactionStandingBook. This class never owns standing;
    /// it translates the persisted standing and separate witness heat into decisions.
    /// </summary>
    public static class FactionStandingIntegration
    {
        public sealed class GuardReactionDecision
        {
            public bool pursue;
            public bool investigate;
            public float suspicion;
            public string reason;
        }

        public static string StableFactionId(string raw)
        {
            return StableWorldId.Normalize(raw);
        }

        public static string FactionForNpc(WorldId world, string npcId)
        {
            var person = WorldBook.FindPerson(world, npcId);
            return person == null ? string.Empty : StableFactionId(person.faction_id);
        }

        public static bool CanDialogue(WorldId world, string factionId, out string reason)
        {
            var standing = FactionStandingBook.Get(world, factionId);
            var heat = FactionStandingBook.WitnessHeat(world, factionId);
            if (standing <= -0.8f)
            {
                reason = "Your standing with this faction is too low.";
                return false;
            }
            if (heat >= 0.9f && standing < 0.1f)
            {
                reason = "Witnesses have made this faction wary of you.";
                return false;
            }
            reason = string.Empty;
            return true;
        }

        public static bool CanAcceptQuest(WorldId world, string factionId, out string reason)
        {
            var standing = FactionStandingBook.Get(world, factionId);
            if (standing <= -0.65f)
            {
                reason = "This faction will not entrust you with its work.";
                return false;
            }
            reason = string.Empty;
            return true;
        }

        public static bool CanTrade(WorldId world, string factionId, out string reason)
        {
            var standing = FactionStandingBook.Get(world, factionId);
            var heat = FactionStandingBook.WitnessHeat(world, factionId);
            if (standing <= -0.9f)
            {
                reason = "The market refuses service to you.";
                return false;
            }
            if (heat >= 0.98f && standing < 0f)
            {
                reason = "The market closes while witnesses are watching you.";
                return false;
            }
            reason = string.Empty;
            return true;
        }

        public static float MarketPriceMultiplier(WorldId world, string factionId)
        {
            var standing = FactionStandingBook.Get(world, factionId);
            var heat = FactionStandingBook.WitnessHeat(world, factionId);
            return Mathf.Clamp(1f - standing * 0.2f + heat * 0.25f, 0.75f, 1.5f);
        }

        public static GuardReactionDecision EvaluateGuardReaction(WorldId world, string factionId, float crimeSeverity, bool confirmedWitness)
        {
            var standing = FactionStandingBook.Get(world, factionId);
            var heat = FactionStandingBook.WitnessHeat(world, factionId);
            var suspicion = Mathf.Clamp01(Mathf.Max(0f, -standing) * 0.55f + heat * 0.35f + Mathf.Clamp01(crimeSeverity) * (confirmedWitness ? 0.45f : 0.2f));
            return new GuardReactionDecision
            {
                suspicion = suspicion,
                investigate = confirmedWitness || suspicion >= 0.35f,
                pursue = confirmedWitness && suspicion >= 0.65f,
                reason = confirmedWitness ? "A witness confirmed the incident." : "The faction is assessing the report."
            };
        }

        public static float WitnessHeatFor(WitnessConfidence confidence, float reliability)
        {
            var certainty = confidence == WitnessConfidence.Confirmed ? 1f
                : confidence == WitnessConfidence.Plausible ? 0.7f
                : confidence == WitnessConfidence.Suspected ? 0.45f
                : 0.2f;
            return Mathf.Clamp01(certainty * Mathf.Clamp01(reliability));
        }

        public static void RecordDecision(string type, string text, string factionId)
        {
            WorldEventLog.Record(type, text, "player", StableFactionId(factionId));
        }
    }
}
