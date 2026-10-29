using System;
using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// A-32: the server's own word on player skill progress. `skill:progress`
    /// (server gainSkillXP) arrives on /unity-ws once per XP grant; until the
    /// first one arrives there is nothing to show, so <see cref="Line"/> stays
    /// empty and the HUD slot stays hidden. Nothing here is computed locally.
    /// </summary>
    public static class ServerProgress
    {
        [Serializable] class Data { public string skill; public int level; public float xp; public float xpToNext; public float xpGain; public bool leveled; public bool acquired; public bool atCap; }
        [Serializable] class Envelope { public Data data; }

        public static bool Has { get; private set; }
        public static string Skill { get; private set; }
        public static int Level { get; private set; }
        public static float Xp { get; private set; }
        public static float XpToNext { get; private set; }
        public static bool AtCap { get; private set; }
        /// <summary>The last grant's gain, for a one-shot toast; cleared by <see cref="TakeNews"/>.</summary>
        static string _news;

        public static void Apply(string frameJson)
        {
            Data d = null;
            try { d = JsonUtility.FromJson<Envelope>(frameJson)?.data; }
            catch (Exception e) { Debug.LogWarning("[Concordia] skill:progress unreadable (" + e.Message + ")"); }
            if (d == null || string.IsNullOrEmpty(d.skill)) return;
            Has = true;
            Skill = d.skill;
            Level = d.level;
            Xp = d.xp;
            XpToNext = d.xpToNext;
            AtCap = d.atCap;
            if (d.acquired) _news = "New skill: " + d.skill + ".";
            else if (d.leveled) _news = d.skill + " reached level " + d.level + ".";
        }

        /// <summary>HUD line, or empty until the server has sent one.</summary>
        public static string Line
        {
            get
            {
                if (!Has) return "";
                if (AtCap) return Skill + "  ·  Lv " + Level + "  ·  max";
                return Skill + "  ·  Lv " + Level + "  ·  " + Mathf.FloorToInt(Xp) + " / " + Mathf.FloorToInt(XpToNext) + " xp";
            }
        }

        public static string TakeNews()
        {
            var n = _news;
            _news = null;
            return n;
        }

        public static void Reset()
        {
            Has = false;
            Skill = null;
            Level = 0;
            Xp = XpToNext = 0f;
            AtCap = false;
            _news = null;
        }
    }
}
