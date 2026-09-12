using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Linq.Expressions;
using System.Reflection;
using UnityEditor;
using UnityEngine;
using Concordia;

namespace Concordia.Editor
{
    /// <summary>
    /// Downloads + installs every My Assets pack into this project except Demo City (269772).
    /// Uses Unity 6 Package Manager internals via reflection (those types are CS0122).
    /// State lives in /tmp so domain reload after each Install can resume.
    /// </summary>
    [InitializeOnLoad]
    public static class ImportAllMyAssets
    {
        const long SkipDemoCity = 269772L;
        const int Batch = 3;
        const string StatePath = "/tmp/concordia-import-state.txt";
        const string NamesPath = "/tmp/concordia-import-names.txt";
        const string ProgressPath = "/tmp/concordia-import-progress.txt";
        const string EditorAsmName = "UnityEditor.CoreModule";

        static readonly string[] LocalUrpPackages =
        {
            "Assets/Barking_Dog/3D Free Modular Kit - URP.unitypackage",
            "Assets/EasyRoads3D/SRP Support Packages/URP_17_0_3.unitypackage",
            "Assets/GabrielAguiarProductions/FreeQuickEffectsVol1_2022_URP_v1.0.unitypackage"
        };

        // productId -> folder needle already in this project
        static readonly Dictionary<long, string[]> KnownFolders = new Dictionary<long, string[]>
        {
            { 85732, new[] { "Barking_Dog" } },
            { 107400, new[] { "BOXOPHOBIC" } },
            { 235621, new[] { "Convai" } },
            { 56841, new[] { "Earth" } },
            { 987, new[] { "EasyRoads3D" } },
            { 65284, new[] { "ExplosiveLLC" } },
            { 35361, new[] { "Fantasy Forest" } },
            { 304424, new[] { "GabrielAguiar" } },
            { 154271, new[] { "Kevin Iglesias" } },
            { 178395, new[] { "Kevin Iglesias" } },
            { 99131, new[] { "KinematicCharacterController" } },
            { 15649, new[] { "living birds" } },
            { 273604, new[] { "LLMUnity" } },
            { 87811, new[] { "Mega Fantasy Props" } },
            { 14360, new[] { "MYFG-Weapon" } },
            { 188357, new[] { "ProceduralTerrainPainter" } },
            { 34938, new[] { "RainMaker" } },
            { 267961, new[] { "Starter Assets" } },
            { 4387, new[] { "SUIMONO" } },
            { 95986, new[] { "UMotionEditor", "UMotionExamples" } },
            { 127325, new[] { "UnityTechnologies" } },
            { 28647, new[] { "3rdPerson+Fly" } },
            { 116144, new[] { "SlimUI" } },
            { 18353, new[] { "Skybox" } },
            { 61217, new[] { "Skybox" } },
            { 12567, new[] { "ADG_Textures" } },
            { 42285, new[] { "_Creepy_Cat" } },
            { 115747, new[] { "3DGamekit" } }
        };

        static bool _hooked;
        static Type _editorAsmCached;
        static double _lastKickAt;

        static ImportAllMyAssets()
        {
            EditorApplication.delayCall += ResumeIfNeeded;
            EditorApplication.update += WatchdogKick;
        }

        static void WatchdogKick()
        {
            if (!File.Exists(StatePath)) return;
            if (EditorApplication.isCompiling || EditorApplication.isUpdating || EditorApplication.isPlaying) return;
            var now = EditorApplication.timeSinceStartup;
            if (now - _lastKickAt < 4.0) return;
            var st = ReadState();
            if (st.Phase == "idle" || st.Phase == "done") return;
            _lastKickAt = now;
            Kick();
        }

        [MenuItem("Concordia/Asset Store/Import all My Assets")]
        public static void StartImport()
        {
            if (EditorApplication.isPlaying)
            {
                EditorApplication.isPlaying = false;
                EditorApplication.delayCall += StartImport;
                Log("stopped Play — starting import");
                return;
            }
            if (EditorApplication.isCompiling || EditorApplication.isUpdating)
            {
                EditorApplication.delayCall += StartImport;
                return;
            }
            WriteProgress("listing My Assets…");
            HookDownloadEvents();
            ListPurchasesThenQueue();
        }

        [MenuItem("Concordia/Asset Store/Import local URP support packs")]
        public static void ImportLocalUrp()
        {
            var imported = 0;
            foreach (var rel in LocalUrpPackages)
            {
                var abs = Path.Combine(Directory.GetParent(Application.dataPath).FullName, rel);
                if (!File.Exists(abs))
                {
                    Log("URP pack missing: " + rel);
                    continue;
                }
                AssetDatabase.ImportPackage(rel, false);
                imported++;
                Log("imported URP support " + rel);
            }
            WriteProgress("urp local packs imported=" + imported);
        }

        [MenuItem("Concordia/Asset Store/Stop My Assets import")]
        public static void StopImport()
        {
            try { if (File.Exists(StatePath)) File.Delete(StatePath); } catch { }
            WriteProgress("stopped");
            Log("import stopped — state cleared");
        }

        static void ResumeIfNeeded()
        {
            if (!File.Exists(StatePath)) return;
            var st = ReadState();
            if (st.Phase == "idle" || st.Phase == "done") return;
            if (EditorApplication.isPlaying) return;
            HookDownloadEvents();
            EditorApplication.delayCall += Kick;
        }

        static void ListPurchasesThenQueue()
        {
            var restType = Ed("UnityEditor.PackageManager.UI.Internal.IAssetStoreRestAPI");
            var purchasesType = Ed("UnityEditor.PackageManager.UI.Internal.AssetStorePurchases");
            var infoType = Ed("UnityEditor.PackageManager.UI.Internal.AssetStorePurchaseInfo");
            var errorType = Ed("UnityEditor.PackageManager.UI.Internal.UIError");
            var queryType = Ed("UnityEditor.PackageManager.UI.Internal.PurchasesQueryArgs");
            var api = Resolve("UnityEditor.PackageManager.UI.Internal.IAssetStoreRestAPI");
            var query = Activator.CreateInstance(queryType, new object[] { 0, 1000, "", null });

            Action<object> onOk = purchases =>
            {
                try
                {
                    var list = purchasesType.GetField("list").GetValue(purchases) as System.Collections.IEnumerable;
                    var total = Convert.ToInt64(purchasesType.GetField("total").GetValue(purchases));
                    var names = new Dictionary<long, string>();
                    if (list != null)
                    {
                        foreach (var item in list)
                        {
                            var id = Convert.ToInt64(infoType.GetField("productId").GetValue(item));
                            var name = "" + infoType.GetField("displayName").GetValue(item);
                            names[id] = name;
                        }
                    }
                    Log("My Assets total=" + total + " listed=" + names.Count);
                    QueueFromCatalog(names);
                }
                catch (Exception ex)
                {
                    WriteProgress("list failed: " + ex.Message);
                    Debug.LogException(ex);
                }
            };
            Action<object> onErr = err =>
            {
                var msg = ReadUiError(err);
                WriteProgress("GetPurchases error: " + msg);
                Log("GetPurchases error: " + msg);
            };

            var okDel = BoxAction(purchasesType, onOk);
            var errDel = BoxAction(errorType, onErr);
            restType.GetMethod("GetPurchases").Invoke(api, new object[] { query, okDel, errDel });
        }

        static void QueueFromCatalog(Dictionary<long, string> names)
        {
            WriteNames(names);
            var download = new List<long>();
            var install = new List<long>();
            var done = new List<long>();
            var failed = new List<long>();
            foreach (var kv in names.OrderBy(k => k.Value, StringComparer.OrdinalIgnoreCase))
            {
                var id = kv.Key;
                var name = kv.Value;
                if (id == SkipDemoCity)
                {
                    Log("skip Demo City " + id);
                    done.Add(id);
                    continue;
                }
                if (AlreadyInProject(id, name))
                {
                    Log("already in project " + id + " " + name);
                    done.Add(id);
                    continue;
                }
                if (HasLocalPackage(id))
                {
                    Log("cached, will install " + id + " " + name);
                    install.Add(id);
                    continue;
                }
                download.Add(id);
            }
            var st = new State
            {
                Phase = download.Count > 0 ? "download" : (install.Count > 0 ? "install" : "urp"),
                PendingDownload = download,
                PendingInstall = install,
                Done = done,
                Failed = failed
            };
            WriteState(st);
            WriteProgress("queued download=" + download.Count + " install=" + install.Count + " already=" + done.Count);
            Kick();
        }

        static void Kick()
        {
            if (EditorApplication.isCompiling || EditorApplication.isUpdating)
            {
                EditorApplication.delayCall += Kick;
                return;
            }
            if (!File.Exists(StatePath))
            {
                WriteProgress("idle — no state");
                return;
            }
            var st = ReadState();
            if (st.Phase == "done" || st.Phase == "idle") return;

            if (st.Installing != 0)
            {
                if (!st.Done.Contains(st.Installing)) st.Done.Add(st.Installing);
                st.PendingInstall.Remove(st.Installing);
                st.Installing = 0;
                WriteState(st);
            }

            if (st.PendingInstall.Count > 0)
            {
                st.Phase = "install";
                var id = st.PendingInstall[0];
                st.Installing = id;
                WriteState(st);
                WriteProgress("installing " + id + " " + NameOf(id) + " remainingInstall=" + st.PendingInstall.Count);
                try
                {
                    var installer = Resolve("UnityEditor.PackageManager.UI.Internal.IAssetStorePackageInstaller");
                    var t = Ed("UnityEditor.PackageManager.UI.Internal.IAssetStorePackageInstaller");
                    t.GetMethod("Install").Invoke(installer, new object[] { id, false });
                    Log("Install(" + id + ", interactive=false)");
                    // Install of an already-cached pack can finish with no domain reload.
                    EditorApplication.delayCall += Kick;
                }
                catch (Exception ex)
                {
                    st.Failed.Add(id);
                    st.PendingInstall.Remove(id);
                    st.Installing = 0;
                    WriteState(st);
                    Log("Install failed " + id + " " + ex.Message);
                    EditorApplication.delayCall += Kick;
                }
                return;
            }

            if (st.PendingDownload.Count > 0)
            {
                st.Phase = "download";
                WriteState(st);
                var n = Math.Min(Batch, st.PendingDownload.Count);
                var batch = st.PendingDownload.GetRange(0, n);
                WriteProgress("download batch " + string.Join(",", batch.ConvertAll(x => x + ":" + NameOf(x)).ToArray()) + " remaining=" + st.PendingDownload.Count);
                try
                {
                    HookDownloadEvents();
                    var mgr = Resolve("UnityEditor.PackageManager.UI.Internal.IAssetStoreDownloadManager");
                    var t = Ed("UnityEditor.PackageManager.UI.Internal.IAssetStoreDownloadManager");
                    var ok = (bool)t.GetMethod("Download", new[] { typeof(IEnumerable<long>) }).Invoke(mgr, new object[] { batch });
                    Log("Download batch ok=" + ok + " n=" + batch.Count);
                    if (!ok)
                    {
                        foreach (var id in batch)
                        {
                            st.Failed.Add(id);
                            st.PendingDownload.Remove(id);
                        }
                        WriteState(st);
                        EditorApplication.delayCall += Kick;
                    }
                }
                catch (Exception ex)
                {
                    WriteProgress("download threw: " + ex.Message);
                    Log("download threw: " + ex);
                }
                return;
            }

            if (st.Phase != "done")
            {
                st.Phase = "urp";
                WriteState(st);
                WriteProgress("importing local URP support packs");
                ImportLocalUrp();
                Finish(st);
            }
        }

        static void Finish(State st)
        {
            st.Phase = "done";
            st.Installing = 0;
            WriteState(st);
            try
            {
                FreePacks.Reindex();
                var audit = DressVocab.Audit();
                File.WriteAllText("/tmp/concordia-visual.txt", audit);
            }
            catch (Exception ex) { Log("reindex/audit: " + ex.Message); }
            WriteProgress("DONE done=" + st.Done.Count + " failed=" + st.Failed.Count + " " + string.Join(",", st.Failed));
            Log("My Assets import finished. failed=" + st.Failed.Count);
        }

        static void HookDownloadEvents()
        {
            if (_hooked) return;
            var mgrType = Ed("UnityEditor.PackageManager.UI.Internal.IAssetStoreDownloadManager");
            var opType = Ed("UnityEditor.PackageManager.UI.Internal.AssetStoreDownloadOperation");
            var errType = Ed("UnityEditor.PackageManager.UI.Internal.UIError");
            var mgr = Resolve("UnityEditor.PackageManager.UI.Internal.IAssetStoreDownloadManager");
            var doneEvt = mgrType.GetEvent("onDownloadFinalized");
            var errEvt = mgrType.GetEvent("onDownloadError");
            var progEvt = mgrType.GetEvent("onDownloadProgress");
            doneEvt.AddEventHandler(mgr, BoxAction(opType, OnDownloadFinalized));
            errEvt.AddEventHandler(mgr, BoxAction2(opType, errType, OnDownloadError));
            progEvt.AddEventHandler(mgr, BoxAction(opType, OnDownloadProgress));
            _hooked = true;
        }

        static void OnDownloadFinalized(object op)
        {
            var opType = op.GetType();
            var id = Convert.ToInt64(opType.GetProperty("productId").GetValue(op, null));
            var state = opType.GetProperty("state").GetValue(op, null);
            var stateName = state != null ? state.ToString() : "?";
            var err = "" + opType.GetProperty("errorMessage").GetValue(op, null);
            var path = "" + opType.GetProperty("packageNewPath").GetValue(op, null);
            Log("download finalized id=" + id + " state=" + stateName + " path=" + path + " err=" + err);
            if (!File.Exists(StatePath)) return;
            var st = ReadState();
            st.PendingDownload.Remove(id);
            var completed = stateName.IndexOf("Completed", StringComparison.OrdinalIgnoreCase) >= 0
                            || (!string.IsNullOrEmpty(path) && File.Exists(path));
            var failed = stateName.IndexOf("Error", StringComparison.OrdinalIgnoreCase) >= 0
                         || stateName.IndexOf("Aborted", StringComparison.OrdinalIgnoreCase) >= 0;
            if (failed && !completed)
            {
                if (!st.Failed.Contains(id)) st.Failed.Add(id);
                WriteState(st);
                WriteProgress("download failed " + id + " " + NameOf(id) + " " + err);
            }
            else
            {
                if (!st.PendingInstall.Contains(id) && !st.Done.Contains(id))
                    st.PendingInstall.Add(id);
                WriteState(st);
                WriteProgress("download ok " + id + " " + NameOf(id) + " → install queue");
            }
            EditorApplication.delayCall += Kick;
        }

        static void OnDownloadError(object op, object err)
        {
            long id = 0;
            try { id = Convert.ToInt64(op.GetType().GetProperty("productId").GetValue(op, null)); } catch { }
            var msg = ReadUiError(err);
            Log("download error id=" + id + " " + msg);
            if (!File.Exists(StatePath)) return;
            var st = ReadState();
            st.PendingDownload.Remove(id);
            if (!st.Failed.Contains(id)) st.Failed.Add(id);
            WriteState(st);
            WriteProgress("download error " + id + " " + NameOf(id) + " " + msg);
            EditorApplication.delayCall += Kick;
        }

        static void OnDownloadProgress(object op)
        {
            try
            {
                var id = Convert.ToInt64(op.GetType().GetProperty("productId").GetValue(op, null));
                var pct = Convert.ToSingle(op.GetType().GetProperty("progressPercentage").GetValue(op, null));
                WriteProgress("downloading " + id + " " + NameOf(id) + " " + (pct * 100f).ToString("0") + "%");
            }
            catch { }
        }

        static bool AlreadyInProject(long id, string displayName)
        {
            try
            {
                var cache = Resolve("UnityEditor.PackageManager.UI.Internal.IAssetStoreCache");
                var t = Ed("UnityEditor.PackageManager.UI.Internal.IAssetStoreCache");
                var imported = t.GetMethod("GetImportedPackage").Invoke(cache, new object[] { ToNullableLong(id) });
                if (imported != null) return true;
            }
            catch { }
            string[] needles;
            if (KnownFolders.TryGetValue(id, out needles) && FolderPresent(needles)) return true;
            if (!string.IsNullOrEmpty(displayName) && FolderPresent(new[] { displayName })) return true;
            return false;
        }

        static bool HasLocalPackage(long id)
        {
            try
            {
                var cache = Resolve("UnityEditor.PackageManager.UI.Internal.IAssetStoreCache");
                var t = Ed("UnityEditor.PackageManager.UI.Internal.IAssetStoreCache");
                var local = t.GetMethod("GetLocalInfo").Invoke(cache, new object[] { ToNullableLong(id) });
                if (local == null) return false;
                var path = "" + local.GetType().GetField("packagePath").GetValue(local);
                return !string.IsNullOrEmpty(path) && File.Exists(path);
            }
            catch { return false; }
        }

        static bool FolderPresent(string[] needles)
        {
            if (needles == null) return false;
            var assets = Application.dataPath;
            if (!Directory.Exists(assets)) return false;
            var dirs = Directory.GetDirectories(assets);
            for (var i = 0; i < dirs.Length; i++)
            {
                var name = Path.GetFileName(dirs[i]);
                for (var n = 0; n < needles.Length; n++)
                {
                    var needle = needles[n];
                    if (string.IsNullOrEmpty(needle)) continue;
                    if (name.IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0) return true;
                }
            }
            return false;
        }

        static object ToNullableLong(long id)
        {
            return Activator.CreateInstance(typeof(long?), id);
        }

        static Delegate BoxAction(Type argType, Action<object> handler)
        {
            var p = Expression.Parameter(argType, "x");
            var body = Expression.Invoke(Expression.Constant(handler), Expression.Convert(p, typeof(object)));
            return Expression.Lambda(typeof(Action<>).MakeGenericType(argType), body, p).Compile();
        }

        static Delegate BoxAction2(Type a, Type b, Action<object, object> handler)
        {
            var p1 = Expression.Parameter(a, "x");
            var p2 = Expression.Parameter(b, "y");
            var body = Expression.Invoke(Expression.Constant(handler),
                Expression.Convert(p1, typeof(object)),
                Expression.Convert(p2, typeof(object)));
            return Expression.Lambda(typeof(Action<,>).MakeGenericType(a, b), body, p1, p2).Compile();
        }

        static Type Ed(string fullName)
        {
            if (_editorAsmCached == null)
            {
                _editorAsmCached = typeof(UnityEditor.Editor);
            }
            var t = _editorAsmCached.Assembly.GetType(fullName);
            if (t == null) throw new InvalidOperationException("missing type " + fullName);
            return t;
        }

        static object Resolve(string fullName)
        {
            var want = Ed(fullName);
            var scType = Ed("UnityEditor.PackageManager.UI.Internal.ServicesContainer");
            var inst = scType.GetProperty("instance", BindingFlags.Public | BindingFlags.Static | BindingFlags.FlattenHierarchy).GetValue(null, null);
            return scType.GetMethod("Resolve").MakeGenericMethod(want).Invoke(inst, null);
        }

        static string ReadUiError(object err)
        {
            if (err == null) return "null";
            try
            {
                var p = err.GetType().GetProperty("message");
                if (p != null) return "" + p.GetValue(err, null);
            }
            catch { }
            return err.ToString();
        }

        static string NameOf(long id)
        {
            try
            {
                if (!File.Exists(NamesPath)) return "";
                foreach (var line in File.ReadAllLines(NamesPath))
                {
                    var tab = line.IndexOf('\t');
                    if (tab <= 0) continue;
                    long parsed;
                    if (long.TryParse(line.Substring(0, tab), out parsed) && parsed == id)
                        return line.Substring(tab + 1);
                }
            }
            catch { }
            return "";
        }

        static void WriteNames(Dictionary<long, string> names)
        {
            var sb = new System.Text.StringBuilder();
            foreach (var kv in names)
                sb.Append(kv.Key).Append('\t').Append(kv.Value).Append('\n');
            File.WriteAllText(NamesPath, sb.ToString());
        }

        class State
        {
            public string Phase = "idle";
            public long Installing;
            public List<long> PendingDownload = new List<long>();
            public List<long> PendingInstall = new List<long>();
            public List<long> Done = new List<long>();
            public List<long> Failed = new List<long>();
        }

        static void WriteState(State st)
        {
            var sb = new System.Text.StringBuilder();
            sb.Append("phase=").Append(st.Phase).Append('\n');
            sb.Append("installing=").Append(st.Installing).Append('\n');
            sb.Append("pendingDownload=").Append(string.Join(",", st.PendingDownload)).Append('\n');
            sb.Append("pendingInstall=").Append(string.Join(",", st.PendingInstall)).Append('\n');
            sb.Append("done=").Append(string.Join(",", st.Done)).Append('\n');
            sb.Append("failed=").Append(string.Join(",", st.Failed)).Append('\n');
            File.WriteAllText(StatePath, sb.ToString());
        }

        static State ReadState()
        {
            var st = new State();
            if (!File.Exists(StatePath)) return st;
            foreach (var raw in File.ReadAllLines(StatePath))
            {
                var eq = raw.IndexOf('=');
                if (eq <= 0) continue;
                var k = raw.Substring(0, eq);
                var v = raw.Substring(eq + 1);
                if (k == "phase") st.Phase = v;
                else if (k == "installing") long.TryParse(v, out st.Installing);
                else if (k == "pendingDownload") st.PendingDownload = ParseIds(v);
                else if (k == "pendingInstall") st.PendingInstall = ParseIds(v);
                else if (k == "done") st.Done = ParseIds(v);
                else if (k == "failed") st.Failed = ParseIds(v);
            }
            return st;
        }

        static List<long> ParseIds(string v)
        {
            var list = new List<long>();
            if (string.IsNullOrEmpty(v)) return list;
            var parts = v.Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries);
            for (var i = 0; i < parts.Length; i++)
            {
                long id;
                if (long.TryParse(parts[i], out id)) list.Add(id);
            }
            return list;
        }

        static void WriteProgress(string line)
        {
            try
            {
                File.WriteAllText(ProgressPath, DateTime.Now.ToString("HH:mm:ss") + " " + line + "\n");
            }
            catch { }
            Debug.Log("[Concordia import] " + line);
        }

        static void Log(string line)
        {
            Debug.Log("[Concordia import] " + line);
        }
    }
}
