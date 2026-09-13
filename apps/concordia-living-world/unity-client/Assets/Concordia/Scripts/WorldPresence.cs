using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// A kernel xz is presentable only if a streamed chunk covers it.
    /// Far organisms stay unplaced — not invented at the player's feet.
    /// Before ContinentStream boots, the Hub ring is the presenter.
    /// </summary>
    public static class WorldPresence
    {
        public static GuestNpc FindGuest(string id)
        {
            if (string.IsNullOrEmpty(id)) return null;
            foreach (var n in Object.FindObjectsByType<GuestNpc>(FindObjectsInactive.Exclude))
            {
                if (!n) continue;
                if (n.personId == id) return n;
                if (n.def != null && n.def.id == id) return n;
            }
            return null;
        }

        public static WorldGate GateToward(string kernelWorld)
        {
            if (string.IsNullOrEmpty(kernelWorld)) return null;
            foreach (var g in Object.FindObjectsByType<WorldGate>(FindObjectsInactive.Exclude))
            {
                if (!g || g.def == null) continue;
                if (WorldBook.Folder(g.def.world) == kernelWorld) return g;
            }
            return null;
        }

        public static bool InPresenter(float x, float z)
        {
            if (ContinentStream.Live)
                return ContinentStream.Live.InPresenter(new Vector3(x, 0f, z));
            var mag = new Vector2(x, z).magnitude;
            return mag > 0.4f && mag <= Canon.RingRadius + 16f;
        }
    }
}
