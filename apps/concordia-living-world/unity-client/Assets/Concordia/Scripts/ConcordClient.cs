using System;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Presentation socket. Same envelope as Godot: { evt, data }.
    /// Combat uses combat:attack so /unity-ws hits applyAttack — Unity does
    /// not resolve HP. Offline kitchen stays disconnected and reports
    /// {ok:false, reason:'no_gateway'} honestly.
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
        public bool Connected => _ws != null && _ws.State == WebSocketState.Open;
        public static string StatusJson { get; private set; } = "{\"ok\":false,\"reason\":\"no_gateway\"}";
        public static string LastReason { get; private set; } = "no_gateway";

        async void Start()
        {
            _cts = new CancellationTokenSource();
            LastReason = "connecting";
            StatusJson = "{\"ok\":false,\"reason\":\"connecting\"}";
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
            try
            {
                if (!string.IsNullOrEmpty(bearerToken))
                    await SendEvt("auth", "{\"token\":\"" + Escape(bearerToken) + "\"}");
                await SendEvt("scene:request", "{\"worldId\":\"" + Escape(worldId) + "\"}");
                LastReason = "";
                StatusJson = "{\"ok\":true}";
                _ = ReceiveLoop();
            }
            catch (Exception e)
            {
                LastReason = "no_gateway";
                StatusJson = "{\"ok\":false,\"reason\":\"no_gateway\"}";
                Debug.LogWarning("Concord gateway handshake failed: " + e.Message);
            }
        }

        public Task SendMove(float x, float y, float z, string cityId) =>
            SendEvt("player:move", "{\"cityId\":\"" + Escape(cityId) + "\",\"x\":" + x + ",\"y\":" + y + ",\"z\":" + z + ",\"direction\":0}");

        public Task SendAttack(string targetId, float baseDamage = 20, float range = 5, string weapon = "sword") =>
            SendEvt("combat:attack", "{\"targetId\":\"" + Escape(targetId) + "\",\"baseDamage\":" + baseDamage + ",\"range\":" + range + ",\"weapon\":\"" + Escape(weapon) + "\"}");

        public Task SendDodge(bool parry = false) =>
            SendEvt("combat:dodge", "{\"wasParry\":" + (parry ? "true" : "false") + "}");

        async Task SendEvt(string evt, string dataJson)
        {
            if (_ws == null || _ws.State != WebSocketState.Open) return;
            var json = "{\"evt\":\"" + evt + "\",\"data\":" + dataJson + "}";
            var buf = Encoding.UTF8.GetBytes(json);
            await _ws.SendAsync(new ArraySegment<byte>(buf), WebSocketMessageType.Text, true, _cts.Token);
        }

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

        void OnDestroy()
        {
            _cts?.Cancel();
            _ws?.Dispose();
        }
    }
}
