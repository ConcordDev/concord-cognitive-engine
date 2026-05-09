# Changelog

All notable changes to the Concord DX extension are documented here. Format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial release scaffolding (package.json, tsconfig, extension.ts).
- Sign-in with Concord via loopback-redirect OAuth (RFC 8252) against
  `/oauth/dx` and `/api/dx/exchange`.
- LSP client wired to bundled `concord-lsp` server.
- Status-bar affordance that reflects sign-in state.
- Five commands: `signIn`, `signOut`, `runDetector`, `openWallet`,
  `repairPreview`.
- Activity-bar view container ("Concord") with two views: Findings + Wallet.
- Configuration: `apiUrl`, `severityWeights`, `lspServerCommand`,
  `billing.confirmThresholdCC`.

## [0.1.0] — 2026-05-09

Initial scaffold landed during the major audit pass (phase 7.1). Not yet
published to the VS Code Marketplace; this changelog will be filled in
once the publisher account is set up and `vsce publish` runs in CI.
