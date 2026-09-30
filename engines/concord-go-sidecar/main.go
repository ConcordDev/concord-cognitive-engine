// concord-go-sidecar — long-lived process that owns Whisper / Piper / sandbox
// subprocess execution so the Node event loop never spawnSync's them on a
// request path (Concurrency Refactor Phase 1; audit finding C03).
//
// Contract: stdlib-only, Unix-domain-socket HTTP, structured JSON in/out.
// Node's own allowlist + gates still apply — this is defense in depth, not a
// trust boundary move. Feature binaries (whisper.cpp, piper) stay env-gated:
// unset => honest "not configured" error, same as the inline path.
package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"time"
)

var (
	startedAt = time.Now()
	// Bounded concurrency for child processes — keep the box from fork-storming
	// under a burst of voice requests. 4 is plenty for a single-box deploy.
	execSem = make(chan struct{}, envInt("CONCORD_GO_SIDECAR_MAX_EXEC", 4))
)

// ── sandbox policy (mirrors server.js SANDBOX_ALLOWED_COMMANDS) ──────────────
var sandboxAllowed = map[string]bool{
	"ls": true, "cat": true, "head": true, "tail": true, "wc": true,
	"grep": true, "find": true, "echo": true, "date": true, "pwd": true,
	"node": true, "npm": true, "npx": true, "python3": true, "python": true,
}
var chainOps = regexp.MustCompile("[;&|`$(){}]")

func main() {
	sock := os.Getenv("CONCORD_GO_SIDECAR_SOCK")
	if sock == "" {
		sock = "/Users/dutch/concord/run/concord-go-sidecar.sock"
	}
	_ = os.Remove(sock) // stale socket from an unclean exit
	if err := os.MkdirAll(filepath.Dir(sock), 0o755); err != nil {
		log.Fatalf("mkdir run dir: %v", err)
	}
	ln, err := net.Listen("unix", sock)
	if err != nil {
		log.Fatalf("listen %s: %v", sock, err)
	}
	_ = os.Chmod(sock, 0o600)

	mux := http.NewServeMux()
	mux.HandleFunc("/v1/health", handleHealth)
	mux.HandleFunc("/v1/whisper", handleWhisper)
	mux.HandleFunc("/v1/piper", handlePiper)
	mux.HandleFunc("/v1/sandbox", handleSandbox)

	srv := &http.Server{Handler: logMW(mux), ReadHeaderTimeout: 5 * time.Second}

	go func() {
		log.Printf("concord-go-sidecar listening on unix:%s (maxExec=%d)", sock, cap(execSem))
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("serve: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGTERM, syscall.SIGINT)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
	_ = os.Remove(sock)
	log.Printf("concord-go-sidecar stopped")
}

// ── handlers ───────────────────────────────────────────────────────────────

func handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, 200, map[string]any{
		"ok":        true,
		"service":   "concord-go-sidecar",
		"uptimeSec": int(time.Since(startedAt).Seconds()),
		"maxExec":   cap(execSem),
		"whisper":   firstEnv("WHISPER_CPP_BIN", "WHISPER_BIN") != "",
		"piper":     os.Getenv("PIPER_BIN") != "",
	})
}

type whisperReq struct {
	AudioPath   string `json:"audioPath"`
	AudioBase64 string `json:"audioBase64"`
	Model       string `json:"model"`
	TimeoutMs   int    `json:"timeoutMs"`
}

func handleWhisper(w http.ResponseWriter, r *http.Request) {
	var req whisperReq
	if !readJSON(w, r, &req) {
		return
	}
	bin := firstEnv("WHISPER_CPP_BIN", "WHISPER_BIN")
	if bin == "" {
		writeJSON(w, 200, map[string]any{"ok": false, "error": "whisper_not_configured", "detail": "set WHISPER_CPP_BIN"})
		return
	}
	audioPath := req.AudioPath
	cleanup := func() {}
	if audioPath == "" && req.AudioBase64 != "" {
		raw, err := base64.StdEncoding.DecodeString(req.AudioBase64)
		if err != nil {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "bad_base64"})
			return
		}
		f, err := os.CreateTemp("", "concord-whisper-*.wav")
		if err != nil {
			writeJSON(w, 500, map[string]any{"ok": false, "error": "tmp_write", "detail": err.Error()})
			return
		}
		_, _ = f.Write(raw)
		_ = f.Close()
		audioPath = f.Name()
		cleanup = func() { _ = os.Remove(audioPath); _ = os.Remove(audioPath + ".txt") }
	}
	defer cleanup()
	if audioPath == "" {
		writeJSON(w, 400, map[string]any{"ok": false, "error": "audioPath_or_audioBase64_required"})
		return
	}

	args := []string{"-f", audioPath, "-otxt"}
	if req.Model != "" {
		args = append([]string{"-m", req.Model}, args...)
	}
	out, _, code, timedOut := runExec(bin, args, "", timeout(req.TimeoutMs, 60000))
	transcript := strings.TrimSpace(out)
	if transcript == "" {
		// whisper.cpp -otxt writes <audioPath>.txt; stdout may be empty
		if b, err := os.ReadFile(audioPath + ".txt"); err == nil {
			transcript = strings.TrimSpace(string(b))
		}
	}
	if transcript == "" {
		writeJSON(w, 200, map[string]any{"ok": false, "error": "no_speech_detected", "exitCode": code, "timedOut": timedOut})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "transcript": transcript, "source": "whisper_cpp"})
}

type piperReq struct {
	Text      string `json:"text"`
	ModelArg  string `json:"modelArg"` // resolved model path from Node (already validated against the allowlist)
	TimeoutMs int    `json:"timeoutMs"`
}

func handlePiper(w http.ResponseWriter, r *http.Request) {
	var req piperReq
	if !readJSON(w, r, &req) {
		return
	}
	if strings.TrimSpace(req.Text) == "" {
		writeJSON(w, 400, map[string]any{"ok": false, "error": "text_required"})
		return
	}
	bin := os.Getenv("PIPER_BIN")
	if bin == "" {
		writeJSON(w, 200, map[string]any{"ok": false, "error": "piper_not_configured", "detail": "set PIPER_BIN"})
		return
	}
	var args []string
	if req.ModelArg != "" {
		args = []string{"--model", req.ModelArg}
	}
	_, stdoutBytes, code, timedOut := runExecBytes(bin, args, req.Text, timeout(req.TimeoutMs, 30000))
	if len(stdoutBytes) == 0 {
		writeJSON(w, 200, map[string]any{"ok": false, "error": "piper_empty_output", "exitCode": code, "timedOut": timedOut})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "source": "piper", "wavBase64": base64.StdEncoding.EncodeToString(stdoutBytes)})
}

type sandboxReq struct {
	Command        string            `json:"command"`
	WorkDir        string            `json:"workDir"`
	TimeoutMs      int               `json:"timeoutMs"`
	MaxOutputBytes int               `json:"maxOutputBytes"`
	Env            map[string]string `json:"env"`
}

func handleSandbox(w http.ResponseWriter, r *http.Request) {
	var req sandboxReq
	if !readJSON(w, r, &req) {
		return
	}
	cmd := strings.TrimSpace(req.Command)
	if cmd == "" {
		writeJSON(w, 400, map[string]any{"exitCode": 1, "stderr": "sandbox: empty command"})
		return
	}
	if chainOps.MatchString(cmd) {
		writeJSON(w, 200, map[string]any{"exitCode": 1, "stdout": "", "stderr": "Sandbox: command chaining operators not allowed.", "timedOut": false})
		return
	}
	parts := strings.Fields(cmd)
	exe, args := parts[0], parts[1:]
	if !sandboxAllowed[exe] {
		writeJSON(w, 200, map[string]any{"exitCode": 1, "stdout": "", "stderr": "Sandbox: command \"" + exe + "\" not in allowlist.", "timedOut": false})
		return
	}
	env := []string{
		"PATH=" + os.Getenv("PATH"),
		"HOME=" + req.WorkDir,
		"NO_PROXY=*",
	}
	for k, v := range req.Env {
		if k == "PATH" || k == "HOME" || strings.Contains(k, "=") {
			continue
		}
		env = append(env, k+"="+v)
	}
	max := req.MaxOutputBytes
	if max <= 0 || max > 32*1024*1024 {
		max = 1024 * 1024
	}
	stdout, stderr, code, timedOut := runExecCapped(exe, args, req.WorkDir, env, timeout(req.TimeoutMs, 15000), max)
	writeJSON(w, 200, map[string]any{
		"exitCode": code, "stdout": stdout, "stderr": stderr, "timedOut": timedOut,
	})
}

// ── exec helpers (goroutine per request → Node loop never blocks) ───────────

func acquire() { execSem <- struct{}{} }
func release() { <-execSem }

func runExec(bin string, args []string, stdin string, d time.Duration) (stdout, stderr string, code int, timedOut bool) {
	o, e, c, t := runExecBytesFull(bin, args, "", stdin, nil, d, 32*1024*1024)
	return string(o), string(e), c, t
}
func runExecBytes(bin string, args []string, stdin string, d time.Duration) (stderr string, stdout []byte, code int, timedOut bool) {
	o, e, c, t := runExecBytesFull(bin, args, "", stdin, nil, d, 32*1024*1024)
	return string(e), o, c, t
}
func runExecCapped(bin string, args []string, cwd string, env []string, d time.Duration, max int) (stdout, stderr string, code int, timedOut bool) {
	o, e, c, t := runExecBytesFull(bin, args, cwd, "", env, d, max)
	return string(o), string(e), c, t
}

func runExecBytesFull(bin string, args []string, cwd, stdin string, env []string, d time.Duration, max int) (stdout, stderr []byte, code int, timedOut bool) {
	acquire()
	defer release()
	ctx, cancel := context.WithTimeout(context.Background(), d)
	defer cancel()
	cmd := exec.CommandContext(ctx, bin, args...)
	if cwd != "" {
		cmd.Dir = cwd
	}
	if env != nil {
		cmd.Env = env
	}
	if stdin != "" {
		cmd.Stdin = strings.NewReader(stdin)
	}
	var ob, eb cappedBuf
	ob.max, eb.max = max, max
	cmd.Stdout, cmd.Stderr = &ob, &eb
	err := cmd.Run()
	timedOut = errors.Is(ctx.Err(), context.DeadlineExceeded)
	code = 0
	if err != nil {
		var ee *exec.ExitError
		if errors.As(err, &ee) {
			code = ee.ExitCode()
		} else {
			code = 1
			eb.b = append(eb.b, []byte("\n"+err.Error())...)
		}
	}
	return ob.b, eb.b, code, timedOut
}

type cappedBuf struct {
	b   []byte
	max int
}

func (c *cappedBuf) Write(p []byte) (int, error) {
	if len(c.b) >= c.max {
		return len(p), nil // discard past the cap, keep the process happy
	}
	room := c.max - len(c.b)
	if len(p) > room {
		c.b = append(c.b, p[:room]...)
	} else {
		c.b = append(c.b, p...)
	}
	return len(p), nil
}

// ── tiny http/env utils ────────────────────────────────────────────────────

func logMW(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t0 := time.Now()
		next.ServeHTTP(w, r)
		if r.URL.Path != "/v1/health" {
			log.Printf("%s %s %dms", r.Method, r.URL.Path, time.Since(t0).Milliseconds())
		}
	})
}

func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	if r.Method != http.MethodPost {
		writeJSON(w, 405, map[string]any{"error": "POST only"})
		return false
	}
	body, _ := io.ReadAll(io.LimitReader(r.Body, 64*1024*1024))
	if err := json.Unmarshal(body, v); err != nil {
		writeJSON(w, 400, map[string]any{"error": "bad_json", "detail": err.Error()})
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func timeout(ms, def int) time.Duration {
	if ms <= 0 {
		ms = def
	}
	if ms > 300000 {
		ms = 300000
	}
	return time.Duration(ms) * time.Millisecond
}

func firstEnv(keys ...string) string {
	for _, k := range keys {
		if v := os.Getenv(k); v != "" {
			return v
		}
	}
	return ""
}

func envInt(k string, def int) int {
	if v := os.Getenv(k); v != "" {
		var n int
		if _, err := fmtSscan(v, &n); err == nil && n > 0 {
			return n
		}
	}
	return def
}

// avoid importing fmt just for one Sscan
func fmtSscan(s string, n *int) (int, error) {
	val := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			return 0, errors.New("nan")
		}
		val = val*10 + int(c-'0')
	}
	*n = val
	return 1, nil
}
