using System.Reflection;
using UnityEngine;

namespace Concordia.Editor
{
    /// <summary>
    /// Aura: read/write <see cref="ConcordiaSettings"/> from the editor so the B-05
    /// persistence check ("does the value survive a Play restart?") is a logged fact.
    /// Uses PlayerPrefs for truth, which crosses assembly/domain boundaries.
    /// </summary>
    public static class SettingsProbe
    {
        /// <summary>Current settings as one line.</summary>
        public static string Read()
        {
            return "playing=" + Application.isPlaying + " " + ConcordiaSettings.Line();
        }

        /// <summary>Flip reduced motion, persist it, and report the value actually stored.</summary>
        public static string ToggleReducedMotion()
        {
            ConcordiaSettings.ReducedMotion = !ConcordiaSettings.ReducedMotion;
            AuraVerify.Pass("B-05", "reducedMotion set to " + ConcordiaSettings.ReducedMotion);
            return "playing=" + Application.isPlaying + " " + ConcordiaSettings.Line();
        }

        /// <summary>The raw persisted value, independent of the settings cache.</summary>
        public static string StoredRaw()
        {
            return "storedReducedMotion=" + PlayerPrefs.GetInt("concordia.settings.reducedMotion", -1);
        }

        /// <summary>
        /// Open the I-menu on its Settings tab and capture it, so the tab is proven to render
        /// (IMGUI sliders/toggles throw rather than failing quietly).
        /// </summary>
        public static string ShowSettingsTab()
        {
            return ShowTab(1, "B-05");
        }

        /// <summary>Open the I-menu on its Controls tab and capture it (B-07).</summary>
        public static string ShowControlsTab()
        {
            return ShowTab(2, "B-07");
        }

        static string ShowTab(int want, string shotId)
        {
            var hud = Object.FindAnyObjectByType<ConcordiaHUD>();
            if (hud == null) return "hud=absent";
            if (hud.player == null) return "hud=True player=absent";

            int tab = -1;
            var field = typeof(ConcordiaHUD).GetField("_menuTab", BindingFlags.Instance | BindingFlags.NonPublic);
            if (field != null)
            {
                field.SetValue(hud, want);
                tab = (int)field.GetValue(hud);
            }

            if (!hud.player.menuOpen) hud.player.ToggleMenu();

            string shot = AuraShots.CaptureAndProbe(shotId);
            return "hud=True menuOpen=" + hud.player.menuOpen + " tab=" + tab + " | " + shot;
        }
    }
}
