/**
 * Concord Frontend Proxy Server (v5)
 *
 * Replaces Next.js's standalone server.js to fix WebSocket proxy through
 * /socket.io/. Next.js's HTTP rewrites handle regular HTTP correctly, but
 * the WS upgrade handshake through that rewrite path returns "Internal
 * Server Error" (no HTTP/1.1 status line) — Cloudflare tunnel sees this
 * as a malformed HTTP response and aborts the connection.
 *
 * This server intercepts /socket.io/* BEFORE Next.js sees them and proxies
 * them directly to the backend (:5050), using http.request's built-in
 * upgrade event handler so WebSocket connections tunnel cleanly through.
 * Everything else is handed to Next.js's getRequestHandler unchanged.
 *
 * Designed to live at /concord-frontend/server-proxy.js and be run from
 * the concord-frontend/ directory via pm2 (cwd is set in ecosystem config).
 */

const path = require('path');
const http = require('http');
const url = require('url');

const dir = __dirname;
process.env.NODE_ENV = 'production';
process.chdir(dir);

const currentPort = parseInt(process.env.PORT, 10) || 3000;
const hostname = process.env.HOSTNAME || '0.0.0.0';
const backendUrl = process.env.BACKEND_URL || 'http://127.0.0.1:5050';
const parsedBackend = url.parse(backendUrl);

const configPath = path.join(dir, 'next.config.js');

let nextConfig = null;
try {
  const loaded = require(configPath);
  nextConfig = (loaded && loaded.default) ? loaded.default : loaded;
  nextConfig = Object.assign({}, nextConfig, { distDir: './.next', output: 'standalone' });
} catch (e) {
  console.error('[proxy] failed to load next.config.js from ' + configPath + ':', e.message);
  process.exit(1);
}

const NextServer = require('next/dist/server/next');
const nextServer = new NextServer({
  dir: dir,
  dev: false,
  conf: nextConfig,
  hostname,
  port: currentPort,
});

function proxySocketIO(req, res) {
  const opts = {
    hostname: parsedBackend.hostname,
    port: parsedBackend.port || 80,
    path: req.url,
    method: req.method,
    headers: Object.assign({}, req.headers, { host: `${parsedBackend.hostname}:${parsedBackend.port || 80}` }),
  };
  const proxyReq = http.request(opts);
  proxyReq.on('response', (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxyReq.on('error', (err) => {
    console.error('[proxy] socket.io http proxy error:', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'socket.io proxy failed', detail: err.message }));
    } else {
      res.destroy();
    }
  });
  req.pipe(proxyReq);
}

function upgradeSocketIO(req, socket, head) {
  const opts = {
    hostname: parsedBackend.hostname,
    port: parsedBackend.port || 80,
    path: req.url,
    method: req.method,
    headers: Object.assign({}, req.headers, { host: `${parsedBackend.hostname}:${parsedBackend.port || 80}` }),
  };
  const proxyReq = http.request(opts);
  proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\n');
    Object.entries(proxyRes.headers).forEach(([key, val]) => {
      if (Array.isArray(val)) val.forEach((v) => socket.write(`${key}: ${v}\r\n`));
      else socket.write(`${key}: ${val}\r\n`);
    });
    socket.write('\r\n');
    if (proxyHead && proxyHead.length) socket.write(proxyHead);
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
  });
  proxyReq.on('response', (proxyRes) => {
    let body = '';
    proxyRes.on('data', (chunk) => body += chunk);
    proxyRes.on('end', () => {
      try { socket.write(`HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage}\r\n`); } catch (e) {}
      Object.entries(proxyRes.headers).forEach(([key, val]) => {
        if (Array.isArray(val)) val.forEach((v) => { try { socket.write(`${key}: ${v}\r\n`); } catch (e) {} });
        else { try { socket.write(`${key}: ${val}\r\n`); } catch (e) {} }
      });
      try { socket.write('\r\n'); socket.write(body); socket.end(); } catch (e) {}
    });
  });
  proxyReq.on('error', (err) => {
    console.error('[proxy] socket.io WS upgrade error:', err.message);
    try { socket.destroy(); } catch (e) {}
  });
  proxyReq.end();
}

nextServer.prepare().then(() => {
  const handler = nextServer.getRequestHandler();
  const upgradeHandler = nextServer.getUpgradeHandler();

  const server = http.createServer((req, res) => {
    if (req.url && req.url.startsWith('/socket.io/')) {
      proxySocketIO(req, res);
      return;
    }
    handler(req, res);
  });

  server.on('upgrade', (req, socket, head) => {
    if (req.url && req.url.startsWith('/socket.io/')) {
      upgradeSocketIO(req, socket, head);
      return;
    }
    upgradeHandler(req, socket, head);
  });

  server.listen(currentPort, hostname, () => {
    console.log(`[proxy] Concord frontend listening on ${hostname}:${currentPort}`);
    console.log(`[proxy] /socket.io/* -> ${backendUrl}`);
    console.log(`[proxy] everything else -> Next.js handler`);
    console.log(`[proxy] working dir: ${dir}`);
  });

  process.on('SIGINT', () => {
    console.log('[proxy] SIGINT received, shutting down');
    server.close(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    console.log('[proxy] SIGTERM received, shutting down');
    server.close(() => process.exit(0));
  });
}).catch((err) => {
  console.error('[proxy] nextServer.prepare() failed:', err);
  process.exit(1);
});
