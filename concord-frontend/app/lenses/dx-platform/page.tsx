// concord-frontend/app/lenses/dx-platform/page.tsx
//
// DX Platform landing — overview + install instructions + sub-lens links.

"use client";

import Link from "next/link";

export default function DxPlatformPage() {
  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <header>
        <h1 className="text-3xl font-semibold">Concord DX Platform</h1>
        <p className="text-zinc-400 mt-2 max-w-2xl">
          Detectors, repair-cortex proposals, per-codebase severity tuning,
          and shadow-DTU cross-file context — streamed live to your editor.
          Pay-as-you-go via your CC wallet.
        </p>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card title="VS Code extension" href="https://github.com/ryttps94jq-gif/concord-cognitive-engine/tree/main/concord-vscode">
          Install the alpha extension. Run <code>Concord: Sign In</code>; paste a key from <Link href="/api-keys" className="underline">/api-keys</Link>.
        </Card>
        <Card title="JetBrains plugin" href="https://github.com/ryttps94jq-gif/concord-cognitive-engine/tree/main/concord-jetbrains">
          Backed by the same LSP server as VS Code. Single source of truth across IDEs.
        </Card>
        <Card title="Web editor (demo)" href="/lenses/dx-platform/web-editor">
          No install — paste code in Monaco, click Run detectors. For trial / demos.
        </Card>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Billing dashboard" href="/lenses/dx-platform/billing">
          CC balance, last-7d usage, top macros, current-minute quota.
        </Card>
        <Card title="API keys" href="/api-keys">
          Issue / revoke / view scopes for your plugin keys.
        </Card>
      </section>

      <section className="rounded border border-zinc-800 p-4 bg-zinc-950">
        <h2 className="text-lg font-medium mb-2">How it works</h2>
        <ol className="list-decimal pl-5 space-y-1 text-zinc-400">
          <li>Plugin opens a workspace → <code>dx.register_codebase</code> stamps a codebase id.</li>
          <li>File save → <code>detectors.runAll(codebaseId)</code> runs server-side.</li>
          <li>Findings stream over <code>/dx</code> Socket.IO → gutter diagnostics.</li>
          <li>Repair-cortex proposes fixes → Accept/Ignore/Reject in the sidebar.</li>
          <li>Decisions feed <code>dx.record_fix_decision</code> → severity weights tune per-codebase.</li>
          <li>Every macro debits your CC wallet via the existing royalty cascade.</li>
        </ol>
      </section>
    </div>
  );
}

function Card({ title, href, children }: { title: string; href: string; children: React.ReactNode }) {
  const isExternal = href.startsWith("http");
  const Wrapper = isExternal ? "a" : Link;
  return (
    <Wrapper
      href={href}
      target={isExternal ? "_blank" : undefined}
      rel={isExternal ? "noreferrer" : undefined}
      className="block rounded border border-zinc-800 p-4 hover:border-zinc-700"
    >
      <div className="font-medium">{title}</div>
      <div className="text-sm text-zinc-500 mt-1">{children}</div>
    </Wrapper>
  );
}
