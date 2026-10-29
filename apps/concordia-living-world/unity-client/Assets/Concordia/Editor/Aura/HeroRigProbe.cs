using System.Collections.Generic;
using System.Reflection;
using System.Text;
using UnityEditor;
using UnityEngine;
using Concordia.Animation;

namespace Concordia.Editor
{
    /// <summary>
    /// Aura: Play-mode hero rig audit (roadmap F-01). Reports the body ModularPerson actually bound
    /// — model, Humanoid avatar state, controller, clip fit — plus the AnimationRuntimeValidator
    /// findings and what <c>ModularPerson</c> itself wrote to /tmp/concordia-person-bind.txt.
    /// Read-only: it never changes the rig.
    /// </summary>
    public static class HeroRigProbe
    {
        /// <summary>Reports the ConcordiaGame host's state and starts a coroutine on that very component.</summary>
        public static string GameState()
        {
            var go = GameObject.Find("ConcordiaGame");
            if (!go) return "no-game-object";
            var comp = go.GetComponent<ConcordiaGame>();
            string s = "activeSelf=" + go.activeSelf +
                       " activeInHierarchy=" + go.activeInHierarchy +
                       " comp=" + (comp != null);
            if (comp == null) { Debug.Log("[AuraVerify] game " + s); return s; }
            s += " enabled=" + comp.enabled +
                 " activeAndEnabled=" + comp.isActiveAndEnabled +
                 " id=" + comp.GetEntityId() +
                 " frame=" + Time.frameCount +
                 " real=" + Time.realtimeSinceStartup.ToString("F1");
            Debug.Log("[AuraVerify] game " + s);
            comp.StartCoroutine(OnHost(comp));
            return s;
        }

        /// <summary>Coroutine started ON the ConcordiaGame component — does it resume?</summary>
        static System.Collections.IEnumerator OnHost(ConcordiaGame comp)
        {
            for (int i = 0; i < 6; i++)
            {
                Debug.Log("[AuraVerify] hostTick i=" + i + " frame=" + Time.frameCount +
                    " real=" + Time.realtimeSinceStartup.ToString("F1"));
                yield return null;
            }
            Debug.Log("[AuraVerify] hostTick done frame=" + Time.frameCount);
        }

        /// <summary>Re-starts the boot's own hero-bind coroutine later in the session.</summary>
        public static string KickBind()
        {
            var go = GameObject.Find("ConcordiaGame");
            if (!go) return "no-game-object";
            var comp = go.GetComponent<ConcordiaGame>();
            if (comp == null) return "no-component";
            var mi = typeof(ConcordiaGame).GetMethod("DressHeroAfterHub",
                BindingFlags.Instance | BindingFlags.NonPublic);
            if (mi == null) return "no-method";
            var en = mi.Invoke(comp, new object[] { null, null, null }) as System.Collections.IEnumerator;
            if (en == null) return "no-enumerator";
            comp.StartCoroutine(en);
            string s = "kicked frame=" + Time.frameCount + " real=" + Time.realtimeSinceStartup.ToString("F1");
            Debug.Log("[AuraVerify] kickBind " + s);
            return s;
        }

        /// <summary>Starts a fresh frame coroutine on a new object.</summary>
        public static string Ticker()
        {
            var go = GameObject.Find("AuraTicker");
            if (!go) go = new GameObject("AuraTicker");
            var t = go.GetComponent<AuraTicker>();
            if (!t) t = go.AddComponent<AuraTicker>();
            t.StartCoroutine(t.Run());
            string s = "started frame=" + Time.frameCount + " real=" + Time.realtimeSinceStartup.ToString("F1");
            Debug.Log("[AuraVerify] ticker " + s);
            return s;
        }

        /// <summary>Frame-rate / pause probe: run twice a few seconds apart and read the delta.</summary>
// <summary>Frame-rate / pause probe: run twice a few seconds apart and read the delta.</summary>
        public static string Frame()
        {
            string s = "frame=" + Time.frameCount +
                       " paused=" + UnityEditor.EditorApplication.isPaused +
                       " ts=" + Time.timeScale +
                       " dt=" + Time.deltaTime.ToString("F3") +
                       " real=" + Time.realtimeSinceStartup.ToString("F1") +
                       " targetFps=" + Application.targetFrameRate +
                       " vSync=" + QualitySettings.vSyncCount;
            Debug.Log("[AuraVerify] frame " + s);
            return s;
        }

        /// <summary>Full audit; logs and reports <c>[AuraVerify] F-01 PASS|FAIL …</c>.</summary>
        public static string Audit()
        {

            var player = ConcordiaPlayer.Live;
            if (player == null) return Fail("player=absent");

            var person = player.GetComponentInChildren<ModularPerson>(true);
            if (person == null) return Fail("player=True modularPerson=absent");

            var body = person.gameObject;
            var anim = person.GetComponentInChildren<Animator>(true);

            bool clipsFit = GetBool(person, "_clipsFit");
            string model = GetObjectName(person, "_modelTransform");
            string prefab = GetString(person, "_lastPrefabPath");

            bool human = anim != null && anim.avatar != null && anim.avatar.isHuman;
            bool avatarValid = anim != null && anim.avatar != null && anim.avatar.isValid;
            string controller = anim != null && anim.runtimeAnimatorController != null
                ? anim.runtimeAnimatorController.name
                : "none";

            // What the validator says about this exact Animator, plus the verb contract.
            var findings = anim != null
                ? AnimationRuntimeValidator.ValidateAnimator(anim, "Locomotion")
                : new List<AnimationRuntimeValidator.Finding> { new AnimationRuntimeValidator.Finding { Code = "no_animator", Detail = "none" } };
            var verbFindings = AnimationRuntimeValidator.ValidateVerbPlaybackContract();

            string codes = Codes(findings) + (verbFindings.Count > 0 ? " verbs:" + Codes(verbFindings) : " verbs:clean");

            var sb = new StringBuilder();
            sb.Append("hero=").Append(model);
            sb.Append(" human=").Append(human);
            sb.Append(" avatarValid=").Append(avatarValid);
            sb.Append(" controller=").Append(controller);
            sb.Append(" clipsFit=").Append(clipsFit);
            sb.Append(" animatorEnabled=").Append(anim != null && anim.enabled);
            sb.Append(" prefab=").Append(string.IsNullOrEmpty(prefab) ? "none" : prefab);
            sb.Append(" findings=").Append(codes);
            sb.Append(" | bindfile=").Append(BindFileLine());

            string line = sb.ToString();
            if (human && clipsFit && controller != "none") AuraVerify.Pass("F-01", line);
            else AuraVerify.Fail("F-01", line);
            return line;
        }

        /// <summary>Importer type of the CX_Humanoid bodies and the Rocketbox bodies (the F-01 note).</summary>
        public static string FbxImportTypes()
        {
            var sb = new StringBuilder();
            foreach (var guid in AssetDatabase.FindAssets("t:Model", new[] { "Assets/Concordia/Generated/Rig" }))
            {
                var path = AssetDatabase.GUIDToAssetPath(guid);
                var imp = AssetImporter.GetAtPath(path) as ModelImporter;
                if (imp == null) continue;
                sb.Append(System.IO.Path.GetFileName(path)).Append('=').Append(imp.animationType).Append(' ');
            }
            return sb.Length == 0 ? "no Generated/Rig models" : sb.ToString();
        }

        static string BindFileLine()
        {
            const string path = "/tmp/concordia-person-bind.txt";
            try
            {
                if (!System.IO.File.Exists(path)) return "missing";
                var lines = System.IO.File.ReadAllLines(path);
                for (int i = lines.Length - 1; i >= 0; i--)
                {
                    if (lines[i].Contains("hero=True")) return Shorten(lines[i]);
                }
                return "no-hero-line";
            }
            catch (System.Exception e) { return "read-failed:" + e.Message; }
        }

        static string Shorten(string line)
        {
            // Trim the timestamp and the uninteresting tail so the console line stays readable.
            int at = line.IndexOf("authored=");
            string s = at > 0 ? line.Substring(at) : line;
            int cut = s.IndexOf(" uArmL=");
            if (cut > 0) s = s.Substring(0, cut);
            return s;
        }

        static string Codes(List<AnimationRuntimeValidator.Finding> list)
        {
            if (list == null || list.Count == 0) return "none";
            var sb = new StringBuilder();
            foreach (var f in list)
            {
                if (sb.Length > 0) sb.Append(',');
                sb.Append(f.Code);
            }
            return sb.ToString();
        }

        static string Fail(string why)
        {
            AuraVerify.Fail("F-01", why);
            return why;
        }

        // ---- tiny reflection helpers (ModularPerson keeps these private) -------------------

        static FieldInfo Field(object target, string name) =>
            target.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic);

        static bool GetBool(object target, string name)
        {
            var f = Field(target, name);
            return f != null && f.GetValue(target) is bool b && b;
        }

        static string GetString(object target, string name)
        {
            var f = Field(target, name);
            return f?.GetValue(target) as string;
        }

        static string GetObjectName(object target, string name)
        {
            var f = Field(target, name);
            var obj = f?.GetValue(target) as Object;
            return obj != null ? obj.name : "null";
        }
    }

    /// <summary>Frame-tick probe: logs 8 consecutive frames, so a stall shows as silence.</summary>
    public class AuraTicker : MonoBehaviour
    {
        public System.Collections.IEnumerator Run()
        {
            for (int i = 0; i < 8; i++)
            {
                Debug.Log("[AuraVerify] tick i=" + i + " frame=" + Time.frameCount +
                    " real=" + Time.realtimeSinceStartup.ToString("F1"));
                yield return null;
            }
            Debug.Log("[AuraVerify] tick done frame=" + Time.frameCount);
        }
    }
}

