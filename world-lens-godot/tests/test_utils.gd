class_name TestUtils
extends RefCounted
## TestUtils — tiny assert-collector so pure-logic test scripts can run
## standalone via `godot --headless --script res://tests/run_all.gd`,
## without vendoring a full framework (gdUnit4 is not in this skeleton).
##
## ENGINE-GATED: this has never actually been executed against a real Godot
## binary — the agent proxy blocks the headless engine download (see
## docs/GODOT_INTEGRATION.md). `gdparse`/`gdlint` confirm this is
## syntactically valid, loadable GDScript. Nothing more. See
## world-lens-godot/VISUAL_QA.md.

var failures: Array[String] = []
var checks: int = 0


func check(condition: bool, label: String) -> void:
	checks += 1
	if not condition:
		failures.append(label)


func check_eq(actual, expected, label: String) -> void:
	check(actual == expected, "%s (expected %s, got %s)" % [label, str(expected), str(actual)])


func check_almost(actual: float, expected: float, label: String, eps: float = 0.001) -> void:
	var msg := "%s (expected ~%s, got %s)" % [label, str(expected), str(actual)]
	check(absf(actual - expected) <= eps, msg)


func ok() -> bool:
	return failures.is_empty()


func summary(suite_name: String) -> String:
	if failures.is_empty():
		return "[PASS] %s (%d checks)" % [suite_name, checks]
	var header := "[FAIL] %s (%d/%d checks failed):" % [suite_name, failures.size(), checks]
	var lines: Array[String] = [header]
	for f in failures:
		lines.append("    - " + f)
	return "\n".join(PackedStringArray(lines))
