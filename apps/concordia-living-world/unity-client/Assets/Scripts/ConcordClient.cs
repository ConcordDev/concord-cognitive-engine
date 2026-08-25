using System;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;

/// <summary>
/// Desktop/WebGL Concordia client. Same scene descriptor as Godot and Three.js.
/// Connects to the live site /unity-ws gateway.
/// </summary>
public class ConcordClient : MonoBehaviour
{
    [SerializeField] string gatewayUrl = "wss://live.concordos.ai/unity-ws";
    [SerializeField] string worldId = "concordia-hub";
    ClientWebSocket _ws;
    CancellationTokenSource _cts;

    async void Start()
    {
        _cts = new CancellationTokenSource();
        _ws = new ClientWebSocket();
        try
        {
            await _ws.ConnectAsync(new Uri(gatewayUrl), _cts.Token);
            await SendJson("{\"type\":\"unity:hello\",\"worldId\":\"" + worldId + "\"}");
            await SendJson("{\"type\":\"unity:scene:request\",\"worldId\":\"" + worldId + "\"}");
            _ = ReceiveLoop();
        }
        catch (Exception e)
        {
            Debug.LogWarning("Concord gateway not reachable yet: " + e.Message);
        }
    }

    async Task SendJson(string json)
    {
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
            Debug.Log(Encoding.UTF8.GetString(buf, 0, result.Count));
        }
    }

    void OnDestroy()
    {
        _cts?.Cancel();
        _ws?.Dispose();
    }
}
