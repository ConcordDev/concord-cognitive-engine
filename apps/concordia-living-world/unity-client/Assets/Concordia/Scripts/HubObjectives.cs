using System.Collections.Generic;
using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// P0 Hub + Ruins tracker. Completes only when the walk actually happened.
    /// </summary>
    public static class HubObjectives
    {
        public static bool Lamp;
        public static bool ArenaHit;
        public static bool Ruins;
        public static bool ReturnHub;
        public static int RingGates;
        static readonly HashSet<WorldId> Seen = new HashSet<WorldId>();

        public static void Reset()
        {
            Lamp = ArenaHit = Ruins = ReturnHub = false;
            RingGates = 0;
            Seen.Clear();
        }

        public static void NoteLamp() => Lamp = true;
        public static void NoteArenaHit() => ArenaHit = true;

        public static void NoteGateWalked(WorldId world)
        {
            if (world == WorldId.Hub) return;
            if (Seen.Add(world)) RingGates = Seen.Count;
        }

        public static void NoteTravel(WorldId from, WorldId to)
        {
            if (to == WorldId.Ruins) Ruins = true;
            if (from == WorldId.Ruins && to == WorldId.Hub) ReturnHub = true;
            if (to != WorldId.Hub) NoteGateWalked(to);
        }

        public static string Line()
        {
            string C(bool b) => b ? "done" : "open";
            int ring = Mathf.Min(RingGates, 3);
            return "Lamp " + C(Lamp)
                   + "  ·  Ring " + ring + "/3"
                   + "  ·  Arena " + C(ArenaHit)
                   + "  ·  Ruins " + C(Ruins)
                   + "  ·  Return " + C(ReturnHub);
        }
    }
}
