using System;
using System.Collections.Generic;
using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Deterministic, offline dialogue authority for Concordia. It uses authored NPC
    /// definitions, world canon, quest state, bonds, and recent world events without
    /// external credentials or a third-party conversation SDK.
    /// </summary>
    public static class ConcordiaDialogueService
    {
        static readonly Dictionary<string, int> Turns = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        static readonly Dictionary<string, string> LastIntent = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        static readonly HashSet<string> FirstTalkOffers = new HashSet<string>(StringComparer.OrdinalIgnoreCase);


        public static string Reply(GuestNpc npc, string input, WorldId world)
        {
            if (npc == null || npc.def == null) return "The silence does not answer.";
            var id = string.IsNullOrEmpty(npc.personId) ? npc.def.id : npc.personId;
            if (string.IsNullOrEmpty(id)) id = npc.def.name;
            var key = id + "@" + world;
            int turn;
            Turns.TryGetValue(key, out turn);
            Turns[key] = turn + 1;

            var intent = Classify(input);
            LastIntent[key] = intent;
            WorldEventLog.Record("dialogue", NameForEvent(npc) + " · intent=" + intent + " · " + (input ?? ""), id, world.ToString());
            var name = string.IsNullOrEmpty(npc.def.name) ? "The stranger" : npc.def.name;
            var baseLine = string.IsNullOrEmpty(npc.def.line) ? "The Court keeps its own counsel." : npc.def.line.Trim();
            var bond = Bonds.Get(Bonds.Key(npc));
            var factionId = FactionStandingIntegration.FactionForNpc(world, id);
            if (!FactionStandingIntegration.CanDialogue(world, factionId, out var dialogueReason))
            {
                FactionStandingIntegration.RecordDecision("dialogue-refusal", name + " refused dialogue: " + dialogueReason, factionId);
                return name + ": " + dialogueReason;
            }


            if (intent == "quest")
            {
                var offered = WorldBook.OfferedBy(world, id);
                if (offered != null && offered.Length > 0)
                    return name + ": " + QuestLog.Offer(offered[0], world);
                return name + ": " + baseLine + " There is no new oath I can place in your hands.";
            }
            if (intent == "where")
                return name + ": You stand in " + Canon.Get(world).title + ". " + Canon.Get(world).traversal;
            if (intent == "who")
                return name + ": I am " + name + ", and I keep the memory of this place. " + baseLine;
            if (intent == "help")
                return name + ": " + HelpLine(world, id);
            if (intent == "event")
            {
                var recent = WorldEventLog.RecentLine(3);
                if (!string.IsNullOrEmpty(recent))
                    return name + ": The recent memory is:\n" + recent;
                if (!string.IsNullOrEmpty(WorldClock.LastEvent))
                    return name + ": The latest word carried through the streets was: " + WorldClock.LastEvent;
            }
            if (intent == "thanks")
                return name + ": Then we understand one another. The Court remembers useful hands.";
            if (intent == "farewell")
                return name + ": Go carefully. Doors remember who crosses them.";

            if (turn == 0)
                return name + ": " + baseLine;
            if (bond >= 0.55f)
                return name + ": You have asked before, and you are still here. " + FollowUp(world);
            if (turn % 3 == 0)
                return name + ": Ask about the road, the work, or the trouble. I will answer what I can.";
            return name + ": " + FollowUp(world);
        }

        public static void Reset()
        {
            Turns.Clear();
            LastIntent.Clear();
            FirstTalkOffers.Clear();
        }

        static string NameForEvent(GuestNpc npc)
        {
            if (npc == null) return "unknown";
            if (npc.def != null && !string.IsNullOrEmpty(npc.def.name)) return npc.def.name;
            return npc.name;
        }

        static string HelpLine(WorldId world, string npcId)
        {
            var offered = WorldBook.OfferedBy(world, npcId);
            if (offered != null && offered.Length > 0)
                return "Take the work I can offer: " + offered[0].title + ".";
            return "Walk the Court, speak to its keepers, and follow the beacons. The ring gates are not decoration.";
        }

        static string FollowUp(WorldId world)
        {
            var recent = WorldEventLog.RecentLine(2);
            if (!string.IsNullOrEmpty(recent)) return "Since last time:\n" + recent;
            if (!string.IsNullOrEmpty(WorldClock.LastEvent)) return "Since last time: " + WorldClock.LastEvent;
            return "The world turns beneath the same sky. Your next useful step is near the marked places.";
        }

        static string Classify(string raw)
        {
            var text = (raw ?? string.Empty).Trim().ToLowerInvariant();
            if (text.Length == 0) return "none";
            if (ContainsAny(text, "quest", "job", "work", "mission", "task", "help me")) return "quest";
            if (ContainsAny(text, "where", "place", "city", "world", "gate", "road")) return "where";
            if (ContainsAny(text, "who are", "your name", "identity")) return "who";
            if (ContainsAny(text, "help", "need", "danger", "problem", "trouble")) return "help";
            if (ContainsAny(text, "what happened", "news", "event", "heard", "latest")) return "event";
            if (ContainsAny(text, "thanks", "thank you", "appreciate")) return "thanks";
            if (ContainsAny(text, "bye", "farewell", "leave", "later")) return "farewell";
            return "general";
        }

        static bool ContainsAny(string text, params string[] terms)
        {
            for (var i = 0; i < terms.Length; i++)
                if (text.Contains(terms[i])) return true;
            return false;
        }


        /// <summary>
        /// Offers the first authored quest attached to this NPC exactly once per world session.
        /// WorldBook resolves the authored giver and QuestLog owns acceptance/state.
        /// </summary>
        public static string FirstTalkQuestOffer(GuestNpc npc, WorldId world)
        {
            if (npc == null || npc.def == null) return null;
            var id = string.IsNullOrEmpty(npc.personId) ? npc.def.id : npc.personId;
            if (string.IsNullOrEmpty(id)) id = npc.def.name;
            var offered = WorldBook.OfferedBy(world, id);
            if (offered == null || offered.Length == 0) return null;

            var key = id + "@" + world;
            if (!FirstTalkOffers.Add(key)) return null;

            var result = QuestLog.Offer(offered[0], world);
            if (string.IsNullOrEmpty(result)) return null;
            var name = string.IsNullOrEmpty(npc.def.name) ? "The stranger" : npc.def.name;
            var baseLine = string.IsNullOrEmpty(npc.def.line) ? "" : npc.def.line.Trim();
            return string.IsNullOrEmpty(baseLine)
                ? name + ": " + result
                : name + ": " + baseLine + "\n" + result;
        }
    }
}
