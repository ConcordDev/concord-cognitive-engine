#if UNITY_EDITOR
using UnityEditor;
using UnityEngine;

[InitializeOnLoad]
static class ForceRecompile_ZukoPlay
{
    static ForceRecompile_ZukoPlay()
    {
        EditorApplication.delayCall += () =>
        {
            // Never write editor settings while Play is starting or running:
            // the delayCall from the pre-Play compile lands after Play begins.
            if (EditorApplication.isPlayingOrWillChangePlaymode) return;
            if (!EditorSettings.enterPlayModeOptionsEnabled
                && EditorSettings.enterPlayModeOptions == EnterPlayModeOptions.None)
                return;
            EditorSettings.enterPlayModeOptionsEnabled = false;
            EditorSettings.enterPlayModeOptions = EnterPlayModeOptions.None;
            Debug.Log("[Concordia] ForceRecompile_ZukoPlay: EnterPlayModeOptions forced OFF + domain load ping " + System.DateTime.Now.ToString("o"));
        };
    }
}
#endif
