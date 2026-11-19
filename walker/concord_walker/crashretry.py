"""ULW C9: crash = relaunch + re-run the current unit of work.

The sweep already relaunches Chrome and retries a lens whose walk crashes
(walker.py cmd_walk). The reverify loop did not: one browser crash raised
out of the per-ticket loop, aborted the run, and errored every remaining
ticket — the run-1 shape that errored FIX-whiteboard-001/003. This helper
carries the same discipline to any per-unit loop: run fn(); on a
crash-class error, call relaunch() and re-run fn() for the SAME unit, up
to max_relaunches; a crash after the last relaunch raises CrashExhausted
(carrying the unit + the last error) so the caller can fail THAT unit
alone and continue with the next. Non-crash errors propagate untouched.
"""


class CrashExhausted(Exception):
    def __init__(self, unit, relaunches, last_error):
        super().__init__("crash on %s after %d relaunch(es): %s" % (unit, relaunches, last_error))
        self.unit, self.relaunches, self.last_error = unit, relaunches, last_error


def run_with_relaunch(unit, fn, relaunch, is_crash, max_relaunches=1, log=lambda *a: None):
    """Returns (result, relaunches_used). Raises CrashExhausted when the
    unit still crashes after the last relaunch; re-raises any non-crash
    error exactly as raised."""
    used = 0
    while True:
        try:
            return fn(), used
        except Exception as e:
            if not is_crash(e):
                raise
            if used >= max_relaunches:
                raise CrashExhausted(unit, used, e) from e
            used += 1
            log("  crash on %s (%s); relaunching and re-running the same unit (relaunch %d of %d)"
                % (unit, type(e).__name__, used, max_relaunches))
            relaunch()
