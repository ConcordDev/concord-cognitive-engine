class_name TestUtils
extends RefCounted
## TestUtils — tiny assert-collector so pure-logic test scripts can run
## standalone via `godot --headless --script res://tests/run_all.gd`,
## without vendoring a full framework (gdUnit4 is not in this skeleton).
##
## EXECUTED AGAINST A REAL ENGINE (2026-07-25): this harness and every suite
## it collects now run under a real Godot 4.4 headless binary
## (`./.godot-runtime/bin/godot`, see docs/GODOT_RUNTIME.md) via
## `godot --headless --path world-lens-godot --script tests/run_all.gd`. The
## earlier "never executed / gdparse+gdlint only" caveat here is superseded —
## that first real run promptly surfaced four genuine defects that lint had
## green-lit, including an honesty-invariant violation in air_legibility.gd
## and a dead defensive branch in dtu_prop_renderer.gd.
##
## Still out of scope for this harness: anything requiring rendered output.
## These are pure-logic assertions, not visual verification — see
## world-lens-godot/VISUAL_QA.md for what remains genuinely unverified.

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
