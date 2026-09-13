using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Net.WebSockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Presentation socket. Same envelope as Godot: { evt, data }.
    /// Editor/desktop: System.Net.WebSockets. WebGL: browser WebSocket via
    /// Assets/Plugins/WebGL/ConcordWs.jslib (ClientWebSocket does not exist
    /// on IL2CPP WebGL).
    /// </summary>
    public class ConcordClient : MonoBehaviour
    {
        [SerializeField] string gatewayUrl = "wss://live.concordos.ai/unity-ws";
        [SerializeField] string kitchenUrl = "ws://127.0.0.1:5050/unity-ws";
        [SerializeField] string worldId = "concordia-hub";
        [SerializeField] string bearerToken = "";
        public event Action<string, string> OnEvent;
        ClientWebSocket _ws;
        CancellationTokenSource _cts;
        bool _jsOpen;
        readonly Dictionary<string, TaskCompletionSource<string>> _dialogueWait =
            new Dictionary<string, TaskCompletionSource<string>>();
        readonly Dictionary<string, TaskCompletionSource<string>> _inspectWait =
            new Dictionary<string, TaskCompletionSource<string>>();
        float _snapshotAt;
        public bool SocketOpen =>
#if UNITY_WEBGL && !UNITY_EDITOR
            _jsOpen;
#else
            _ws != null && _ws.State == WebSocketState.Open;
#endif
        public bool Connected => SocketOpen && !string.IsNullOrEmpty(_userId);
        public static string StatusJson { get; private set; } = "{\"ok\":false,\"reason\":\"no_gateway\"}";
        public static string LastReason { get; private set; } = "no_gateway";
        public static string HudLine { get; private set; } = "";
        public static string SnapshotJson { get; private set; } = "";
        public static ConcordClient Live { get; private set; }
        string _userId = "";
        readonly ConcurrentQueue<Action> _main = new ConcurrentQueue<Action>();
        TaskCompletionSource<bool> _hello;

        public string WorldId => worldId;

        void Awake()
        {
            // Dedicated GO is named ConcordClient so the WebGL jslib
            // SendMessage target stays stable. Never rename Player.
            if (gameObject.name != "ConcordClient")
                gameObject.name = "ConcordClient";
            Live = this;
            ApplyPageConfig();
        }

        void Update()
        {
            Action a;
            while (_main.TryDequeue(out a))
            {
                try { a(); }
                catch (Exception e) { Debug.LogWarning("Concord frame: " + e.Message); }
            }
            if (Connected && Time.unscaledTime >= _snapshotAt)
            {
                _snapshotAt = Time.unscaledTime + 12f;
                _ = SendEvt("world:snapshot", "{\"worldId\":\"" + Escape(worldId) + "\"}");
            }
        }

        void RunMain(Action a)
        {
            if (a != null) _main.Enqueue(a);
        }

        void OnDestroy()
        {
            if (Live == this) Live = null;
            _cts?.Cancel();
#if UNITY_WEBGL && !UNITY_EDITOR
            ConcordWsClose();
#else
            _ws?.Dispose();
#endif
        }

        void ApplyPageConfig()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            // Do not fall through to the Editor's live.concordos.ai default.
            gatewayUrl = "";
            var cfgGw = ConcordReadConfig("gatewayUrl");
            var cfgWorld = ConcordReadConfig("worldId");
            var cfgTok = ConcordReadConfig("token");
            if (!string.IsNullOrEmpty(cfgGw)) gatewayUrl = cfgGw;
            if (!string.IsNullOrEmpty(cfgWorld)) worldId = cfgWorld;
            if (!string.IsNullOrEmpty(cfgTok)) bearerToken = cfgTok;

            var href = Application.absoluteURL ?? "";
            var q = href.Contains("?") ? href.Substring(href.IndexOf('?') + 1) : "";
            var hash = q.IndexOf('#');
            if (hash >= 0) q = q.Substring(0, hash);
            foreach (var part in q.Split('&'))
            {
                var kv = part.Split(new[] { '=' }, 2);
                if (kv.Length != 2) continue;
                var key = Uri.UnescapeDataString(kv[0]);
                var val = Uri.UnescapeDataString(kv[1]);
                if (key == "CONCORD_GATEWAY_URL" && !string.IsNullOrEmpty(val)) gatewayUrl = val;
                if (key == "CONCORD_WORLD_ID" && !string.IsNullOrEmpty(val)) worldId = val;
                if (key == "CONCORD_AUTH_TOKEN" && !string.IsNullOrEmpty(val)) bearerToken = val;
            }
            kitchenUrl = "";
#endif
        }

        async void Start()
        {
            _cts = new CancellationTokenSource();
            LastReason = "connecting";
            StatusJson = "{\"ok\":false,\"reason\":\"connecting\"}";
#if UNITY_WEBGL && !UNITY_EDITOR
            if (string.IsNullOrWhiteSpace(gatewayUrl))
            {
                MarkDisconnected();
                return;
            }
            ConcordWsConnect(gatewayUrl);
#else
#if UNITY_EDITOR
            // Kitchen 2B first. live.concordos.ai is the shipped client fallback.
            var urls = new[] { kitchenUrl, gatewayUrl };
#else
            var urls = new[] { gatewayUrl, kitchenUrl };
#endif
            Exception last = null;
            foreach (var url in urls)
            {
                if (string.IsNullOrWhiteSpace(url)) continue;
                try
                {
                    _ws?.Dispose();
                    _ws = new ClientWebSocket();
                    await _ws.ConnectAsync(new Uri(url), _cts.Token);
                    last = null;
                    break;
                }
                catch (Exception e)
                {
                    last = e;
                    _ws?.Dispose();
                    _ws = null;
                }
            }
            if (_ws == null || _ws.State != WebSocketState.Open)
            {
                LastReason = "no_gateway";
                StatusJson = "{\"ok\":false,\"reason\":\"no_gateway\"}";
                Debug.LogWarning("Concord gateway not reachable yet: " + (last != null ? last.Message : "no url"));
                return;
            }
            // Read before AfterOpen sends — scene:data is already ~61KB and
            // grows with live buildings. Starting the loop late + a 64KB
            // one-shot buffer aborted the socket (CloseReceived, no_gateway)
            // on the kitchen handshake.
            _ = ReceiveLoop();
            await AfterOpen();
#endif
        }

        /// <summary>Retry kitchen then live if Talk happens before Start finished, or after a drop.</summary>
        public async Task<bool> EnsureConnected()
        {
            if (Connected) return true;
            if (_cts == null || _cts.IsCancellationRequested)
                _cts = new CancellationTokenSource();
            if (SocketOpen && _hello != null)
            {
                await Task.WhenAny(_hello.Task, Task.Delay(10000, _cts.Token));
                return Connected;
            }
#if UNITY_WEBGL && !UNITY_EDITOR
            return Connected;
#else
            var urls =
#if UNITY_EDITOR
                new[] { kitchenUrl, gatewayUrl };
#else
                new[] { gatewayUrl, kitchenUrl };
#endif
            foreach (var url in urls)
            {
                if (string.IsNullOrWhiteSpace(url)) continue;
                try
                {
                    _ws?.Dispose();
                    _ws = new ClientWebSocket();
                    await _ws.ConnectAsync(new Uri(url), _cts.Token);
                    _ = ReceiveLoop();
                    await AfterOpen();
                    return Connected;
                }
                catch
                {
                    _ws?.Dispose();
                    _ws = null;
                }
            }
            return false;
#endif
        }

        public void OnWsOpen(string unused)
        {
            _jsOpen = true;
            _ = AfterOpen();
        }

        public void OnWsClose(string _)
        {
            _jsOpen = false;
            MarkDisconnected();
        }

        public void OnWsError(string _)
        {
            _jsOpen = false;
            MarkDisconnected();
        }

        public void OnWsMessage(string text)
        {
            TryParseEvt(text, out var evt);
            HandleFrame(evt, text);
            OnEvent?.Invoke(evt, text);
        }

        async Task AfterOpen()
        {
            try
            {
                var token = string.IsNullOrEmpty(bearerToken) ? "unity-local-guest" : bearerToken;
                _hello = new TaskCompletionSource<bool>();
                await SendEvt("auth", "{\"token\":\"" + Escape(token) + "\"}");
                var hello = await Task.WhenAny(_hello.Task, Task.Delay(10000, _cts.Token));
                if (hello != _hello.Task || !_hello.Task.Result)
                {
                    LastReason = "auth_required";
                    StatusJson = "{\"ok\":false,\"reason\":\"auth_required\"}";
                    Debug.LogWarning("Concord gateway hello did not arrive before post-auth traffic");
                    return;
                }
                await SendEvt("scene:request", "{\"worldId\":\"" + Escape(worldId) + "\"}");
                await SendEvt("kingdom:request", "{\"worldId\":\"" + Escape(worldId) + "\"}");
                await SendEvt("room:join", "{\"room\":\"world:" + Escape(worldId) + "\"}");
                await SendEvt("world:snapshot", "{\"worldId\":\"" + Escape(worldId) + "\"}");
                await LensRun("skills", "mastery");
                if (string.IsNullOrEmpty(HudLine))
                {
                    LastReason = "awaiting_kingdom";
                    StatusJson = "{\"ok\":false,\"reason\":\"awaiting_kingdom\"}";
                }
            }
            catch (Exception e)
            {
                MarkDisconnected();
                Debug.LogWarning("Concord gateway handshake failed: " + e.Message);
            }
        }

        void MarkDisconnected()
        {
            LastReason = "no_gateway";
            StatusJson = "{\"ok\":false,\"reason\":\"no_gateway\"}";
            HudLine = "";
            SnapshotJson = "";
            _userId = "";
            SkillLattice.Reset();
        }

        void HandleFrame(string evt, string text)
        {
            if (evt == "hello")
            {
                var uid = JsonString(text, "userId");
                if (!string.IsNullOrEmpty(uid)) _userId = uid;
                _hello?.TrySetResult(true);
                Debug.Log("Concord kernel hello user=" + _userId);
                return;
            }
            if (evt == "auth:error")
            {
                _hello?.TrySetResult(false);
                var why = JsonString(text, "reason");
                LastReason = string.IsNullOrEmpty(why) ? "auth_failed" : why;
                StatusJson = "{\"ok\":false,\"reason\":\"" + Escape(LastReason) + "\"}";
                return;
            }
            if (evt == "kingdom:data")
            {
                ApplyKingdom(text);
                return;
            }
            if (evt == "scene:data")
            {
                RunMain(() => ApplyScene(text));
                return;
            }
            if (evt == "world:snapshot")
            {
                RunMain(() => ApplyWorldSnapshot(text));
                return;
            }
            if (evt == "world:clock")
            {
                var phase = JsonFloat(text, "phase", WorldClock.Hour / 24f);
                var segment = JsonString(text, "segment");
                RunMain(() => WorldClock.BindKernelClock(phase, segment));
                return;
            }
            if (evt == "world:weather" || evt == "weather:update")
            {
                var w = JsonString(text, "type");
                if (string.IsNullOrEmpty(w)) w = JsonString(text, "weather");
                RunMain(() =>
                {
                    WorldClock.BindKernelWeather(w);
                    if (!string.IsNullOrEmpty(w)) WorldClock.NoteAct("weather · " + w);
                });
                return;
            }
            if (evt == "combat:hit" || evt == "combat:impact")
            {
                RunMain(() => ApplyCombatFeel(text, evt == "combat:impact"));
                return;
            }
            if (evt == "combat:kill")
            {
                var who = JsonString(text, "targetId");
                if (string.IsNullOrEmpty(who)) who = JsonString(text, "targetName");
                RunMain(() =>
                {
                    WorldClock.NoteAct(string.IsNullOrEmpty(who) ? "a death" : who + " fell");
                    ConcordiaHUD.Announce("Fell", string.IsNullOrEmpty(who) ? "someone died" : who);
                    var at = ConcordiaPlayer.Live ? ConcordiaPlayer.Live.transform.position : Vector3.zero;
                    NpcLife.NoteKernelDeath(who, at);
                });
                return;
            }
            if (evt == "combat:telegraph")
            {
                var kind = JsonString(text, "kind");
                if (string.IsNullOrEmpty(kind)) kind = JsonString(text, "style");
                RunMain(() => { if (!string.IsNullOrEmpty(kind)) Hostile.TelegraphKind = kind; });
                return;
            }
            if (evt == "world:crisis" || evt == "world:plague-declared")
            {
                var kind = JsonString(text, "type");
                if (string.IsNullOrEmpty(kind)) kind = evt == "world:plague-declared" ? "plague" : "crisis";
                RunMain(() =>
                {
                    WorldClock.NoteAct("crisis · " + kind);
                    ConcordiaHUD.Announce("Crisis", kind);
                });
                return;
            }
            if (evt == "world:crisis-resolved")
            {
                RunMain(() =>
                {
                    WorldClock.NoteAct("the crisis broke");
                    ConcordiaHUD.Announce("Resolved", "the crisis broke");
                });
                return;
            }
            if (evt == "quest:completed" || evt == "npc:quest-completed")
            {
                var q = JsonString(text, "questId");
                RunMain(() => WorldClock.NoteAct(string.IsNullOrEmpty(q) ? "a quest closed" : "quest closed · " + q));
                return;
            }
            if (evt == "npc:quest-accepted")
            {
                RunMain(() => WorldClock.NoteAct("someone took a quest"));
                return;
            }
            if (evt == "npc:level-up")
            {
                RunMain(() => WorldClock.NoteAct("someone grew"));
                return;
            }
            if (evt == "world:npc-gather")
            {
                RunMain(() => WorldClock.NoteAct("a gathering"));
                return;
            }
            if (evt == "lens:result")
            {
                RunMain(() => ApplyLensResult(text));
                return;
            }
            if (evt == "dialogue:data")
            {
                ApplyDialogue(text);
                return;
            }
            if (evt == "inspect:data")
            {
                ApplyInspect(text);
                return;
            }
            if (evt == "error" && text.Contains("auth_required"))
            {
                _hello?.TrySetResult(false);
                MarkDisconnected();
            }
        }

        void ApplyDialogue(string json)
        {
            var id = JsonString(json, "requestId");
            if (string.IsNullOrEmpty(id)) return;
            if (!_dialogueWait.TryGetValue(id, out var wait)) return;
            if (JsonFlagFalse(json, "ok"))
            {
                wait.TrySetResult("");
                return;
            }
            wait.TrySetResult(JsonString(json, "text"));
        }

        void ApplyInspect(string json)
        {
            var id = JsonString(json, "requestId");
            var name = JsonString(json, "name");
            var why = JsonString(json, "why");
            WorldAaa.BindInspect(name, why);
            if (!string.IsNullOrEmpty(id) && _inspectWait.TryGetValue(id, out var wait))
                wait.TrySetResult(JsonFlagFalse(json, "ok") ? "" : (string.IsNullOrEmpty(why) ? name : why));
        }

        /// <summary>
        /// Concord 2B line for Convai / Talk. Empty string is honest failure
        /// (no_gateway, timeout, or ok:false) — never a fabricated voice.
        /// </summary>
        public async Task<string> AskTwoB(string npcId, string npcName, string line, string text)
        {
            if (!Connected) return "";
            var id = Guid.NewGuid().ToString("N");
            var wait = new TaskCompletionSource<string>();
            _dialogueWait[id] = wait;
            try
            {
                await SendEvt("dialogue:request",
                    "{\"requestId\":\"" + Escape(id)
                    + "\",\"worldId\":\"" + Escape(worldId)
                    + "\",\"npcId\":\"" + Escape(npcId)
                    + "\",\"npcName\":\"" + Escape(npcName)
                    + "\",\"line\":\"" + Escape(line)
                    + "\",\"text\":\"" + Escape(text) + "\"}");
                var done = await Task.WhenAny(wait.Task, Task.Delay(12000, _cts.Token));
                return done == wait.Task ? wait.Task.Result : "";
            }
            catch
            {
                return "";
            }
            finally
            {
                _dialogueWait.Remove(id);
            }
        }

        public async Task<string> RequestInspect(string npcId)
        {
            if (!Connected || string.IsNullOrEmpty(npcId)) return "";
            var id = Guid.NewGuid().ToString("N");
            var wait = new TaskCompletionSource<string>();
            _inspectWait[id] = wait;
            try
            {
                await SendEvt("inspect:request",
                    "{\"requestId\":\"" + Escape(id)
                    + "\",\"worldId\":\"" + Escape(worldId)
                    + "\",\"npcId\":\"" + Escape(npcId) + "\"}");
                var done = await Task.WhenAny(wait.Task, Task.Delay(8000, _cts.Token));
                return done == wait.Task ? wait.Task.Result : "";
            }
            catch
            {
                return "";
            }
            finally
            {
                _inspectWait.Remove(id);
            }
        }

        void ApplyKingdom(string json)
        {
            SnapshotJson = json ?? "";
            if (JsonFlagFalse(json, "ok"))
            {
                var reason = JsonString(json, "reason");
                LastReason = string.IsNullOrEmpty(reason) ? "kingdom_export_unavailable" : reason;
                StatusJson = "{\"ok\":false,\"reason\":\"" + Escape(LastReason) + "\"}";
                HudLine = "";
                return;
            }
            var title = JsonString(json, "title");
            var staple = JsonNestedString(json, "staple");
            var n = JsonArrayCount(json, "settlements");
            if (string.IsNullOrEmpty(title)) title = worldId;
            if (string.IsNullOrEmpty(staple)) staple = "";
            LastReason = "";
            StatusJson = "{\"ok\":true,\"format\":\"concord-kingdom/v1\",\"world\":\""
                + Escape(title) + "\",\"staple\":\"" + Escape(staple)
                + "\",\"settlements\":" + n + "}";
            HudLine = title + " · kernel · " + staple
                + (n == 0 ? " · The Court is the city" : " · " + n + " settlements");
        }

        void ApplyWorldSnapshot(string json)
        {
            if (JsonFlagFalse(json, "ok")) return;
            SnapshotJson = json;
            var clock = JsonObjectSlice(json, "clock");
            var phaseSrc = string.IsNullOrEmpty(clock) ? json : clock;
            WorldClock.BindKernelClock(
                JsonFloat(phaseSrc, "phase", WorldClock.Hour / 24f),
                JsonString(phaseSrc, "segment"));
            var weather = JsonObjectSlice(json, "weather");
            var w = JsonString(weather, "type");
            if (string.IsNullOrEmpty(w)) w = JsonString(json, "type");
            WorldClock.BindKernelWeather(w);
            var n = JsonArrayCount(json, "npcs");
            if (n > 0)
            {
                WorldBuilder.ClearKernelNpcs();
                ForEachArrayObject(json, "npcs", node =>
                {
                    WorldBuilder.PlaceKernelNpc(
                        JsonString(node, "id"),
                        JsonString(node, "name"),
                        JsonString(node, "title"),
                        new Vector3(JsonFloat(node, "x"), JsonFloat(node, "y"), JsonFloat(node, "z")),
                        JsonString(node, "activity"));
                });
            }
            ApplyAaaExtras(json);
            WorldClock.NoteAct((n <= 0 ? "clock" : n + " npcs") + " · kernel");
        }

        void ApplyAaaExtras(string json)
        {
            var qn = JsonArrayCount(json, "quests");
            string first = "";
            ForEachArrayObject(json, "quests", node =>
            {
                if (string.IsNullOrEmpty(first)) first = JsonString(node, "title");
                var qid = JsonString(node, "id");
                if (string.IsNullOrEmpty(qid)) return;
                var w = ConcordiaPlayer.Live != null ? ConcordiaPlayer.Live.world : Concordia.WorldId.Hub;
                var authored = WorldBook.QuestById(w, qid);
                if (authored != null) QuestLog.Offer(authored, w);
            });
            WorldAaa.BindQuests(qn, first);
            WorldAaa.BindWarrants(JsonArrayCount(json, "warrants"));
            WorldAaa.ConsequenceCount = JsonArrayCount(json, "consequences");
            var refusal = JsonObjectSlice(json, "refusal");
            WorldAaa.BindRefusal(JsonString(refusal, "name"), JsonString(refusal, "theNo"));
            var limbs = JsonObjectSlice(json, "limbs");
            var player = ConcordiaPlayer.Live;
            if (player && !string.IsNullOrEmpty(limbs))
                player.ApplyLimbs(
                    JsonFlagTrue(limbs, "brokenArm"),
                    JsonFlagTrue(limbs, "brokenLeg") || JsonFlagTrue(limbs, "dodgeDisabled"));
            WorldBuilder.ClearKernelVehicles();
            var vn = 0;
            ForEachArrayObject(json, "vehicles", node =>
            {
                vn++;
                WorldBuilder.PlaceKernelVehicle(
                    JsonString(node, "id"),
                    JsonString(node, "kind"),
                    new Vector3(JsonFloat(node, "x"), JsonFloat(node, "y"), JsonFloat(node, "z")),
                    JsonFloat(node, "heading"));
            });
            WorldAaa.VehicleCount = vn;
        }

        static string JsonObjectSlice(string json, string key)
        {
            if (string.IsNullOrEmpty(json)) return "";
            var needle = "\"" + key + "\":";
            var i = json.IndexOf(needle, System.StringComparison.Ordinal);
            if (i < 0) return "";
            var start = json.IndexOf('{', i + needle.Length);
            if (start < 0) return "";
            int depth = 0;
            bool inStr = false;
            for (int p = start; p < json.Length; p++)
            {
                char c = json[p];
                if (c == '"' && (p == 0 || json[p - 1] != '\\')) inStr = !inStr;
                if (inStr) continue;
                if (c == '{') depth++;
                else if (c == '}')
                {
                    depth--;
                    if (depth == 0) return json.Substring(start, p - start + 1);
                }
            }
            return "";
        }

        void ApplyCombatFeel(string json, bool impact)
        {
            var target = JsonString(json, "targetId");
            var atk = JsonString(json, "attackerId");
            var dmg = JsonFloat(json, "damage", JsonFloat(json, "amount", 8f));
            var skillKey = JsonString(json, "skillKey");
            if (string.IsNullOrEmpty(skillKey)) skillKey = JsonString(json, "skillId");
            var player = ConcordiaPlayer.Live;
            var kick = SkillLattice.KickMul(skillKey);
            if (player && !string.IsNullOrEmpty(_userId) && target == _userId)
                player.TakeHit(Mathf.Max(1f, dmg), string.IsNullOrEmpty(atk) ? "a blow" : atk);
            else
            {
                var feel = player ? player.GetComponent<CombatFeel>() : null;
                feel?.Strike(impact, true, kick);
            }
            var at = player ? player.transform.position : Vector3.zero;
            NpcLife.NoteKernelThreat(at);
            if (!string.IsNullOrEmpty(skillKey))
                WorldClock.NoteAct(skillKey + (impact ? " · impact" : " · steel"));
            else if (impact)
                WorldClock.NoteAct("steel");
        }

        /// <summary>
        /// Consume scene:data for live kernel buildings. Hub look stays local
        /// (FreePacks / WorldBuilder). Empty nodes stay empty — never fabricated.
        /// The hub portal list in enrichScene is Three.js-scale scaffold and
        /// must not stomp the authored Ring of Doors.
        /// </summary>
        void ApplyScene(string json)
        {
            if (JsonFlagFalse(json, "ok"))
            {
                var reason = JsonString(json, "reason");
                if (!string.IsNullOrEmpty(reason) && string.IsNullOrEmpty(HudLine))
                    LastReason = reason;
                return;
            }
            WorldBuilder.ClearKernelLive();
            var n = JsonArrayCount(json, "nodes");
            if (n <= 0) return;
            ForEachArrayObject(json, "nodes", node =>
            {
                var id = JsonString(node, "id");
                var type = JsonString(node, "type");
                var pos = JsonVec3(node, "translation");
                var yaw = JsonFloat(node, "rotationY", 0f);
                var scale = JsonVec3(node, "scale");
                var maxDim = Mathf.Max(scale.x, Mathf.Max(scale.y, scale.z));
                WorldBuilder.PlaceKernelBuilding(id, type, pos, yaw, maxDim);
            });
        }

        void ApplyLensResult(string json)
        {
            if (JsonFlagFalse(json, "ok")) return;
            var lensName = JsonString(json, "lensName");
            var catalogCount = JsonInt(json, "catalogCount", 0);
            if (lensName != "mastery" && catalogCount <= 0) return;
            SkillLattice.Reset();
            ForEachArrayObject(json, "groups", groupJson =>
            {
                var group = JsonString(groupJson, "group");
                ForEachArrayObject(groupJson, "skills", skillJson =>
                {
                    SkillLattice.Add(new SkillLattice.Row
                    {
                        skillType = JsonString(skillJson, "skillType"),
                        group = string.IsNullOrEmpty(JsonString(skillJson, "group")) ? group : JsonString(skillJson, "group"),
                        tier = JsonString(skillJson, "tier"),
                        element = JsonNestedString(skillJson, "element"),
                        preset = JsonString(skillJson, "preset"),
                        level = JsonInt(skillJson, "level", 0),
                        cameraKickPx = JsonInt(skillJson, "cameraKickPx", 0),
                        potency = JsonFloat(skillJson, "potency", 1f),
                        glow = JsonFloat(skillJson, "glow", 0.4f),
                        finisher = skillJson.IndexOf("\"finisherFlourish\":true", StringComparison.Ordinal) >= 0
                            || skillJson.IndexOf("\"finisherUnlocked\":true", StringComparison.Ordinal) >= 0,
                    });
                });
            });
            SkillLattice.Bind(catalogCount, JsonInt(json, "trainedCount", 0));
            if (SkillLattice.FromKernel)
                WorldClock.NoteAct(SkillLattice.CatalogCount + " skills · kernel");
        }

        public Task LensRun(string domain, string name, string inputJson = "{}")
        {
            var body = "{\"domain\":\"" + Escape(domain)
                + "\",\"name\":\"" + Escape(name)
                + "\",\"input\":" + (string.IsNullOrEmpty(inputJson) ? "{}" : inputJson) + "}";
            return SendEvt("lens:run", body);
        }

        public Task RequestKingdom(string nextWorldId)
        {
            if (!string.IsNullOrEmpty(nextWorldId)) worldId = nextWorldId;
            return SendEvt("kingdom:request", "{\"worldId\":\"" + Escape(worldId) + "\"}");
        }

        public async Task RequestScene(string nextWorldId)
        {
            if (!string.IsNullOrEmpty(nextWorldId)) worldId = nextWorldId;
            await SendEvt("scene:request", "{\"worldId\":\"" + Escape(worldId) + "\"}");
            await SendEvt("kingdom:request", "{\"worldId\":\"" + Escape(worldId) + "\"}");
            await SendEvt("room:join", "{\"room\":\"world:" + Escape(worldId) + "\"}");
            await SendEvt("world:snapshot", "{\"worldId\":\"" + Escape(worldId) + "\"}");
            await LensRun("skills", "mastery");
        }

        public Task SendMove(float x, float y, float z, string cityId) =>
            SendEvt("player:move", "{\"cityId\":\"" + Escape(cityId) + "\",\"x\":" + x + ",\"y\":" + y + ",\"z\":" + z + ",\"direction\":0}");

        public Task SendAttack(string targetId, float baseDamage = 20, float range = 5, string weapon = "sword", string skillId = null)
        {
            if (string.IsNullOrEmpty(skillId)) skillId = SkillLattice.ActiveSkill;
            if (string.IsNullOrEmpty(skillId)) skillId = "swords";
            return SendEvt("combat:attack",
                "{\"targetId\":\"" + Escape(targetId)
                + "\",\"baseDamage\":" + baseDamage
                + ",\"range\":" + range
                + ",\"weapon\":\"" + Escape(weapon)
                + "\",\"skillId\":\"" + Escape(skillId) + "\"}");
        }

        public Task SendDodge(bool parry = false) =>
            SendEvt("combat:dodge", "{\"wasParry\":" + (parry ? "true" : "false") + "}");

        async Task SendEvt(string evt, string dataJson)
        {
            if (!SocketOpen) return;
            var json = "{\"evt\":\"" + evt + "\",\"data\":" + dataJson + "}";
#if UNITY_WEBGL && !UNITY_EDITOR
            ConcordWsSend(json);
            await Task.CompletedTask;
#else
            var buf = Encoding.UTF8.GetBytes(json);
            await _ws.SendAsync(new ArraySegment<byte>(buf), WebSocketMessageType.Text, true, _cts.Token);
#endif
        }

#if !(UNITY_WEBGL && !UNITY_EDITOR)
        async Task ReceiveLoop()
        {
            var buf = new byte[1 << 16];
            var acc = new MemoryStream();
            const int maxFrame = 8 * 1024 * 1024;
            while (_ws != null && _ws.State == WebSocketState.Open)
            {
                WebSocketReceiveResult result;
                try
                {
                    result = await _ws.ReceiveAsync(new ArraySegment<byte>(buf), _cts.Token);
                }
                catch (Exception e)
                {
                    Debug.LogWarning("Concord gateway receive failed: " + e.Message);
                    break;
                }
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    Debug.LogWarning("Concord gateway closed: " + _ws.CloseStatus + " " + _ws.CloseStatusDescription);
                    break;
                }
                acc.Write(buf, 0, result.Count);
                if (!result.EndOfMessage) continue;
                if (acc.Length > maxFrame)
                {
                    Debug.LogWarning("Concord gateway frame dropped: " + acc.Length + " bytes");
                    acc.SetLength(0);
                    continue;
                }
                var text = Encoding.UTF8.GetString(acc.GetBuffer(), 0, (int)acc.Length);
                acc.SetLength(0);
                TryParseEvt(text, out var evt);
                try
                {
                    HandleFrame(evt, text);
                    OnEvent?.Invoke(evt, text);
                }
                catch (Exception e)
                {
                    Debug.LogWarning("Concord frame: " + e.Message);
                }
            }
            MarkDisconnected();
        }
#endif

        public static bool TryParseEvt(string json, out string evt)
        {
            evt = "";
            if (string.IsNullOrEmpty(json)) return false;
            const string key = "\"evt\":\"";
            var i = json.IndexOf(key, StringComparison.Ordinal);
            if (i < 0) return false;
            var start = i + key.Length;
            var end = json.IndexOf('"', start);
            if (end <= start) return false;
            evt = json.Substring(start, end - start);
            return true;
        }

        static bool JsonFlagFalse(string json, string key)
        {
            if (string.IsNullOrEmpty(json)) return true;
            var needle = "\"" + key + "\":";
            var i = json.IndexOf(needle, StringComparison.Ordinal);
            if (i < 0) return false;
            var rest = json.Substring(i + needle.Length).TrimStart();
            return rest.StartsWith("false", StringComparison.Ordinal);
        }

        static bool JsonFlagTrue(string json, string key)
        {
            if (string.IsNullOrEmpty(json)) return false;
            var needle = "\"" + key + "\":";
            var i = json.IndexOf(needle, StringComparison.Ordinal);
            if (i < 0) return false;
            var rest = json.Substring(i + needle.Length).TrimStart();
            return rest.StartsWith("true", StringComparison.Ordinal);
        }

        static string JsonString(string json, string key)
        {
            if (string.IsNullOrEmpty(json)) return "";
            var needle = "\"" + key + "\":\"";
            var i = json.IndexOf(needle, StringComparison.Ordinal);
            if (i < 0) return "";
            var start = i + needle.Length;
            var end = json.IndexOf('"', start);
            return end <= start ? "" : json.Substring(start, end - start);
        }

        static string JsonNestedString(string json, string key)
        {
            var v = JsonString(json, key);
            return v;
        }

        static int JsonArrayCount(string json, string key)
        {
            if (string.IsNullOrEmpty(json)) return 0;
            var needle = "\"" + key + "\":";
            var i = json.IndexOf(needle, StringComparison.Ordinal);
            if (i < 0) return 0;
            var start = json.IndexOf('[', i + needle.Length);
            if (start < 0) return 0;
            int depth = 0, n = 0;
            bool inStr = false;
            for (int p = start; p < json.Length; p++)
            {
                char c = json[p];
                if (c == '"' && (p == 0 || json[p - 1] != '\\')) inStr = !inStr;
                if (inStr) continue;
                if (c == '[') depth++;
                else if (c == ']')
                {
                    depth--;
                    if (depth == 0) break;
                }
                else if (c == '{' && depth == 1) n++;
            }
            return n;
        }

        static void ForEachArrayObject(string json, string key, Action<string> each)
        {
            if (string.IsNullOrEmpty(json) || each == null) return;
            var needle = "\"" + key + "\":";
            var i = json.IndexOf(needle, StringComparison.Ordinal);
            if (i < 0) return;
            var start = json.IndexOf('[', i + needle.Length);
            if (start < 0) return;
            int depth = 0, objStart = -1;
            bool inStr = false;
            for (int p = start; p < json.Length; p++)
            {
                char c = json[p];
                if (c == '"' && (p == 0 || json[p - 1] != '\\')) inStr = !inStr;
                if (inStr) continue;
                if (c == '[') depth++;
                else if (c == ']')
                {
                    depth--;
                    if (depth == 0) break;
                }
                else if (c == '{' && depth == 1) objStart = p;
                else if (c == '}' && depth == 1 && objStart >= 0)
                {
                    each(json.Substring(objStart, p - objStart + 1));
                    objStart = -1;
                }
            }
        }

        static Vector3 JsonVec3(string json, string key)
        {
            if (string.IsNullOrEmpty(json)) return Vector3.zero;
            var needle = "\"" + key + "\":";
            var i = json.IndexOf(needle, StringComparison.Ordinal);
            if (i < 0) return Vector3.zero;
            var start = json.IndexOf('[', i + needle.Length);
            if (start < 0) return Vector3.zero;
            var end = json.IndexOf(']', start);
            if (end <= start) return Vector3.zero;
            var inner = json.Substring(start + 1, end - start - 1).Split(',');
            float x = 0, y = 0, z = 0;
            if (inner.Length > 0) float.TryParse(inner[0].Trim(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out x);
            if (inner.Length > 1) float.TryParse(inner[1].Trim(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out y);
            if (inner.Length > 2) float.TryParse(inner[2].Trim(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out z);
            return new Vector3(x, y, z);
        }

        static float JsonFloat(string json, string key, float fallback = 0f)
        {
            if (string.IsNullOrEmpty(json)) return fallback;
            var needle = "\"" + key + "\":";
            var i = json.IndexOf(needle, StringComparison.Ordinal);
            if (i < 0) return fallback;
            var rest = json.Substring(i + needle.Length).TrimStart();
            int n = 0;
            while (n < rest.Length && (char.IsDigit(rest[n]) || rest[n] == '-' || rest[n] == '+' || rest[n] == '.' || rest[n] == 'e' || rest[n] == 'E'))
                n++;
            if (n == 0) return fallback;
            float v;
            return float.TryParse(rest.Substring(0, n), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out v)
                ? v : fallback;
        }

        static int JsonInt(string json, string key, int fallback = 0)
        {
            return Mathf.RoundToInt(JsonFloat(json, key, fallback));
        }

        static string Escape(string s) => (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"");

#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] static extern void ConcordWsConnect(string url);
        [DllImport("__Internal")] static extern void ConcordWsSend(string msg);
        [DllImport("__Internal")] static extern void ConcordWsClose();
        [DllImport("__Internal")] static extern string ConcordReadConfig(string key);
#endif
    }
}
