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
            EditorSettings.enterPlayModeOptionsEnabled = false;
            EditorSettings.enterPlayModeOptions = EnterPlayModeOptions.None;
            Debug.Log("[Concordia] ForceRecompile_ZukoPlay: EnterPlayModeOptions forced OFF + domain load ping " + System.DateTime.Now.ToString("o"));
        };
    }
}
#endif
