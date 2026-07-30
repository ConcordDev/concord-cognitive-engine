class_name TestGatewayClientSeq
extends RefCounted
## Pure-logic tests for GatewayClient.detect_seq_anomaly — the R6 `_seq`
## monotonicity check. See net/gateway_client.gd's class doc for why this is
## a diagnostic-only signal (a shared, non-contiguous server-side counter)
## and never the resync trigger itself.

const GatewayClient := preload("res://net/gateway_client.gd")
const TestUtils := preload("res://tests/test_utils.gd")


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_first_frame_this_connection_is_never_an_anomaly(t)
	_test_increasing_seq_is_not_an_anomaly(t)
	_test_large_jump_is_not_an_anomaly(t)
	_test_duplicate_seq_is_an_anomaly(t)
	_test_decreasing_seq_is_an_anomaly(t)
	return t


static func _test_first_frame_this_connection_is_never_an_anomaly(t: TestUtils) -> void:
	# last_seen == -1 means "nothing received yet this connection" — there is
	# nothing to compare against, so this must never be flagged regardless of
	# what the first real seq value is (a fresh connection can validly see
	# any starting value, since the server's counter is shared/global).
	t.check(
		not GatewayClient.detect_seq_anomaly(-1, 0),
		"first frame ever (seq=0) on a fresh connection is not an anomaly")
	t.check(
		not GatewayClient.detect_seq_anomaly(-1, 50000),
		"first frame with a large seq (server has been running a while) is not an anomaly")


static func _test_increasing_seq_is_not_an_anomaly(t: TestUtils) -> void:
	t.check(
		not GatewayClient.detect_seq_anomaly(10, 11),
		"seq increasing by exactly 1 is not an anomaly")


static func _test_large_jump_is_not_an_anomaly(t: TestUtils) -> void:
	# The server's `_seq` counter is shared across every client/room/event
	# type (see class doc) — large, non-contiguous jumps are the NORMAL
	# case, not evidence of a missed frame.
	t.check(
		not GatewayClient.detect_seq_anomaly(10, 9000),
		"a large forward jump is honestly not flagged — the counter is shared, not per-connection")


static func _test_duplicate_seq_is_an_anomaly(t: TestUtils) -> void:
	t.check(
		GatewayClient.detect_seq_anomaly(10, 10),
		"the exact same seq arriving twice is a genuine anomaly")


static func _test_decreasing_seq_is_an_anomaly(t: TestUtils) -> void:
	t.check(
		GatewayClient.detect_seq_anomaly(100, 5),
		"a seq lower than the highest already seen is a genuine anomaly " +
			"(out-of-order delivery, or the server's counter reset mid-connection)")
