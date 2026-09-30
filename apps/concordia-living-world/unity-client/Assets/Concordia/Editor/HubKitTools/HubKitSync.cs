// Concordia — HubKit sync.
//
// FreePacks.cs's own doc comment claims: "Player / WebGL: HubKit only
// (StreamingAssets + glTFast). Never Editor-only." That claim was true for the
// consumption side (HubKit.TryGet is genuinely called from FreePacks.Mesh at
// runtime) but the PRODUCTION side — the tool that bakes FreePacks' indexed
// catalog into StreamingAssets/HubKit/MANIFEST.json — never existed. The
// manifest on disk had 5 hand-picked Kenney items and predates the PolyHaven +
// FreePacks(folder) import by three days: none of that 13.5GB was reachable
// from a real Player build.
//
// This closes that gap without inventing a parallel asset pipeline: it reuses
// FreePacks' own indexing (FreePacks.AllIndexed) as the source-of-truth list of
// "things Unity has actually imported as a spawnable GameObject", and glTFast's
// own exporter (already a project dependency) as the format converter — so it
// does not matter whether the original source was .fbx, .obj, or already .glb.
//
// INCIDENT (2026-09-16): the first version of this tool called
// `export.SaveToFileAndDispose(destPath).GetAwaiter().GetResult()` inside a
// synchronous method, reasoning that UninterruptedDeferAgent.ShouldDefer()
// always returning false made blocking "provably safe" — it rules out the
// export ever yielding across a FRAME, but does not rule out an internal
// continuation being marshaled back to the main thread via Unity's
// SynchronizationContext (e.g. for texture encoding). Blocking the main
// thread while something needs that same main thread to resume is the
// textbook single-threaded deadlock, and it wedged the Editor solid — 32
// consecutive "Command TCS timed out" in Editor.log, every subsequent
// command hung, and the process had to be force-killed and restarted.
//
// The fix is structural, not a smaller timeout: this file now NEVER blocks a
// Task synchronously anywhere. Work is driven by EditorApplication.update,
// one item in flight at a time, using a real `await` inside an `async void`
// tick handler — genuine await yields the thread back to Unity's message
// pump instead of parking it, so a stuck continuation can no longer prevent
// the pump (and therefore every other Editor command) from running. A
// wall-clock watchdog additionally force-advances past any single item that
// still doesn't complete in time, so one bad asset can degrade to "skipped"
// instead of wedging the batch again.

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Concordia;
using GLTFast;
using GLTFast.Export;
using UnityEditor;
using UnityEngine;

namespace Concordia.EditorTools
{
    public static class HubKitSync
    {
        const string KitDir = "Assets/StreamingAssets/HubKit";
        const string ManifestPath = KitDir + "/MANIFEST.json";
        const double ItemTimeoutSeconds = 25.0;

        [Serializable]
        class Entry
        {
            public string stem;
            public string file;
            public string license;
            public string author;
            public string source;
        }

        [Serializable]
        class Alias
        {
            public string from;
            public string to;
        }

        [Serializable]
        class Manifest
        {
            public string id;
            public string title;
            public string note;
            public List<Entry> files = new List<Entry>();

            // MUST mirror every field HubKit.Manifest reads. JsonUtility.ToJson only serialises
            // fields this class declares, so an omitted field is silently DESTROYED on the first
            // save — that is exactly what happened: the original manifest's 11 `aliases` (used by
            // HubKit.Alias, which FreePacks.Mesh calls on every single lookup) were dropped on the
            // first sync, breaking stem resolution for building-small-a/b/c/d, statue, trophy,
            // market_crate, market_barrel, weapon-rack, building-garage and road-straight-lightposts.
            // Add a field here whenever HubKit's Manifest gains one.
            public List<Alias> aliases = new List<Alias>();
        }

        static Queue<(string stem, string path)> _queue;
        static bool _busy;
        static double _itemStartTime;
        static int _exported, _copied, _skipped;

        [MenuItem("Concordia/HubKit/Start Sync (150)")]
        public static void StartSyncMenu() => Debug.Log(StartSync(150));

        /// Removes manifest entries (and their backing file) whose .glb is suspiciously small —
        /// the signature left by the pre-instantiate-fix exporter, which returned `true` for an
        /// empty scene. Existing-by-stem is otherwise permanent skip logic, so a broken entry left
        /// in place would be silently skipped forever instead of retried. Returns how many were purged.
        [MenuItem("Concordia/HubKit/Purge Broken Entries")]
        public static void PurgeBrokenEntriesMenu() => PurgeBrokenEntries();

        public static int PurgeBrokenEntries(long minBytes = 200)
        {
            var manifest = LoadManifest();
            var kept = new List<Entry>();
            int purged = 0;

            foreach (var e in manifest.files)
            {
                var path = KitDir + "/" + e.file;
                var info = new FileInfo(path);
                bool broken = !info.Exists || info.Length < minBytes;
                if (broken)
                {
                    purged++;
                    if (info.Exists) File.Delete(path);
                    Debug.LogWarning($"[HubKitSync] purged broken entry '{e.stem}' " +
                                      $"({(info.Exists ? info.Length : 0)} bytes)");
                }
                else
                {
                    kept.Add(e);
                }
            }

            manifest.files = kept;
            SaveManifest(manifest);
            AssetDatabase.Refresh();
            Debug.Log($"[HubKitSync] purge complete — removed {purged}, {kept.Count} remain valid");
            return purged;
        }

        [MenuItem("Concordia/HubKit/Report Status")]
        public static void ReportStatusMenu() => Debug.Log(Status());

        /// Queues up to `limit` not-yet-synced stems and starts the tick-driven worker. Returns
        /// immediately — this never blocks. Poll Status() / CountPending() to track progress.
        public static string StartSync(int limit)
        {
            if (_queue != null && _queue.Count > 0)
                return $"[HubKitSync] a run is already in progress ({_queue.Count} queued, busy={_busy}) — poll Status() instead of starting another.";

            Directory.CreateDirectory(KitDir);
            var manifest = LoadManifest();
            var already = new HashSet<string>(manifest.files.Select(f => f.stem));

            var candidates = InScopeCandidates()
                .Where(kv => !already.Contains(kv.Key))
                .OrderBy(kv => kv.Key, StringComparer.Ordinal)
                .Take(Math.Max(0, limit))
                .ToList();

            _queue = new Queue<(string, string)>(candidates.Select(kv => (kv.Key, kv.Value)));
            _exported = 0;
            _copied = 0;
            _skipped = 0;
            _busy = false;

            EditorApplication.update -= Tick;
            EditorApplication.update += Tick;

            return $"[HubKitSync] started — queued {_queue.Count} items (limit was {limit})";
        }

        public static string Status()
        {
            int queued = _queue?.Count ?? 0;
            var (pending, total) = CountPending();
            return $"running={_queue != null} queued={queued} busy={_busy} " +
                   $"thisRun(exported={_exported} copied={_copied} skipped={_skipped}) " +
                   $"overallPending={pending} overallTotalInScope={total}";
        }

        static void Tick()
        {
            if (_busy)
            {
                if (EditorApplication.timeSinceStartup - _itemStartTime > ItemTimeoutSeconds)
                {
                    Debug.LogWarning("[HubKitSync] item watchdog fired (>" + ItemTimeoutSeconds +
                                      "s) — moving on. This bounds the damage from a stuck export; " +
                                      "it does not and cannot force-abort a truly wedged background " +
                                      "task, it only stops that task from blocking the batch further.");
                    _skipped++;
                    _busy = false;
                }
                else
                {
                    return;
                }
            }

            if (_queue == null || _queue.Count == 0)
            {
                if (_queue != null)
                {
                    AssetDatabase.Refresh();
                    Debug.Log($"[HubKitSync] run complete — exported={_exported} copied={_copied} skipped={_skipped}");
                }
                EditorApplication.update -= Tick;
                _queue = null;
                return;
            }

            var (stem, assetPath) = _queue.Dequeue();
            _busy = true;
            _itemStartTime = EditorApplication.timeSinceStartup;
            // Fire-and-forget on purpose: `async void` here is called from a synchronous tick and
            // must not be awaited by the caller — that is exactly the shape that lets a genuine
            // `await` inside it cooperate with the message pump instead of blocking it.
            ProcessOneAsync(stem, assetPath);
        }

        static async void ProcessOneAsync(string stem, string assetPath)
        {
            bool ok;
            var destFile = SafeFileName(stem) + ".glb";
            var destPath = KitDir + "/" + destFile;

            try
            {
                if (assetPath.EndsWith(".glb", StringComparison.OrdinalIgnoreCase))
                {
                    File.Copy(assetPath, destPath, overwrite: true);
                    ok = true;
                }
                else
                {
                    ok = await ExportGlbAsync(assetPath, destPath);
                }
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[HubKitSync] {stem} failed: {e.Message}");
                ok = false;
            }

            // The watchdog may already have moved on and cleared _busy for this stem's slot; only
            // record success if this callback is still the one Tick is waiting on.
            bool stillOwnsSlot = _busy;

            if (ok)
            {
                if (assetPath.EndsWith(".glb", StringComparison.OrdinalIgnoreCase)) _copied++; else _exported++;

                var manifest = LoadManifest();
                if (!manifest.files.Any(f => f.stem == stem))
                {
                    manifest.files.Add(new Entry
                    {
                        stem = stem,
                        file = destFile,
                        license = "CC0",
                        author = InferAuthor(assetPath),
                        source = assetPath
                    });
                    SaveManifest(manifest);
                }
            }
            else if (stillOwnsSlot)
            {
                _skipped++;
            }

            if (stillOwnsSlot) _busy = false;
        }

        static async Task<bool> ExportGlbAsync(string assetPath, string destPath)
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(assetPath);
            if (!prefab)
            {
                Debug.LogWarning($"[HubKitSync] could not load GameObject at {assetPath}");
                return false;
            }

            // GameObjectExport walks a live scene hierarchy (matches glTFast's own SimpleExport
            // sample, which exports FindGameObjectsWithTag results — actual scene objects, not
            // asset references). A raw prefab ASSET passed directly produced a technically-valid
            // but EMPTY glTF (magic header + bare {"asset":{...}} JSON, no scenes/nodes/meshes) —
            // caught by checking the exported byte count, not by trusting the bool return value.
            // Instantiating first is the fix; the instance is destroyed in `finally` regardless of
            // outcome so a long batch can't accumulate hidden scene objects.
            var instance = UnityEngine.Object.Instantiate(prefab);
            try
            {
                var settings = new ExportSettings { Format = GltfFormat.Binary };
                var export = new GameObjectExport(
                    exportSettings: settings,
                    deferAgent: new UninterruptedDeferAgent()
                );

                if (!export.AddScene(new[] { instance }, prefab.name))
                {
                    Debug.LogWarning($"[HubKitSync] AddScene rejected {assetPath}");
                    return false;
                }

                // Real await — the tick-driven design (never .Result/.Wait()/.GetAwaiter().GetResult())
                // is what fixed the original deadlock. forceSync:true is the SEPARATE, officially
                // documented fix for the root cause glTFast itself names: "Unity does not pump the
                // main-thread SynchronizationContext outside Play Mode, so awaited I/O continuations
                // may never resume." Belt and suspenders — the tick design also protects any other
                // call this file makes that could exhibit the same class of hang.
                var ok = await export.SaveToFileAndDispose(destPath, forceSync: true);
                if (!ok)
                {
                    Debug.LogWarning($"[HubKitSync] export returned false for {assetPath}");
                    return false;
                }

                // The bool return alone isn't trustworthy (this exact call returned true for an
                // empty export before the instantiate fix) — verify real bytes landed too.
                var info = new System.IO.FileInfo(destPath);
                if (!info.Exists || info.Length < 200)
                {
                    Debug.LogWarning($"[HubKitSync] export for {assetPath} produced suspiciously few bytes " +
                                      $"({(info.Exists ? info.Length : 0)}) — treating as failed, not silently keeping an empty glb.");
                    return false;
                }
                return true;
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(instance);
            }
        }

        public static (int pending, int totalInScope) CountPending()
        {
            var manifest = LoadManifest();
            var already = new HashSet<string>(manifest.files.Select(f => f.stem));
            var scope = InScopeCandidates().ToList();
            int pending = scope.Count(kv => !already.Contains(kv.Key));
            return (pending, scope.Count);
        }

        /// Scope is deliberately narrower than FreePacks' full index (which also scans arbitrary
        /// Assets/Store, Assets/AssetStore, etc.) — this bakes exactly the CC0 kits this session
        /// imported (PolyHaven Models, FreePacks/**), not the entire long tail of everything
        /// FreePacks.Index() happens to find on disk.
        static IEnumerable<KeyValuePair<string, string>> InScopeCandidates()
        {
            foreach (var kv in FreePacks.AllIndexed())
            {
                if (kv.Value.StartsWith("Assets/Concordia/PolyHaven/Models/", StringComparison.Ordinal) ||
                    kv.Value.StartsWith("Assets/Concordia/FreePacks/", StringComparison.Ordinal))
                {
                    yield return kv;
                }
            }
        }

        static string SafeFileName(string stem)
        {
            var invalid = Path.GetInvalidFileNameChars();
            var chars = stem.Select(c => invalid.Contains(c) ? '_' : c).ToArray();
            return new string(chars);
        }

        static string InferAuthor(string assetPath)
        {
            if (assetPath.Contains("/PolyHaven/")) return "Poly Haven";
            if (assetPath.Contains("Quaternius")) return "Quaternius";
            if (assetPath.Contains("Kenney")) return "Kenney";
            return "Unknown (CC0 kit)";
        }

        static Manifest LoadManifest()
        {
            if (File.Exists(ManifestPath))
            {
                try
                {
                    var json = File.ReadAllText(ManifestPath);
                    var m = JsonUtility.FromJson<Manifest>(json);
                    if (m != null)
                    {
                        m.files ??= new List<Entry>();
                        m.aliases ??= new List<Alias>();
                        return m;
                    }
                }
                catch (Exception e)
                {
                    Debug.LogWarning($"[HubKitSync] manifest parse failed, starting fresh: {e.Message}");
                }
            }
            return new Manifest
            {
                id = "unburned-court-hub-kit",
                title = "Unburned Court hub kit",
                note = "Shared by Unity, Godot, and the Vite KenneyField.",
                files = new List<Entry>()
            };
        }

        static void SaveManifest(Manifest m)
        {
            File.WriteAllText(ManifestPath, JsonUtility.ToJson(m, prettyPrint: true));
        }
    }
}
