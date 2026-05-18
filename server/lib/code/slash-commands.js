// server/lib/code/slash-commands.js
//
// Code Sprint B Item #9 — slash commands + skill composition.
//
// Every 2026 rival has it: Cursor / Windsurf / Copilot Workspace /
// Claude Code's .claude/skills/ / Aider's `/architect /editor /commit`.
// Concord lets users author custom slash commands as DTUs (kind=
// 'code_skill') so they're citable + earn royalties when reused.
//
// Built-in commands dispatch directly to real macros (test runner,
// git, memory, agent loop, spec, ingest). Custom skills resolve to
// a stored template that gets rendered with the user's args.

const BUILTINS = [
  {
    name: "test",
    description: "Run tests via the real runner.  /test [runner] [args...]",
    parse(args, ctx) {
      const runner = args[0] || ctx?.defaultRunner || "npm";
      const restArgs = args.slice(1).length > 0 ? args.slice(1) : ["test"];
      return { domain: "code", macro: "run_tests", input: {
        runner, args: restArgs, projectPath: ctx?.projectPath || ".",
      }};
    },
  },
  {
    name: "commit",
    description: "Real git commit.  /commit <message> -- [files...]",
    parse(args, ctx) {
      const sep = args.indexOf("--");
      const messageParts = sep === -1 ? args : args.slice(0, sep);
      const files = sep === -1 ? [] : args.slice(sep + 1);
      return { domain: "code", macro: "git_commit", input: {
        repoPath: ctx?.projectPath || ".",
        message: messageParts.join(" "),
        files: files.length > 0 ? files : (ctx?.changedFiles || []),
      }};
    },
  },
  {
    name: "branch",
    description: "Git branch op.  /branch [list|current|create|checkout|delete] [name]",
    parse(args, ctx) {
      const op = args[0] || "list";
      const name = args[1] || undefined;
      return { domain: "code", macro: "git_branch", input: {
        repoPath: ctx?.projectPath || ".", op, name,
      }};
    },
  },
  {
    name: "diff",
    description: "Show real git diff.  /diff [paths...]",
    parse(args, ctx) {
      return { domain: "code", macro: "git_diff", input: {
        repoPath: ctx?.projectPath || ".",
        paths: args,
      }};
    },
  },
  {
    name: "status",
    description: "Real git status.  /status",
    parse(_args, ctx) {
      return { domain: "code", macro: "git_status", input: { repoPath: ctx?.projectPath || "." }};
    },
  },
  {
    name: "log",
    description: "Recent commits.  /log [limit]",
    parse(args, ctx) {
      return { domain: "code", macro: "git_log", input: {
        repoPath: ctx?.projectPath || ".",
        limit: args[0] ? Number(args[0]) : 20,
      }};
    },
  },
  {
    name: "memory",
    description: "Project memory.  /memory list  |  /memory add <text>  |  /memory remove <id>  |  /memory publish <id>",
    parse(args, ctx) {
      const sub = args[0] || "list";
      if (sub === "list") return { domain: "code", macro: "memory_list", input: { projectPath: ctx?.projectPath || "." } };
      if (sub === "add") return { domain: "code", macro: "memory_add", input: { projectPath: ctx?.projectPath || ".", kind: "rule", content: args.slice(1).join(" "), pinned: true } };
      if (sub === "remove") return { domain: "code", macro: "memory_remove", input: { id: args[1] } };
      if (sub === "publish") return { domain: "code", macro: "memory_publish", input: { id: args[1] } };
      if (sub === "import") return { domain: "code", macro: "memory_import_agents_md", input: { projectPath: ctx?.projectPath || ".", filename: args[1] || "AGENTS.md" } };
      if (sub === "export") return { domain: "code", macro: "memory_export_agents_md", input: { projectPath: ctx?.projectPath || ".", filename: args[1] || "AGENTS.md" } };
      return { error: "unknown_memory_subcommand" };
    },
  },
  {
    name: "loop",
    description: "Run the edit→test→fix loop.  /loop <task>",
    parse(args, ctx) {
      return { domain: "code", macro: "agent_loop", input: {
        task: args.join(" "),
        projectPath: ctx?.projectPath || ".",
        files: ctx?.openFiles || [],
        runner: ctx?.defaultRunner || "npm",
      }};
    },
  },
  {
    name: "spec",
    description: "Spec-driven workflow.  /spec create <title>  |  /spec to_plan <id>  |  /spec to_code <plan_id>",
    parse(args, ctx) {
      const sub = args[0];
      if (sub === "create") return { domain: "code", macro: "spec_create", input: { title: args.slice(1).join(" ") } };
      if (sub === "to_plan") return { domain: "code", macro: "spec_to_plan", input: { specDtuId: args[1] } };
      if (sub === "to_code") return { domain: "code", macro: "plan_to_code", input: { planDtuId: args[1], projectPath: ctx?.projectPath || ".", runner: ctx?.defaultRunner || "npm" } };
      return { error: "unknown_spec_subcommand" };
    },
  },
  {
    name: "index",
    description: "Ingest a repo into code-engine.  /index [path-or-url]",
    parse(args, _ctx) {
      const arg = args[0] || "";
      const isUrl = arg.startsWith("http") || arg.includes("/");
      return { domain: "code", macro: "ingest_repo", input: isUrl ? { url: arg } : { localPath: arg || "." } };
    },
  },
  {
    name: "search",
    description: "Semantic search of indexed patterns.  /search [category] <name>",
    parse(args, _ctx) {
      const first = args[0] || "";
      const categories = ["architectural", "error_handling", "security", "performance", "testing", "data_modeling", "api_design", "concurrency"];
      const isCategory = categories.includes(first);
      return { domain: "code", macro: "search_patterns", input: {
        category: isCategory ? first : undefined,
        name: isCategory ? args.slice(1).join(" ") : args.join(" "),
      }};
    },
  },
  {
    name: "help",
    description: "List built-in commands + your authored skills.",
    parse(_args, ctx) {
      return { domain: "_meta", macro: "help", input: { ctx } };
    },
  },
];

/**
 * Parse a slash-prefixed line into a (domain, macro, input) tuple.
 * Falls back to checking user-authored skills when the name isn't
 * a built-in.
 *
 * @param {string} line — raw input, MUST start with `/`
 * @param {object} ctx — chat-side context: projectPath, openFiles, ...
 * @param {Function} [skillResolver] — async(name) → skill DTU or null
 */
export async function parseSlash(line, ctx = {}, skillResolver = null) {
  if (!line || typeof line !== "string") return { error: "empty" };
  const trimmed = line.trim();
  if (!trimmed.startsWith("/")) return { error: "not_a_slash_command" };
  // tokenise respecting double-quoted substrings
  const parts = tokenise(trimmed.slice(1));
  if (parts.length === 0) return { error: "empty_command" };
  const name = parts[0];
  const args = parts.slice(1);

  if (name === "help") {
    return {
      domain: "_meta", macro: "help",
      input: {
        builtins: BUILTINS.map(({ name, description }) => ({ name, description })),
      },
    };
  }

  const builtin = BUILTINS.find((b) => b.name === name);
  if (builtin) {
    const dispatch = builtin.parse(args, ctx);
    if (dispatch.error) return dispatch;
    return { ...dispatch, source: "builtin" };
  }

  if (skillResolver) {
    const skill = await skillResolver(name);
    if (skill) {
      // Custom skills are templates; the macro is whatever the skill
      // declares. Default: dispatch to `code.multi-file-plan` with the
      // skill's prompt rendered with `args`.
      const promptTemplate = skill.prompt || skill.template || "";
      const rendered = promptTemplate.replace(/\$\{args\}/g, args.join(" "));
      return {
        domain: skill.domain || "code",
        macro: skill.macro || "multi-file-plan",
        input: skill.input || { prompt: rendered, files: ctx?.openFiles || [] },
        source: "skill",
        skillName: name,
        skillDtuId: skill.id,
      };
    }
  }

  return { error: "unknown_command", name };
}

export function listBuiltins() {
  return BUILTINS.map(({ name, description }) => ({ name, description }));
}

function tokenise(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    if (s[i] === '"') {
      i++;
      let buf = "";
      while (i < s.length && s[i] !== '"') {
        if (s[i] === "\\" && i + 1 < s.length) { buf += s[i + 1]; i += 2; continue; }
        buf += s[i++];
      }
      i++; out.push(buf);
    } else {
      let buf = "";
      while (i < s.length && !/\s/.test(s[i])) buf += s[i++];
      out.push(buf);
    }
  }
  return out;
}
