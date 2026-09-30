// concord-ollama-proxy — fail-fast reverse proxy in front of Ollama.
//
// Concurrency Refactor Phase 4. When the A40 SSH tunnel (or a local Ollama)
// wedges, Node's per-request `fetch(ollama)` calls hang on TCP connect until the
// OS timeout, each holding an _llmQueue slot — 45-120s pileups that helped cause
// the Sep 7-8 lockups. This proxy gives every brain call ONE chokepoint with:
//
//   - a hard connect timeout (default 2s) so a dead upstream fails in ~2s not ~2min
//   - a shared circuit breaker: N consecutive upstream failures → OPEN, instant
//     503 for the cooldown, one half-open probe to recover
//   - per-model FIFO admission with a max depth → instant 503 when saturated,
//     instead of unbounded queueing
//
// Everything else is a transparent passthrough. stdlib-only.
//
//	LISTEN     127.0.0.1:11480         ($CONCORD_OLLAMA_PROXY_ADDR)
//	UPSTREAM   http://127.0.0.1:11434  ($OLLAMA_UPSTREAM)
//	GET /v1/proxy-health               breaker state + queue depths + upstream probe
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

var (
	upstreamURL   *url.URL
	connectTOms   = envInt("CONCORD_OLLAMA_PROXY_CONNECT_TIMEOUT_MS", 2000)
	genTOms       = envInt("CONCORD_OLLAMA_PROXY_GEN_TIMEOUT_MS", 300000)
	maxQueuePer   = envInt("CONCORD_OLLAMA_PROXY_MAX_QUEUE_PER_MODEL", 24)
	breakThresh   = envInt("CONCORD_OLLAMA_PROXY_BREAK_THRESHOLD", 5)
	breakCooldown = time.Duration(envInt("CONCORD_OLLAMA_PROXY_BREAK_COOLDOWN_MS", 15000)) * time.Millisecond
	served        int64
	fastFailed    int64
)

// ── circuit breaker ────────────────────────────────────────────────────────
type breaker struct {
	mu            sync.Mutex
	state         string // "closed" | "open" | "half_open"
	consecFails   int
	openedAt      time.Time
	probeInFlight bool
}

func (b *breaker) allow() (bool, string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	switch b.state {
	case "open":
		if time.Since(b.openedAt) >= breakCooldown && !b.probeInFlight {
			b.state = "half_open"
			b.probeInFlight = true
			return true, "half_open_probe"
		}
		return false, "open"
	case "half_open":
		if b.probeInFlight {
			return false, "half_open_busy"
		}
		b.probeInFlight = true
		return true, "half_open_probe"
	default:
		return true, "closed"
	}
}

func (b *breaker) record(ok bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.probeInFlight = false
	if ok {
		b.consecFails = 0
		b.state = "closed"
		return
	}
	b.consecFails++
	if b.consecFails >= breakThresh {
		if b.state != "open" {
			log.Printf("circuit OPEN after %d consecutive upstream failures", b.consecFails)
		}
		b.state = "open"
		b.openedAt = time.Now()
	}
}

func (b *breaker) snapshot() map[string]any {
	b.mu.Lock()
	defer b.mu.Unlock()
	m := map[string]any{"state": b.state, "consecFails": b.consecFails}
	if b.state == "open" {
		m["cooldownRemainingMs"] = max64(0, breakCooldown.Milliseconds()-time.Since(b.openedAt).Milliseconds())
	}
	return m
}

var cb = &breaker{state: "closed"}

// ── per-model admission ────────────────────────────────────────────────────
var (
	qMu    sync.Mutex
	qDepth = map[string]int{}
)

func admit(model string) bool {
	qMu.Lock()
	defer qMu.Unlock()
	if qDepth[model] >= maxQueuePer {
		return false
	}
	qDepth[model]++
	return true
}
func leave(model string) {
	qMu.Lock()
	defer qMu.Unlock()
	if qDepth[model] > 0 {
		qDepth[model]--
	}
}
func depths() map[string]int {
	qMu.Lock()
	defer qMu.Unlock()
	out := map[string]int{}
	for k, v := range qDepth {
		if v > 0 {
			out[k] = v
		}
	}
	return out
}

// ── proxy ─────────────────────────────────────────────────────────────────
func newTransport() *http.Transport {
	return &http.Transport{
		DialContext: (&net.Dialer{
			Timeout:   time.Duration(connectTOms) * time.Millisecond, // the key knob: dead tunnel fails here
			KeepAlive: 30 * time.Second,
		}).DialContext,
		ForceAttemptHTTP2:     false,
		MaxIdleConns:          64,
		MaxIdleConnsPerHost:   64,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   time.Duration(connectTOms) * time.Millisecond,
		ExpectContinueTimeout: 1 * time.Second,
		ResponseHeaderTimeout: time.Duration(genTOms) * time.Millisecond,
	}
}

func isGenPath(p string) bool {
	return p == "/api/chat" || p == "/api/generate" || p == "/v1/chat/completions" || p == "/api/embeddings"
}

func modelOf(body []byte) string {
	var m struct {
		Model string `json:"model"`
	}
	_ = json.Unmarshal(body, &m)
	if m.Model == "" {
		return "_unknown"
	}
	return m.Model
}

func main() {
	up := os.Getenv("OLLAMA_UPSTREAM")
	if up == "" {
		up = "http://127.0.0.1:11434"
	}
	var err error
	upstreamURL, err = url.Parse(up)
	if err != nil {
		log.Fatalf("bad OLLAMA_UPSTREAM %q: %v", up, err)
	}

	rp := httputil.NewSingleHostReverseProxy(upstreamURL)
	rp.Transport = newTransport()
	rp.ErrorHandler = func(w http.ResponseWriter, r *http.Request, e error) {
		cb.record(false)
		atomic.AddInt64(&fastFailed, 1)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"error": "upstream_unreachable", "detail": e.Error(), "proxy": "concord-ollama-proxy",
		})
	}
	// mark success once headers come back from upstream
	rp.ModifyResponse = func(resp *http.Response) error {
		cb.record(resp.StatusCode < 500)
		return nil
	}

	addr := os.Getenv("CONCORD_OLLAMA_PROXY_ADDR")
	if addr == "" {
		addr = "127.0.0.1:11480"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/v1/proxy-health", func(w http.ResponseWriter, _ *http.Request) {
		reachable, probeMs := probeUpstream()
		writeJSON(w, 200, map[string]any{
			"ok": true, "service": "concord-ollama-proxy",
			"upstream": up, "upstreamReachable": reachable, "upstreamProbeMs": probeMs,
			"breaker": cb.snapshot(), "queueDepths": depths(),
			"served": atomic.LoadInt64(&served), "fastFailed": atomic.LoadInt64(&fastFailed),
			"config": map[string]any{
				"connectTimeoutMs": connectTOms, "genTimeoutMs": genTOms,
				"maxQueuePerModel": maxQueuePer, "breakThreshold": breakThresh,
				"breakCooldownMs": breakCooldown.Milliseconds(),
			},
		})
	})

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt64(&served, 1)
		if !isGenPath(r.URL.Path) {
			rp.ServeHTTP(w, r) // transparent passthrough for tags/pull/show/etc
			return
		}

		// circuit check — instant 503, no connect attempt
		if ok, why := cb.allow(); !ok {
			atomic.AddInt64(&fastFailed, 1)
			writeJSON(w, 503, map[string]any{"error": "upstream_circuit_open", "reason": why, "proxy": "concord-ollama-proxy", "breaker": cb.snapshot()})
			return
		}

		body, _ := io.ReadAll(io.LimitReader(r.Body, 64<<20))
		_ = r.Body.Close()
		model := modelOf(body)

		if !admit(model) {
			atomic.AddInt64(&fastFailed, 1)
			cb.record(true) // saturation isn't an upstream fault
			writeJSON(w, 503, map[string]any{"error": "queue_full", "model": model, "maxQueuePerModel": maxQueuePer, "proxy": "concord-ollama-proxy"})
			return
		}
		defer leave(model)

		ctx, cancel := context.WithTimeout(r.Context(), time.Duration(genTOms)*time.Millisecond)
		defer cancel()
		r2 := r.Clone(ctx)
		r2.Body = io.NopCloser(bytes.NewReader(body))
		r2.ContentLength = int64(len(body))
		r2.Header.Set("Content-Length", strconv.Itoa(len(body)))
		rp.ServeHTTP(w, r2)
	})

	srv := &http.Server{Addr: addr, Handler: mux}
	go func() {
		log.Printf("concord-ollama-proxy listening on %s → %s (connectTO=%dms breakThresh=%d)", addr, up, connectTOms, breakThresh)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGTERM, syscall.SIGINT)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}

func probeUpstream() (bool, int64) {
	t0 := time.Now()
	d := net.Dialer{Timeout: time.Duration(connectTOms) * time.Millisecond}
	c, err := d.Dial("tcp", upstreamURL.Host)
	ms := time.Since(t0).Milliseconds()
	if err != nil {
		return false, ms
	}
	_ = c.Close()
	return true, ms
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func envInt(k string, def int) int {
	if v := os.Getenv(k); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return def
}

func max64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
