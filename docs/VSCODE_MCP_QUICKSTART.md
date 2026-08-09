# VS Code + MCP Quickstart

This is the canonical go-live quickstart for both Concord surfaces:

1. Install the Concord DX VS Code extension.
2. Connect any MCP-capable client to Concord's `/mcp` endpoint.

## 1) Install in VS Code (Concord DX)

### Marketplace install
1. Open VS Code Extensions.
2. Search for **Concord DX**.
3. Install and reload.

### Local `.vsix` install (pre-release/internal)
1. Build/package:
   ```bash
   cd concord-vscode
   npm install
   npm run compile
   npm run package
   ```
2. In VS Code: **Extensions → ... → Install from VSIX...**
3. Select `concord-vscode/concord-dx.vsix`.

### Sign in
Run `Concord: Sign in with Concord (OAuth)` from the command palette.

## 2) Connect MCP clients

- **Public endpoint:** `https://concord-os.org/mcp`
- **Local endpoint:** `http://localhost:5050/mcp`
- **Tool discovery:** `GET /mcp/tools`
- **OAuth protected-resource metadata:** `GET /.well-known/oauth-protected-resource`

### VS Code MCP config (`.vscode/mcp.json`)
```json
{
  "servers": {
    "concord": {
      "type": "http",
      "url": "https://concord-os.org/mcp",
      "auth": {
        "kind": "bearer",
        "token": "${env:CONCORD_TOKEN}"
      }
    }
  }
}
```

### Cursor/Claude Desktop shape
Use the same URL (`https://concord-os.org/mcp`) and pass a bearer token in your client's MCP config.

## Release automation (VS Code extension)

Marketplace publish is wired in `.github/workflows/dx-extension.yml`:
- Build/package runs on PRs and main pushes touching `concord-vscode/` or `concord-lsp/`.
- Publish runs only on tags shaped `concord-dx-vX.Y.Z`.
- CI enforces `tag version == concord-vscode/package.json version`.

## Registry publish (MCP server)

`server/mcp-server.json` is the publishable registry manifest.

```bash
mcp-publisher login
mcp-publisher publish server/mcp-server.json
```
