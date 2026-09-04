using System;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Same envelope as Godot: { evt, data }. Combat uses combat:attack so
    /// /unity-ws hits the identical applyAttack path.
    /// </summary>
    public class ConcordClient : MonoBehaviour
    {
        [SerializeField] string gatewayUrl = "wss://live.concordos.ai/unity-ws";
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
            _ws = new ClientWebSocket();
            LastReason = "connecting";
            StatusJson = "{\"ok\":false,\"reason\":\"connecting\"}";
            try
            {
                await _ws.ConnectAsync(new Uri(gatewayUrl), _cts.Token);
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
                Debug.LogWarning("Concord gateway not reachable yet: " + e.Message);
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
            while (_ws.State == WebSocketState.Open)
            {
                var result = await _ws.ReceiveAsync(new ArraySegment<byte>(buf), _cts.Token);
                if (result.MessageType == WebSocketMessageType.Close) break;
                var text = Encoding.UTF8.GetString(buf, 0, result.Count);
                Debug.Log(text);
                OnEvent?.Invoke("", text);
            }
        }

        static string Escape(string s) => (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"");

        void OnDestroy()
        {
            _cts?.Cancel();
            _ws?.Dispose();
        }
    }
}
