// Concord Code — VS Code extension.
//
// Wires every Concord code-lens macro into a VS Code command. Real
// fetches against the Concord server (POST /api/lens/run). No mocks.
// Results land in the output channel and/or open in a new editor as
// JSON. AI-edit commands replace the selected text in the active
// editor with the macro's `after` content.

import * as vscode from 'vscode';
import * as path from 'path';

interface ConcordResult<T = unknown> {
  ok?: boolean;
  reason?: string;
  error?: string;
  result?: T;
  [k: string]: unknown;
}

function _cfg() {
  const c = vscode.workspace.getConfiguration('concord');
  return {
    apiUrl: (c.get<string>('apiUrl') || 'http://localhost:5050').replace(/\/$/, ''),
    apiToken: c.get<string>('apiToken') || '',
    defaultRunner: c.get<string>('defaultRunner') || 'npm',
  };
}

let _channel: vscode.OutputChannel | undefined;
function _log() { if (!_channel) _channel = vscode.window.createOutputChannel('Concord'); return _channel; }

async function _call<T>(domain: string, name: string, input: Record<string, unknown>): Promise<ConcordResult<T>> {
  const { apiUrl, apiToken } = _cfg();
  try {
    const r = await fetch(`${apiUrl}/api/lens/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}),
      },
      body: JSON.stringify({ domain, action: name, input }),
    });
    const json = await r.json() as ConcordResult<T>;
    return json;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'request_failed' };
  }
}

function _workspaceRoot(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return '.';
  return folders[0].uri.fsPath;
}

function _relativeProjectPath(): string {
  // The Concord server's CONCORD_CODE_WORKSPACE_ROOT is the source of
  // truth for path resolution; we ship absolute path and let server-
  // side gating reject when outside.
  return _workspaceRoot();
}

async function _showResult(label: string, result: ConcordResult) {
  const channel = _log();
  channel.appendLine(`\n── ${label} @ ${new Date().toLocaleTimeString()} ──`);
  channel.appendLine(JSON.stringify(result, null, 2));
  channel.show(true);
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('concord.runTests', async () => {
      const { defaultRunner } = _cfg();
      const r = await _call('code', 'run_tests', {
        runner: defaultRunner, projectPath: _relativeProjectPath(), args: ['test'],
      });
      _showResult(`run_tests ${defaultRunner}`, r);
      const result = r.result as { verdict?: string; failed?: number; passed?: number } | undefined;
      if (result?.verdict === 'pass') vscode.window.showInformationMessage(`Concord: tests pass (${result.passed} ok)`);
      else vscode.window.showWarningMessage(`Concord: ${result?.failed ?? '?'} failing tests — see output`);
    }),

    vscode.commands.registerCommand('concord.aiEdit', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return vscode.window.showErrorMessage('No active editor');
      const selection = editor.selection;
      const selected = editor.document.getText(selection);
      const lang = editor.document.languageId;
      const fullText = editor.document.getText();
      const prompt = await vscode.window.showInputBox({
        prompt: 'AI edit — describe the change',
        placeHolder: 'e.g. add error handling, convert to async, extract to function',
      });
      if (!prompt) return;
      const r = await _call('llm', 'local', {
        messages: [
          { role: 'system', content: `You are a senior ${lang} engineer doing a focused inline edit. Output ONLY the rewritten code in a single \`\`\`${lang} fenced block. Preserve indentation.` },
          ...(selected ? [] : [{ role: 'user' as const, content: `Full file context (\`${path.basename(editor.document.fileName)}\`):\n\n\`\`\`${lang}\n${fullText}\n\`\`\`` }]),
          { role: 'user', content: `${selected ? 'Rewrite ONLY this selection' : 'Rewrite the whole file'} so that: ${prompt}\n\n\`\`\`${lang}\n${selected || fullText}\n\`\`\`` },
        ],
        temperature: 0.2, max_tokens: 2048, slot: 'utility',
      });
      const raw = (r.result as { text?: string; content?: string } | undefined)?.text || (r.result as { content?: string } | undefined)?.content || '';
      const fence = String(raw).match(/```(?:\w+)?\n([\s\S]*?)```/);
      const newText = fence ? fence[1].trimEnd() : String(raw).trim();
      if (!newText) { vscode.window.showErrorMessage('Concord: empty AI response'); return; }
      const confirm = await vscode.window.showInformationMessage(
        `Apply ${newText.length} chars to ${selected ? 'selection' : 'whole file'}?`, 'Apply', 'Cancel',
      );
      if (confirm !== 'Apply') return;
      await editor.edit((eb) => {
        if (selected) eb.replace(selection, newText);
        else eb.replace(new vscode.Range(0, 0, editor.document.lineCount, 0), newText);
      });
    }),

    vscode.commands.registerCommand('concord.gitCommit', async () => {
      const message = await vscode.window.showInputBox({ prompt: 'Commit message' });
      if (!message) return;
      // Pull current status to get the changed files
      const status = await _call('code', 'git_status', { repoPath: _relativeProjectPath() });
      const files = ((status.result as { files?: { path: string }[] } | undefined)?.files || []).map((f) => f.path);
      if (files.length === 0) return vscode.window.showInformationMessage('Concord: nothing to commit');
      const r = await _call('code', 'git_commit', { repoPath: _relativeProjectPath(), message, files });
      _showResult('git_commit', r);
      const result = r.result as { sha?: string; reason?: string } | undefined;
      if (result?.sha) vscode.window.showInformationMessage(`Concord: committed ${result.sha.slice(0, 7)}`);
      else vscode.window.showErrorMessage(`Concord: commit failed (${result?.reason || 'unknown'})`);
    }),

    vscode.commands.registerCommand('concord.gitStatus', async () => {
      const r = await _call('code', 'git_status', { repoPath: _relativeProjectPath() });
      _showResult('git_status', r);
    }),

    vscode.commands.registerCommand('concord.memoryAdd', async () => {
      const kind = await vscode.window.showQuickPick(['rule', 'preference', 'naming_convention', 'pattern'], { placeHolder: 'Memory kind' });
      if (!kind) return;
      const content = await vscode.window.showInputBox({ prompt: `New ${kind}` });
      if (!content) return;
      const r = await _call('code', 'memory_add', { projectPath: _relativeProjectPath(), kind, content, pinned: true });
      _showResult('memory_add', r);
      if (r.result && (r.result as { ok?: boolean }).ok !== false) vscode.window.showInformationMessage('Concord: memory added');
    }),

    vscode.commands.registerCommand('concord.memoryList', async () => {
      const r = await _call('code', 'memory_list', { projectPath: _relativeProjectPath() });
      _showResult('memory_list', r);
    }),

    vscode.commands.registerCommand('concord.specCreate', async () => {
      const title = await vscode.window.showInputBox({ prompt: 'Spec title' });
      if (!title) return;
      const body = await vscode.window.showInputBox({ prompt: 'Spec body (one requirement per line)', value: '' });
      if (!body) return;
      const r = await _call('code', 'spec_create', { title, body, projectPath: _relativeProjectPath() });
      _showResult('spec_create', r);
    }),

    vscode.commands.registerCommand('concord.specToPlan', async () => {
      const list = await _call<{ items?: { id: string; title: string }[] }>('code', 'spec_list', { kind: 'code_spec', limit: 20 });
      const items = (list.result?.items || (list as ConcordResult & { items?: { id: string; title: string }[] }).items || []);
      const pick = await vscode.window.showQuickPick(items.map((i) => ({ label: i.title, description: i.id })), { placeHolder: 'Pick a spec' });
      if (!pick) return;
      const r = await _call('code', 'spec_to_plan', { specDtuId: pick.description });
      _showResult('spec_to_plan', r);
    }),

    vscode.commands.registerCommand('concord.agentLoopRun', async () => {
      const task = await vscode.window.showInputBox({ prompt: 'Task for the agent loop' });
      if (!task) return;
      const { defaultRunner } = _cfg();
      vscode.window.showInformationMessage('Concord: agent loop running — see output for steps');
      const r = await _call('code', 'agent_loop', {
        task, projectPath: _relativeProjectPath(), files: [],
        runner: defaultRunner, runnerArgs: ['test'], maxIterations: 5,
      });
      _showResult('agent_loop', r);
    }),

    vscode.commands.registerCommand('concord.bgStart', async () => {
      const task = await vscode.window.showInputBox({ prompt: 'Background task — will run as code:bg agent' });
      if (!task) return;
      const { defaultRunner } = _cfg();
      const r = await _call('code', 'bg_start', { task, projectPath: _relativeProjectPath(), files: [], runner: defaultRunner, maxSteps: 5 });
      _showResult('bg_start', r);
      const result = r.result as { sessionId?: string } | undefined;
      if (result?.sessionId) vscode.window.showInformationMessage(`Concord: background agent started — ${result.sessionId.slice(0, 24)}`);
    }),

    vscode.commands.registerCommand('concord.bgList', async () => {
      const r = await _call('code', 'bg_list', {});
      _showResult('bg_list', r);
    }),

    vscode.commands.registerCommand('concord.semanticSearch', async () => {
      const query = await vscode.window.showInputBox({ prompt: 'Semantic search query' });
      if (!query) return;
      const r = await _call('code', 'semantic_search', { query, topK: 20 });
      _showResult('semantic_search', r);
    }),

    vscode.commands.registerCommand('concord.ingestRepo', async () => {
      const r = await _call('code', 'ingest_repo', { localPath: _relativeProjectPath(), allowCopyleft: false });
      _showResult('ingest_repo', r);
      const result = r.result as { patternsExtracted?: number } | undefined;
      if (result) vscode.window.showInformationMessage(`Concord: ${result.patternsExtracted || 0} patterns extracted`);
    }),
  );
}

export function deactivate() {}
