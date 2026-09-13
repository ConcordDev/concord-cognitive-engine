using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Kernel extras from world:snapshot / inspect:data. Presentation only.
    /// Empty when Concord has not answered — never invented citizens or quests.
    /// </summary>
    public static class WorldAaa
    {
        public static string QuestLine = "";
        public static string WarrantLine = "";
        public static string InspectLine = "";
        public static string MixamoLine = "modular person (Soldier.glb not in git)";
        public static string RefusalLine = "";
        public static int VehicleCount;
        public static int ConsequenceCount;

        public static void Reset()
        {
            QuestLine = "";
            WarrantLine = "";
            InspectLine = "";
            RefusalLine = "";
            VehicleCount = 0;
            ConsequenceCount = 0;
        }

        public static string HudTail()
        {
            var q = string.IsNullOrEmpty(QuestLine) ? QuestLog.HudBlock() : QuestLine;
            var extra = "";
            if (!string.IsNullOrEmpty(RefusalLine)) extra += "  ·  " + RefusalLine;
            if (!string.IsNullOrEmpty(WarrantLine)) extra += "  ·  " + WarrantLine;
            if (!string.IsNullOrEmpty(InspectLine)) extra += "  ·  " + InspectLine;
            if (VehicleCount > 0) extra += "  ·  carts " + VehicleCount;
            return q + extra;
        }

        public static void BindRefusal(string name, string theNo)
        {
            if (string.IsNullOrEmpty(name)) { RefusalLine = ""; return; }
            RefusalLine = name + (string.IsNullOrEmpty(theNo) ? "" : " — " + theNo);
        }

        public static void BindQuests(int n, string firstTitle)
        {
            if (n <= 0)
            {
                QuestLine = "";
                return;
            }
            QuestLine = n + " kernel quest" + (n == 1 ? "" : "s")
                + (string.IsNullOrEmpty(firstTitle) ? "" : "  ·  " + firstTitle);
        }

        public static void BindWarrants(int n)
        {
            WarrantLine = n <= 0 ? "" : n + " warrant" + (n == 1 ? "" : "s");
        }

        public static void BindInspect(string name, string why)
        {
            if (string.IsNullOrEmpty(name) && string.IsNullOrEmpty(why))
            {
                InspectLine = "";
                return;
            }
            InspectLine = (string.IsNullOrEmpty(name) ? "inspect" : name)
                + (string.IsNullOrEmpty(why) ? "" : " — " + why);
        }
    }
}
