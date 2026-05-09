# Concord on RunPod via Cloudflare Tunnel

This is the deployment shape we recommend for solo operators on rented GPU. RunPod boxes don't have stable inbound IPs and their proxy adds cost + latency. Cloudflare Tunnel solves both problems: outbound-only connection from the GPU container to Cloudflare's edge, free TLS, your-own-domain, no inbound port forwarding.

## TL;DR

```bash
# One-time, on the GPU box (or via RunPod web terminal):
bash infra/cloudflare/setup-tunnel.sh

# Then:
docker compose \
  -f docker-compose.yml \
  -f infra/cloudflare/docker-compose.cloudflared.yml \
  up -d
```

That's it. `https://concord.<your-domain>.com` is now live.

## Two modes

### Token mode (recommended)

You create the tunnel + ingress rules in the [Cloudflare Zero Trust dashboard](https://one.dash.cloudflare.com/), copy a single token string, paste it into `.env`. Cloudflare manages your config; you only ship `CF_TUNNEL_TOKEN`.

**Pros:** zero config files, change ingress rules without redeploying, dashboard UI for routes.
**Cons:** dashboard-driven; harder to audit changes in git.

### Config-file mode

You declare the tunnel + ingress rules in `infra/cloudflare/cloudflared.yml`, mount a `credentials.json` next to it. Everything is version-controlled.

**Pros:** ingress rules in git, no dashboard dependency.
**Cons:** more setup, must redeploy to change routes.

`setup-tunnel.sh` walks you through either mode interactively.

---

## RunPod-specific notes

### The pod must run Docker

RunPod offers two pod types:
- **Pod** (raw container, single image) — won't work directly; you'd need to install docker-in-docker or use a different shape.
- **Pod with Docker** or **community templates with docker-compose support** — this is the shape this guide assumes.

If you're on a raw RunPod container, easier path: forget docker-compose entirely and run cloudflared as its own background process:

```bash
# Install cloudflared inside the RunPod container
wget -qO /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
chmod +x /usr/local/bin/cloudflared

# Token mode — start the tunnel in the background
cloudflared tunnel --no-autoupdate run --token $CF_TUNNEL_TOKEN &
```

### Persistent storage

RunPod's container filesystem is volatile by default. Make sure the Concord DB lives on a **mounted volume** (RunPod calls these "Network Volumes" or "Persistent Storage"), not the container root. Set `DB_PATH=/workspace/concord.db` (or wherever your volume is mounted) in `.env`.

If you skip this, you'll lose your DTU corpus + every grudge every NPC ever held the next time the pod restarts. The royalty cascade depends on the lineage being persistent.

### Brain models

The Ollama models are ~70GB total. RunPod pods come with the model dir empty. Either:
1. Pre-pull on first boot (slow, billable GPU minutes wasted) — `ollama pull qwen2.5:32b-instruct-q4_K_M` ×4 + `llava:13b-v1.6-vicuna-q4_K_M`.
2. Mount a Network Volume to `/root/.ollama` so models persist across pod restarts.

Option 2 is what you want.

### GPU sizing

CLAUDE.md targets the RTX PRO 4500 Blackwell (32GB). On RunPod:
- **RTX 4090 (24GB)** — works if you drop conscious from 32B → 14B.
- **A6000 / 6000 Ada (48GB)** — generous; defaults work.
- **H100 / H200** — overkill but cheap if you batch.

Set the brain models in `.env` to match your card.

### Costs (rough, May 2026)

For a 24/7 RunPod RTX 4090 pod + Cloudflare Free tier:
- GPU: ~$0.40-0.70/hr → ~$300-500/mo
- Cloudflare: $0/mo (Free tier handles TLS + tunnel + DNS)
- Storage: ~$0.10/GB/mo on Network Volumes (~$10-20/mo for 100GB)

Total: about $310-520/mo for a real production Concord instance. Compare to comparable SaaS knowledge platforms charging per seat at scale.

---

## Verifying the tunnel works

```bash
# 1. Tunnel logs — should show "Registered tunnel connection" within 5s
docker logs -f concord-cloudflared

# 2. From outside the box:
curl -I https://concord.<your-domain>.com
# Expect HTTP/2 200 (or 30x redirect)

# 3. WebSocket / socket.io
wscat -c wss://concord.<your-domain>.com/socket.io/?transport=websocket
```

## When things go wrong

**Tunnel logs say "no such tunnel"** — token is for a different tunnel than the one you created. Re-paste from the Cloudflare dashboard.

**Public URL returns 530** — origin (your concord-backend) is not reachable from the cloudflared container. Most likely cause: cloudflared and backend are on different docker networks. The compose sidecar joins `concord-network`; verify your main compose declares the same.

**Public URL works but socket.io disconnects** — your ingress rules don't include the `/socket.io/.*` path. In token mode add it in the dashboard; in config-file mode it's already in the example.

**RunPod pod kills the container under load** — increase the GPU memory in your pod tier OR reduce concurrent dialogue cap (`CONCORD_DIALOGUE_MAX_CONCURRENT=20`).

**Federation peers can't reach you** — by default the tunnel only exposes `concord.<your-domain>.com`. If you're federating, peers need `/api/world/social-shadows` reachable, which is on the same hostname so this works. But if you're brain-only-federation (rare), you'd need to expose `brain.<your-domain>.com` too.

---

## Security

- The `CF_TUNNEL_TOKEN` is sensitive. Treat it like a credential. RunPod has a Secrets feature; use it.
- Cloudflare Tunnel doesn't authenticate your users — that's still Concord's JWT layer. The tunnel just gets traffic to you.
- Cloudflare can be put in front of an Access policy if you want it to gate access by identity (Google login, etc.) before the request even reaches Concord. See [Cloudflare Zero Trust Access docs](https://developers.cloudflare.com/cloudflare-one/applications/).
- **Do not expose `brain.<your-domain>.com` publicly** unless you've put Access in front of it. Public Ollama is a free GPU for the world.
