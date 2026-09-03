using System;
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
        public bool Connected =>
#if UNITY_WEBGL && !UNITY_EDITOR
            _jsOpen;
#else
            _ws != null && _ws.State == WebSocketState.Open;
#endif
        public static string StatusJson { get; private set; } = "{\"ok\":false,\"reason\":\"no_gateway\"}";
        public static string LastReason { get; private set; } = "no_gateway";
        public static ConcordClient Live { get; private set; }

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
            var urls = new[] { gatewayUrl, kitchenUrl };
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
            await AfterOpen();
#endif
        }

        public void OnWsOpen(string _)
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
            OnEvent?.Invoke(evt, text);
        }

        async Task AfterOpen()
        {
            try
            {
                if (!string.IsNullOrEmpty(bearerToken))
                    await SendEvt("auth", "{\"token\":\"" + Escape(bearerToken) + "\"}");
                await SendEvt("scene:request", "{\"worldId\":\"" + Escape(worldId) + "\"}");
                LastReason = "";
                StatusJson = "{\"ok\":true}";
#if !(UNITY_WEBGL && !UNITY_EDITOR)
                _ = ReceiveLoop();
#endif
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
        }

        public Task RequestScene(string nextWorldId)
        {
            if (!string.IsNullOrEmpty(nextWorldId)) worldId = nextWorldId;
            return SendEvt("scene:request", "{\"worldId\":\"" + Escape(worldId) + "\"}");
        }

        public Task SendMove(float x, float y, float z, string cityId) =>
            SendEvt("player:move", "{\"cityId\":\"" + Escape(cityId) + "\",\"x\":" + x + ",\"y\":" + y + ",\"z\":" + z + ",\"direction\":0}");

        public Task SendAttack(string targetId, float baseDamage = 20, float range = 5, string weapon = "sword") =>
            SendEvt("combat:attack", "{\"targetId\":\"" + Escape(targetId) + "\",\"baseDamage\":" + baseDamage + ",\"range\":" + range + ",\"weapon\":\"" + Escape(weapon) + "\"}");

        public Task SendDodge(bool parry = false) =>
            SendEvt("combat:dodge", "{\"wasParry\":" + (parry ? "true" : "false") + "}");

        async Task SendEvt(string evt, string dataJson)
        {
            if (!Connected) return;
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
            while (_ws != null && _ws.State == WebSocketState.Open)
            {
                var result = await _ws.ReceiveAsync(new ArraySegment<byte>(buf), _cts.Token);
                if (result.MessageType == WebSocketMessageType.Close) break;
                var text = Encoding.UTF8.GetString(buf, 0, result.Count);
                TryParseEvt(text, out var evt);
                OnEvent?.Invoke(evt, text);
            }
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

        static string Escape(string s) => (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"");

#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] static extern void ConcordWsConnect(string url);
        [DllImport("__Internal")] static extern void ConcordWsSend(string msg);
        [DllImport("__Internal")] static extern void ConcordWsClose();
        [DllImport("__Internal")] static extern string ConcordReadConfig(string key);
#endif
    }
}
