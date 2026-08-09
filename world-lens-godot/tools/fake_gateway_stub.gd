class_name FakeGatewayStub
extends Node
## FakeGatewayStub — probe-only test double for the `gateway` DI slot
## (net/gateway_client.gd's real public surface: `send_event(evt, data)` +
## an `event_received` signal). Used by tools/combat_target_probe.gd to
## capture what a real CharacterController actually sends over the gateway
## without needing a live WebSocket connection — this is a fixture for
## real-engine verification tooling, not a production stand-in.

var sent: Array = []


func send_event(evt: String, data: Dictionary) -> void:
	sent.append({"evt": evt, "data": data})
