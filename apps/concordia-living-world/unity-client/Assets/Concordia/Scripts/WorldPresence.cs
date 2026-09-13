using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// A kernel xz is presentable only if a streamed chunk covers it.
    /// Far organisms stay unplaced — not invented at the player's feet.
    /// </summary>
    public static class WorldPresence
    {
        public static bool InPresenter(float x, float z)
        {
            if (!ContinentStream.Live) return false;
            return ContinentStream.Live.InPresenter(new Vector3(x, 0f, z));
        }
    }
}
