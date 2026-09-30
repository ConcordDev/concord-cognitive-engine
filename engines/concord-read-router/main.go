// concord-read-router — front-door splitter for horizontal read scale-out.
//
// Concurrency Refactor. Concord's read-only replica (CONCORD_READ_REPLICA=1)
// already exists in the codebase: it opens SQLite read-only, skips heartbeat +
// migrations + seeders, and serves ONLY a vetted GET allowlist. This router puts
// it to use on the bare-metal (launchd, no nginx) deploy:
//
//	allowlisted GET  → replica pool (round-robin)   ── fall back to writer on ANY error
//	everything else  → writer                        (POST, WS, socket.io, unknown GET)
//
// FAIL SAFE by construction: the default target is always the writer, a replica
// error retries on the writer, and an ambiguous path goes to the writer. The
// worst a router bug can do is send a read to the writer — i.e. today's
// behaviour. stdlib only.
//
//	LISTEN     $CONCORD_READ_ROUTER_ADDR         (default 127.0.0.1:5060)
//	WRITER     $CONCORD_WRITER_URL               (default http://127.0.0.1:5050)
//	REPLICAS   $CONCORD_REPLICA_URLS  (comma)    (default http://127.0.0.1:5051)
//	GET /v1/router-health
package main

import (
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"regexp"
	"strings"
	"sync/atomic"
	"syscall"
	"time"
)

// ── allowlist — ported verbatim from server/lib/read-replica-allowlist.js ────
// Keep in sync with that file. The replica ALSO enforces this server-side
// (default-deny gate), so this is a routing hint, not a trust boundary.
var infra = mustCompile([]string{
	`^/health/?$`, `^/ready/?$`, `^/livez/?$`, `^/metrics/?$`,
})
var danger = mustCompile([]string{
	`^/api/worlds/[^/]+/nodes/?$`,
	`^/api/worlds/[^/]+/buildings/?$`,
	`^/api/worlds/[^/]+/buildings/[^/]+/interior/?$`,
})
var safe = mustCompile([]string{
	`^/api/dtus/?$`, `^/api/dtus/stats/?$`, `^/api/dtus/shadow(/pending)?/?$`,
	`^/api/dtus/promotion/queue/?$`, `^/api/dtus/[^/]+/?$`, `^/api/dtu_view/[^/]+/?$`,
	`^/api/dtu/[^/]+/(export|verify-container)/?$`, `^/api/megas/?$`, `^/api/hypers/?$`,
	`^/api/definitions(/[^/]+)?/?$`,
	`^/api/worlds/?$`, `^/api/worlds/current/?$`, `^/api/worlds/[^/]+/?$`,
	`^/api/worlds/[^/]+/quests(/active)?/?$`,
	`^/api/worlds/[^/]+/npc-relationships/(gossip-feed|list)/?$`,
	`^/api/worlds/[^/]+/emergents/?$`, `^/api/worlds/[^/]+/market/?$`,
	`^/api/worlds/[^/]+/directives/?$`, `^/api/worlds/[^/]+/buildings/[^/]+/rooms/?$`,
	`^/api/worlds/[^/]+/frame/?$`, `^/api/worlds/[^/]+/health/?$`,
	`^/api/cities(/[^/]+(/players)?|/home)?/?$`,
	`^/api/feeds(/(health|domains|domain/[^/]+))?/?$`,
	`^/api/marketplace/(stats|categories|browse|search|dtu-types|full-summary)/?$`,
	`^/api/marketplace/(lens/[^/]+(/citations|/full)?|by-category/[^/]+|by-classification/[^/]+)/?$`,
	`^/api/atlas/(tile|volume|material|subsurface|change|coverage|live)/?$`,
	`^/api/leaderboards(/[^/]+)?/?$`, `^/api/player-inventory/knowledge/?$`,
})

func isReadSafe(method, path string) bool {
	if method != http.MethodGet && method != http.MethodHead {
		return false
	}
	if matchAny(danger, path) {
		return false
	}
	if matchAny(infra, path) {
		return true
	}
	return matchAny(safe, path)
}

// ── stats ──────────────────────────────────────────────────────────────────
var (
	toWriter    int64
	toReplica   int64
	replicaFail int64
)

func main() {
	addr := envOr("CONCORD_READ_ROUTER_ADDR", "127.0.0.1:5060")
	writerRaw := envOr("CONCORD_WRITER_URL", "http://127.0.0.1:5050")
	replicaRaw := envOr("CONCORD_REPLICA_URLS", "http://127.0.0.1:5051")

	writerURL := mustURL(writerRaw)
	writer := newProxy(writerURL, nil)

	var replicas []*httputil.ReverseProxy
	var replicaHosts []string
	for _, r := range strings.Split(replicaRaw, ",") {
		r = strings.TrimSpace(r)
		if r == "" {
			continue
		}
		u := mustURL(r)
		replicaHosts = append(replicaHosts, u.Host)
		// on ANY replica transport error → transparently re-serve on the writer
		p := newProxy(u, func(w http.ResponseWriter, req *http.Request, err error) {
			atomic.AddInt64(&replicaFail, 1)
			log.Printf("replica %s error (%v) — falling back to writer for %s", u.Host, err, req.URL.Path)
			writer.ServeHTTP(w, req)
		})
		replicas = append(replicas, p)
	}
	var rr uint64

	mux := http.NewServeMux()
	mux.HandleFunc("/v1/router-health", func(w http.ResponseWriter, _ *http.Request) {
		wOK, wMs := probe(writerURL.Host)
		out := `{"ok":true,"service":"concord-read-router"` +
			`,"writer":{"host":"` + writerURL.Host + `","reachable":` + b(wOK) + `,"probeMs":` + itoa(wMs) + `}` +
			`,"replicas":[`
		for i, h := range replicaHosts {
			rOK, rMs := probe(h)
			if i > 0 {
				out += ","
			}
			out += `{"host":"` + h + `","reachable":` + b(rOK) + `,"probeMs":` + itoa(rMs) + `}`
		}
		out += `],"routed":{"writer":` + itoa64(atomic.LoadInt64(&toWriter)) +
			`,"replica":` + itoa64(atomic.LoadInt64(&toReplica)) +
			`,"replicaFallback":` + itoa64(atomic.LoadInt64(&replicaFail)) + `}}`
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, out)
	})

	mux.HandleFunc("/", func(w http.ResponseWriter, req *http.Request) {
		// WebSocket upgrades + socket.io always to the writer (replica has no
		// realtime; the writer owns the io server).
		if len(replicas) > 0 &&
			req.Header.Get("Upgrade") == "" &&
			!strings.HasPrefix(req.URL.Path, "/socket.io") &&
			!strings.HasPrefix(req.URL.Path, "/godot-ws") &&
			isReadSafe(req.Method, req.URL.Path) {
			atomic.AddInt64(&toReplica, 1)
			idx := int(atomic.AddUint64(&rr, 1)) % len(replicas)
			replicas[idx].ServeHTTP(w, req)
			return
		}
		atomic.AddInt64(&toWriter, 1)
		writer.ServeHTTP(w, req)
	})

	srv := &http.Server{Addr: addr, Handler: mux}
	go func() {
		log.Printf("concord-read-router on %s  → writer %s  · replicas %v", addr, writerRaw, replicaHosts)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGTERM, syscall.SIGINT)
	<-stop
	_ = srv.Close()
}

func newProxy(target *url.URL, onErr func(http.ResponseWriter, *http.Request, error)) *httputil.ReverseProxy {
	p := httputil.NewSingleHostReverseProxy(target)
	base := p.Director
	p.Director = func(r *http.Request) {
		base(r)
		r.Host = target.Host // Express reads Host; keep it the upstream's
		if r.Header.Get("X-Forwarded-Proto") == "" {
			r.Header.Set("X-Forwarded-Proto", "http")
		}
	}
	p.Transport = &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		MaxIdleConns:          256,
		MaxIdleConnsPerHost:   256,
		IdleConnTimeout:       90 * time.Second,
		ResponseHeaderTimeout: 120 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}
	p.FlushInterval = -1 // stream immediately (SSE / chunked)
	if onErr != nil {
		p.ErrorHandler = onErr
	}
	return p
}

func probe(host string) (bool, int64) {
	t0 := time.Now()
	c := &http.Client{Timeout: 1500 * time.Millisecond}
	r, err := c.Get("http://" + host + "/health")
	ms := time.Since(t0).Milliseconds()
	if err != nil {
		return false, ms
	}
	_ = r.Body.Close()
	return r.StatusCode < 500, ms
}

func mustCompile(pats []string) []*regexp.Regexp {
	out := make([]*regexp.Regexp, len(pats))
	for i, p := range pats {
		out[i] = regexp.MustCompile(p)
	}
	return out
}
func matchAny(res []*regexp.Regexp, s string) bool {
	for _, re := range res {
		if re.MatchString(s) {
			return true
		}
	}
	return false
}
func mustURL(s string) *url.URL {
	u, err := url.Parse(s)
	if err != nil {
		log.Fatalf("bad url %q: %v", s, err)
	}
	return u
}
func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
func b(v bool) string {
	if v {
		return "true"
	}
	return "false"
}
func itoa(n int64) string { return itoa64(n) }
func itoa64(n int64) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
